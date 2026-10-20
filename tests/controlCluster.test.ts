/**
 * Ports of the control-cluster simulations (/workspace/petri/sim-control, sim10/sim11, layout B)
 * as unit tests: σ_px 1, control σ 3 mm, fx prior 0.3 %, session fx solved, 12 edge points on a
 * 12 m circle, one 1× photo each facing the centre.
 */
import { describe, expect, it } from 'vitest';
import {
  adjustGridNetwork,
  adjustSession,
  familyCriticalW,
  gateEdgePoints,
  normalQuantile,
  projectU,
  strengthLines,
  visibleSleeves,
  controlCircleVerdict,
  sightingsFromPhoto,
  type EdgePhoto,
  type SessionInput,
  type Xy,
} from '../src/solver/controlCluster';
import { kasaSeed } from '../src/solver/circleFit';
import { CIRCLE_SLEEVES } from '../scripts/markerSleeve';
import tolerances from '../workflow/tolerances.json';
import { glossaryById } from '../src/workflow/glossary';

/** Layout B (sim11, RESULTS.md round 5): 7 staggered base points within 6 m of the circle centre. Test fixture only. */
const LAYOUT_B: Xy[] = [
  { x: 2.6, y: -0.48 },
  { x: 1.73, y: 0.12 },
  { x: -0.13, y: -0.56 },
  { x: -0.87, y: 1.76 },
  { x: -0.48, y: 0.72 },
  { x: 1.62, y: 1.34 },
  { x: -1.08, y: -1.44 },
];
const bas = (i: number) => `BAS${String(i + 3).padStart(2, '0')}`;

const FX = 2690;
const R = 6;
const EDGE: Xy[] = Array.from({ length: 12 }, (_, i) => ({ x: R * Math.cos((i * Math.PI) / 6), y: R * Math.sin((i * Math.PI) / 6) }));

function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

function diameter(pts: Xy[]): number {
  return 2 * kasaSeed(pts)!.r;
}

interface Scenario {
  sleeves: readonly Xy[];
  cams?: Xy[];
  fxErr?: number;
  blunder?: { sleeve: number; dx: number; dy: number };
  randn: () => number;
  calibrationSigmaRel?: number;
  /** Drop sighting j from photo p (occlusion). */
  hide?: (p: number, j: number) => boolean;
}

function simulate(sc: Scenario) {
  const cams = sc.cams ?? EDGE;
  const ids = sc.sleeves.map((_, i) => bas(i));
  const truth = sc.sleeves.map((s) => ({ x: s.x + 0.003 * sc.randn(), y: s.y + 0.003 * sc.randn() }));
  if (sc.blunder) {
    truth[sc.blunder.sleeve].x += sc.blunder.dx;
    truth[sc.blunder.sleeve].y += sc.blunder.dy;
  }
  const photos: EdgePhoto[] = cams.map((c, p) => {
    const yaw = Math.atan2(-c.y, -c.x);
    const yt = yaw + 0.05 * sc.randn();
    const vis = visibleSleeves(c, yaw, sc.sleeves);
    return {
      pointId: `EDG${String(p + 1).padStart(2, '0')}`,
      sightings: vis.filter((j) => !sc.hide?.(p, j)).map((j) => ({ id: ids[j], u: projectU({ x: c.x, y: c.y, yaw: yt }, truth[j], FX * (1 + (sc.fxErr ?? 0.005))) + sc.randn() })),
      seed: { x: c.x + 0.2 * sc.randn(), y: c.y + 0.2 * sc.randn(), yaw },
    };
  });
  const n = sc.sleeves.length;
  const cov = Array.from({ length: 2 * n }, (_, i) => Array.from({ length: 2 * n }, (_, j) => (i === j ? 0.003 ** 2 : 0)));
  const input: SessionInput = {
    control: sc.sleeves.map((s, i) => ({ id: ids[i], x: s.x, y: s.y })),
    controlCovariance: cov,
    photos,
    fx0: FX,
    calibrationSigmaRel: sc.calibrationSigmaRel ?? 0.003,
  };
  const res = adjustSession(input);
  const gates = gateEdgePoints(input, res);
  return { res, gates, dD: diameter(res.photos.map((p) => ({ x: p.x, y: p.y }))) - diameter(cams) };
}

describe('control cluster: helpers', () => {
  it('normal quantile and Bonferroni k', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.0005)).toBeCloseTo(-3.290527, 4);
    expect(familyCriticalW(7)).toBeCloseTo(2.69, 2);
    expect(familyCriticalW(1)).toBeCloseTo(1.96, 2);
  });

  it('base points are BAS01… from the garden marker set (no special circle set)', () => {
    expect(CIRCLE_SLEEVES.every((sl) => /^BAS\d\d$/.test(sl.point))).toBe(true);
    expect(CIRCLE_SLEEVES).toHaveLength(14);
  });

  it('gates live in tolerances.json and the glossary has reliability-shift', () => {
    expect(tolerances.controlShiftGreenMm).toBe(40);
    expect(tolerances.controlShiftAmberMm).toBe(60);
    expect(tolerances.controlBlunderW).toBe(3.29);
    expect(tolerances.controlCalibrateFirstFxRel).toBe(0.005);
    expect(glossaryById('reliability-shift')?.short).toMatch(/how far an undetected error could move this point/i);
  });

  it('layout B: every edge point sees all 7 sleeves in one 1× photo', () => {
    for (const c of EDGE) expect(visibleSleeves(c, Math.atan2(-c.y, -c.x), LAYOUT_B)).toHaveLength(7);
  });
});

describe('control network on the N/E grid', () => {
  const truth: Record<string, Xy> = { BAS02: { x: 6, y: 0 }, CTL01: { x: 3.2, y: 4.1 }, CTL02: { x: 1.4, y: 6.3 } };
  const tie = (from: string, to: string, extra?: Partial<{ e: number; n: number; d: number }>) => {
    const a = from === 'BAS01' ? { x: 0, y: 0 } : truth[from];
    const b = truth[to];
    return { from, to, eastM: b.x - a.x + (extra?.e ?? 0), northM: b.y - a.y + (extra?.n ?? 0), diagonalM: Math.hypot(b.x - a.x, b.y - a.y) + (extra?.d ?? 0) };
  };

  it('places points from N/E offsets; a consistent diagonal passes', () => {
    const net = adjustGridNetwork('BAS01', [tie('BAS01', 'BAS02'), tie('BAS02', 'CTL01'), tie('CTL01', 'CTL02'), { from: 'BAS01', to: 'CTL02', diagonalM: Math.hypot(1.4, 6.3) }]);
    expect(net.points.CTL02.x).toBeCloseTo(1.4, 6);
    expect(net.points.CTL02.y).toBeCloseTo(6.3, 6);
    for (const d of net.diagonals) expect(d.flag === 'green' || d.flag === 'grey').toBe(true);
  });

  it('a 30 mm diagonal mismatch is red', () => {
    const net = adjustGridNetwork('BAS01', [tie('BAS01', 'BAS02'), tie('BAS02', 'CTL01', { d: 0.03 }), tie('CTL01', 'CTL02')]);
    const d = net.diagonals.find((o) => o.to === 'CTL01')!;
    expect(Math.abs(d.w)).toBeGreaterThan(3.29);
    expect(d.flag).toBe('red');
  });
});

describe('session adjustment, layout B (sim11)', () => {
  it('95% |ΔD| ≤ 60 mm and most points green at fx error 0.5%', () => {
    const randn = rng(11);
    const dD: number[] = [];
    const cls: Record<string, number> = { green: 0, amber: 0, grey: 0, red: 0 };
    for (let k = 0; k < 120; k++) {
      const s = simulate({ sleeves: LAYOUT_B, randn });
      dD.push(Math.abs(s.dD));
      for (const g of s.gates) cls[g.cls] += 1;
    }
    dD.sort((a, b) => a - b);
    const p95 = dD[Math.floor(0.95 * dD.length)];
    if (process.env.CONTROL_SIM_LOG) console.log(`p95 |ΔD| ${(p95 * 1000).toFixed(1)} mm`, cls);
    expect(p95).toBeLessThanOrEqual(0.06);
    const total = Object.values(cls).reduce((a, b) => a + b, 0);
    expect(cls.grey / total).toBeLessThan(0.05);
    expect(cls.green / total).toBeGreaterThan(0.5);
  });

  it('shows r, MDB and reliability shift for each sleeve', () => {
    const s = simulate({ sleeves: LAYOUT_B, randn: rng(3) });
    const g = s.gates[0];
    expect(g.rows).toHaveLength(7);
    expect(g.reliabilityShiftM).toBeLessThan(0.06);
    const lines = strengthLines(g);
    expect(lines.join('\n')).toMatch(/r 0\.\d\d · MDB .* px · w .* ∇x \d+ mm/);
  });

  it('a 30 mm control blunder is flagged and named', () => {
    const randn = rng(5);
    let flagged = 0;
    let named = 0;
    const runs = 40;
    for (let k = 0; k < runs; k++) {
      const s = simulate({ sleeves: LAYOUT_B, randn, blunder: { sleeve: 0, dx: 0.03, dy: 0 } });
      if (s.res.suspect && Math.abs(s.res.suspect.w) > 3.29) {
        flagged += 1;
        if (s.res.suspect.sleeve === bas(0)) named += 1;
      }
    }
    expect(flagged / runs).toBeGreaterThanOrEqual(0.9);
    expect(named / flagged).toBeGreaterThanOrEqual(0.9);
  });

  it('a photo with sleeves hidden (fewer than 4 base points) goes grey', () => {
    // Line up three blockers in front of LAYOUT_B sleeves as seen from EDG01, plus a narrow frame: keep 3 visible.
    const c = EDGE[0];
    const keep = [0, 1, 2];
    const s = simulate({ sleeves: LAYOUT_B, randn: rng(9), hide: (p, j) => p === 0 && !keep.includes(j) });
    expect(s.gates[0].cls).toBe('grey');
    expect(s.gates[0].missing.length).toBeGreaterThan(0);
    expect(c.x).toBe(6);
  });

  it('a photo on the danger circle goes grey', () => {
    // Four sleeves on one circle; the camera stands on the same circle.
    const cc = { x: 0, y: 0 };
    const rr = 3;
    const ang = [150, 175, 195, 215].map((d) => (d * Math.PI) / 180);
    const sleeves = ang.map((a) => ({ x: cc.x + rr * Math.cos(a), y: cc.y + rr * Math.sin(a) }));
    const cam = { x: rr, y: 0 }; // on the circle, facing −x
    const s = simulate({ sleeves, cams: [cam, { x: 6, y: 1.5 }, { x: 6, y: -1.5 }], randn: rng(2), fxErr: 0 });
    expect(s.gates[0].cls).toBe('grey');
    expect(s.gates[0].reasons[0]).toMatch(/danger circle|Unchecked/);
  });

  it('step-8 σ_fx above 0.5% never gives green ("calibrate first")', () => {
    const s = simulate({ sleeves: LAYOUT_B, randn: rng(4), calibrationSigmaRel: 0.008 });
    expect(s.gates.every((g) => g.cls !== 'green')).toBe(true);
    expect(s.gates[0].reasons.join(' ')).toMatch(/Calibrate first/);
  });
});

describe('circle fit and tape comparison (unchanged circleVerdict)', () => {
  it('layout B with good tapes passes', () => {
    const s = simulate({ sleeves: LAYOUT_B, randn: rng(21) });
    const ids = LAYOUT_B.map((_, i) => bas(i));
    const input: SessionInput = {
      control: LAYOUT_B.map((p, i) => ({ id: ids[i], x: p.x, y: p.y })),
      controlCovariance: Array.from({ length: 14 }, (_, i) => Array.from({ length: 14 }, (_, j) => (i === j ? 9e-6 : 0))),
      photos: EDGE.map((c, p) => ({
        pointId: `EDG${String(p + 1).padStart(2, '0')}`,
        sightings: LAYOUT_B.map((sl, j) => ({ id: ids[j], u: projectU({ x: c.x, y: c.y, yaw: Math.atan2(-c.y, -c.x) }, sl, FX) })),
      })),
      fx0: FX,
      searchCentre: { x: 0, y: 0 },
      searchRadiusM: 8,
    };
    expect(s.gates).toHaveLength(12);
    const out = controlCircleVerdict(input, { tapes: { diametersM: [12.004, 11.998, 12.001], edge: 'inside' } });
    expect(out.verdict.fit!.diameterM).toBeCloseTo(12, 2);
    expect(out.verdict.state).toBe('green');
  });

  it('reads sightings from a photo: full-res px, levelled with gravity when present', () => {
    const photo = { width: 1008, height: 756, clicks: [{ pointId: 'BAS03', px: 529, py: 378 }, { pointId: 'EDG01', px: 1, py: 1 }], originalFile: { fullWidth: 4032, fullHeight: 3024, previewScaleX: 0.25, previewScaleY: 0.25 } };
    const flat = sightingsFromPhoto(photo, new Set(['BAS03']), FX);
    expect(flat.levelled).toBe(false);
    expect(flat.sightings).toHaveLength(1);
    expect(flat.sightings[0].u).toBeCloseTo(100, 6);
    const tilted = sightingsFromPhoto({ ...photo, originalFile: { ...photo.originalFile, nativeCapture: { gravity: { x: 0, y: 1, z: 0 } } } }, new Set(['BAS03']), FX);
    expect(tilted.levelled).toBe(true);
    expect(tilted.sightings[0].u).toBeCloseTo(100, 6); // this gravity means no pitch, no roll
  });
});
