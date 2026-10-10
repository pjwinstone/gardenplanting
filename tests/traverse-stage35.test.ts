/**
 * Walk-round stages 3–5. Setup offset as the traverse default, the closure
 * report, and the incremental solve. Legacy per-ray photos stay as they were.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { wrap } from '../src/solver/bearing.ts';
import { closureChi2, closureReport, duplicateMisclosure } from '../src/solver/closure.ts';
import { solveIncremental } from '../src/solver/incremental.ts';
import { solve } from '../src/solver/index.ts';
import type { SolveInput, SolverPhotoInput } from '../src/solver/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

interface Fixture {
  input: SolveInput;
  truth: Record<string, { x: number; y: number }>;
}

function load(name: string): Fixture {
  return JSON.parse(readFileSync(join(root, 'fixtures/traverse', name), 'utf8')) as Fixture;
}

function ellipseMm(q: [number, number, number]): { major: number; minor: number } {
  const [a, b, c] = q;
  const tr = a + c;
  const det = a * c - b * b;
  const s = Math.sqrt(Math.max((tr * tr) / 4 - det, 0));
  return {
    major: Math.sqrt(tr / 2 + s) * 1000,
    minor: Math.sqrt(Math.max(tr / 2 - s, 0)) * 1000,
  };
}

/** Shared phone, and the traverse setup offset. No per-photo cameraSetupId. */
function traverse(input: SolveInput, shared: boolean): SolveInput {
  return {
    ...input,
    cameraCentring: 'setup',
    photos: (input.photos ?? []).map((p) =>
      shared ? { ...p, phoneId: 'ph1', lens: '1x' } : p,
    ),
  };
}

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

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function setupGroup(photo: SolverPhotoInput): string {
  const closing = photo.closing === true || (photo.closing == null && photo.id.includes('-close-'));
  return `${photo.stationId}|${closing ? 'close' : 'open'}`;
}

function designYaw(photo: SolverPhotoInput, truth: Fixture['truth']): number {
  const fx = photo.fxOverWidth * photo.width;
  const cx = photo.cx ?? photo.width / 2;
  const click = photo.clicks[0];
  const station = truth[photo.stationId];
  const mark = truth[click.pointId];
  const az = Math.atan2(mark.y - station.y, mark.x - station.x);
  const beta = Math.atan2(cx - click.px, fx);
  return wrap(az - beta);
}

/** Draw fx, setup offsets, and observation noise the way the adjustment models them. */
function perturb(input: SolveInput, truth: Fixture['truth'], rng: () => number): SolveInput {
  const s = randn(rng) * 0.02;
  const offsets = new Map<string, { x: number; y: number }>();
  for (const photo of input.photos ?? []) {
    const key = setupGroup(photo);
    if (offsets.has(key)) continue;
    const sigma = photo.sigmaCentringM != null && photo.sigmaCentringM > 0 ? photo.sigmaCentringM : 0.008;
    offsets.set(key, { x: randn(rng) * sigma, y: randn(rng) * sigma });
  }
  return {
    ...input,
    datum: {
      ...input.datum,
      lengthM: input.datum.lengthM + randn(rng) * (input.datum.sigmaM ?? 0.004),
    },
    distances: (input.distances ?? []).map((d) => ({
      ...d,
      slopeM: d.slopeM + randn(rng) * (d.sigmaM ?? 0.02),
    })),
    photos: (input.photos ?? []).map((photo) => {
      const yaw = designYaw(photo, truth);
      const station = truth[photo.stationId];
      const o = offsets.get(setupGroup(photo)) ?? { x: 0, y: 0 };
      const cam = { x: station.x + o.x, y: station.y + o.y };
      const fx0 = photo.fxOverWidth * photo.width;
      const cx = photo.cx ?? photo.width / 2;
      const sigmaPx = photo.sigmaPx ?? 2;
      return {
        ...photo,
        clicks: photo.clicks.map((click) => {
          const mark = truth[click.pointId];
          const b = wrap(Math.atan2(mark.y - cam.y, mark.x - cam.x) - yaw);
          const beta = b + randn(rng) * (sigmaPx / fx0);
          return { ...click, px: cx - fx0 * (1 + s) * Math.tan(beta) };
        }),
      };
    }),
  };
}

test('arc and tape still seed a station when another frame adds a mark', () => {
  const width = 1200;
  const fxOverWidth = 0.75;
  const S = { x: 2.3, y: 3.2 };
  const M1 = { x: 2, y: 2 };
  const M2 = { x: 6, y: 2 };
  const M3 = { x: 4, y: 5 };
  const yaw1 = Math.atan2((M1.y + M2.y) / 2 - S.y, (M1.x + M2.x) / 2 - S.x);
  const yaw2 = Math.atan2(M3.y - S.y, M3.x - S.x);
  const result = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true },
    points: [
      { id: 'M1', held: M1 },
      { id: 'M2', held: M2 },
      { id: 'M3', held: M3 },
    ],
    distances: [{ id: 'tape', a: 'S', b: 'M1', slopeM: Math.hypot(S.x - M1.x, S.y - M1.y), sigmaM: 0.005 }],
    photos: [
      {
        id: 'frame-ab',
        stationId: 'S',
        width,
        height: 900,
        fxOverWidth,
        gravity: { x: 0, y: 1, z: 0 },
        sigmaPx: 2,
        clicks: [
          { pointId: 'M1', ...projectClick(S, yaw1, M1, width, fxOverWidth) },
          { pointId: 'M2', ...projectClick(S, yaw1, M2, width, fxOverWidth) },
        ],
      },
      {
        id: 'frame-c',
        stationId: 'S',
        width,
        height: 900,
        fxOverWidth,
        gravity: { x: 0, y: 1, z: 0 },
        sigmaPx: 2,
        clicks: [{ pointId: 'M3', ...projectClick(S, yaw2, M3, width, fxOverWidth) }],
      },
    ],
  });
  const placed = result.points.find((p) => p.id === 'S');
  assert.ok(placed?.x != null && placed.y != null, `${placed?.unsetCode}`);
  assert.ok(Math.hypot(placed.x - S.x, placed.y - S.y) < 0.02, `${placed.x}, ${placed.y}`);
});

test('two two-mark frames seed the station where the arcs meet', () => {
  const width = 1200;
  const fxOverWidth = 0.75;
  const S = { x: 2, y: 3 };
  const M1 = { x: -1, y: 5 };
  const M2 = { x: 1, y: 7 };
  const M3 = { x: 5, y: 5 };
  const M4 = { x: 4, y: 8 };
  const yawOf = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.atan2((a.y + b.y) / 2 - S.y, (a.x + b.x) / 2 - S.x);
  const yaw1 = yawOf(M1, M2);
  const yaw2 = yawOf(M3, M4);
  const result = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true },
    points: [
      { id: 'M1', held: M1 },
      { id: 'M2', held: M2 },
      { id: 'M3', held: M3 },
      { id: 'M4', held: M4 },
    ],
    photos: [
      {
        id: 'frame-1',
        stationId: 'S',
        width,
        height: 900,
        fxOverWidth,
        gravity: { x: 0, y: 1, z: 0 },
        sigmaPx: 2,
        clicks: [
          { pointId: 'M1', ...projectClick(S, yaw1, M1, width, fxOverWidth) },
          { pointId: 'M2', ...projectClick(S, yaw1, M2, width, fxOverWidth) },
        ],
      },
      {
        id: 'frame-2',
        stationId: 'S',
        width,
        height: 900,
        fxOverWidth,
        gravity: { x: 0, y: 1, z: 0 },
        sigmaPx: 2,
        clicks: [
          { pointId: 'M3', ...projectClick(S, yaw2, M3, width, fxOverWidth) },
          { pointId: 'M4', ...projectClick(S, yaw2, M4, width, fxOverWidth) },
        ],
      },
    ],
  });
  const placed = result.points.find((p) => p.id === 'S');
  assert.ok(placed?.x != null && placed.y != null, `${placed?.unsetCode} ${placed?.status}`);
  assert.ok(Math.hypot(placed.x - S.x, placed.y - S.y) < 0.02, `${placed.x}, ${placed.y}`);
});

test('a shared fx prior uses the smallest uncertainty, in either photo order', () => {
  const width = 1200;
  const fxOverWidth = 0.75;
  const S = { x: 4, y: 5 };
  const yaw = -Math.PI / 2;
  const clicks = [
    { pointId: 'A', ...projectClick(S, yaw, { x: 0, y: 0 }, width, fxOverWidth) },
    { pointId: 'B', ...projectClick(S, yaw, { x: 8, y: 0 }, width, fxOverWidth) },
  ];
  const photo = (id: string, fxRelativeUncertainty: number): SolverPhotoInput => ({
    id,
    stationId: 'S',
    width,
    height: 900,
    fxOverWidth,
    fxRelativeUncertainty,
    gravity: { x: 0, y: 1, z: 0 },
    phoneId: 'ph1',
    lens: '1x',
    clicks,
  });
  const base: SolveInput = {
    datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true },
    points: [{ id: 'S', held: S }],
  };
  const first = solve({ ...base, photos: [photo('p1', 0.05), photo('p2', 0.01)] });
  const swapped = solve({ ...base, photos: [photo('p2', 0.01), photo('p1', 0.05)] });
  const focal = (r: ReturnType<typeof solve>) => r.observations.find((o) => o.kind === 'focal');
  assert.equal(focal(first)?.sigma, 0.01);
  assert.equal(focal(swapped)?.sigma, 0.01);
  assert.ok(first.warnings.some((w) => w.code === 'fx-prior'));
  assert.ok(swapped.warnings.some((w) => w.code === 'fx-prior'));
  const agreed = solve({ ...base, photos: [photo('p1', 0.02), photo('p2', 0.02)] });
  assert.equal(agreed.warnings.some((w) => w.code === 'fx-prior'), false);
  assert.equal(focal(agreed)?.sigma, 0.02);
});

test('a held solve publishes the scaled fx σ and does not offer it as a calibration', () => {
  const width = 1200;
  const fxOverWidth = 0.75;
  const S = { x: 4, y: 5 };
  const M = { x: 4, y: 9 };
  const yaw = Math.PI / 2;
  const clicks = [
    { pointId: 'A', ...projectClick(S, yaw, { x: 0, y: 0 }, width, fxOverWidth) },
    { pointId: 'B', ...projectClick(S, yaw, { x: 8, y: 0 }, width, fxOverWidth) },
    { pointId: 'M', ...projectClick(S, yaw, M, width, fxOverWidth) },
  ];
  clicks[2].px += 40;
  const result = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true },
    points: [
      { id: 'S', held: S },
      { id: 'M', held: M },
    ],
    photos: [
      {
        id: 'cam',
        stationId: 'S',
        width,
        height: 900,
        fxOverWidth,
        fxRelativeUncertainty: 0.02,
        sigmaPx: 0.05,
        gravity: { x: 0, y: 1, z: 0 },
        phoneId: 'ph1',
        lens: '1x',
        clicks,
      },
    ],
  });
  assert.equal(result.varianceTest, 'high');
  assert.equal(result.covarianceScaled, true);
  assert.equal(result.focals.length, 1);
  assert.equal(result.focals[0].calibratable, false);
  assert.ok(result.focals[0].sigmaHeld != null && result.focals[0].sigma != null);
  assert.ok(Math.abs((result.focals[0].sigmaHeld ?? 0) - (result.focals[0].sigma ?? 0)) > 1e-6);
  assert.ok(result.warnings.some((w) => w.code === 'fx-held'));
});

test('loop4ct.json stays 15.3 × 2.8 mm when centring stays per ray', () => {
  const { input } = load('loop4ct.json');
  const result = solve(input);
  assert.equal(result.converged, true);
  const c3 = result.points.find((p) => p.id === 'C3');
  assert.ok(c3?.q);
  const ell = ellipseMm(c3.q);
  assert.ok(Math.abs(ell.major - 15.3) < 0.15, `major ${ell.major.toFixed(2)}`);
  assert.ok(Math.abs(ell.minor - 2.8) < 0.15, `minor ${ell.minor.toFixed(2)}`);
});

test('closed cross-ties and shared fx: far mark 6.3 mm, ties MDB ≤ 21 mm', () => {
  const { input, truth } = load('loop4ct-steps.json');
  const result = solve(traverse(input, true));
  assert.equal(result.converged, true);
  assert.equal(result.fxSharedInSolve, true);
  assert.equal(result.degreesOfFreedom, 34);
  const mark = (id: string) => {
    const p = result.points.find((q) => q.id === id);
    assert.ok(p?.q, id);
    return ellipseMm(p.q).major;
  };
  const c3 = mark('C3');
  assert.ok(Math.abs(c3 - 6.3) <= 0.3, `C3 ${c3.toFixed(2)} mm`);
  for (const id of ['C4', 'H3', 'H4']) {
    const major = mark(id);
    assert.ok(major <= 6.6, `${id} ${major.toFixed(2)} mm`);
  }
  for (const [id, t] of Object.entries(truth)) {
    const p = result.points.find((q) => q.id === id);
    assert.ok(p?.x != null && p.y != null, id);
    assert.ok(Math.hypot(p.x - t.x, p.y - t.y) * 1000 <= 1, id);
  }
  const ties = (input.distances ?? []).filter((d) => d.role === 'leg' || d.role === 'cross');
  assert.ok(ties.length > 0);
  for (const tie of ties) {
    const obs = result.observations.find((o) => o.id === tie.id);
    assert.ok(obs?.used, tie.id);
    assert.ok(obs.redundancy >= 0.14, `${tie.id} r ${obs.redundancy.toFixed(3)}`);
    const mdbMm = obs.mdb == null ? null : obs.mdb * 1000;
    // The design table rounds 21.25 mm to 21. The analytic cross-tie maximum is 21.25 mm.
    assert.ok(mdbMm != null && mdbMm <= 21.3, `${tie.id} MDB ${mdbMm?.toFixed(2)}`);
  }
  const fxPct = (result.focals[0].sigma ?? 0) * 100;
  assert.ok(Math.abs(fxPct - 0.042) < 0.004, `fx ${fxPct.toFixed(4)}%`);
});

test('per-photo fx with the setup offset: closed far mark 13.4 mm', () => {
  const { input } = load('loop4ct.json');
  const result = solve(traverse(input, false));
  assert.equal(result.fxSharedInSolve, false);
  assert.equal(result.degreesOfFreedom, 34);
  const c3 = result.points.find((p) => p.id === 'C3');
  assert.ok(c3?.q);
  const major = ellipseMm(c3.q).major;
  assert.ok(Math.abs(major - 13.4) < 0.4, `C3 ${major.toFixed(2)} mm`);
});

test('open cross-ties and shared fx: last mark 70 mm', () => {
  const { input } = load('loop4ct-open.json');
  const result = solve(traverse(input, true));
  assert.equal(result.converged, true);
  assert.equal(result.degreesOfFreedom, 19);
  const c4 = result.points.find((p) => p.id === 'C4');
  assert.ok(c4?.q, c4?.unsetCode);
  const major = ellipseMm(c4.q).major;
  assert.ok(Math.abs(major - 70) < 1.5, `C4 ${major.toFixed(2)} mm`);
});

test('closure report: along/across/azimuth sigmas, and χ² is not the raw misclosure', () => {
  const { input } = load('loop4ct-dup.json');
  const result = solve(traverse(input, true));
  assert.equal(result.converged, true);
  const report = closureReport(result, {
    pairs: [
      { id: 'C1', duplicateId: "C1'" },
      { id: 'C2', duplicateId: "C2'" },
      { id: 'H1', duplicateId: "H1'" },
    ],
    fromId: 'C4',
  });
  assert.ok(report, 'closure');
  assert.equal(report.rank, 6);
  assert.ok(report.chi2 < 1e-4, `χ² ${report.chi2}`);
  assert.ok(Math.abs(report.sigmaAlongM * 1000 - 57) < 1.5, `along ${report.sigmaAlongM * 1000}`);
  assert.ok(Math.abs(report.sigmaAcrossM * 1000 - 48.2) < 1.5, `across ${report.sigmaAcrossM * 1000}`);
  const azDeg = (report.sigmaAzimuthRad * 180) / Math.PI;
  assert.ok(Math.abs(azDeg - 0.493) < 0.02, `az ${azDeg}`);
  assert.equal(report.rawMisclosureIsBlunderTest, false);
  assert.ok(report.positionPass);
  assert.ok(report.azimuthPass);
  assert.ok(report.chi2Pass);
  assert.equal(report.qW.length, 3);
  assert.equal(report.qW[0].length, 3);
  assert.ok(report.position95M * 1000 > 100);
});

test('closure χ² Monte Carlo: mean within 10% of rank, 95% exceedance 3–8%', () => {
  const { input, truth } = load('loop4ct-dup.json');
  const baseInput = traverse(input, true);
  const clean = solve(baseInput);
  const report = closureReport(clean, {
    pairs: [
      { id: 'C1', duplicateId: "C1'" },
      { id: 'C2', duplicateId: "C2'" },
      { id: 'H1', duplicateId: "H1'" },
    ],
    fromId: 'C4',
  });
  assert.ok(report);
  assert.equal(report.rank, 6);
  const rng = mulberry32(20261010);
  const N = 200;
  const chis: number[] = [];
  let diverged = 0;
  for (let i = 0; i < N; i++) {
    const trial = solve(perturb(baseInput, truth, rng));
    if (!trial.converged) {
      diverged += 1;
      continue;
    }
    const d = duplicateMisclosure(trial, {
      pairs: [
        { id: 'C1', duplicateId: "C1'" },
        { id: 'C2', duplicateId: "C2'" },
        { id: 'H1', duplicateId: "H1'" },
      ],
      fromId: 'C4',
    });
    assert.ok(d, `trial ${i}`);
    chis.push(closureChi2(d, report.qDPlus));
  }
  const mean = chis.reduce((s, v) => s + v, 0) / Math.max(1, chis.length);
  const exceed = chis.filter((v) => v > report.chi2Limit95).length / Math.max(1, chis.length);
  // A draw that does not settle is not a χ² sample. This seed leaves only a few.
  assert.ok(diverged / N <= 0.02, `diverged ${diverged}`);
  assert.ok(Math.abs(mean - report.rank) / report.rank <= 0.1, `mean χ² ${mean.toFixed(2)} rank ${report.rank}`);
  assert.ok(exceed >= 0.03 && exceed <= 0.08, `exceedance ${(exceed * 100).toFixed(1)}% n=${chis.length}`);
});

test('incremental solve: ellipses grow 3 → 33 → 70 mm and close at 6.1 mm', () => {
  const { input } = load('loop4ct-steps.json');
  const steps = solveIncremental(traverse(input, true), [
    { step: 0, newestId: 'C2' },
    { step: 1, newestId: 'C3' },
    { step: 2, newestId: 'C4' },
    { step: 3, newestId: 'C4' },
  ]);
  const mm = (i: number) => (steps[i].semiMajorM ?? NaN) * 1000;
  assert.ok(Math.abs(mm(0) - 3.1) < 0.4, `step1 ${mm(0).toFixed(2)}`);
  assert.ok(Math.abs(mm(1) - 33.0) < 1.5, `step2 ${mm(1).toFixed(2)}`);
  assert.ok(Math.abs(mm(2) - 70.0) < 1.5, `step3 ${mm(2).toFixed(2)}`);
  assert.ok(Math.abs(mm(3) - 6.1) < 0.4, `step4 ${mm(3).toFixed(2)}`);
  // Analytic minimum is the leg-station ray S3→C1 at 0.136, which the design prints as 0.14.
  assert.ok(
    steps[3].tieRedundancy != null && Math.abs(steps[3].tieRedundancy - 0.136) < 0.015,
    `r ${steps[3].tieRedundancy}`,
  );
  assert.ok(steps[3].tieMdbM != null && steps[3].tieMdbM * 1000 <= 21.3, `MDB ${steps[3].tieMdbM}`);
  const fxPct = (steps[3].fxSigma ?? 0) * 100;
  assert.ok(Math.abs(fxPct - 0.042) < 0.004, `fx ${fxPct}`);
  assert.ok(steps.every((s) => s.converged));
});
