/**
 * Phase-1 solver pass bars from docs/ROADMAP.md and docs/GEOMETRY_DESIGN.md.
 * Synthetic only. The field circle export is not invented: that test skips
 * until fixtures/field-circle-baseline/garden.json exists.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { solverCoachLines, houseCoachLine } from '../src/coach.ts';
import { emptyDocument, normalizeDocument, syntheticDocument } from '../src/model.ts';
import {
  CHI2_2_95,
  ELLIPSE_95,
  arcStation,
  bearingSigma,
  chi2Cdf,
  dangerAssessment,
  distanceSigma,
  fitCircleGeometric,
  horizontalDistance,
  houseTolerance,
  isoscelesRange,
  levelledBearing,
  misclosureChi2,
  nees2,
  openTraverse,
  predictedBearing,
  solve,
  solveGardenDocument,
  traverseGeometry,
  trilaterationEllipse,
} from '../src/solver/index.ts';
import type { SolveInput, SolverPhotoInput } from '../src/solver/types.ts';
import { clickBearingUnlevelled, wrap } from '../src/solver/bearing.ts';
import { invertSpd } from '../src/solver/linalg.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEG = Math.PI / 180;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function point(result: ReturnType<typeof solve>, id: string) {
  const p = result.points.find((q) => q.id === id);
  assert.ok(p, id);
  return p;
}

const SHED = [
  { x: 0, y: 0 },
  { x: 7, y: 0 },
  { x: 7.4, y: 2.2 },
  { x: 6.2, y: 5.5 },
  { x: 1.5, y: 5.8 },
  { x: -0.3, y: 3.0 },
];

test('equilibrated inverse keeps a tight datum tape and an ordinary tape', () => {
  const inverse = invertSpd([
    [1, 0, 0],
    [0, 2, 0],
    [0, 0, 3],
  ]);
  assert.ok(inverse);
  assert.ok(Math.abs(inverse[0][0] - 1) < 1e-12);
  assert.ok(Math.abs(inverse[1][1] - 0.5) < 1e-12);
  assert.ok(Math.abs(inverse[2][2] - 1 / 3) < 1e-12);
  // Diagonals 1e16 and 2500 are a 1e-8 m datum beside a 20 mm tape.
  const ill = invertSpd([
    [1e16, 0],
    [0, 2500],
  ]);
  assert.ok(ill);
  assert.ok(Math.abs(ill[0][0] - 1e-16) < 1e-22);
  assert.ok(Math.abs(ill[1][1] - 1 / 2500) < 1e-12);
  assert.equal(invertSpd([
    [1, 1],
    [1, 1],
  ]), null);
});

test('χ²(2, 0.95) and the 95% ellipse factor', () => {
  assert.ok(Math.abs(chi2Cdf(CHI2_2_95, 2) - 0.95) < 1e-4);
  assert.ok(Math.abs(ELLIPSE_95 - 2.447746830680816) < 1e-9);
});

test('datum: A fixed, By fixed, Bx free, tape is a residual', () => {
  const result = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 7, sigmaM: 0.02 },
    distances: [{ id: 'AB-laser', a: 'A', b: 'B', slopeM: 7.1, sigmaM: 0.002, instrument: 'laser' }],
  });
  const A = point(result, 'A');
  const B = point(result, 'B');
  assert.equal(A.x, 0);
  assert.equal(A.y, 0);
  assert.equal(A.datumRole, 'origin');
  assert.equal(B.y, 0);
  assert.equal(B.datumRole, 'axis');
  // Precise 7.10 m tape outweighs the 7.00 m tape. B is not pinned at 7.
  assert.ok(Math.abs((B.x ?? 0) - 7.099) < 0.002, `Bx=${B.x}`);
  const coarse = result.observations.find((o) => o.id.startsWith('datum:'));
  const fine = result.observations.find((o) => o.id === 'AB-laser');
  assert.ok(coarse && fine);
  assert.ok(Math.abs(coarse.residual) > 0.05);
  assert.notEqual(B.x, 7);
  const lines = solverCoachLines(result);
  assert.ok(lines.some((l) => l.includes('ordinary distance')));
});

test('distance σ, slope reduction, laser face offset', () => {
  assert.ok(Math.abs(distanceSigma({ lengthM: 8, aM: 0.003, bPerM: 0.001 }) - Math.hypot(0.003, 0.008)) < 1e-12);
  assert.equal(distanceSigma({ lengthM: 4, instrument: 'laser' }), 0.005);
  assert.equal(distanceSigma({ lengthM: 4, instrument: 'tape' }), 0.02);
  assert.equal(distanceSigma({ lengthM: 4, sigmaM: 0.02, aM: 0.003, bPerM: 0.001 }), Math.hypot(0.003, 0.004));
  const h = horizontalDistance(10, 1, 0);
  assert.ok(h != null && Math.abs(h - Math.sqrt(99)) < 1e-12);
  // 1.0 m drop on 10 m is 50 mm of slope, always long if left unreduced.
  assert.ok(Math.abs(10 - h) - 0.05 < 0.001);
  const face = horizontalDistance(5, 0, 0.05);
  assert.ok(face != null && Math.abs(face - 5.05) < 1e-12);
  assert.equal(horizontalDistance(1, 2), null);

  const reduced = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 4, sigmaM: 0.001 },
    points: [{ id: 'P', held: { x: 6, y: 8 } }],
    distances: [
      {
        id: 'AP',
        a: 'A',
        b: 'P',
        slopeM: Math.hypot(10, 1),
        deltaHM: 1,
        sigmaM: 0.005,
        instrument: 'laser',
      },
    ],
  });
  const ap = reduced.observations.find((o) => o.id === 'AP');
  assert.ok(ap && ap.used);
  assert.ok(Math.abs(ap.residual) < 1e-6, `residual ${ap?.residual}`);
  assert.equal(ap?.sigma, 0.005);
});

test('trilateration ellipse matches 101 mm at 40° and 20/20 mm at 90°', () => {
  const at40 = trilaterationEllipse((40 * Math.PI) / 180, 0.02);
  const at90 = trilaterationEllipse((90 * Math.PI) / 180, 0.02);
  const at30 = trilaterationEllipse((30 * Math.PI) / 180, 0.02);
  const at20 = trilaterationEllipse((20 * Math.PI) / 180, 0.02);
  assert.ok(Math.abs(at90.major1M - 0.02) < 1e-9);
  assert.ok(Math.abs(at90.minor1M - 0.02) < 1e-9);
  assert.ok(Math.abs(at40.major1M - 0.04135) < 0.001);
  assert.ok(Math.abs(at40.minor1M - 0.01505) < 0.001);
  assert.ok(Math.abs(at40.major95M - 0.101) < 0.002, `95% ${at40.major95M}`);
  assert.ok(Math.abs(at90.drmsM - 0.02 * Math.SQRT2) < 1e-9);
  assert.ok(Math.abs(at30.drmsM - 0.05657) < 0.001);
  assert.ok(Math.abs(at20.major95M - 0.199) < 0.003);
});

test('two tapes are unchecked; 40° semi-major is about 101 mm; shallow angle warns', () => {
  const L = 7;
  const phi = (40 * Math.PI) / 180;
  const d = L / 2 / Math.tan(phi / 2);
  const truth = { x: L / 2, y: d };
  const range = Math.hypot(L / 2, d);
  const fixed = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: L, sigmaM: 1e-8 },
    distances: [
      { id: 'AP', a: 'A', b: 'P', slopeM: range, sigmaM: 0.02 },
      { id: 'BP', a: 'B', b: 'P', slopeM: range, sigmaM: 0.02 },
    ],
  });
  const P = point(fixed, 'P');
  assert.equal(P.status, 'unchecked');
  assert.ok(Math.abs((P.x ?? 0) - truth.x) < 1e-4);
  assert.ok(Math.abs((P.y ?? 0) - truth.y) < 1e-4);
  assert.ok(Math.abs((P.semiMajor95M ?? 0) - 0.101) < 0.005, `semi ${P.semiMajor95M}`);
  assert.equal(fixed.degreesOfFreedom, 0);
  assert.equal(fixed.varianceTest, 'undefined');
  const sumR = fixed.observations.filter((o) => o.used).reduce((s, o) => s + o.redundancy, 0);
  assert.ok(Math.abs(sumR - fixed.degreesOfFreedom) < 1e-6);

  const shallow = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: L, sigmaM: 1e-8 },
    distances: [
      { id: 'AP', a: 'A', b: 'P', slopeM: Math.hypot(L / 2, 26.584), sigmaM: 0.02 },
      { id: 'BP', a: 'B', b: 'P', slopeM: Math.hypot(L / 2, 26.584), sigmaM: 0.02 },
    ],
  });
  const S = point(shallow, 'P');
  assert.equal(S.earlyWarning, 'shallow-intersection');
  assert.ok((S.semiMajor95M ?? 0) > 0.2);

  const flat = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: L, sigmaM: 1e-8 },
    distances: [
      { id: 'AP', a: 'A', b: 'P', slopeM: Math.hypot(L / 2, 0.15), sigmaM: 0.02 },
      { id: 'BP', a: 'B', b: 'P', slopeM: Math.hypot(L / 2, 0.15), sigmaM: 0.02 },
    ],
  });
  assert.equal(point(flat, 'P').earlyWarning, 'straight-intersection');
  assert.ok(solverCoachLines(fixed).some((l) => l.includes('unchecked')));
});

test('Monte Carlo: 40° errors sit in the predicted ellipse, NEES ≈ 2, about 25% miss 50 mm', () => {
  const L = 7;
  const phi = (40 * Math.PI) / 180;
  const d = L / 2 / Math.tan(phi / 2);
  const truth = { x: L / 2, y: d };
  const range = Math.hypot(truth.x, truth.y);
  const rng = mulberry32(40);
  const trials = 400;
  let inside = 0;
  let neesSum = 0;
  let miss50 = 0;
  for (let i = 0; i < trials; i++) {
    const ap = range + gaussian(rng) * 0.02;
    const bp = range + gaussian(rng) * 0.02;
    const result = solve({
      datum: { originId: 'A', axisPointId: 'B', lengthM: L, sigmaM: 1e-8 },
      distances: [
        { id: 'AP', a: 'A', b: 'P', slopeM: ap, sigmaM: 0.02 },
        { id: 'BP', a: 'B', b: 'P', slopeM: bp, sigmaM: 0.02 },
      ],
    });
    const P = point(result, 'P');
    assert.ok(P.q && P.x != null && P.y != null);
    const n = nees2(P.x - truth.x, P.y - truth.y, P.q[0], P.q[1], P.q[2]);
    neesSum += n;
    if (n <= CHI2_2_95) inside++;
    if (Math.hypot(P.x - truth.x, P.y - truth.y) > 0.05) miss50++;
  }
  const coverage = inside / trials;
  const meanNees = neesSum / trials;
  assert.ok(coverage > 0.9 && coverage < 0.99, `coverage ${coverage}`);
  assert.ok(meanNees > 1.5 && meanNees < 2.5, `NEES ${meanNees}`);
  const rate = miss50 / trials;
  assert.ok(rate > 0.15 && rate < 0.36, `P(|e|>50 mm) ${rate}`);
});

test('bearing sign: camera at the origin facing +X, point (10, 1) is positive', () => {
  const pred = predictedBearing(10, 1, 0, 0, 0);
  const deg = (pred * 180) / Math.PI;
  assert.ok(Math.abs(deg - 5.710593137) < 1e-6, `pred ${deg}`);
  assert.ok(pred > 0);
  const fx = 900;
  const cx = 600;
  const px = cx - fx * Math.tan(pred);
  assert.ok(px < cx);
  const beta = levelledBearing({ px, py: 450, cx, cy: 450, fx, fy: fx });
  assert.ok(Math.abs(((beta - pred) * 180) / Math.PI) < 1e-9);
  // The 0.7.25 sign is the opposite and is not what this module returns.
  assert.ok(clickBearingUnlevelled(px, cx, fx) > 0);
  assert.ok(Math.atan2(px - cx, fx) < 0);
  // Published pixel check: px = 510, cx = 600, fx = 900 → +5.711°.
  const published = (clickBearingUnlevelled(510, 600, 900) * 180) / Math.PI;
  assert.ok(Math.abs(published - 5.711) < 0.001, `published ${published}`);
});

test('gravity tilt table at fx = 900', () => {
  const fx = 900;
  const cx = 600;
  const cy = 450;
  const cases: [number, number, number, number, number][] = [
    [15, 0, 400, 200, 0.49],
    [15, 0, 400, -200, -2.11],
    [0, 2, 0, 300, 0.67],
    [10, 2, 400, 250, 1.2],
  ];
  for (const [pitch, roll, u, v, expected] of cases) {
    const p = pitch * DEG;
    const r = roll * DEG;
    const gravity = {
      x: Math.cos(p) * Math.sin(r),
      y: Math.cos(p) * Math.cos(r),
      z: -Math.sin(p),
    };
    const level = levelledBearing({
      px: cx + u,
      py: cy + v,
      cx,
      cy,
      fx,
      fy: fx,
      gravity,
    });
    const naive = Math.atan2(-u, fx);
    const err = ((level - naive) * 180) / Math.PI;
    assert.ok(Math.abs(err - expected) < 0.02, `pitch ${pitch} roll ${roll} (${u},${v}) err ${err}`);
  }
  const sigma = bearingSigma({ sigmaPx: 2, fx: 900, sigmaCentringM: 0.005, rangeM: 10 });
  assert.ok(Math.abs(sigma - Math.hypot(2 / 900, 0.005 / 10)) < 1e-12);
});

test('isosceles focal-length danger is ±1.98 m and is not the station the solver uses', () => {
  const theta = 20 * DEG;
  const d = isoscelesRange(7, theta);
  assert.ok(Math.abs(d - 19.8495) < 0.001);
  for (const factor of [0.9, 1.1]) {
    const half = Math.atan(Math.tan(theta / 2) / factor);
    const shifted = isoscelesRange(7, 2 * half);
    assert.ok(Math.abs(Math.abs(shifted - d) - 1.985) < 0.002, `Δd ${shifted - d}`);
  }
  // 7 m / 20° arc radius.
  assert.ok(Math.abs(7 / (2 * Math.sin(theta)) - 10.233) < 0.01);
});

function projectClick(
  station: { x: number; y: number },
  yaw: number,
  mark: { x: number; y: number },
  width: number,
  fxOverWidth: number,
): { px: number; py: number } {
  const fx = fxOverWidth * width;
  const beta = wrap(Math.atan2(mark.y - station.y, mark.x - station.x) - yaw);
  return { px: width / 2 - fx * Math.tan(beta), py: 450 };
}

test('two marks and no tape: no coordinate. One tape: two candidates about 20 m apart', () => {
  const theta = 20 * DEG;
  const C = { x: 3.5, y: isoscelesRange(7, theta) };
  const yaw = -Math.PI / 2;
  const bA = wrap(Math.atan2(0 - C.y, 0 - C.x) - yaw);
  const bB = wrap(Math.atan2(0 - C.y, 7 - C.x) - yaw);
  const arcOnly = arcStation({ a: { x: 0, y: 0 }, b: { x: 7, y: 0 }, bearingA: bA, bearingB: bB });
  assert.equal(arcOnly.code, 'arc-only');
  assert.equal(arcOnly.candidates.length, 0);
  assert.ok(Math.abs(arcOnly.radiusM - 10.233) < 0.01);

  const toA = arcStation({
    a: { x: 0, y: 0 },
    b: { x: 7, y: 0 },
    bearingA: bA,
    bearingB: bB,
    tape: { to: 'a', lengthM: 15 },
  });
  assert.equal(toA.candidates.length, 2);
  assert.equal(toA.unique, false);
  const sepA = Math.hypot(toA.candidates[0].x - toA.candidates[1].x, toA.candidates[0].y - toA.candidates[1].y);
  assert.ok(Math.abs(sepA - 20.41) < 0.05, `sep ${sepA}`);
  const xs = toA.candidates.map((p) => p.x).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[0] + 5.83) < 0.05);
  assert.ok(Math.abs(xs[1] - 13.35) < 0.05);

  const mid = arcStation({
    a: { x: 0, y: 0 },
    b: { x: 7, y: 0 },
    bearingA: bA,
    bearingB: bB,
    tape: { to: 'mid', lengthM: 15 },
  });
  assert.equal(mid.midpointTape, true);
  assert.equal(mid.candidates.length, 2);
  const sepM = Math.hypot(mid.candidates[0].x - mid.candidates[1].x, mid.candidates[0].y - mid.candidates[1].y);
  assert.ok(Math.abs(sepM - 20.26) < 0.05);

  const unique = arcStation({
    a: { x: 0, y: 0 },
    b: { x: 7, y: 0 },
    bearingA: bA,
    bearingB: bB,
    tape: { to: 'a', lengthM: 5 },
  });
  assert.equal(unique.unique, true);
  assert.equal(unique.candidates.length, 1);

  const width = 1200;
  const fxOverWidth = 0.75;
  const photo = (clicks: SolverPhotoInput['clicks']): SolverPhotoInput => ({
    id: 'cam',
    stationId: 'S',
    width,
    height: 900,
    fxOverWidth,
    fxRelativeUncertainty: 0.005,
    gravity: { x: 0, y: 1, z: 0 },
    bearingSigmaRad: 0.1 * DEG,
    clicks,
  });
  const clicks = [
    { pointId: 'A', ...projectClick(C, yaw, { x: 0, y: 0 }, width, fxOverWidth) },
    { pointId: 'B', ...projectClick(C, yaw, { x: 7, y: 0 }, width, fxOverWidth) },
  ];
  const none = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 7, sigmaM: 0.02 },
    photos: [photo(clicks)],
  });
  const bare = point(none, 'S');
  assert.equal(bare.status, 'unset');
  assert.equal(bare.x, undefined);
  assert.equal(bare.unsetCode, 'arc-only');

  const oneTape = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 7, sigmaM: 1e-8 },
    photos: [photo(clicks)],
    distances: [{ id: 'SA', a: 'S', b: 'A', slopeM: 15, sigmaM: 0.02 }],
  });
  const amb = point(oneTape, 'S');
  assert.equal(amb.status, 'unset');
  assert.equal(amb.x, undefined);
  assert.equal(amb.unsetCode, 'two-candidates');
  assert.ok(Math.abs((amb.candidateSeparationM ?? 0) - 20.4) < 0.1);
  assert.equal(amb.meetsStationClass, undefined);
  assert.ok(solverCoachLines(oneTape).some((l) => l.includes('two candidates')));

  const chosen = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 7, sigmaM: 1e-8 },
    photos: [photo(clicks)],
    distances: [{ id: 'SA', a: 'S', b: 'A', slopeM: 15, sigmaM: 0.02 }],
    branchChoices: [{ id: 'S', candidateIndex: 0 }],
  });
  const branch = point(chosen, 'S');
  assert.equal(branch.status, 'unchecked');
  assert.equal(branch.branchChoice, true);
  assert.equal(branch.meetsStationClass, false);
  assert.equal(branch.stationClassBlock, 'branch');
  assert.ok(branch.x != null && branch.y != null);
});

test('tapes to both ends fix one station; bearings check it', () => {
  const S = { x: 3.5, y: 5 };
  const yaw = -Math.PI / 2;
  const width = 1200;
  const fxOverWidth = 0.72;
  const result = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 7, sigmaM: 0.02 },
    photos: [
      {
        id: 'cam',
        stationId: 'S',
        width,
        height: 900,
        fxOverWidth,
        gravity: { x: 0, y: 1, z: 0 },
        bearingSigmaRad: 0.1 * DEG,
        clicks: [
          { pointId: 'A', ...projectClick(S, yaw, { x: 0, y: 0 }, width, fxOverWidth) },
          { pointId: 'B', ...projectClick(S, yaw, { x: 7, y: 0 }, width, fxOverWidth) },
        ],
      },
    ],
    distances: [
      { id: 'SA', a: 'S', b: 'A', slopeM: Math.hypot(S.x, S.y), sigmaM: 0.02 },
      { id: 'SB', a: 'S', b: 'B', slopeM: Math.hypot(S.x - 7, S.y), sigmaM: 0.02 },
    ],
  });
  const station = point(result, 'S');
  assert.equal(station.method, 'both-tapes');
  assert.notEqual(station.status, 'unset');
  assert.ok(Math.abs((station.x ?? 0) - S.x) < 1e-3);
  assert.ok(Math.abs((station.y ?? 0) - S.y) < 1e-3);
  assert.equal(station.meetsStationClass, true);
  assert.ok((station.semiMajor95M ?? 1) <= 0.2);
  // Focal length did not have to be declared: the tapes set the coordinate.
  assert.ok(result.degreesOfFreedom >= 1);
});

test('resection recovers the station, meets 200 mm only with fx ≤ 1% and levelled rays', () => {
  const marks = [
    { id: 'A', x: 0, y: 0 },
    { id: 'B', x: 8, y: 0 },
    { id: 'C', x: 1, y: 3 },
    { id: 'D', x: 7, y: 3 },
  ];
  const S = { x: 4, y: 8 };
  const yaw = -Math.PI / 2;
  const width = 1200;
  const fx = 0.72;
  const clicks = marks.map((m) => ({ pointId: m.id, ...projectClick(S, yaw, m, width, fx) }));
  const input = (fxOverWidth: number, uncertainty: number | undefined, gravity: boolean): SolveInput => ({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 8, sigmaM: 1e-6 },
    points: [
      { id: 'C', held: { x: 1, y: 3 } },
      { id: 'D', held: { x: 7, y: 3 } },
    ],
    photos: [
      {
        id: 'cam',
        stationId: 'S',
        width,
        height: 900,
        fxOverWidth,
        fxRelativeUncertainty: uncertainty,
        gravity: gravity ? { x: 0, y: 1, z: 0 } : undefined,
        bearingSigmaRad: 0.1 * DEG,
        clicks,
      },
    ],
  });
  const good = solve(input(fx, 0.005, true));
  const station = point(good, 'S');
  assert.equal(station.method, 'resection');
  assert.ok(Math.abs((station.x ?? 99) - S.x) < 1e-3, `x ${station.x}`);
  assert.ok(Math.abs((station.y ?? 99) - S.y) < 1e-3, `y ${station.y}`);
  assert.ok((station.semiMajor95M ?? 1) <= 0.2, `semi ${station.semiMajor95M}`);
  assert.equal(station.meetsStationClass, true);
  assert.equal(station.status, 'checked');

  const badFx = solve(input(fx * 1.1, 0.1, true));
  const moved = point(badFx, 'S');
  const shift = Math.hypot((moved.x ?? 0) - S.x, (moved.y ?? 0) - S.y);
  assert.ok(shift > 0.2, `10% fx shift ${shift}`);
  assert.equal(moved.meetsStationClass, false);
  assert.equal(moved.stationClassBlock, 'fx');

  const unlevelled = solve(input(fx, 0.005, false));
  assert.equal(point(unlevelled, 'S').meetsStationClass, false);
  assert.equal(point(unlevelled, 'S').stationClassBlock, 'level');
});

test('photo-station Monte Carlo NEES ≈ 2', () => {
  const marks = [
    { id: 'A', x: 0, y: 0 },
    { id: 'B', x: 8, y: 0 },
    { id: 'C', x: 1, y: 3 },
    { id: 'D', x: 7, y: 3 },
  ];
  const S = { x: 4, y: 8 };
  const yaw = -Math.PI / 2;
  const width = 1200;
  const fxOver = 0.72;
  const fx = fxOver * width;
  const sigma = 0.1 * DEG;
  const rng = mulberry32(7);
  let inside = 0;
  let neesSum = 0;
  const trials = 200;
  for (let t = 0; t < trials; t++) {
    const clicks = marks.map((m) => {
      const beta = wrap(Math.atan2(m.y - S.y, m.x - S.x) - yaw) + gaussian(rng) * sigma;
      return { pointId: m.id, px: width / 2 - fx * Math.tan(beta), py: 450 };
    });
    const result = solve({
      datum: { originId: 'A', axisPointId: 'B', lengthM: 8, sigmaM: 1e-8 },
      points: [
        { id: 'C', held: { x: 1, y: 3 } },
        { id: 'D', held: { x: 7, y: 3 } },
      ],
      photos: [
        {
          id: 'cam',
          stationId: 'S',
          width,
          height: 900,
          fxOverWidth: fxOver,
          fxRelativeUncertainty: 0.005,
          gravity: { x: 0, y: 1, z: 0 },
          bearingSigmaRad: sigma,
          clicks,
        },
      ],
    });
    const P = point(result, 'S');
    assert.ok(P.q && P.x != null && P.y != null, P.unsetCode);
    const n = nees2(P.x - S.x, P.y - S.y, P.q[0], P.q[1], P.q[2]);
    neesSum += n;
    if (n <= CHI2_2_95) inside++;
  }
  assert.ok(inside / trials > 0.88 && inside / trials < 0.995, `coverage ${inside / trials}`);
  const mean = neesSum / trials;
  assert.ok(mean > 1.4 && mean < 2.6, `NEES ${mean}`);
});

test('θ → 0 and the danger circle publish no coordinate', () => {
  const flat = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 7, sigmaM: 0.02 },
    photos: [
      {
        id: 'cam',
        stationId: 'S',
        width: 1200,
        height: 900,
        fxOverWidth: 0.72,
        gravity: { x: 0, y: 1, z: 0 },
        clicks: [
          { pointId: 'A', px: 600, py: 450 },
          { pointId: 'B', px: 601, py: 450 },
        ],
      },
    ],
  });
  assert.equal(point(flat, 'S').status, 'unset');
  assert.equal(point(flat, 'S').x, undefined);
  assert.equal(point(flat, 'S').unsetCode, 'flat-angle');

  // Three marks and a station 5% off their circumcircle, on the far side.
  // The near side of this flat circle sits on the middle mark, where the
  // ellipse is tens of millimetres and a coordinate is still published.
  const marks = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 3, y: 1 },
  ];
  const danger = dangerAssessment({ x: 3, y: 10 }, marks);
  assert.equal(danger.kind, 'circle');
  assert.ok(danger.circumRadiusM != null);
  const centre = circumcentre(marks[0], marks[1], marks[2]);
  const R = danger.circumRadiusM!;
  const centroid = {
    x: (marks[0].x + marks[1].x + marks[2].x) / 3,
    y: (marks[0].y + marks[1].y + marks[2].y) / 3,
  };
  const away = { x: centre.x - centroid.x, y: centre.y - centroid.y };
  const nrm = Math.hypot(away.x, away.y);
  const station = { x: centre.x + (away.x / nrm) * R * 1.05, y: centre.y + (away.y / nrm) * R * 1.05 };
  const ratio = dangerAssessment(station, marks);
  assert.equal(ratio.kind, 'circle');
  assert.ok(ratio.ratio < 0.2, `ratio ${ratio.ratio}`);
  const yaw = Math.atan2(3 - station.y, 3 - station.x);
  const width = 1200;
  const fx = 0.72;
  const ids = ['A', 'B', 'C'];
  const result = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 6, sigmaM: 1e-8 },
    points: [{ id: 'C', held: { x: 3, y: 1 } }],
    photos: [
      {
        id: 'cam',
        stationId: 'S',
        width,
        height: 900,
        fxOverWidth: fx,
        fxRelativeUncertainty: 0.005,
        gravity: { x: 0, y: 1, z: 0 },
        bearingSigmaRad: 0.1 * DEG,
        clicks: marks.map((m, i) => ({ pointId: ids[i], ...projectClick(station, yaw, m, width, fx) })),
      },
    ],
  });
  const S = point(result, 'S');
  assert.equal(S.status, 'unset');
  assert.equal(S.x, undefined);
  assert.equal(S.unsetCode, 'danger');
  assert.ok((S.rejected?.semiMajor95M ?? 0) > 0.2);
  assert.ok(solverCoachLines(result).some((l) => l.includes('danger circle')));
});

test('collinear rod uses distance-to-line / range, not |ρ − R| / R', () => {
  const marks = [
    { x: 2, y: 9 },
    { x: 4, y: 9 },
    { x: 6, y: 9 },
  ];
  const station = { x: 4, y: 0 };
  const danger = dangerAssessment(station, marks);
  assert.equal(danger.kind, 'line');
  assert.equal(danger.circumRadiusM, null);
  assert.ok(Math.abs(danger.ratio - 1) < 0.15, `ratio ${danger.ratio}`);
  const yaw = Math.PI / 2;
  const width = 1200;
  const fx = 0.72;
  const result = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 8, sigmaM: 1e-8 },
    points: marks.map((m, i) => ({ id: ['A1', 'A0', 'A2'][i], held: m })),
    photos: [
      {
        id: 'cam',
        stationId: 'S',
        width,
        height: 900,
        fxOverWidth: fx,
        fxRelativeUncertainty: 0.005,
        gravity: { x: 0, y: 1, z: 0 },
        bearingSigmaRad: 0.1 * DEG,
        clicks: marks.map((m, i) => ({
          pointId: ['A1', 'A0', 'A2'][i],
          ...projectClick(station, yaw, m, width, fx),
        })),
      },
    ],
  });
  const S = point(result, 'S');
  assert.equal(S.dangerKind, 'line');
  assert.notEqual(S.dangerRatio, undefined);
  assert.ok(Number.isFinite(S.dangerRatio));
  // About 1 m at 95% at 9 m with 0.1° rays. The ellipse is allowed to decide.
  assert.ok(S.x != null && S.y != null, S.unsetCode);
  assert.ok((S.semiMajor95M ?? 0) > 0.4 && (S.semiMajor95M ?? 0) < 2.5, `semi ${S.semiMajor95M}`);
  assert.equal(S.meetsStationClass, false);
});

test('ray crossing: about 43 mm at 90° and about 231 mm at 15°', () => {
  function run(s1: { x: number; y: number }, s2: { x: number; y: number }, mark: { x: number; y: number }) {
    const az = (s: { x: number; y: number }) => Math.atan2(mark.y - s.y, mark.x - s.x);
    return solve({
      datum: { originId: 'A', axisPointId: 'B', lengthM: 30, sigmaM: 1e-8 },
      points: [
        { id: 'S1', held: s1 },
        { id: 'S2', held: s2 },
      ],
      photos: (['S1', 'S2'] as const).map((id, i) => {
        const s = i === 0 ? s1 : s2;
        return {
          id: `p${i}`,
          stationId: id,
          width: 1200,
          height: 900,
          fxOverWidth: 0.72,
          // Aim straight at the mark so the click is on the principal point.
          yawHeldRad: az(s),
          bearingSigmaRad: 0.1 * DEG,
          gravity: { x: 0, y: 1, z: 0 },
          clicks: [{ pointId: 'M', px: 600, py: 450 }],
        };
      }),
    });
  }
  const mark = { x: 4, y: 6 };
  const square = run({ x: 4, y: 16 }, { x: 14, y: 6 }, mark);
  const M = point(square, 'M');
  assert.ok(Math.abs((M.x ?? 0) - mark.x) < 1e-3, `x ${M.x} ${M.unsetCode}`);
  assert.ok(Math.abs((M.y ?? 0) - mark.y) < 1e-3, `y ${M.y}`);
  assert.ok(Math.abs((M.semiMajor95M ?? 0) - 0.0427) < 0.008, `90° ${M.semiMajor95M}`);
  assert.notEqual(M.earlyWarning, 'shallow-rays');

  const phi = 15 * DEG;
  const range = 10;
  const shallowMark = { x: 1, y: 4 };
  const shallow = run(
    { x: shallowMark.x + range, y: shallowMark.y },
    {
      x: shallowMark.x + range * Math.cos(phi),
      y: shallowMark.y + range * Math.sin(phi),
    },
    shallowMark,
  );
  const N = point(shallow, 'M');
  assert.equal(N.earlyWarning, 'shallow-rays');
  assert.ok(Math.abs((N.semiMajor95M ?? 0) - 0.231) < 0.03, `15° ${N.semiMajor95M}`);
  assert.equal(N.plantable, false);
});

test('one taped edge stays unfixed — no 90° turn', () => {
  const result = solve({
    datum: { originId: 'HSE01', axisPointId: 'HSE02', lengthM: 7, sigmaM: 0.02 },
    distances: [{ id: 'wall', a: 'HSE02', b: 'HSE03', slopeM: 2.236, sigmaM: 0.02 }],
  });
  const corner = point(result, 'HSE03');
  assert.equal(corner.status, 'unset');
  assert.equal(corner.x, undefined);
  assert.equal(corner.unsetCode, 'one-distance');
  assert.ok(solverCoachLines(result).some((l) => l.includes('will not turn 90')));

  const checked = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 7, sigmaM: 1e-8 },
    points: [{ id: 'C', held: { x: 0, y: 4 } }],
    distances: [
      { id: 'AP', a: 'A', b: 'P', slopeM: 5, sigmaM: 0.02 },
      { id: 'BP', a: 'B', b: 'P', slopeM: Math.hypot(2, 5), sigmaM: 0.02 },
    ],
  });
  // Two distances, nothing spare.
  assert.equal(point(checked, 'P').status, 'unchecked');
});

test('demo shed Q_m is 93 mm and 144 mm, and a flat 50 mm gate false-alarms about 35%', () => {
  const tapes = houseTolerance(SHED, 0.02);
  assert.equal(tapes.hasTraverseMisclosure, false);
  assert.ok(Math.abs(tapes.semiMajor95M - 0.09253) < 0.001, `tapes ${tapes.semiMajor95M}`);
  assert.equal(tapes.pass, null);

  const angled = houseTolerance(SHED, 0.02, 0.2 * DEG, { x: 0, y: 0 });
  assert.equal(angled.hasTraverseMisclosure, true);
  assert.ok(Math.abs(angled.semiMajor95M - 0.14394) < 0.001, `angles ${angled.semiMajor95M}`);
  assert.equal(angled.pass, true);
  assert.ok((angled.chi2 ?? 1) <= CHI2_2_95);

  const g = traverseGeometry(SHED);
  const sigSplit = g.lengths.map((L) => Math.hypot(0.003, 0.001 * L));
  const split = houseTolerance(SHED, sigSplit);
  const splitAng = houseTolerance(SHED, sigSplit, 0.2 * DEG);
  assert.ok(Math.abs(split.semiMajor95M - 0.02424) < 0.001, `split ${split.semiMajor95M}`);
  assert.ok(Math.abs(splitAng.semiMajor95M - 0.11595) < 0.002, `split+ang ${splitAng.semiMajor95M}`);

  const blown = houseTolerance(SHED, 0.02, 0.2 * DEG, { x: 1, y: 1 });
  assert.equal(blown.pass, false);
  assert.ok((blown.chi2 ?? 0) > CHI2_2_95);
  assert.ok(Math.abs(misclosureChi2(angled.qM, { x: 0, y: 0 })) < 1e-12);

  const rng = mulberry32(93);
  let over = 0;
  const trials = 4000;
  for (let i = 0; i < trials; i++) {
    const lengths = g.lengths.map((L) => L + gaussian(rng) * 0.02);
    const m = openTraverse(lengths, g.azimuth0, g.turnings);
    if (Math.hypot(m.x, m.y) > 0.05) over++;
  }
  const rate = over / trials;
  assert.ok(rate > 0.3 && rate < 0.4, `P(|m|>50 mm) ${rate}`);
  const sentence = houseCoachLine(tapes);
  assert.match(sentence, /no traverse misclosure/i);
  assert.match(sentence, /93 mm/);
  assert.match(houseCoachLine(angled), /144 mm/);
});

test('plantable point: ≤ 100 mm, a spare observation, and a withheld distance inside 1.96 σ', () => {
  const L = 7;
  const phi = (40 * Math.PI) / 180;
  const truth = { x: L / 2, y: L / 2 / Math.tan(phi / 2) };
  const range = Math.hypot(truth.x, truth.y);
  const C = { x: 0, y: 6 };
  const cp = Math.hypot(truth.x - C.x, truth.y - C.y);
  const F = { x: 3.5, y: 0 };
  const fp = Math.hypot(truth.x - F.x, truth.y - F.y);
  const sigma = 0.005;
  const exact = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: L, sigmaM: 1e-8 },
    points: [
      { id: 'C', held: C },
      { id: 'F', held: F },
    ],
    distances: [
      { id: 'AP', a: 'A', b: 'P', slopeM: range, sigmaM: sigma },
      { id: 'BP', a: 'B', b: 'P', slopeM: range, sigmaM: sigma },
      { id: 'CP', a: 'C', b: 'P', slopeM: cp, sigmaM: sigma },
      { id: 'FP', a: 'F', b: 'P', slopeM: fp, sigmaM: sigma, withheld: true },
    ],
  });
  const P = point(exact, 'P');
  assert.equal(P.status, 'checked');
  assert.ok((P.semiMajor95M ?? 1) <= 0.1, `semi ${P.semiMajor95M}`);
  assert.equal(P.plantable, true);
  assert.equal(exact.withheld.length, 1);
  assert.equal(exact.withheld[0].pass, true);
  assert.ok(exact.withheld[0].limitM > 0);
  const sumR = exact.observations.filter((o) => o.used).reduce((s, o) => s + o.redundancy, 0);
  assert.ok(Math.abs(sumR - exact.degreesOfFreedom) < 1e-5);
  assert.ok(exact.degreesOfFreedom >= 1);

  // Two 20 mm tapes at 40° are about 101 mm. A withheld tape does not
  // enter the adjustment, so the point stays unchecked and is not plantable.
  const coarse = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: L, sigmaM: 1e-8 },
    points: [{ id: 'F', held: F }],
    distances: [
      { id: 'AP', a: 'A', b: 'P', slopeM: range, sigmaM: 0.02 },
      { id: 'BP', a: 'B', b: 'P', slopeM: range, sigmaM: 0.02 },
      { id: 'FP', a: 'F', b: 'P', slopeM: fp, sigmaM: 0.02, withheld: true },
    ],
  });
  const coarseP = point(coarse, 'P');
  assert.equal(coarseP.status, 'unchecked');
  assert.ok(Math.abs((coarseP.semiMajor95M ?? 0) - 0.101) < 0.008, `coarse ${coarseP.semiMajor95M}`);
  assert.equal(coarseP.plantable, false);

  const rng = mulberry32(196);
  let pass = 0;
  const trials = 200;
  for (let i = 0; i < trials; i++) {
    const result = solve({
      datum: { originId: 'A', axisPointId: 'B', lengthM: L, sigmaM: 1e-8 },
      points: [
        { id: 'C', held: C },
        { id: 'F', held: F },
      ],
      distances: [
        { id: 'AP', a: 'A', b: 'P', slopeM: range + gaussian(rng) * sigma, sigmaM: sigma },
        { id: 'BP', a: 'B', b: 'P', slopeM: range + gaussian(rng) * sigma, sigmaM: sigma },
        { id: 'CP', a: 'C', b: 'P', slopeM: cp + gaussian(rng) * sigma, sigmaM: sigma },
        { id: 'FP', a: 'F', b: 'P', slopeM: fp + gaussian(rng) * sigma, sigmaM: sigma, withheld: true },
      ],
    });
    if (result.withheld[0]?.pass) pass++;
  }
  const rate = pass / trials;
  assert.ok(rate > 0.88 && rate < 0.995, `withheld pass ${rate}`);
});

test('blunders: two-sided χ², |w| > 3.29, MDB, drop one and re-solve', () => {
  const truth = { x: 3, y: 4 };
  const C = { x: 0, y: 5 };
  const D = { x: 6, y: 5 };
  const dists = {
    AP: Math.hypot(truth.x, truth.y),
    BP: Math.hypot(truth.x - 6, truth.y),
    CP: Math.hypot(truth.x - C.x, truth.y - C.y),
    DP: Math.hypot(truth.x - D.x, truth.y - D.y),
  };
  const clean = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 6, sigmaM: 0.02 },
    points: [
      { id: 'C', held: C },
      { id: 'D', held: D },
    ],
    distances: [
      { id: 'AP', a: 'A', b: 'P', slopeM: dists.AP, sigmaM: 0.02 },
      { id: 'BP', a: 'B', b: 'P', slopeM: dists.BP, sigmaM: 0.02 },
      { id: 'CP', a: 'C', b: 'P', slopeM: dists.CP, sigmaM: 0.02 },
      { id: 'DP', a: 'D', b: 'P', slopeM: dists.DP, sigmaM: 0.02 },
    ],
  });
  assert.equal(clean.varianceTest, 'low');
  assert.ok((clean.sigma0 ?? 1) < 0.01);
  for (const o of clean.observations.filter((q) => q.used && q.redundancy > 0.1)) {
    assert.ok(o.mdb != null);
    assert.ok(Math.abs((o.mdb ?? 0) - (4.13 * o.sigma) / Math.sqrt(o.redundancy)) < 1e-9);
  }

  const blunder = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 6, sigmaM: 0.02 },
    points: [
      { id: 'C', held: C },
      { id: 'D', held: D },
    ],
    distances: [
      { id: 'AP', a: 'A', b: 'P', slopeM: dists.AP + 0.5, sigmaM: 0.02 },
      { id: 'BP', a: 'B', b: 'P', slopeM: dists.BP, sigmaM: 0.02 },
      { id: 'CP', a: 'C', b: 'P', slopeM: dists.CP, sigmaM: 0.02 },
      { id: 'DP', a: 'D', b: 'P', slopeM: dists.DP, sigmaM: 0.02 },
    ],
  });
  assert.equal(blunder.varianceTest, 'high');
  const flagged = blunder.observations
    .filter((o) => o.flagged && o.standardised != null)
    .sort((a, b) => Math.abs(b.standardised ?? 0) - Math.abs(a.standardised ?? 0))[0];
  assert.ok(flagged);
  assert.equal(flagged.id, 'AP');
  assert.ok(Math.abs(flagged.standardised ?? 0) > 3.29);
  assert.ok(solverCoachLines(blunder).some((l) => l.includes('w-test')));

  const dropped = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 6, sigmaM: 0.02 },
    points: [
      { id: 'C', held: C },
      { id: 'D', held: D },
    ],
    distances: [
      { id: 'AP', a: 'A', b: 'P', slopeM: dists.AP + 0.5, sigmaM: 0.02 },
      { id: 'BP', a: 'B', b: 'P', slopeM: dists.BP, sigmaM: 0.02 },
      { id: 'CP', a: 'C', b: 'P', slopeM: dists.CP, sigmaM: 0.02 },
      { id: 'DP', a: 'D', b: 'P', slopeM: dists.DP, sigmaM: 0.02 },
    ],
    dropBlunders: true,
  });
  assert.ok(dropped.droppedObservationIds.includes('AP'));
  assert.ok(Math.abs((point(dropped, 'P').x ?? 0) - truth.x) < 0.02);
  assert.ok(Math.abs((point(dropped, 'P').y ?? 0) - truth.y) < 0.02);
});

test('noisy redundant network passes the variance test about 95% of the time', () => {
  const truth = { x: 3, y: 4 };
  const C = { x: 0, y: 5 };
  const D = { x: 6, y: 5 };
  const sigma = 0.02;
  const pairs = [
    ['A', Math.hypot(truth.x, truth.y)],
    ['B', Math.hypot(truth.x - 6, truth.y)],
    ['C', Math.hypot(truth.x - C.x, truth.y - C.y)],
    ['D', Math.hypot(truth.x - D.x, truth.y - D.y)],
  ] as const;
  const rng = mulberry32(5);
  let ok = 0;
  const trials = 200;
  for (let i = 0; i < trials; i++) {
    const result = solve({
      datum: { originId: 'A', axisPointId: 'B', lengthM: 6, sigmaM: sigma },
      points: [
        { id: 'C', held: C },
        { id: 'D', held: D },
      ],
      distances: pairs.map(([id, len]) => ({
        id: `P${id}`,
        a: id,
        b: 'P',
        slopeM: len + gaussian(rng) * sigma,
        sigmaM: sigma,
      })),
    });
    if (result.varianceTest === 'ok') ok++;
  }
  const rate = ok / trials;
  assert.ok(rate > 0.85 && rate < 0.995, `variance ok ${rate}`);
});

test('geometric circle fit stays in the same frame and flags a short arc', () => {
  const full = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * 2 * Math.PI;
    return { x: 1 + 3 * Math.cos(a), y: 2 + 3 * Math.sin(a) };
  });
  const fit = fitCircleGeometric(full);
  assert.ok(fit);
  assert.ok(Math.abs(fit.cx - 1) < 1e-3);
  assert.ok(Math.abs(fit.cy - 2) < 1e-3);
  assert.ok(Math.abs(fit.r - 3) < 1e-3);
  assert.equal(fit.radiusWeak, false);
  assert.ok(fit.sigmaRM != null && fit.sigmaRM < 0.01);

  const arc = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 5) * (60 * DEG);
    return { x: 5 * Math.cos(a), y: 5 * Math.sin(a) };
  });
  const short = fitCircleGeometric(arc);
  assert.ok(short);
  assert.equal(short.radiusWeak, true);
  assert.ok(short.arcRad < Math.PI / 2 + 0.05);
  assert.ok(short.sigmaRM == null || short.sigmaRM > (fit.sigmaRM ?? 0));
  // Same frame: the centre is not shifted into another origin.
  assert.ok(Math.hypot(short.cx, short.cy) < 20);
});

test('schema v1 still loads, offsets are not applied, and a house corner is not invented', () => {
  const raw = JSON.parse(JSON.stringify(syntheticDocument())) as ReturnType<typeof syntheticDocument>;
  assert.equal(raw.version, 1);
  const doc = normalizeDocument(raw);
  assert.equal(doc.version, 1);
  const result = solveGardenDocument(doc);
  const a = point(result, 'HSE01');
  const b = point(result, 'HSE02');
  const c = point(result, 'HSE03');
  assert.equal(a.x, 0);
  assert.equal(a.y, 0);
  assert.equal(b.y, 0);
  assert.ok(Math.abs((b.x ?? 0) - 7) < 1e-6);
  assert.equal(c.status, 'unset');
  assert.equal(c.x, undefined);
  assert.notEqual(c.y, 2.236);
  assert.ok(result.skippedPhotos.some((p) => p.id === 'photo-tie-1' && p.code === 'no-fx'));
  assert.ok(!result.points.some((p) => p.method === 'resection' && p.x != null));

  // A determined point that carries v1 offsetMm must not be shifted by it.
  const garden = emptyDocument('offset');
  garden.points = [
    { id: 'A', kind: 'HSE', offsetMm: 40 },
    { id: 'B', kind: 'HSE' },
    { id: 'P', kind: 'OCC', offsetMm: 50 },
  ];
  garden.baselines = [
    { id: 'BL', a: 'A', b: 'B', lengthM: 4, sigmaM: 1e-8, kind: 'tape', trust: 80 },
  ];
  garden.lines = [
    { id: 'AP', a: 'A', b: 'P', lengthM: 3, sigmaM: 0.001, kind: 'tape' },
    { id: 'BP', a: 'B', b: 'P', lengthM: 3, sigmaM: 0.001, kind: 'tape' },
  ];
  const placed = solveGardenDocument(garden);
  const P = point(placed, 'P');
  // Intersection of 3 m and 3 m on a 4 m baseline, garden side: height √(9 − 4) = √5.
  assert.ok(Math.abs((P.x ?? 0) - 2) < 1e-3, `x ${P.x}`);
  assert.ok(Math.abs((P.y ?? 0) - Math.sqrt(5)) < 1e-3, `y ${P.y}`);

  const legacy = normalizeDocument(
    JSON.parse(
      JSON.stringify({
        ...emptyDocument('legacy'),
        version: 1,
        baselines: undefined,
        lines: [{ id: 'old', a: 'A', b: 'B', lengthM: 5, sigmaM: 0.02, kind: 'baseline' }],
        points: [
          { id: 'A', kind: 'BL' },
          { id: 'B', kind: 'BL' },
        ],
      }),
    ),
  );
  const fromLine = solveGardenDocument(legacy);
  assert.equal(point(fromLine, 'A').x, 0);
  assert.equal(point(fromLine, 'B').y, 0);
  assert.ok(Math.abs((point(fromLine, 'B').x ?? 0) - 5) < 1e-6);
});

test('trust chooses the datum; a second baseline does not change weights', () => {
  const doc = emptyDocument('two baselines');
  doc.points = [
    { id: 'A', kind: 'HSE' },
    { id: 'B', kind: 'HSE' },
    { id: 'C', kind: 'HSE' },
    { id: 'D', kind: 'HSE' },
  ];
  doc.baselines = [
    { id: 'low', a: 'C', b: 'D', lengthM: 3, sigmaM: 0.02, kind: 'tape', trust: 10 },
    { id: 'high', a: 'A', b: 'B', lengthM: 6, sigmaM: 0.02, kind: 'tape', trust: 90 },
  ];
  const result = solveGardenDocument(doc);
  assert.equal(point(result, 'A').datumRole, 'origin');
  assert.equal(point(result, 'B').datumRole, 'axis');
  assert.equal(point(result, 'C').status, 'unset');
});

const fieldFixture = join(root, 'fixtures/field-circle-baseline/garden.json');

test('field circle baseline fixture', { skip: existsSync(fieldFixture) ? false : 'Paul has not captured fixtures/field-circle-baseline/garden.json yet. Do not invent it.' }, () => {
  const raw = JSON.parse(readFileSync(fieldFixture, 'utf8'));
  const doc = normalizeDocument(raw);
  assert.equal(doc.version, 1);
  const pts = doc.points.filter((p) => p.x != null && p.y != null);
  const circle = doc.objects.find((o) => o.geometryType === 'circle');
  if (circle && circle.measuredPointIds.length >= 3) {
    const xy = circle.measuredPointIds
      .map((id) => doc.points.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => p != null && p.x != null && p.y != null)
      .map((p) => ({ x: p.x as number, y: p.y as number }));
    const fit = fitCircleGeometric(xy);
    assert.ok(fit);
    assert.ok(fit.sigmaRM === null || fit.sigmaRM >= 0);
    if (fit.arcRad < Math.PI / 2) assert.equal(fit.radiusWeak, true);
  } else {
    assert.ok(pts.length >= 0);
  }
});

function circumcentre(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): { x: number; y: number } {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const x =
    ((a.x * a.x + a.y * a.y) * (b.y - c.y) +
      (b.x * b.x + b.y * b.y) * (c.y - a.y) +
      (c.x * c.x + c.y * c.y) * (a.y - b.y)) /
    d;
  const y =
    ((a.x * a.x + a.y * a.y) * (c.x - b.x) +
      (b.x * b.x + b.y * b.y) * (a.x - c.x) +
      (c.x * c.x + c.y * c.y) * (b.x - a.x)) /
    d;
  return { x, y };
}
