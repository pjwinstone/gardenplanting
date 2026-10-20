/** Garden-circle validation end to end through the main adjustment (docs/garden-circle.md). */
import { describe, expect, it } from 'vitest';
import { solve } from '../src/solver/adjust';
import { circleCheckFromSolve, circleVerdict, fitCircleWeighted, type CircleCheckInput } from '../src/solver/circleCheck';
import { circleSurvey, type CircleSurveyOpt } from './fixtures/circleSurvey';

function run(o: CircleSurveyOpt, tapes = [12.004, 11.998, 12.006]) {
  const s = circleSurvey(o);
  const res = solve(s.input);
  const check = circleCheckFromSolve(res, s.edgeIds, { tapes: { diametersM: tapes, edge: 'inside' }, plannedPoints: s.edgeIds.length });
  return { s, res, check, v: circleVerdict(check) };
}

describe('garden circle', () => {
  it('12 m circle, 12 points, 4 cameras ~6 m outside the edge, no baseline end needed per photo: green', () => {
    const { v, check, res } = run({ camRange: 12 });
    process.stderr.write(`[circle green] ${v.state} ${v.headline} chi2=${v.fit?.chi2.toFixed(2)}/${v.fit?.dof} rms=${v.fit?.rmsM.toFixed(4)} conv=${res.converged} pts=${check.points.length} cams=${check.cameras.length}\n${v.guidance.join('\n')}\n`);
    expect(v.state).toBe('green');
    expect(Math.abs(v.fit!.diameterM - 12)).toBeLessThan(0.03);
    expect(v.guidance).toEqual([]);
    expect(check.network?.fullRank).toBe(true);
    expect(check.network?.cameras.every((c) => (c.semiMajor95M ?? 1) < 0.2)).toBe(true);
  });

  it('a taped position behind the baseline line cannot be placed: network not solvable, says why', () => {
    const { v } = run({ camRange: 12, cameraDeg: [-60, 30, 150, 240] });
    expect(v.state).toBe('needs-data');
    expect(v.headline).toMatch(/does not solve on its own yet: no edge point could be placed \(POS1 could be on either side/);
  });

  it('6 m baseline for a 12 m circle: far points beyond 2 baselines give a warning, not a gate', () => {
    const s = circleSurvey({ camRange: 12 });
    const res = solve(s.input);
    const v = circleVerdict(circleCheckFromSolve(res, s.edgeIds, { tapes: { diametersM: [12.004, 11.998, 12.006], edge: 'inside' }, baselineM: 6 }));
    expect(v.state).toBe('green');
    expect(v.warnings?.[0]).toMatch(/more than 2 baseline lengths \(12\.0 m\).*8–10 m, roughly along the circle/);
  });

  it('points on a 90° arc only: weak or inconclusive, never a pass, and says where to add points', () => {
    const { v } = run({ camRange: 15, pointDeg: [200, 210, 220, 230, 240, 250, 260, 270, 280, 290] });
    process.stderr.write(`[circle arc] ${v.state} ${v.headline}\n${v.guidance.join('\n')}\n`);
    expect(['weak', 'inconclusive']).toContain(v.state);
    expect(v.guidance.some((g) => /^Add a point between EDG\d\d and EDG\d\d/.test(g))).toBe(true);
  });

  it('an ellipse (12 m by 11.6 m) is "not a circle"', () => {
    const { v } = run({ camRange: 15, ry: 5.8 });
    process.stderr.write(`[circle ellipse] ${v.state} ${v.headline}\n${v.guidance.join('\n')}\n`);
    expect(v.state).toBe('not-a-circle');
    expect(v.headline).toMatch(/^Not a circle/);
  });

  it('cameras all on one side: guidance says which side to take a photo from', () => {
    const { v } = run({ camRange: 15, cameraDeg: [-60, -40, -20] });
    process.stderr.write(`[circle one side] ${v.state} ${v.headline}\n${v.guidance.join('\n')}\n`);
    expect(v.state).not.toBe('green');
    expect(v.guidance.some((g) => /^Take a photo from the .+, outside the circle beyond EDG\d\d and EDG\d\d\./.test(g))).toBe(true);
  });

  it('the diameter tape: 3 entries needed; far off is red, a bit off is amber', () => {
    expect(run({ camRange: 15 }, [12.0, 12.01]).v.state).toBe('needs-data');
    expect(run({ camRange: 15 }, [12.07, 12.07, 12.072]).v.state).toBe('amber');
    expect(run({ camRange: 15 }, [12.2, 12.2, 12.2]).v.state).toBe('red');
  });
});

// Unit checks on synthetic inputs (no solve).
const ring = (n = 12, r = 6) => Array.from({ length: n }, (_, i) => {
  const a = ((i * 360) / n + 15) * Math.PI / 180;
  return { id: `EDG${String(i + 1).padStart(2, '0')}`, x: r * Math.cos(a), y: r * Math.sin(a) };
});
function cov(n: number, sigma: number, common: number, crossTerms = true): number[][] {
  const C = Array.from({ length: 2 * n }, () => Array(2 * n).fill(0));
  for (let i = 0; i < 2 * n; i += 1) {
    for (let j = 0; j < 2 * n; j += 1) {
      const sameAxis = i % 2 === j % 2;
      const samePoint = Math.floor(i / 2) === Math.floor(j / 2);
      if (sameAxis && (crossTerms || samePoint)) C[i][j] = common * common;
      if (i === j) C[i][j] += sigma * sigma;
    }
  }
  return C;
}

describe('circle fit weighting: W = (J Σ_pp Jᵀ + σ²I)⁻¹ with the full joint covariance', () => {
  it('a shared translation of all points (cross-covariances) does not inflate σ_R; dropping the cross terms does', () => {
    const pts = ring();
    const plain = fitCircleWeighted(pts, cov(12, 0.005, 0))!;
    const full = fitCircleWeighted(pts, cov(12, 0.005, 0.05))!;
    const blocks = fitCircleWeighted(pts, cov(12, 0.005, 0.05, false))!;
    expect(full.sigmaRM).toBeCloseTo(plain.sigmaRM, 4);
    expect(blocks.sigmaRM).toBeGreaterThan(2 * full.sigmaRM);
  });
});

describe('circle geometry gates on synthetic inputs', () => {
  const base = (): CircleCheckInput => {
    const points = ring();
    const cameras = [0, 90, 180, 270].map((d, k) => ({ id: `POS${k + 1}`, x: 12 * Math.cos(d * Math.PI / 180), y: 12 * Math.sin(d * Math.PI / 180) }));
    const rays = points.flatMap((p) => cameras.map((c) => ({ pointId: p.id, cameraId: c.id })));
    return {
      points, covariance: cov(12, 0.004, 0), cameras, rays,
      tapes: { diametersM: [12, 12, 12], edge: 'inside' },
      network: { fullRank: true, cameras: cameras.map((c) => ({ id: c.id, semiMajor95M: 0.03 })) },
    };
  };

  it('all gates pass: green', () => {
    expect(circleVerdict(base()).state).toBe('green');
  });

  it('per-edge-point intersection angle < 30° is flagged', () => {
    const inp = base();
    // EDG01 seen only from two cameras close together in direction.
    inp.cameras.push({ id: 'POSX', x: 30, y: 6 });
    inp.rays = inp.rays.filter((r) => r.pointId !== 'EDG01').concat([{ pointId: 'EDG01', cameraId: 'POS1' }, { pointId: 'EDG01', cameraId: 'POSX' }]);
    const v = circleVerdict(inp);
    expect(v.state).toBe('weak');
    expect(v.guidance.some((g) => /^EDG01 is seen from directions only \d+° apart \(needs 30°\)/.test(g))).toBe(true);
  });

  it('an edge point with one ray is flagged', () => {
    const inp = base();
    inp.rays = inp.rays.filter((r) => r.pointId !== 'EDG05' || r.cameraId === 'POS2');
    expect(circleVerdict(inp).guidance.some((g) => g.startsWith('EDG05 is in only one photo'))).toBe(true);
  });

  it('a camera position whose 95% ellipse is outside its class blocks the pass', () => {
    const inp = base();
    inp.network!.cameras[2].semiMajor95M = 0.35;
    const v = circleVerdict(inp);
    expect(v.state).toBe('weak');
    expect(v.guidance).toContain('POS3 is only known to ± 350 mm (limit 200 mm). Tape it to BAS01 and BAS02, or take a photo from it that shows more edge canes spread wide.');
  });

  it('a rank-deficient network is not graded', () => {
    const inp = base();
    inp.network = { fullRank: false, rankNote: 'POS3 cannot be fixed from the measurements', cameras: [] };
    const v = circleVerdict(inp);
    expect(v.state).toBe('needs-data');
    expect(v.headline).toBe('The survey network does not solve on its own yet: POS3 cannot be fixed from the measurements.');
  });
});
