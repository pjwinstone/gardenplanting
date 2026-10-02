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
  angleSumCheck,
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
  wholeGardenReflection,
  circleTrialVerdict,
} from '../src/solver/index.ts';
import type { SolveInput, SolverPhotoInput } from '../src/solver/types.ts';
import { clickBearingUnlevelled, levelledBearingScaleDerivative, tiltBearingSigma, wrap } from '../src/solver/bearing.ts';
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
    datum: { originId: 'A', axisPointId: 'B', lengthM: L, fixScale: true },
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
    datum: { originId: 'A', axisPointId: 'B', lengthM: L, fixScale: true },
    distances: [
      { id: 'AP', a: 'A', b: 'P', slopeM: Math.hypot(L / 2, 26.584), sigmaM: 0.02 },
      { id: 'BP', a: 'B', b: 'P', slopeM: Math.hypot(L / 2, 26.584), sigmaM: 0.02 },
    ],
  });
  const S = point(shallow, 'P');
  assert.equal(S.earlyWarning, 'shallow-intersection');
  assert.ok((S.semiMajor95M ?? 0) > 0.2);

  const flat = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: L, fixScale: true },
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
      datum: { originId: 'A', axisPointId: 'B', lengthM: L, fixScale: true },
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
    datum: { originId: 'A', axisPointId: 'B', lengthM: 7, fixScale: true },
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
    datum: { originId: 'A', axisPointId: 'B', lengthM: 7, fixScale: true },
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
  // 63 mm meets the 200 mm precision. The bearings have r < 0.1 and the
  // tape's MDB shift exceeds 200 mm, so the class stays unchecked (N5).
  assert.equal(station.status, 'unchecked');
  assert.equal(station.meetsStationClass, false);
  assert.equal(station.stationClassBlock, 'unchecked');
  assert.ok((station.semiMajor95M ?? 1) <= 0.2);
  assert.equal(station.uncheckedObservationId, 'SA');
  assert.ok(result.degreesOfFreedom >= 1);
});

test('resection recovers the station; class needs a check, level, and the ellipse', () => {
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
    datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true },
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
  // cam:C has r ≈ 0.1 and its MDB shift exceeds 200 mm, so precision is met
  // and the class is not. A declared 10% prior below absorbs the station shift.
  assert.equal(station.status, 'unchecked');
  assert.equal(station.meetsStationClass, false);
  assert.equal(station.stationClassBlock, 'unchecked');
  assert.equal(station.uncheckedObservationId, 'cam:C');

  const badFx = solve(input(fx * 1.1, 0.1, true));
  const moved = point(badFx, 'S');
  const shift = Math.hypot((moved.x ?? 0) - S.x, (moved.y ?? 0) - S.y);
  assert.ok(shift < 0.02, `10% fx absorbed, shift ${shift}`);
  assert.equal(moved.meetsStationClass, false);
  assert.equal(moved.stationClassBlock, 'unchecked');

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
      datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true },
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
    datum: { originId: 'A', axisPointId: 'B', lengthM: 6, fixScale: true },
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
    datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true },
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
      datum: { originId: 'A', axisPointId: 'B', lengthM: 30, fixScale: true },
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
    datum: { originId: 'A', axisPointId: 'B', lengthM: 7, fixScale: true },
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

  // All six interior angles. A 1° error at one corner fails 1.96 σ √n
  // and is invisible to the 2D test when it sits on the datum azimuth.
  const interior = SHED.map((_, i) => {
    const prev = SHED[(i + SHED.length - 1) % SHED.length];
    const next = SHED[(i + 1) % SHED.length];
    const here = SHED[i];
    return Math.abs(
      wrap(Math.atan2(prev.y - here.y, prev.x - here.x) - Math.atan2(next.y - here.y, next.x - here.x)),
    );
  });
  const exactAngles = angleSumCheck(interior, 0.2 * DEG);
  assert.equal(exactAngles.pass, true);
  assert.ok(Math.abs(exactAngles.limitRad - 1.96 * 0.2 * DEG * Math.sqrt(6)) < 1e-12);
  const kicked = interior.slice();
  kicked[0] += DEG;
  const badAngles = angleSumCheck(kicked, 0.2 * DEG);
  assert.equal(badAngles.pass, false);
  assert.ok(Math.abs(badAngles.misclosureRad) > badAngles.limitRad);
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
    datum: { originId: 'A', axisPointId: 'B', lengthM: L, fixScale: true },
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
    datum: { originId: 'A', axisPointId: 'B', lengthM: L, fixScale: true },
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
      datum: { originId: 'A', axisPointId: 'B', lengthM: L, fixScale: true },
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

test('blunders: upper-tail χ², |w| > 3.29, drop only an isolated residual', () => {
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
  assert.ok(solverCoachLines(clean).some((l) => l.includes('not a warning')));
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
  // |w| on AP, BP, DP and the datum tape move together (ratio under 2),
  // so the correct tapes stay and P is not "repaired" by deleting one.
  assert.deepEqual(dropped.droppedObservationIds, []);
  assert.ok(dropped.inseparableObservationIds.includes('AP'));
  assert.ok(dropped.inseparableObservationIds.includes('BP'));
  assert.equal(dropped.varianceTest, 'high');
  assert.equal(point(dropped, 'P').varianceHold, true);
  assert.equal(point(dropped, 'P').plantable, false);
  assert.ok(solverCoachLines(dropped).some((l) => l.includes('have not dropped one')));

  // Lasers pin P. One loose tape is then the only |w| over 3.29, and dropping
  // it makes the variance test pass.
  const isolated = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 6, fixScale: true },
    points: [
      { id: 'C', held: C },
      { id: 'D', held: D },
    ],
    distances: [
      { id: 'BP', a: 'B', b: 'P', slopeM: dists.BP, sigmaM: 0.002 },
      { id: 'CP', a: 'C', b: 'P', slopeM: dists.CP, sigmaM: 0.002 },
      { id: 'DP', a: 'D', b: 'P', slopeM: dists.DP, sigmaM: 0.002 },
      { id: 'AP', a: 'A', b: 'P', slopeM: dists.AP + 0.5, sigmaM: 0.02 },
    ],
    dropBlunders: true,
  });
  assert.deepEqual(isolated.droppedObservationIds, ['AP']);
  assert.deepEqual(isolated.inseparableObservationIds, []);
  assert.notEqual(isolated.varianceTest, 'high');
  assert.ok(Math.abs((point(isolated, 'P').x ?? 0) - truth.x) < 0.01);
  assert.ok(Math.abs((point(isolated, 'P').y ?? 0) - truth.y) < 0.01);
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
    { id: 'BL', a: 'A', b: 'B', lengthM: 4, sigmaM: 0.02, kind: 'tape', trust: 80 },
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

test('B1: a zero-redundancy tape is named, and a 0.3 m blunder is not a check', () => {
  // Advisor probe: P(5,5) from A(0,0), C(10,10) collinear with A and P, and B(7,0). σ = 5 mm.
  const P = { x: 5, y: 5 };
  const C = { x: 10, y: 10 };
  const sigma = 0.005;
  const input = (bp: number): SolveInput => ({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 7, fixScale: true },
    points: [{ id: 'C', held: C }],
    distances: [
      { id: 'AP', a: 'A', b: 'P', slopeM: Math.hypot(P.x, P.y), sigmaM: sigma },
      { id: 'CP', a: 'C', b: 'P', slopeM: Math.hypot(P.x - C.x, P.y - C.y), sigmaM: sigma },
      { id: 'BP', a: 'B', b: 'P', slopeM: bp, sigmaM: sigma },
    ],
  });
  const clean = solve(input(Math.hypot(P.x - 7, P.y)));
  const cleanP = point(clean, 'P');
  const r = (id: string) => clean.observations.find((o) => o.id === id)?.redundancy ?? -1;
  assert.ok(Math.abs(r('AP') - 0.5) < 1e-6, `r AP ${r('AP')}`);
  assert.ok(Math.abs(r('CP') - 0.5) < 1e-6, `r CP ${r('CP')}`);
  assert.ok(r('BP') <= 0.1, `r BP ${r('BP')}`);
  assert.equal(cleanP.status, 'unchecked');
  assert.equal(cleanP.uncheckedObservationId, 'BP');
  assert.ok(Math.abs((cleanP.semiMajor95M ?? 0) - 0.0141) < 0.001, `semi ${cleanP.semiMajor95M}`);
  assert.equal(cleanP.plantable, false);

  const blunder = solve(input(Math.hypot(P.x - 7, P.y) + 0.3));
  const moved = point(blunder, 'P');
  const shift = Math.hypot((moved.x ?? 0) - P.x, (moved.y ?? 0) - P.y);
  assert.ok(Math.abs(shift - 0.324) < 0.01, `shift ${shift}`);
  assert.equal(moved.status, 'unchecked');
  assert.equal(moved.uncheckedObservationId, 'BP');
  const worst = Math.max(...blunder.observations.map((o) => Math.abs(o.standardised ?? 0)));
  assert.ok(worst < 3.29, `|w| ${worst}`);
});

test('B2: focal length enters the ellipse, including rays from a both-tapes station', () => {
  const width = 1200;
  const fxOver = 0.72;
  const fx = fxOver * width;
  const cam = { x: 3.5, y: 14 };
  const marks = [
    { id: 'A', x: 0, y: 0 },
    { id: 'B', x: 7, y: 0 },
    { id: 'R', x: 3.5, y: 10 },
  ];
  const yaw = -Math.PI / 2;
  const clicksAt = (scale: number) =>
    marks.map((m) => {
      const beta = wrap(Math.atan2(m.y - cam.y, m.x - cam.x) - yaw);
      return { pointId: m.id, px: width / 2 - fx * scale * Math.tan(beta), py: 450 };
    });
  const rod = (uncertainty: number | undefined, scale = 1) =>
    solve({
      datum: { originId: 'A', axisPointId: 'B', lengthM: 7, fixScale: true },
      points: [{ id: 'R', held: { x: 3.5, y: 10 } }],
      photos: [
        {
          id: 'cam',
          stationId: 'S',
          width,
          height: 900,
          fxOverWidth: fxOver,
          fxRelativeUncertainty: uncertainty,
          gravity: { x: 0, y: 1, z: 0 },
          bearingSigmaRad: 0.1 * DEG,
          clicks: clicksAt(scale),
        },
      ],
    });
  const bare = point(rod(undefined), 'S');
  const carried = point(rod(0.01), 'S');
  assert.ok(Math.abs((bare.semiMajor95M ?? 0) - 0.18) < 0.01, `bare ${bare.semiMajor95M}`);
  assert.ok(Math.abs((carried.semiMajor95M ?? 0) - 0.387) < 0.02, `with fx ${carried.semiMajor95M}`);
  assert.equal(carried.meetsStationClass, false);
  assert.equal(carried.stationClassBlock, 'ellipse');
  assert.notEqual(carried.status, 'checked');

  const rng = mulberry32(11);
  let inside = 0;
  let insideBare = 0;
  let meets = 0;
  const trials = 200;
  for (let t = 0; t < trials; t++) {
    const scale = 1 + gaussian(rng) * 0.01;
    const clicks = marks.map((m) => {
      const beta = wrap(Math.atan2(m.y - cam.y, m.x - cam.x) - yaw) + gaussian(rng) * 0.1 * DEG;
      return { pointId: m.id, px: width / 2 - fx * scale * Math.tan(beta), py: 450 };
    });
    const photo = {
      id: 'cam',
      stationId: 'S',
      width,
      height: 900,
      fxOverWidth: fxOver,
      gravity: { x: 0, y: 1, z: 0 } as const,
      bearingSigmaRad: 0.1 * DEG,
      clicks,
    };
    const withFx = solve({
      datum: { originId: 'A', axisPointId: 'B', lengthM: 7, fixScale: true },
      points: [{ id: 'R', held: { x: 3.5, y: 10 } }],
      photos: [{ ...photo, fxRelativeUncertainty: 0.01 }],
    });
    const without = solve({
      datum: { originId: 'A', axisPointId: 'B', lengthM: 7, fixScale: true },
      points: [{ id: 'R', held: { x: 3.5, y: 10 } }],
      photos: [photo],
    });
    const P = point(withFx, 'S');
    const Q = point(without, 'S');
    if (P.meetsStationClass) meets++;
    if (P.q && P.x != null && P.y != null && nees2(P.x - cam.x, P.y - cam.y, P.q[0], P.q[1], P.q[2]) <= CHI2_2_95) {
      inside++;
    }
    if (Q.q && Q.x != null && Q.y != null && nees2(Q.x - cam.x, Q.y - cam.y, Q.q[0], Q.q[1], Q.q[2]) <= CHI2_2_95) {
      insideBare++;
    }
  }
  assert.ok(inside / trials > 0.85 && inside / trials < 0.995, `fx coverage ${inside / trials}`);
  assert.ok(insideBare / trials < 0.85, `unpropagated coverage ${insideBare / trials}`);
  assert.equal(meets, 0);

  // S1 is taped to both baseline ends. A mark 20° off axis, also seen from a
  // held camera, moves about 0.3 m when S1's fx is 10% high and fx is not a
  // parameter. That must not be published as checked on a ~60 mm ellipse, and
  // the correct tape must not be the observation that is dropped.
  const S1 = { x: 4, y: 6 };
  const azM = -Math.PI / 2 + 20 * DEG;
  const mark = { x: S1.x + 10 * Math.cos(azM), y: S1.y + 10 * Math.sin(azM) };
  const S2 = { x: mark.x + 8, y: mark.y };
  const yaw2 = Math.atan2(mark.y - S2.y, mark.x - S2.x);
  const click = (scale: number) =>
    [
      { id: 'A', x: 0, y: 0 },
      { id: 'B', x: 8, y: 0 },
      { id: 'M', ...mark },
    ].map((m) => {
      const beta = wrap(Math.atan2(m.y - S1.y, m.x - S1.x) + Math.PI / 2);
      return { pointId: m.id, px: width / 2 - fx * scale * Math.tan(beta), py: 450 };
    });
  const tied = (scale: number, prior: number | undefined) =>
    solve({
      datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true },
      points: [{ id: 'S2', held: S2 }],
      distances: [
        { id: 'S1A', a: 'S1', b: 'A', slopeM: Math.hypot(S1.x, S1.y), sigmaM: 0.005 },
        { id: 'S1B', a: 'S1', b: 'B', slopeM: Math.hypot(S1.x - 8, S1.y), sigmaM: 0.005 },
      ],
      photos: [
        {
          id: 'p1',
          stationId: 'S1',
          width,
          height: 900,
          fxOverWidth: fxOver,
          gravity: { x: 0, y: 1, z: 0 },
          bearingSigmaRad: 0.1 * DEG,
          fxRelativeUncertainty: prior,
          clicks: click(scale),
        },
        {
          id: 'p2',
          stationId: 'S2',
          width,
          height: 900,
          fxOverWidth: fxOver,
          gravity: { x: 0, y: 1, z: 0 },
          bearingSigmaRad: 0.1 * DEG,
          yawHeldRad: yaw2,
          fxRelativeUncertainty: 0.005,
          clicks: [{ pointId: 'M', px: width / 2, py: 450 }],
        },
      ],
      dropBlunders: true,
    });
  const exact = tied(1, undefined);
  const exactM = point(exact, 'M');
  assert.ok(Math.abs((exactM.semiMajor95M ?? 0) - 0.058) < 0.008, `tied semi ${exactM.semiMajor95M}`);
  assert.notEqual(exactM.status, 'checked');

  const wrong = tied(1.1, undefined);
  const wrongM = point(wrong, 'M');
  const shift = Math.hypot((wrongM.x ?? 0) - mark.x, (wrongM.y ?? 0) - mark.y);
  assert.ok(shift > 0.25, `10% fx shift ${shift}`);
  assert.notEqual(wrongM.status, 'checked');
  assert.ok((wrongM.semiMajor95M ?? 0) > 0.2, `scaled semi ${wrongM.semiMajor95M}`);
  assert.equal(wrong.varianceTest, 'high');
  assert.ok(!wrong.droppedObservationIds.includes('S1A'));
  assert.ok(wrong.inseparableObservationIds.includes('S1A'));

  const absorbed = tied(1.1, 0.1);
  const absorbedM = point(absorbed, 'M');
  const left = Math.hypot((absorbedM.x ?? 0) - mark.x, (absorbedM.y ?? 0) - mark.y);
  assert.ok(left < 0.01, `absorbed shift ${left}`);
  assert.notEqual(absorbed.varianceTest, 'high');
  assert.deepEqual(absorbed.droppedObservationIds, []);
  assert.notEqual(absorbedM.status, 'checked');
});

test('B3: a mislabelled click behind the camera is not published', () => {
  const width = 1200;
  const fxOver = 0.72;
  const fx = fxOver * width;
  const S1 = { x: 0, y: 10 };
  const S2 = { x: 10, y: 10 };
  const R1 = { x: 3, y: 4 };
  const R2 = { x: 8, y: 4 };
  const seen = { x: 16, y: 11 };
  const other = { x: 16, y: 9 };
  const yawOf = (station: { x: number; y: number }, marks: { x: number; y: number }[]) => {
    let x = 0;
    let y = 0;
    for (const m of marks) {
      const az = Math.atan2(m.y - station.y, m.x - station.x);
      x += Math.cos(az);
      y += Math.sin(az);
    }
    return Math.atan2(y, x);
  };
  const click = (station: { x: number; y: number }, yaw: number, id: string, mark: { x: number; y: number }) => {
    const beta = wrap(Math.atan2(mark.y - station.y, mark.x - station.x) - yaw);
    assert.ok(Math.abs(beta) < Math.PI / 2 - 0.05, `${id} beta ${beta}`);
    return { pointId: id, px: width / 2 - fx * Math.tan(beta), py: 450 };
  };
  const yaw1 = yawOf(S1, [R1, R2, seen]);
  const yaw2 = yawOf(S2, [R1, R2, other]);
  const result = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 20, fixScale: true },
    points: [
      { id: 'S1', held: S1 },
      { id: 'S2', held: S2 },
      { id: 'R1', held: R1 },
      { id: 'R2', held: R2 },
    ],
    photos: [
      {
        id: 'p1',
        stationId: 'S1',
        width,
        height: 900,
        fxOverWidth: fxOver,
        gravity: { x: 0, y: 1, z: 0 },
        bearingSigmaRad: 0.1 * DEG,
        clicks: [click(S1, yaw1, 'R1', R1), click(S1, yaw1, 'R2', R2), click(S1, yaw1, 'M', seen)],
      },
      {
        id: 'p2',
        stationId: 'S2',
        width,
        height: 900,
        fxOverWidth: fxOver,
        gravity: { x: 0, y: 1, z: 0 },
        bearingSigmaRad: 0.1 * DEG,
        clicks: [click(S2, yaw2, 'R1', R1), click(S2, yaw2, 'R2', R2), click(S2, yaw2, 'M', other)],
      },
    ],
  });
  const M = point(result, 'M');
  assert.equal(M.status, 'unset');
  assert.equal(M.x, undefined);
  assert.equal(M.unsetCode, 'behind-camera');
  assert.ok(solverCoachLines(result).some((l) => l.includes('behind a camera')));
});

test('N1: two yaws at one station are not averaged into one ray', () => {
  const width = 1200;
  const fxOver = 0.72;
  const fx = fxOver * width;
  const S1 = { x: 0, y: 0 };
  const S2 = { x: 6, y: 1 };
  const K1 = { x: 8, y: -1 };
  const K2 = { x: 9, y: -6 };
  const M = { x: 15, y: -10 };
  const click = (station: { x: number; y: number }, yaw: number, id: string, mark: { x: number; y: number }) => {
    const beta = wrap(Math.atan2(mark.y - station.y, mark.x - station.x) - yaw);
    return { pointId: id, px: width / 2 - fx * Math.tan(beta), py: 450 };
  };
  const yawA = Math.atan2(K1.y - S1.y, K1.x - S1.x);
  const yawB = Math.atan2(K2.y - S1.y, K2.x - S1.x);
  const yawS = Math.atan2(M.y - S2.y, M.x - S2.x);
  const result = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 12, fixScale: true },
    points: [
      { id: 'S1', held: S1 },
      { id: 'S2', held: S2 },
      { id: 'K1', held: K1 },
      { id: 'K2', held: K2 },
    ],
    photos: [
      {
        id: 'left',
        stationId: 'S1',
        width,
        height: 900,
        fxOverWidth: fxOver,
        gravity: { x: 0, y: 1, z: 0 },
        bearingSigmaRad: 0.1 * DEG,
        clicks: [click(S1, yawA, 'K1', K1), click(S1, yawA, 'M', M)],
      },
      {
        id: 'right',
        stationId: 'S1',
        width,
        height: 900,
        fxOverWidth: fxOver,
        gravity: { x: 0, y: 1, z: 0 },
        bearingSigmaRad: 0.1 * DEG,
        clicks: [click(S1, yawB, 'K2', K2), click(S1, yawB, 'M', M)],
      },
      {
        id: 'far',
        stationId: 'S2',
        width,
        height: 900,
        fxOverWidth: fxOver,
        gravity: { x: 0, y: 1, z: 0 },
        bearingSigmaRad: 0.1 * DEG,
        clicks: [click(S2, yawS, 'M', M), click(S2, yawS, 'K1', K1)],
      },
    ],
  });
  const got = point(result, 'M');
  assert.notEqual(got.unsetCode, 'parallel-rays');
  assert.ok(Math.abs((got.x ?? 99) - M.x) < 1e-3, `x ${got.x} ${got.unsetCode}`);
  assert.ok(Math.abs((got.y ?? 99) - M.y) < 1e-3, `y ${got.y}`);
});

test('N2: a concyclic first triple does not hide a resectable station', () => {
  const width = 1200;
  const fxOver = 0.72;
  const S = { x: 9, y: 6 };
  const onCircle = [
    { id: 'C1', x: 4, y: 11 },
    { id: 'C2', x: 4, y: 1 },
    { id: 'C3', x: -1, y: 6 },
  ];
  const off = { id: 'D', x: 6, y: 8 };
  const yaw = Math.PI;
  const click = (mark: { id: string; x: number; y: number }) => {
    const beta = wrap(Math.atan2(mark.y - S.y, mark.x - S.x) - yaw);
    assert.ok(Math.abs(beta) < Math.PI / 2 - 0.05, `${mark.id} ${beta}`);
    return {
      pointId: mark.id,
      px: width / 2 - fxOver * width * Math.tan(beta),
      py: 450,
    };
  };
  const run = (order: { id: string; x: number; y: number }[]) =>
    solve({
      datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true },
      points: order.map((m) => ({ id: m.id, held: { x: m.x, y: m.y } })),
      photos: [
        {
          id: 'cam',
          stationId: 'S',
          width,
          height: 900,
          fxOverWidth: fxOver,
          gravity: { x: 0, y: 1, z: 0 },
          bearingSigmaRad: 0.1 * DEG,
          fxRelativeUncertainty: 0.01,
          clicks: order.map(click),
        },
      ],
    });
  for (const order of [
    [...onCircle, off],
    [off, ...onCircle],
  ]) {
    const station = point(run(order), 'S');
    assert.notEqual(station.unsetCode, 'flat-angle', order.map((m) => m.id).join(','));
    assert.notEqual(station.unsetCode, 'danger', order.map((m) => m.id).join(','));
    assert.ok((station.dangerRatio ?? 0) > 0.2, `ratio ${station.dangerRatio} ${order.map((m) => m.id).join(',')}`);
    assert.ok(Math.abs((station.x ?? 99) - S.x) < 1e-2, `x ${station.x} ${station.unsetCode}`);
    assert.ok(Math.abs((station.y ?? 99) - S.y) < 1e-2, `y ${station.y}`);
  }

  // A and R1 lie on the ray through the station. They are the first clicks.
  const saved = { x: 4, y: 8 };
  const look = -Math.PI / 2;
  const extra = [
    { id: 'A', x: 0, y: 0 },
    { id: 'R1', x: 2, y: 4 },
    { id: 'B', x: 8, y: 0 },
    { id: 'C', x: 1, y: 3 },
    { id: 'D', x: 7, y: 3 },
  ];
  const rescued = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true },
    points: extra.filter((m) => m.id !== 'A' && m.id !== 'B').map((m) => ({ id: m.id, held: { x: m.x, y: m.y } })),
    photos: [
      {
        id: 'cam',
        stationId: 'S',
        width,
        height: 900,
        fxOverWidth: fxOver,
        gravity: { x: 0, y: 1, z: 0 },
        bearingSigmaRad: 0.1 * DEG,
        clicks: extra.map((m) => {
          const beta = wrap(Math.atan2(m.y - saved.y, m.x - saved.x) - look);
          return { pointId: m.id, px: width / 2 - fxOver * width * Math.tan(beta), py: 450 };
        }),
      },
    ],
  });
  const got = point(rescued, 'S');
  assert.notEqual(got.unsetCode, 'flat-angle');
  assert.ok(Math.abs((got.x ?? 99) - saved.x) < 1e-2, `rescued ${got.x} ${got.unsetCode}`);
  assert.ok(Math.abs((got.y ?? 99) - saved.y) < 1e-2, `rescued y ${got.y}`);
});

test('circle gap is 3 √(σ₀² + σ₁²), and bubble tilt is per ray', () => {
  // 20 mm tapes: the limit is about 85 mm. A 50 mm gap is not a miss.
  // On this baseline the closest point has no cross-track, so the normal
  // matrix leaves it unset as rank rather than calling the tape a blunder.
  const close = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 10, fixScale: true },
    distances: [
      { id: 'AP', a: 'A', b: 'P', slopeM: 6, sigmaM: 0.02 },
      { id: 'BP', a: 'B', b: 'P', slopeM: 3.95, sigmaM: 0.02 },
    ],
  });
  assert.notEqual(point(close, 'P').unsetCode, 'miss');

  const open = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 10, fixScale: true },
    distances: [
      { id: 'AP', a: 'A', b: 'P', slopeM: 6, sigmaM: 0.02 },
      { id: 'BP', a: 'B', b: 'P', slopeM: 3.85, sigmaM: 0.02 },
    ],
  });
  assert.equal(point(open, 'P').status, 'unset');
  assert.equal(point(open, 'P').unsetCode, 'miss');

  const tilt = tiltBearingSigma({
    tiltSigmaRad: 2 * DEG,
    px: 600,
    py: 450 + 300,
    cx: 600,
    cy: 450,
    fx: 900,
  });
  assert.ok(Math.abs(tilt - (2 * DEG * 300) / 900) < 1e-12, `tilt ${tilt}`);
});

test('focal-scale derivative matches a finite difference, and noisy resections converge', () => {
  const fx0 = 864;
  const scale = 0.003;
  const h = 1e-6;
  for (const gravity of [undefined, { x: 0.1, y: 0.95, z: -0.05 }] as const) {
    const beta = (s: number) =>
      levelledBearing({
        px: 400,
        py: 520,
        cx: 600,
        cy: 450,
        fx: fx0 * (1 + s),
        fy: fx0 * (1 + s),
        gravity,
      });
    const numeric = (beta(scale + h) - beta(scale - h)) / (2 * h);
    const analytic = levelledBearingScaleDerivative({
      px: 400,
      py: 520,
      cx: 600,
      cy: 450,
      fx: fx0 * (1 + scale),
      fy: fx0 * (1 + scale),
      fx0,
      fy0: fx0,
      gravity,
    });
    assert.ok(Math.abs(analytic / numeric - 1) < 1e-4, `∂β/∂s ratio ${analytic / numeric}`);
  }

  // A Jacobian large by (1+s) stalled about 4.6% of these solves as diverged.
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
  const rng = mulberry32(3);
  const trials = 120;
  let diverged = 0;
  for (let t = 0; t < trials; t++) {
    const focal = 1 + gaussian(rng) * 0.01;
    const clicks = marks.map((m) => {
      const beta = wrap(Math.atan2(m.y - S.y, m.x - S.x) - yaw) + gaussian(rng) * 0.1 * DEG;
      return { pointId: m.id, px: width / 2 - fx * focal * Math.tan(beta), py: 450 };
    });
    const result = solve({
      datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true },
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
          fxRelativeUncertainty: 0.01,
          gravity: { x: 0, y: 1, z: 0 },
          bearingSigmaRad: 0.1 * DEG,
          clicks,
        },
      ],
    });
    if (!result.converged || point(result, 'S').x == null) diverged++;
  }
  assert.equal(diverged, 0, `${diverged} / ${trials} diverged`);
});

test('MDB shift checks a redundant tape net; r ≤ 0.1 alone does not', () => {
  // Six points, eleven 5 mm tapes, three degrees of freedom. AR and RS have
  // r under 0.1. Their MDB shifts stay inside the planting class, so the
  // free points are checked. A blunder of 1.5×MDB checks none of them.
  const net = {
    A: { x: 0, y: 0 },
    B: { x: 10, y: 0 },
    P: { x: 4, y: 3 },
    Q: { x: 7, y: 4 },
    R: { x: 3, y: 7 },
    S: { x: 8, y: 8 },
  };
  const free = ['P', 'Q', 'R', 'S'] as const;
  const pairs = [
    ['A', 'P'], ['B', 'P'], ['A', 'Q'], ['B', 'Q'], ['P', 'Q'],
    ['A', 'R'], ['B', 'R'], ['Q', 'R'], ['R', 'S'], ['Q', 'S'], ['P', 'S'],
  ] as const;
  const sigma = 0.005;
  const length = (a: string, b: string) => {
    const pa = net[a as keyof typeof net];
    const pb = net[b as keyof typeof net];
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
  };
  const solveNet = (extra: (id: string) => number) =>
    solve({
      datum: { originId: 'A', axisPointId: 'B', lengthM: 10, fixScale: true },
      distances: pairs.map(([a, b]) => ({
        id: `${a}${b}`,
        a,
        b,
        slopeM: length(a, b) + extra(`${a}${b}`),
        sigmaM: sigma,
      })),
    });

  const exact = solveNet(() => 0);
  assert.equal(exact.degreesOfFreedom, 3);
  assert.equal(exact.converged, true);
  const low = exact.observations.filter((o) => o.used && o.redundancy > 1e-6 && o.redundancy <= 0.1);
  assert.ok(low.length >= 1, 'expected a tape with r ≤ 0.1');
  for (const id of free) {
    const p = point(exact, id);
    assert.equal(p.status, 'checked', `${id} blocked by ${p.uncheckedObservationId}`);
  }

  const rng = mulberry32(21);
  let checked = 0;
  let seen = 0;
  const trials = 100;
  for (let i = 0; i < trials; i++) {
    const result = solveNet(() => gaussian(rng) * sigma);
    for (const id of free) {
      seen++;
      if (point(result, id).status === 'checked') checked++;
    }
  }
  const rate = checked / seen;
  assert.ok(rate > 0.88 && rate < 0.995, `clean checked ${rate}`);

  const tape = exact.observations.find((o) => o.id === 'AR');
  assert.ok(tape?.mdb && tape.redundancy <= 0.1 && tape.redundancy > 1e-6);
  const blown = solveNet((id) => (id === 'AR' ? 1.5 * tape.mdb! : 0));
  assert.equal(blown.varianceTest, 'high');
  for (const id of free) assert.equal(point(blown, id).status, 'unchecked', id);

  const rngB = mulberry32(22);
  let badChecked = 0;
  const badTrials = 40;
  for (let i = 0; i < badTrials; i++) {
    const result = solveNet((id) => gaussian(rngB) * sigma + (id === 'AR' ? 1.5 * tape.mdb! : 0));
    for (const id of free) if (point(result, id).status === 'checked') badChecked++;
  }
  assert.equal(badChecked, 0);
});

test('B4: rejecting a station after adjustment does not throw', () => {
  const width = 1200;
  const fxOver = 0.5;
  const S = { x: 4, y: 5 };
  const yawLook = -Math.PI / 2;
  const yawAway = Math.PI / 2;
  const clicks = [
    { id: 'A', x: 0, y: 0 },
    { id: 'B', x: 8, y: 0 },
  ].map((m) => ({ pointId: m.id, ...projectClick(S, yawLook, m, width, fxOver) }));
  const result = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true },
    distances: [
      { id: 'SA', a: 'S', b: 'A', slopeM: Math.hypot(S.x, S.y), sigmaM: 0.001 },
      { id: 'SB', a: 'S', b: 'B', slopeM: Math.hypot(S.x - 8, S.y), sigmaM: 0.001 },
    ],
    photos: [
      {
        id: 'cam',
        stationId: 'S',
        width,
        height: 900,
        fxOverWidth: fxOver,
        gravity: { x: 0, y: 1, z: 0 },
        bearingSigmaRad: 1 * DEG,
        yawHeldRad: yawAway,
        clicks,
      },
    ],
  });
  const station = point(result, 'S');
  assert.equal(station.status, 'unset');
  assert.equal(station.x, undefined);
  assert.equal(station.unsetCode, 'behind-camera');
  const tape = result.observations.find((o) => o.id === 'SA');
  assert.ok(tape);
  assert.equal(tape.used, false);
  assert.equal(point(result, 'A').x, 0);
  assert.equal(result.reflected, false);
});

test('B5: opposite-side stations follow the branch choice and the bearings', () => {
  const A = { x: 0, y: 0 };
  const B = { x: 8, y: 0 };
  const peg = { x: 8, y: 4.3 };
  const crc = (k: number) => {
    const ang = -Math.PI / 2 + k * (Math.PI / 3);
    return { id: `CRC0${k + 1}`, x: peg.x + 4 * Math.cos(ang), y: peg.y + 4 * Math.sin(ang) };
  };
  const CRC = [0, 1, 2, 3, 4, 5].map(crc);
  const STN = [
    { id: 'STN01', x: 4, y: -Math.sqrt(7.2 * 7.2 - 16) },
    { id: 'STN02', x: 2.5, y: Math.sqrt(25 - 6.25) },
    { id: 'STN03', x: 4, y: Math.sqrt(10.5 * 10.5 - 16) },
  ];
  const width = 1200;
  const fxOver = 0.72;
  const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
  const yawOf = (station: { x: number; y: number }, marks: { x: number; y: number }[]) => {
    let sx = 0;
    let sy = 0;
    for (const m of marks) {
      const az = Math.atan2(m.y - station.y, m.x - station.x);
      sx += Math.cos(az);
      sy += Math.sin(az);
    }
    return Math.atan2(sy, sx);
  };

  // Candidate 0 is +Y. STN01 is the opposite side, so its index is 1.
  const branched = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true, gardenSign: 1 },
    distances: [STN[0], STN[1]].flatMap((s) => [
      { id: `${s.id}A`, a: s.id, b: 'A', slopeM: dist(s, A), sigmaM: 0.005 },
      { id: `${s.id}B`, a: s.id, b: 'B', slopeM: dist(s, B), sigmaM: 0.005 },
    ]),
    branchChoices: [
      { id: 'STN01', candidateIndex: 1 },
      { id: 'STN02', candidateIndex: 0 },
    ],
  });
  const b1 = point(branched, 'STN01');
  const b2 = point(branched, 'STN02');
  assert.ok((b1.y ?? 0) < -5, `branch STN01 y ${b1.y}`);
  assert.ok((b2.y ?? 0) > 4, `branch STN02 y ${b2.y}`);
  assert.equal(b1.branchChoice, true);
  assert.equal(branched.reflected, false);

  const solveStations = (n: number) => {
    const stations = STN.slice(0, n);
    const marks = [{ id: 'A', ...A }, { id: 'B', ...B }, ...CRC];
    return solve({
      datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true, gardenSign: 1 },
      distances: stations.flatMap((s) => [
        { id: `${s.id}A`, a: s.id, b: 'A', slopeM: dist(s, A), sigmaM: 0.005 },
        { id: `${s.id}B`, a: s.id, b: 'B', slopeM: dist(s, B), sigmaM: 0.005 },
      ]),
      photos: stations.map((s) => {
        const yaw = yawOf(s, [A, B]);
        const clicks = marks.flatMap((m) => {
          const beta = wrap(Math.atan2(m.y - s.y, m.x - s.x) - yaw);
          if (Math.abs(beta) >= Math.PI / 2 - 0.05) return [];
          return [{ pointId: m.id, ...projectClick(s, yaw, m, width, fxOver) }];
        });
        return {
          id: s.id,
          stationId: s.id,
          width,
          height: 900,
          fxOverWidth: fxOver,
          gravity: { x: 0, y: 1, z: 0 },
          bearingSigmaRad: 0.1 * DEG,
          clicks,
        };
      }),
    });
  };

  const two = solveStations(2);
  assert.equal(two.converged, true, 'two stations diverged');
  assert.equal(two.reflected, false);
  const s1 = point(two, 'STN01');
  const s2 = point(two, 'STN02');
  assert.ok(Math.abs((s1.y ?? 0) - STN[0].y) < 0.02, `STN01 ${s1.y}`);
  assert.ok(Math.abs((s2.x ?? 0) - STN[1].x) < 0.02 && Math.abs((s2.y ?? 0) - STN[1].y) < 0.02, `STN02 ${s2.x} ${s2.y}`);
  assert.equal(s1.method, 'both-tapes');
  assert.equal(s2.method, 'both-tapes');
  const c2 = point(two, 'CRC02');
  const err2 = Math.hypot((c2.x ?? 0) - CRC[1].x, (c2.y ?? 0) - CRC[1].y);
  assert.ok(c2.x != null && err2 < 0.05, `CRC02 err ${err2} unset ${c2.unsetCode}`);

  const three = solveStations(3);
  assert.equal(three.converged, true, 'three stations diverged');
  assert.notEqual(three.varianceTest, 'high');
  assert.equal(three.reflected, false);
  for (const s of STN) {
    const p = point(three, s.id);
    assert.ok(Math.abs((p.x ?? 99) - s.x) < 0.02 && Math.abs((p.y ?? 99) - s.y) < 0.02, `${s.id} ${p.x} ${p.y} ${p.unsetCode}`);
  }
  const c4 = point(three, 'CRC04');
  const err4 = Math.hypot((c4.x ?? 0) - CRC[3].x, (c4.y ?? 0) - CRC[3].y);
  assert.ok(c4.x != null && err4 < 0.05, `CRC04 err ${err4} unset ${c4.unsetCode}`);
});

test('a whole-garden mirror is flagged, and one opposite station is not', () => {
  assert.equal(wholeGardenReflection({ axisX: -0.2, gardenSign: 1, points: [] }), true);
  assert.equal(
    wholeGardenReflection({
      axisX: 8,
      gardenSign: 1,
      points: [
        { x: 2, y: -1 },
        { x: 4, y: -3 },
      ],
    }),
    true,
  );
  assert.equal(
    wholeGardenReflection({
      axisX: 8,
      gardenSign: 1,
      points: [
        { x: 2, y: -1, branchChoice: true },
        { x: 4, y: -3, branchChoice: true },
      ],
    }),
    false,
  );
  assert.equal(
    wholeGardenReflection({
      axisX: 8,
      gardenSign: 1,
      points: [
        { x: 2, y: -1 },
        { x: 4, y: 3 },
      ],
    }),
    false,
  );

  const width = 1200;
  const fxOver = 0.72;
  const stations = [
    { id: 'P', x: 3, y: 4 },
    { id: 'Q', x: 6, y: 5 },
  ];
  const result = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true, gardenSign: -1 },
    distances: stations.flatMap((s) => [
      { id: `${s.id}A`, a: s.id, b: 'A', slopeM: Math.hypot(s.x, s.y), sigmaM: 0.005 },
      { id: `${s.id}B`, a: s.id, b: 'B', slopeM: Math.hypot(s.x - 8, s.y), sigmaM: 0.005 },
    ]),
    photos: stations.map((s) => ({
      id: s.id,
      stationId: s.id,
      width,
      height: 900,
      fxOverWidth: fxOver,
      gravity: { x: 0, y: 1, z: 0 },
      bearingSigmaRad: 0.1 * DEG,
      clicks: [
        { pointId: 'A', ...projectClick(s, -Math.PI / 2, { x: 0, y: 0 }, width, fxOver) },
        { pointId: 'B', ...projectClick(s, -Math.PI / 2, { x: 8, y: 0 }, width, fxOver) },
      ],
    })),
  });
  assert.ok((point(result, 'P').y ?? 0) > 0);
  assert.ok((point(result, 'Q').y ?? 0) > 0);
  assert.equal(result.reflected, true);
});

test('circle trial grades only with STN03, and fxShared false is allowed', () => {
  const two = circleTrialVerdict({ fxShared: false, stationIds: ['STN01', 'STN02'] });
  assert.equal(two.fxShared, false);
  assert.equal(two.grade, false);
  assert.match(two.report, /not graded/);
  const three = circleTrialVerdict({ fxShared: false, stationIds: ['STN01', 'STN02', 'STN03'] });
  assert.equal(three.grade, true);
  assert.equal(three.fxShared, false);
  const unnamed = circleTrialVerdict({ stationIds: ['BAS01', 'CRC01'] });
  assert.equal(unnamed.fxShared, false);
  assert.equal(unnamed.grade, true);
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
