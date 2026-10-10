/**
 * Walk-round stages 1 and 2. Shared fx per phone, and placement that repeats
 * until the 4-leg loop is seeded. Fixtures are the design's noise-free
 * SolveInputs (loop4.json, loop4ct.json).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emptyDocument } from '../src/model.ts';
import { solve, solveGardenDocument } from '../src/solver/index.ts';
import type { SolveInput, SolverPhotoInput } from '../src/solver/types.ts';
import { wrap } from '../src/solver/bearing.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

interface Fixture {
  input: SolveInput;
  truth: Record<string, { x: number; y: number }>;
}

function load(name: string): Fixture {
  return JSON.parse(readFileSync(join(root, 'fixtures/traverse', name), 'utf8')) as Fixture;
}

/** 1σ semi-axes, millimetres, from the marginal cofactor (qxx, qxy, qyy). */
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

/**
 * One phone, and one camera setup per occupation. Closing C1 is not the
 * opening occupation. The design's ≤8 mm / ~0.045% figures use this offset
 * (8 mm, from sigmaCentringM) instead of per-ray centring.
 */
function withSharedFx(input: SolveInput): SolveInput {
  return {
    ...input,
    photos: (input.photos ?? []).map((p) => ({
      ...p,
      phoneId: 'ph1',
      lens: '1x',
      cameraSetupId: `${p.stationId}:${p.id.includes('-close-') ? 'close' : 'open'}`,
    })),
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

test('shared fx on the closed 4-leg loop: far mark ≤ 8 mm and fx σ about 0.045%', () => {
  const { input, truth } = load('loop4.json');
  const result = solve(withSharedFx(input));
  assert.equal(result.converged, true);
  assert.equal(result.degreesOfFreedom, 22);
  assert.equal(result.fxSharedInSolve, true);
  assert.equal(result.focals.length, 1);
  assert.equal(result.focals[0].shared, true);
  assert.equal(result.focals[0].phoneId, 'ph1');
  assert.equal(result.focals[0].lens, '1x');
  assert.ok((result.focals[0].photoIds.length ?? 0) > 1);

  const c3 = result.points.find((p) => p.id === 'C3');
  assert.ok(c3?.q, `C3 ${c3?.status} ${c3?.unsetCode}`);
  const ell = ellipseMm(c3.q);
  assert.ok(ell.major <= 8, `C3 1σ ${ell.major.toFixed(2)} mm`);
  assert.ok(Math.abs(ell.major - 7.4) < 0.4, `C3 1σ ${ell.major.toFixed(2)} mm, design 7.4`);

  const fxPct = (result.focals[0].sigma ?? 0) * 100;
  // The design prints 0.045%. The analytic value is 0.0445% before rounding.
  assert.ok(fxPct >= 0.044 && fxPct <= 0.06, `fx σ ${fxPct.toFixed(4)}%`);

  for (const [id, t] of Object.entries(truth)) {
    const p = result.points.find((q) => q.id === id);
    assert.ok(p?.x != null && p.y != null, `${id} ${p?.status} ${p?.unsetCode}`);
    const d = Math.hypot(p.x - t.x, p.y - t.y) * 1000;
    assert.ok(d <= 1, `${id} ${d.toFixed(2)} mm from truth`);
  }
});

test('loop4.json places every mark, including C4 and the side-2 station, to ±1 mm', () => {
  const { input, truth } = load('loop4.json');
  const result = solve(input);
  assert.equal(result.converged, true);
  assert.equal(result.fxSharedInSolve, false);
  for (const id of ['C4', 'S1', 'H3', 'H4', 'S2', 'S3']) {
    const p = result.points.find((q) => q.id === id);
    assert.ok(p?.x != null && p.y != null, `${id} ${p?.unsetCode}`);
  }
  for (const [id, t] of Object.entries(truth)) {
    const p = result.points.find((q) => q.id === id);
    assert.ok(p?.x != null && p.y != null, id);
    const d = Math.hypot(p.x - t.x, p.y - t.y) * 1000;
    assert.ok(d <= 1, `${id} ${d.toFixed(2)} mm`);
  }
});

test('loop4ct.json still gives C3 15.3 × 2.8 mm with per-photo fx', () => {
  const { input, truth } = load('loop4ct.json');
  const result = solve(input);
  assert.equal(result.fxSharedInSolve, false);
  assert.equal(result.converged, true);
  const c3 = result.points.find((p) => p.id === 'C3');
  assert.ok(c3?.q, `C3 ${c3?.status} ${c3?.unsetCode}`);
  const ell = ellipseMm(c3.q);
  assert.ok(Math.abs(ell.major - 15.3) < 0.15, `major ${ell.major.toFixed(2)}`);
  assert.ok(Math.abs(ell.minor - 2.8) < 0.15, `minor ${ell.minor.toFixed(2)}`);
  const p = result.points.find((q) => q.id === 'C3');
  assert.ok(p?.x != null && p.y != null);
  assert.ok(Math.hypot(p.x - truth.C3.x, p.y - truth.C3.y) * 1000 <= 1);
});

test('one tape and one ray place a mark; two placed targets orient the photo', () => {
  const width = 1200;
  const fxOverWidth = 0.75;
  const S = { x: 4, y: 6 };
  const M1 = { x: 3, y: 8 };
  const M2 = { x: 5, y: 8 };
  const P = { x: 4, y: 10 };
  const yaw = Math.PI / 2;
  const photo: SolverPhotoInput = {
    id: 'cam',
    stationId: 'S',
    width,
    height: 900,
    fxOverWidth,
    gravity: { x: 0, y: 1, z: 0 },
    sigmaPx: 2,
    clicks: [
      { pointId: 'M1', ...projectClick(S, yaw, M1, width, fxOverWidth) },
      { pointId: 'M2', ...projectClick(S, yaw, M2, width, fxOverWidth) },
      { pointId: 'P', ...projectClick(S, yaw, P, width, fxOverWidth) },
    ],
  };
  const result = solve({
    datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true },
    points: [
      { id: 'S', held: S },
      { id: 'M1', held: M1 },
      { id: 'M2', held: M2 },
    ],
    photos: [photo],
    distances: [{ id: 'SP', a: 'S', b: 'P', slopeM: 4, sigmaM: 0.005 }],
  });
  const placed = result.points.find((p) => p.id === 'P');
  assert.ok(placed?.x != null && placed.y != null, placed?.unsetCode);
  assert.ok(Math.hypot(placed.x - P.x, placed.y - P.y) * 1000 <= 1, `${placed.x}, ${placed.y}`);
  assert.equal(result.fxSharedInSolve, false);
});

test('the same phone shares one fx; no phone id keeps a private scale', () => {
  const width = 1200;
  const fxOverWidth = 0.75;
  const S = { x: 4, y: 5 };
  const yaw = -Math.PI / 2;
  const clicks = [
    { pointId: 'A', ...projectClick(S, yaw, { x: 0, y: 0 }, width, fxOverWidth) },
    { pointId: 'B', ...projectClick(S, yaw, { x: 8, y: 0 }, width, fxOverWidth) },
  ];
  const photo = (id: string, phoneId?: string): SolverPhotoInput => ({
    id,
    stationId: 'S',
    width,
    height: 900,
    fxOverWidth,
    fxRelativeUncertainty: 0.02,
    gravity: { x: 0, y: 1, z: 0 },
    clicks,
    phoneId,
    lens: phoneId ? '1x' : undefined,
  });
  const base: SolveInput = {
    datum: { originId: 'A', axisPointId: 'B', lengthM: 8, fixScale: true },
    points: [{ id: 'S', held: S }],
    distances: [
      { id: 'SA', a: 'S', b: 'A', slopeM: Math.hypot(4, 5), sigmaM: 0.01 },
      { id: 'SB', a: 'S', b: 'B', slopeM: Math.hypot(4, 5), sigmaM: 0.01 },
    ],
  };
  const shared = solve({ ...base, photos: [photo('p1', 'phone-a'), photo('p2', 'phone-a')] });
  assert.equal(shared.fxSharedInSolve, true);
  assert.equal(shared.focals.length, 1);
  assert.deepEqual(shared.focals[0].photoIds.slice().sort(), ['p1', 'p2']);

  const split = solve({ ...base, photos: [photo('p1', 'phone-a'), photo('p2', 'phone-b')] });
  assert.equal(split.fxSharedInSolve, false);
  assert.equal(split.focals.length, 2);

  const legacy = solve({ ...base, photos: [photo('p1'), photo('p2')] });
  assert.equal(legacy.fxSharedInSolve, false);
  assert.equal(legacy.focals.length, 2);
  assert.ok(legacy.focals.every((f) => !f.shared));
});

test('an old garden without a phone id still solves and does not share fx', () => {
  const doc = emptyDocument('old');
  doc.points = [
    { id: 'A', kind: 'HSE' },
    { id: 'B', kind: 'HSE' },
    { id: 'S', kind: 'OCC' },
  ];
  doc.baselines = [{ id: 'BL', a: 'A', b: 'B', lengthM: 8, sigmaM: 0.02, kind: 'tape', trust: 80 }];
  doc.lines = [
    { id: 'SA', a: 'S', b: 'A', lengthM: Math.hypot(4, 5), sigmaM: 0.01, kind: 'tape' },
    { id: 'SB', a: 'S', b: 'B', lengthM: Math.hypot(4, 5), sigmaM: 0.01, kind: 'tape' },
  ];
  const bare = solveGardenDocument(doc);
  assert.equal(bare.fxSharedInSolve, false);
  assert.deepEqual(bare.focals, []);
  const sBare = bare.points.find((p) => p.id === 'S');
  assert.ok(sBare?.x != null && sBare.y != null, sBare?.unsetCode);

  const width = 1200;
  const fxOverWidth = 0.75;
  const station = { x: 4, y: 5 };
  const yaw = -Math.PI / 2;
  const clicks = [
    { pointId: 'A', ...projectClick(station, yaw, { x: 0, y: 0 }, width, fxOverWidth) },
    { pointId: 'B', ...projectClick(station, yaw, { x: 8, y: 0 }, width, fxOverWidth) },
  ];
  doc.photos = [1, 2].map((n) => ({
    id: `p${n}`,
    setupId: 'setup-1',
    addPointId: 'S',
    width,
    height: 900,
    fxOverWidth,
    fxRelativeUncertainty: 0.02,
    phoneId: 'phone-a',
    lens: '1x',
    clicks,
  }));
  const shared = solveGardenDocument(doc);
  assert.equal(shared.fxSharedInSolve, true);
  assert.equal(shared.focals.length, 1);
});
