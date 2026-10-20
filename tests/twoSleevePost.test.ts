/**
 * Two-sleeve posts (rev 7): a base point with a top and a bottom sleeve a known distance apart.
 * Port of sim S7a (/workspace/petri/sim-control/RESULTS.md): 2 posts at (−5, −10) and (5, −10),
 * 1.2 m between the sleeves, 12 edge points on a 12 m circle, one 1× photo each facing the posts,
 * σ_px 1, fx error 0.5 %. RESULTS.md: 9 of 12 points have both posts in frame (3 no fix), 95 %
 * ellipse median about 305 mm, worst about 717 mm, and the left/right image order rejects the
 * mirror solution in every run.
 */
import { describe, expect, it } from 'vitest';
import {
  adjustSession,
  gateEdgePoints,
  HALF_FOV_RAD,
  POST_SEPARATION_DEFAULT_M,
  projectDy,
  projectU,
  rangeFromDy,
  sightingsFromPhoto,
  strengthLines,
  TWO_POINT_LABEL,
  twoPointFix,
  wrap,
  type EdgePhoto,
  type SessionInput,
  type Xy,
} from '../src/solver/controlCluster';

const FX = 2690;
const SEP = 1.2;
const POSTS: Xy[] = [{ x: -5, y: -10 }, { x: 5, y: -10 }];
const IDS = ['BAS01', 'BAS02'];
const EDGE: Xy[] = Array.from({ length: 12 }, (_, i) => ({ x: 6 * Math.cos((i * Math.PI) / 6), y: 6 * Math.sin((i * Math.PI) / 6) }));

function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** Edge points that hold both posts in the usable frame, aiming between them (bisector, as sim.py). */
function inFrame(c: Xy) {
  const ta = Math.atan2(POSTS[0].y - c.y, POSTS[0].x - c.x);
  const yaw = ta + wrap(Math.atan2(POSTS[1].y - c.y, POSTS[1].x - c.x) - ta) / 2;
  const ok = POSTS.every((p) => Math.abs(wrap(Math.atan2(p.y - c.y, p.x - c.x) - yaw)) < HALF_FOV_RAD);
  return { ok, yaw };
}

function simulate(randn: () => number, fxErr = 0.005, calibrationSigmaRel = 0.003, extra?: Xy) {
  const control = [...POSTS, ...(extra ? [extra] : [])].map((p, i) => ({ id: i < 2 ? IDS[i] : 'BAS03', x: p.x, y: p.y, postSeparationM: i < 2 ? SEP : undefined }));
  const truth = control.map((c) => ({ x: c.x + 0.003 * randn(), y: c.y + 0.003 * randn() }));
  const fxTrue = FX * (1 + fxErr);
  const used: number[] = [];
  const photos: EdgePhoto[] = [];
  EDGE.forEach((c, i) => {
    const { ok, yaw } = inFrame(c);
    if (!ok) return;
    used.push(i);
    const cam = { x: c.x, y: c.y, yaw: yaw + 0.05 * randn() };
    photos.push({
      pointId: `EDG${String(i + 1).padStart(2, '0')}`,
      sightings: control
        .map((s, j) => ({ s, j }))
        .filter(({ s }) => Math.abs(wrap(Math.atan2(s.y - c.y, s.x - c.x) - yaw)) < HALF_FOV_RAD)
        .map(({ s, j }) => ({
          id: s.id,
          u: projectU(cam, truth[j], fxTrue) + randn(),
          ...(s.postSeparationM ? { dyPx: projectDy(c, truth[j], fxTrue, SEP) + Math.SQRT2 * randn() } : {}),
        })),
    });
  });
  const n = control.length;
  const input: SessionInput = {
    control,
    controlCovariance: Array.from({ length: 2 * n }, (_, i) => Array.from({ length: 2 * n }, (_, j) => (i === j ? 0.003 ** 2 : 0))),
    photos,
    fx0: FX,
    calibrationSigmaRel,
    searchCentre: { x: 0, y: 0 },
    searchRadiusM: 9,
  };
  return { input, used };
}

describe('two-sleeve posts: S7a 2-point fix', () => {
  it('default post separation is 1.2 m', () => {
    expect(POST_SEPARATION_DEFAULT_M).toBe(1.2);
  });

  it('range from Δy is fx·s/Δy', () => {
    const dy = projectDy({ x: 0, y: 0 }, { x: 10, y: 0 }, FX, SEP);
    expect(dy).toBeCloseTo(322.8, 1);
    expect(rangeFromDy(dy, FX, SEP)).toBeCloseTo(10, 9);
  });

  it('resolves the side from the left/right image order (mirror rejected)', () => {
    const a = POSTS[0];
    const b = POSTS[1];
    for (const c of EDGE.filter((e) => inFrame(e).ok)) {
      const yaw = inFrame(c).yaw;
      const ua = projectU({ ...c, yaw }, a, FX);
      const ub = projectU({ ...c, yaw }, b, FX);
      const fix = twoPointFix(a, b, Math.hypot(a.x - c.x, a.y - c.y), Math.hypot(b.x - c.x, b.y - c.y), ua, ub, FX);
      expect(fix.sideResolved).toBe(true);
      expect(Math.hypot(fix.x - c.x, fix.y - c.y)).toBeLessThan(1e-6);
      expect(Math.abs(wrap(fix.yaw - yaw))).toBeLessThan(1e-6);
      // The mirror is on the far side of the line between the posts.
      expect(fix.mirror.y).toBeLessThan(-10);
      // Swapping the image order picks the mirror.
      const swapped = twoPointFix(a, b, Math.hypot(a.x - c.x, a.y - c.y), Math.hypot(b.x - c.x, b.y - c.y), ub, ua, FX);
      expect(Math.hypot(swapped.x - fix.mirror.x, swapped.y - fix.mirror.y)).toBeLessThan(1e-6);
    }
  });

  it('solves every 2-post photo, amber "2-point fix (unchecked)", never green (60 runs)', () => {
    const randn = rng(7);
    const ell: number[] = [];
    let points = 0;
    for (let run = 0; run < 60; run++) {
      const { input, used } = simulate(randn);
      expect(used).toHaveLength(9);
      const res = adjustSession(input);
      const gates = gateEdgePoints(input, res);
      res.photos.forEach((ph, p) => {
        const truth = EDGE[used[p]];
        // On the right side of the posts (no mirror), within a few ellipses.
        expect(Math.hypot(ph.x - truth.x, ph.y - truth.y)).toBeLessThan(Math.max(3 * gates[p].ellipse95M, 0.3));
        expect(gates[p].twoPointFix).toBe(true);
        expect(gates[p].cls).not.toBe('green');
        if (gates[p].cls === 'amber') expect(gates[p].reasons[0]).toContain(TWO_POINT_LABEL);
        ell.push(gates[p].ellipse95M);
        points += 1;
      });
      const amber = gates.filter((g) => g.cls === 'amber').length;
      expect(amber).toBeGreaterThanOrEqual(8);
    }
    ell.sort((a, b) => a - b);
    const median = ell[Math.floor(ell.length / 2)];
    // RESULTS.md S7a: median ≈ 305 mm, worst ≈ 717 mm (control σ 10 mm there, 3 mm here).
    expect(median).toBeGreaterThan(0.1);
    expect(median).toBeLessThan(0.6);
    expect(ell[ell.length - 1]).toBeLessThan(1.2);
    expect(points).toBe(60 * 9);
  });

  it('is grey "calibrate first" when the step-8 focal length is worse than 0.5 %', () => {
    const { input } = simulate(rng(3), 0.005, 0.008);
    const gates = gateEdgePoints(input, adjustSession(input));
    for (const g of gates) {
      expect(g.cls).toBe('grey');
      expect(g.reasons[0]).toContain(TWO_POINT_LABEL);
      expect(g.reasons[0]).toContain('calibrate first');
    }
  });

  it('with a third base point the ranges add redundancy: 3 base points + ranges are checked, not a 2-point fix', () => {
    const { input } = simulate(rng(11), 0.005, 0.003, { x: 0, y: -12 });
    const res = adjustSession(input);
    const gates = gateEdgePoints(input, res);
    for (const g of gates) {
      expect(g.twoPointFix).toBe(false);
      expect(g.basePointCount).toBe(3);
      expect(g.rangeCount).toBe(2);
      expect(g.missing).toEqual([]);
      expect(g.rows.filter((r) => r.kind === 'range').every((r) => r.r > 0)).toBe(true);
    }
    expect(strengthLines(gates[0]).some((l) => l.includes('BAS01 range'))).toBe(true);
  });

  it('a 2-point photo without post ranges stays grey', () => {
    const { input } = simulate(rng(5));
    const bare: SessionInput = { ...input, photos: input.photos.map((p) => ({ ...p, sightings: p.sightings.map(({ id, u }) => ({ id, u })) })), control: input.control.map(({ id, x, y }) => ({ id, x, y })) };
    // Seed from the truth: 2 bearings cannot place the camera on their own.
    const seeded: SessionInput = { ...bare, photos: bare.photos.map((p) => ({ ...p, seed: { x: 0, y: 0, yaw: -Math.PI / 2 } })) };
    let gates;
    try {
      gates = gateEdgePoints(seeded, adjustSession(seeded));
    } catch {
      return; // does not solve: also not a fix
    }
    for (const g of gates) expect(g.cls).toBe('grey');
  });
});

describe('sightingsFromPhoto: two-sleeve posts', () => {
  const photo = (bottom: { px: number; py: number }) => ({
    width: 4032,
    height: 3024,
    clicks: [
      { pointId: 'BAS03', px: 2016 + 100, py: 1512 - 100 },
      { pointId: 'BAS03B', ...bottom },
      { pointId: 'BAS04', px: 1000, py: 1500 },
    ],
  });

  it('gives Δy for an aligned top and bottom sleeve', () => {
    const s = sightingsFromPhoto(photo({ px: 2016 + 100, py: 1512 + 222.8 }), new Set(['BAS03', 'BAS04']), FX);
    const b3 = s.sightings.find((x) => x.id === 'BAS03')!;
    expect(b3.dyPx).toBeGreaterThan(320);
    expect(b3.dyPx).toBeLessThan(326);
    expect(s.sightings.find((x) => x.id === 'BAS04')!.dyPx).toBeUndefined();
    expect(s.misaligned).toEqual([]);
  });

  it('drops the range when the two sleeves are not vertically aligned, or upside down', () => {
    expect(sightingsFromPhoto(photo({ px: 2016 + 160, py: 1512 + 222 }), new Set(['BAS03']), FX).misaligned).toEqual(['BAS03']);
    const flipped = sightingsFromPhoto(photo({ px: 2016 + 100, py: 1512 - 400 }), new Set(['BAS03']), FX);
    expect(flipped.misaligned).toEqual(['BAS03']);
    expect(flipped.sightings[0].dyPx).toBeUndefined();
  });
});
