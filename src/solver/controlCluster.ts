/**
 * No-cane circle test (docs/garden-circle.md, field test rev 6): a general, growing network of
 * base points BAS01, BAS02, BAS03… (sleeves from the garden marker set), one 1× photo per edge
 * point. Spread several base points so each edge point sees 4+ of them at good angles.
 *
 * 1. Base-point network (`adjustGridNetwork`): every new point is tied to an existing point by a
 *    taped East offset and a taped North offset on the N/E grid, plus a taped diagonal as the
 *    check. Extra ties are allowed. The N/E grid IS the network frame (BAS01 at the origin);
 *    the grid-to-north rotation is display-only.
 * 2. Session adjustment (`adjustSession`): per photo x, y, yaw; one shared fx with the step-8
 *    prior; control coordinates as weighted priors. Observation: image x of each sleeve axis
 *    (tilt-corrected), u = fx · tan(bearing − yaw).
 *    Two-sleeve posts (rev 7): a base point may carry a top and a bottom sleeve a known vertical
 *    distance s apart. The levelled image separation Δy of the two sleeve centres is a range
 *    observation, Δy = fx · s / d (d the horizontal distance), with its own r, w and MDB.
 *    With only 2 base points in a photo, both on two-sleeve posts, the photo is a "2-point fix":
 *    2 ranges plus the subtended angle, side resolved by the left/right image order.
 * 3. Per-edge-point gates (`gateEdgePoints`), signed off by the Geometry & Maths Advisor:
 *    red |w| > 3.29; amber max|w| in (k, 3.29], k = z(1 − 0.025/n); reliability shift
 *    ∇x_i = (AᵀPA)⁻¹AᵀP e_i · MDB_i, MDB_i = 4.13 σ_i / √r_i: green ≤ 40 mm, amber ≤ 60 mm;
 *    grey when a sleeve is missing, a point-moving row has r < 0.01, or the photo is near a
 *    danger circle; σ_fx(step 8) > 0.5 % → "calibrate first", never green.
 * Everything runs on the phone; no server.
 */

import tolerances from '../../workflow/tolerances.json';
import { cholesky } from './linalg';
import { circleVerdict, type DiameterTapes } from './circleCheck';
import { levelledBearing, levelRay } from './bearing';

export interface Xy { x: number; y: number }

// ---------------------------------------------------------------------------------------------
// Constants (workflow/tolerances.json)
// ---------------------------------------------------------------------------------------------

export const CONTROL_SIGMA_M = tolerances.controlSleeveSigmaMm / 1000;
export const IMAGE_SIGMA_PX = tolerances.controlImageSigmaPx;
export const FX_PRIOR_REL = tolerances.controlFxPriorRel;
export const CALIBRATE_FIRST_FX_REL = tolerances.controlCalibrateFirstFxRel;
export const BLUNDER_W = tolerances.controlBlunderW;
export const FAMILY_ALPHA = tolerances.controlFamilyAlpha;
export const MDB_DELTA0 = tolerances.controlMdbNonCentrality;
export const SHIFT_GREEN_M = tolerances.controlShiftGreenMm / 1000;
export const SHIFT_AMBER_M = tolerances.controlShiftAmberMm / 1000;
export const UNCHECKED_R = tolerances.controlUncheckedR;
export const DANGER_COND_MAX = tolerances.controlDangerCondMax;
/** Fewest base points a photo must hold to be checked (4 = one spare over x, y, yaw). */
export const MIN_BASE_POINTS = tolerances.controlMinBasePoints;
/** Default vertical distance between the top and bottom sleeve of a two-sleeve post, m (Set-up). */
export const POST_SEPARATION_DEFAULT_M = tolerances.postSeparationDefaultM;
/** σ of the taped top-to-bottom sleeve distance on a post, m. */
export const POST_SEPARATION_SIGMA_M = tolerances.postSeparationSigmaMm / 1000;
/** Relative σ of Δy from the residual tilt correction (pitch/roll after levelling). */
export const RANGE_TILT_SIGMA_REL = tolerances.postRangeTiltSigmaRel;
/** Top and bottom sleeve must line up: |Δx| ≤ this fraction of Δy plus POST_ALIGN_PX. */
export const POST_ALIGN_FRACTION = 0.05;
export const POST_ALIGN_PX = 10;
/** Label for a photo fixed from 2 base points on two-sleeve posts (no redundancy). */
export const TWO_POINT_LABEL = '2-point fix (unchecked)';
/** χ²(2, 0.95), for the 95 % ellipse semi-major. */
const CHI2_2_95 = 5.991;

/** Sleeve width for the occlusion model, m (dowel + sleeve). */
export const SLEEVE_WIDTH_M = 0.08;
/** Usable half field of view at 1× landscape, rad (33° of the nominal 35°). */
export const HALF_FOV_RAD = (33 * Math.PI) / 180;

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

export function wrap(a: number): number {
  let r = (a + Math.PI) % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r - Math.PI;
}

/** Standard normal quantile (Acklam, |ε| < 1.2e-9 after one Halley step). */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error('p must be in (0, 1)');
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let x: number;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // Halley refinement with erfc.
  const e = 0.5 * erfc(-x / Math.SQRT2) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

function erfc(x: number): number {
  // Numerical Recipes erfcc, |ε| < 1.2e-7.
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** Green threshold for max|w| over n image rows: Bonferroni at a 5 % family rate. */
export function familyCriticalW(n: number, alpha = FAMILY_ALPHA): number {
  return normalQuantile(1 - alpha / (2 * Math.max(1, n)));
}

/** Inverse of an SPD matrix via Cholesky; null if not SPD. */
export function invSpd(a: number[][]): number[][] | null {
  const n = a.length;
  const L = cholesky(a);
  if (!L) return null;
  const inv = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const col = Array<number>(n);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      let s = i === k ? 1 : 0;
      for (let j = 0; j < i; j++) s -= L[i][j] * col[j];
      col[i] = s / L[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = col[i];
      for (let j = i + 1; j < n; j++) s -= L[j][i] * inv[j][k];
      inv[i][k] = s / L[i][i];
    }
  }
  return inv;
}

interface Lsq {
  /** Design rows, misclosure l = observed − computed, and the weight matrix as blocks. */
  A: number[][];
  l: number[];
  /** Diagonal sigmas for rows not in a block. */
  sigma: number[];
  /** Full-covariance blocks: rows [start, start+size) have covariance cov (replaces sigma). */
  blocks: { start: number; cov: number[][]; weight: number[][] }[];
}

function weightTimes(lsq: Lsq, v: number[]): number[] {
  const out = v.map((x, i) => x / (lsq.sigma[i] * lsq.sigma[i]));
  for (const b of lsq.blocks) {
    const n = b.cov.length;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += b.weight[i][j] * v[b.start + j];
      out[b.start + i] = s;
    }
  }
  return out;
}

function normals(lsq: Lsq, m: number): { N: number[][]; PA: number[][] } {
  // PA (rows × m) = P A
  const rows = lsq.A.length;
  const PA: number[][] = Array.from({ length: rows }, () => Array<number>(m).fill(0));
  for (let c = 0; c < m; c++) {
    const pc = weightTimes(lsq, lsq.A.map((r) => r[c]));
    for (let i = 0; i < rows; i++) PA[i][c] = pc[i];
  }
  const N = Array.from({ length: m }, () => Array<number>(m).fill(0));
  for (let i = 0; i < rows; i++) {
    const a = lsq.A[i];
    const pa = PA[i];
    for (let p = 0; p < m; p++) {
      if (a[p] === 0) continue;
      for (let q = 0; q < m; q++) N[p][q] += a[p] * pa[q];
    }
  }
  return { N, PA };
}

function rowCov(lsq: Lsq, i: number): number {
  for (const b of lsq.blocks) if (i >= b.start && i < b.start + b.cov.length) return b.cov[i - b.start][i - b.start];
  return lsq.sigma[i] * lsq.sigma[i];
}

function quad(a: number[], Q: number[][], b: number[]): number {
  let s = 0;
  for (let p = 0; p < a.length; p++) {
    if (a[p] === 0) continue;
    let t = 0;
    for (let q = 0; q < b.length; q++) t += Q[p][q] * b[q];
    s += a[p] * t;
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// 1. Control network on the N/E grid
// ---------------------------------------------------------------------------------------------

/**
 * One tie from an existing point to another point. Any of the three readings may be missing
 * (extra ties); a new point's first tie should carry all three.
 */
export interface GridTie {
  from: string;
  to: string;
  /** Taped East offset to − from, m (signed). */
  eastM?: number;
  /** Taped North offset to − from, m (signed). */
  northM?: number;
  /** Taped diagonal from → to, m: the check. */
  diagonalM?: number;
}

export interface GridNetworkOptions {
  /** Tape σ per reading, m (default 4 mm, the 3–5 mm range). */
  tapeSigmaM?: number;
  /** Squareness / alignment σ of the N and E directions set by eye or compass, rad (default 1°). */
  alignSigmaRad?: number;
  /** Grid-to-north rotation and its σ, rad. Display only. */
  gridToNorthRad?: number;
  gridToNorthSigmaRad?: number;
}

export interface GridObservationResult {
  tie: number;
  kind: 'east' | 'north' | 'diagonal';
  from: string;
  to: string;
  observedM: number;
  residualM: number;
  sigmaM: number;
  r: number;
  w: number;
  /** red |w| > 3.29, amber |w| > 1.96, grey r < 0.01 (unchecked), else green. */
  flag: 'green' | 'amber' | 'red' | 'grey';
}

export interface GridNetworkResult {
  /** Grid coordinates, m: x = East, y = North. The origin point is (0, 0). */
  points: Record<string, Xy>;
  /** Point order of `covariance` (2 rows each: E, N). */
  order: string[];
  covariance: number[][];
  observations: GridObservationResult[];
  /** Diagonal checks only, for the form. */
  diagonals: GridObservationResult[];
  sigma0: number;
  gridToNorthRad: number;
  gridToNorthSigmaRad: number;
  /** Failed diagonal checks, as warnings (never blocks). */
  warnings: GridDiagonalWarning[];
  /** Covariance before the diagonal-warning scaling (to tell whether the scaling alone made something red). */
  covarianceUnscaled: number[][];
}

export interface GridDiagonalWarning {
  /** Base point the failing tie places. */
  point: string;
  tie: number;
  /** Taped diagonal minus the one from the N and E tapes, mm. */
  offMm: number;
  /** 1.96 × σ of that misclosure, mm. */
  expectedMm: number;
  w: number;
  /** Factor on the point's σ (covariance ×factor²). 1 when it was Huber down-weighted instead. */
  factor: number;
  downWeighted: boolean;
  /** "Diagonal off by X mm (expected ±Y mm); base point uncertainty ×Z" */
  text: string;
}

/**
 * Adjust the N/E tie network. `origin` is held at (0, 0); the grid axes are the frame.
 * The N and E offsets are distance observations along the grid axes; their σ adds the
 * alignment error times the perpendicular offset (setting the axis by eye rotates it).
 */
export function adjustGridNetwork(origin: string, ties: GridTie[], opts: GridNetworkOptions = {}): GridNetworkResult {
  const st = opts.tapeSigmaM ?? 0.004;
  const sa = opts.alignSigmaRad ?? Math.PI / 180;
  // Approximate coordinates by walking the ties from the origin.
  const approx = new Map<string, Xy>([[origin, { x: 0, y: 0 }]]);
  for (let pass = 0; pass < ties.length + 1; pass++) {
    let grew = false;
    for (const t of ties) {
      if (t.eastM == null || t.northM == null) continue;
      if (approx.has(t.from) && !approx.has(t.to)) {
        const f = approx.get(t.from)!;
        approx.set(t.to, { x: f.x + t.eastM, y: f.y + t.northM });
        grew = true;
      } else if (approx.has(t.to) && !approx.has(t.from)) {
        const f = approx.get(t.to)!;
        approx.set(t.from, { x: f.x - t.eastM, y: f.y - t.northM });
        grew = true;
      }
    }
    if (!grew) break;
  }
  const unknown = [...new Set(ties.flatMap((t) => [t.from, t.to]))].filter((p) => p !== origin);
  const missing = unknown.filter((p) => !approx.has(p));
  if (missing.length) throw new Error(`${missing.join(', ')} needs an East and a North offset from a point already placed.`);
  const order = unknown;
  const col = new Map(order.map((p, i) => [p, 2 * i]));
  const m = 2 * order.length;
  const par = order.flatMap((p) => [approx.get(p)!.x, approx.get(p)!.y]);
  const get = (p: string): Xy => (p === origin ? { x: 0, y: 0 } : { x: par[col.get(p)!], y: par[col.get(p)! + 1] });

  type Row = { tie: number; kind: GridObservationResult['kind']; obs: number; sigma: number };
  const rows: Row[] = [];
  const blocks: Lsq['blocks'] = [];
  ties.forEach((t, i) => {
    if (t.eastM != null) rows.push({ tie: i, kind: 'east', obs: t.eastM, sigma: Math.hypot(st, (t.northM ?? 0) * sa) });
    if (t.northM != null) rows.push({ tie: i, kind: 'north', obs: t.northM, sigma: Math.hypot(st, (t.eastM ?? 0) * sa) });
    if (t.eastM != null && t.northM != null) {
      // One misaligned pair of axes rotates the offset vector by δ: E += N·δ, N −= E·δ.
      // The pair is correlated, and the diagonal (a length) is blind to δ, so it checks the tapes.
      const g = [t.northM * sa, -t.eastM * sa];
      const cov = [
        [st * st + g[0] * g[0], g[0] * g[1]],
        [g[0] * g[1], st * st + g[1] * g[1]],
      ];
      blocks.push({ start: rows.length - 2, cov, weight: invSpd(cov)! });
    }
    if (t.diagonalM != null) rows.push({ tie: i, kind: 'diagonal', obs: t.diagonalM, sigma: st });
  });
  if (rows.length < m) throw new Error('Not enough tape readings to place every point.');

  const build = (): Lsq => {
    const A: number[][] = [];
    const l: number[] = [];
    for (const r of rows) {
      const t = ties[r.tie];
      const a = get(t.from);
      const b = get(t.to);
      const row = Array<number>(m).fill(0);
      const put = (p: string, dx: number, dy: number) => {
        if (p === origin) return;
        row[col.get(p)!] += dx;
        row[col.get(p)! + 1] += dy;
      };
      let calc: number;
      if (r.kind === 'east') {
        calc = b.x - a.x;
        put(t.to, 1, 0);
        put(t.from, -1, 0);
      } else if (r.kind === 'north') {
        calc = b.y - a.y;
        put(t.to, 0, 1);
        put(t.from, 0, -1);
      } else {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        calc = Math.hypot(dx, dy);
        put(t.to, dx / calc, dy / calc);
        put(t.from, -dx / calc, -dy / calc);
      }
      A.push(row);
      l.push(r.obs - calc);
    }
    return { A, l, sigma: rows.map((r) => r.sigma), blocks };
  };

  const solve = () => {
    let lsq = build();
    let Ni: number[][] | null = null;
    for (let it = 0; it < 10; it++) {
      const { N, PA } = normals(lsq, m);
      Ni = invSpd(N);
      if (!Ni) throw new Error('The ties do not fix every point (add a tie).');
      const rhs = Array<number>(m).fill(0);
      lsq.A.forEach((_, i) => { for (let p = 0; p < m; p++) rhs[p] += PA[i][p] * lsq.l[i]; });
      const dx = Ni.map((r) => r.reduce((s, v, q) => s + v * rhs[q], 0));
      dx.forEach((d, i) => { par[i] += d; });
      lsq = build();
      if (Math.max(...dx.map(Math.abs)) < 1e-9) break;
    }
    const { N } = normals(lsq, m);
    Ni = invSpd(N)!;
    let vpv = 0;
    const Pv = weightTimes(lsq, lsq.l.map((x) => -x));
    const qvvs: number[] = [];
    const observations: GridObservationResult[] = rows.map((r, i) => {
      const v = -lsq.l[i];
      const s2 = rowCov(lsq, i);
      vpv += v * Pv[i];
      const qvv = Math.max(s2 - quad(lsq.A[i], Ni!, lsq.A[i]), 0);
      qvvs.push(qvv);
      const rr = qvv / s2;
      const w = qvv > 1e-16 ? v / Math.sqrt(qvv) : 0;
      const flag: GridObservationResult['flag'] = rr < UNCHECKED_R ? 'grey' : Math.abs(w) > BLUNDER_W ? 'red' : Math.abs(w) > 1.96 ? 'amber' : 'green';
      const t = ties[r.tie];
      return { tie: r.tie, kind: r.kind, from: t.from, to: t.to, observedM: r.obs, residualM: v, sigmaM: Math.sqrt(s2), r: rr, w, flag };
    });
    return { Ni, vpv, observations, qvvs };
  };

  let sol = solve();
  // Diagonal check as a warning, never a block (Paul, 22 Oct 2026; Geometry & Maths Advisor rule):
  //  - |w| <= k (3.29): no change.
  //  - |w| > k on a base point with local redundancy >= 2: Huber down-weight the reading with the
  //    largest |w| at that point (weight p = k/|w|, i.e. sigma × |w|/k) and re-solve once.
  //  - local redundancy 1 (the usual N + E + diagonal tie): keep the weights (no down-weighting),
  //    keep the coordinates, and scale that point's covariance rows/columns so its 2×2 block grows
  //    by sigma0² = v'Pv/dof = w². Downstream points pick this up through the normal covariance.
  const k = BLUNDER_W;
  const pointOf = (o: GridObservationResult) => (o.to === origin ? o.from : o.to);
  const touches = (p: string) => rows.map((_, i) => i).filter((i) => ties[rows[i].tie].from === p || ties[rows[i].tie].to === p);
  const localDof = (p: string) => touches(p).length - 2;
  const redDiag = () => sol.observations.filter((o) => o.kind === 'diagonal' && Math.abs(o.w) > k);
  const huberPts = [...new Set(redDiag().map(pointOf))].filter((p) => localDof(p) >= 2);
  if (huberPts.length) {
    for (const p of huberPts) {
      const idx = touches(p).reduce((best, i) => (Math.abs(sol.observations[i].w) > Math.abs(sol.observations[best].w) ? i : best), touches(p)[0]);
      const w = Math.abs(sol.observations[idx].w);
      if (w > k) rows[idx].sigma *= w / k;
    }
    sol = solve();
  }
  const cov = sol.Ni.map((r) => [...r]);
  const warnings: GridDiagonalWarning[] = [];
  for (const o of redDiag()) {
    const p = pointOf(o);
    const t = ties[o.tie];
    const scale = Math.abs(o.w);
    const factor = localDof(p) >= 2 ? 1 : scale;
    if (factor > 1) {
      // C' = D·C·D with D = factor on this point's E, N rows: its block ×factor² (= sigma0²),
      // its cross terms ×factor, so the extra uncertainty flows to points tied through it.
      const c = col.get(p)!;
      for (let i = 0; i < m; i++) for (const j of [c, c + 1]) { cov[i][j] *= factor; cov[j][i] = cov[i][j]; }
      for (const i of [c, c + 1]) for (const j of [c, c + 1]) cov[i][j] = sol.Ni[i][j] * factor * factor;
    }
    const expected = t.eastM != null && t.northM != null ? Math.hypot(t.eastM, t.northM) : o.observedM - o.residualM;
    const offMm = Math.round((o.observedM - expected) * 1000);
    const idx = sol.observations.indexOf(o);
    const plusMm = Math.round(1.96 * Math.sqrt(sol.qvvs[idx]) * 1000);
    warnings.push({
      point: p,
      tie: o.tie,
      offMm,
      expectedMm: plusMm,
      w: o.w,
      factor,
      downWeighted: factor === 1,
      text: `Diagonal off by ${Math.abs(offMm)} mm (expected ±${plusMm} mm); base point uncertainty ×${factor.toFixed(1)}`,
    });
  }
  const dof = rows.length - m;
  const points: Record<string, Xy> = { [origin]: { x: 0, y: 0 } };
  for (const p of order) points[p] = get(p);
  return {
    points,
    order,
    covariance: cov,
    covarianceUnscaled: sol.Ni,
    observations: sol.observations,
    diagonals: sol.observations.filter((o) => o.kind === 'diagonal'),
    sigma0: dof > 0 ? Math.sqrt(sol.vpv / dof) : NaN,
    gridToNorthRad: opts.gridToNorthRad ?? 0,
    gridToNorthSigmaRad: opts.gridToNorthSigmaRad ?? (4 * Math.PI) / 180,
    warnings,
  };
}

/** Covariance of a subset of the network's points, in the given order (2×2 blocks E, N). */
export function subCovariance(net: GridNetworkResult, ids: string[]): number[][] {
  const idx = ids.flatMap((id) => {
    const k = net.order.indexOf(id);
    if (k < 0) throw new Error(`${id} is not in the control network`);
    return [2 * k, 2 * k + 1];
  });
  return idx.map((i) => idx.map((j) => net.covariance[i][j]));
}

// ---------------------------------------------------------------------------------------------
// 2. Session adjustment
// ---------------------------------------------------------------------------------------------

export interface SleeveSighting {
  /** Base point id (BAS01…). */
  id: string;
  /** Image x of the sleeve axis, px from the principal point, after tilt correction. */
  u: number;
  /**
   * Two-sleeve post only: levelled vertical image separation, top sleeve centre to bottom sleeve
   * centre, px (fx·(tan e_top − tan e_bottom)). Positive. Needs `postSeparationM` on the control point.
   */
  dyPx?: number;
}

export interface EdgePhoto {
  /** Edge point this photo stands on (EDG01…). */
  pointId: string;
  sightings: SleeveSighting[];
  /** Optional seed; otherwise found by a grid search. */
  seed?: { x: number; y: number; yaw: number };
}

export interface ControlPoint {
  id: string;
  x: number;
  y: number;
  /** Two-sleeve post: vertical distance between the top and bottom sleeve centres, m. */
  postSeparationM?: number;
}

export interface SessionInput {
  control: ControlPoint[];
  /** Covariance of the control coordinates (2 rows per sleeve, `control` order), m². */
  controlCovariance: number[][];
  photos: EdgePhoto[];
  /** Step-8 focal length, px, and its relative σ (prior). */
  fx0: number;
  fxPriorRel?: number;
  /** Step-8 calibration σ_fx/fx actually achieved (for the "calibrate first" gate). */
  calibrationSigmaRel?: number;
  sigmaPx?: number;
  /** Seed search: centre and radius of the area where the edge points are, m. */
  searchCentre?: Xy;
  searchRadiusM?: number;
}

export type ImageRowKind = 'bearing' | 'range';

export interface ImageRow {
  photo: number;
  sleeve: string;
  /** 'bearing': image x of the sleeve axis (u). 'range': two-sleeve post Δy (u holds Δy, px). */
  kind: ImageRowKind;
  u: number;
  residualPx: number;
  r: number;
  w: number;
  /** Minimal detectable bias, px. */
  mdbPx: number;
  /** Shift of this photo's camera position an undetected MDB would cause, m (xy norm). */
  shiftM: number;
}

export interface SessionResult {
  photos: { pointId: string; x: number; y: number; yaw: number; cov: number[][] }[];
  control: { id: string; x: number; y: number; w: [number, number] }[];
  fx: number;
  sigmaFxRel: number;
  rows: ImageRow[];
  /** Joint covariance of the edge points (x0, y0, x1, y1 …), photo order, m². */
  pointCovariance: number[][];
  sigma0: number;
  /** Observation with the largest |w| over image rows and control priors (session blunder test). */
  suspect?: { sleeve: string; w: number; kind: 'image' | 'control' };
  /** Normalised condition number of each photo's x, y, yaw block (danger-circle check). */
  photoCond: number[];
}

function bearingModel(cam: { x: number; y: number; yaw: number }, s: Xy, fx: number) {
  const dx = s.x - cam.x;
  const dy = s.y - cam.y;
  const d2 = dx * dx + dy * dy;
  const t = wrap(Math.atan2(dy, dx) - cam.yaw);
  const sec2 = 1 / Math.cos(t) ** 2;
  const k = fx * sec2;
  // Image x grows to the right: bearing to the right is a smaller angle (counter-clockwise frame),
  // so u = −fx·tan(t). Derivatives below follow that sign.
  return {
    u: -fx * Math.tan(t),
    dx: (-k * dy) / d2,
    dy: (k * dx) / d2,
    dyaw: k,
    dfx: -Math.tan(t),
    dsx: (k * dy) / d2,
    dsy: (-k * dx) / d2,
    t,
  };
}

/** Image x of a sleeve seen from a camera pose (for simulation and seeding). */
export function projectU(cam: { x: number; y: number; yaw: number }, s: Xy, fx: number): number {
  return bearingModel(cam, s, fx).u;
}

/** Two-sleeve post range model: Δy = fx · s / d, d the horizontal distance camera → post. */
function rangeModel(cam: Xy, s: Xy, fx: number, sep: number) {
  const dx = s.x - cam.x;
  const dy = s.y - cam.y;
  const d = Math.hypot(dx, dy);
  const k = (fx * sep) / (d * d * d);
  return {
    v: (fx * sep) / d,
    // ∂Δy/∂cam = fx·s·(s − cam)/d³; ∂Δy/∂sleeve is its negative.
    dx: k * dx,
    dy: k * dy,
    dfx: sep / d,
    dsx: -k * dx,
    dsy: -k * dy,
  };
}

/** Δy of a two-sleeve post seen from a camera (for simulation). */
export function projectDy(cam: Xy, s: Xy, fx: number, sepM: number): number {
  return rangeModel(cam, s, fx, sepM).v;
}

/** Range from a post's Δy: r = fx · s / Δy. */
export function rangeFromDy(dyPx: number, fx: number, sepM: number): number {
  return (fx * sepM) / dyPx;
}

/** σ of a Δy row, px: 1 px per sleeve centre, the taped separation, and the tilt correction. fx σ enters through the shared fx unknown. */
export function dySigmaPx(dyPx: number, sepM: number, sigmaPx = IMAGE_SIGMA_PX): number {
  return Math.hypot(Math.SQRT2 * sigmaPx, (dyPx * POST_SEPARATION_SIGMA_M) / sepM, dyPx * RANGE_TILT_SIGMA_REL);
}

export interface TwoPointFix {
  x: number;
  y: number;
  yaw: number;
  /** The other circle intersection (same two ranges), rejected by the image order. */
  mirror: Xy;
  /** True when the left/right image order picked one side (false only when the two coincide). */
  sideResolved: boolean;
  /** The two ranges did not meet; the closest point on the line between the posts was used. */
  rangesDisagree: boolean;
}

/**
 * Position from 2 base points with ranges (two-sleeve posts) and their image x. The two range
 * circles meet in two points, mirror images across the line between the posts; the one whose
 * predicted left/right order of the two sleeves matches the photo is kept.
 */
export function twoPointFix(a: Xy, b: Xy, ra: number, rb: number, ua: number, ub: number, fx: number): TwoPointFix {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const d = Math.hypot(ex, ey);
  const along = (ra * ra - rb * rb + d * d) / (2 * d);
  const h2 = ra * ra - along * along;
  const rangesDisagree = !(h2 > 0);
  const h = rangesDisagree ? 0 : Math.sqrt(h2);
  const mx = a.x + (along * ex) / d;
  const my = a.y + (along * ey) / d;
  const c1 = { x: mx - (h * ey) / d, y: my + (h * ex) / d };
  const c2 = { x: mx + (h * ey) / d, y: my - (h * ex) / d };
  // u grows to the right; a point further counter-clockwise is further left (smaller u).
  const order = (c: Xy) => Math.sign(wrap(Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x)));
  const want = Math.sign(ub - ua);
  const pick = order(c1) === want ? c1 : c2;
  const other = pick === c1 ? c2 : c1;
  const sideResolved = !rangesDisagree && order(c1) !== order(c2) && (order(c1) === want || order(c2) === want);
  const yawFrom = (c: Xy) => {
    let cs = 0;
    let sn = 0;
    for (const [p, u] of [[a, ua], [b, ub]] as const) {
      const t = Math.atan2(p.y - c.y, p.x - c.x) + Math.atan(u / fx);
      cs += Math.cos(t);
      sn += Math.sin(t);
    }
    return Math.atan2(sn, cs);
  };
  return { x: pick.x, y: pick.y, yaw: yawFrom(pick), mirror: other, sideResolved, rangesDisagree };
}

/** Sightings that make a 2-point fix: exactly 2 tied base points, both with a post range. */
export function twoPointSightings(photo: EdgePhoto, ctl: Map<string, ControlPoint>): SleeveSighting[] | null {
  const known = photo.sightings.filter((s) => ctl.has(s.id));
  if (known.length !== 2) return null;
  if (!known.every((s) => s.dyPx != null && s.dyPx > 0 && (ctl.get(s.id)!.postSeparationM ?? 0) > 0)) return null;
  return known;
}

function seedPhoto(photo: EdgePhoto, ctl: Map<string, ControlPoint>, fx: number, centre: Xy, radius: number) {
  if (photo.seed) return photo.seed;
  const two = twoPointSightings(photo, ctl);
  if (two) {
    const [sa, sb] = two;
    const pa = ctl.get(sa.id)!;
    const pb = ctl.get(sb.id)!;
    const f = twoPointFix(pa, pb, rangeFromDy(sa.dyPx!, fx, pa.postSeparationM!), rangeFromDy(sb.dyPx!, fx, pb.postSeparationM!), sa.u, sb.u, fx);
    return { x: f.x, y: f.y, yaw: f.yaw };
  }
  const sights = photo.sightings.filter((s) => ctl.has(s.id));
  let best = { x: centre.x, y: centre.y, yaw: 0, cost: Infinity };
  const step = 0.5;
  for (let gx = -radius; gx <= radius; gx += step) {
    for (let gy = -radius; gy <= radius; gy += step) {
      const x = centre.x + gx;
      const y = centre.y + gy;
      // Yaw from the circular mean of (bearing + atan(u/fx)).
      let cs = 0;
      let sn = 0;
      for (const s of sights) {
        const p = ctl.get(s.id)!;
        const a = Math.atan2(p.y - y, p.x - x) + Math.atan(s.u / fx);
        cs += Math.cos(a);
        sn += Math.sin(a);
      }
      const yaw = Math.atan2(sn, cs);
      let cost = 0;
      for (const s of sights) {
        const p = ctl.get(s.id)!;
        const t = wrap(Math.atan2(p.y - y, p.x - x) - yaw);
        if (Math.abs(t) > Math.PI / 2 - 0.05) { cost = Infinity; break; }
        cost += (-fx * Math.tan(t) - s.u) ** 2;
      }
      if (cost < best.cost) best = { x, y, yaw, cost };
    }
  }
  return { x: best.x, y: best.y, yaw: best.yaw };
}

export function adjustSession(input: SessionInput): SessionResult {
  const sp = input.sigmaPx ?? IMAGE_SIGMA_PX;
  const fxRel = input.fxPriorRel ?? FX_PRIOR_REL;
  const nS = input.control.length;
  const sIdx = new Map(input.control.map((c, i) => [c.id, i]));
  const ctl = new Map(input.control.map((c) => [c.id, c]));
  const P = input.photos.length;
  const obs: { photo: number; sleeve: number; u: number; kind: ImageRowKind; sigma: number }[] = [];
  input.photos.forEach((ph, p) => ph.sightings.forEach((s) => {
    const j = sIdx.get(s.id);
    if (j != null) obs.push({ photo: p, sleeve: j, u: s.u, kind: 'bearing', sigma: sp });
  }));
  // Range rows (two-sleeve posts) after all bearing rows, so bearing row order is unchanged.
  input.photos.forEach((ph, p) => ph.sightings.forEach((s) => {
    const j = sIdx.get(s.id);
    const sep = j != null ? input.control[j].postSeparationM : undefined;
    if (j != null && sep != null && sep > 0 && s.dyPx != null && s.dyPx > 0) obs.push({ photo: p, sleeve: j, u: s.dyPx, kind: 'range', sigma: dySigmaPx(s.dyPx, sep, sp) });
  }));
  const fxCol = 3 * P;
  const sCol = fxCol + 1;
  const m = sCol + 2 * nS;
  const centre = input.searchCentre ?? {
    x: input.control.reduce((s, c) => s + c.x, 0) / Math.max(1, nS),
    y: input.control.reduce((s, c) => s + c.y, 0) / Math.max(1, nS),
  };
  const radius = input.searchRadiusM ?? 12;
  const par = Array<number>(m).fill(0);
  input.photos.forEach((ph, p) => {
    const s = seedPhoto(ph, ctl, input.fx0, centre, radius);
    par[3 * p] = s.x;
    par[3 * p + 1] = s.y;
    par[3 * p + 2] = s.yaw;
  });
  par[fxCol] = input.fx0;
  input.control.forEach((c, j) => { par[sCol + 2 * j] = c.x; par[sCol + 2 * j + 1] = c.y; });
  const priorCov = input.controlCovariance;
  const priorW = invSpd(priorCov);
  if (!priorW) throw new Error('Control covariance is not positive definite.');
  const nImg = obs.length;
  const priorStart = nImg;
  const sigFx = input.fx0 * fxRel;

  const build = (): Lsq => {
    const A: number[][] = [];
    const l: number[] = [];
    const sigma: number[] = [];
    for (const o of obs) {
      const cam = { x: par[3 * o.photo], y: par[3 * o.photo + 1], yaw: par[3 * o.photo + 2] };
      const s = { x: par[sCol + 2 * o.sleeve], y: par[sCol + 2 * o.sleeve + 1] };
      const row = Array<number>(m).fill(0);
      if (o.kind === 'range') {
        const g = rangeModel(cam, s, par[fxCol], input.control[o.sleeve].postSeparationM!);
        row[3 * o.photo] = g.dx;
        row[3 * o.photo + 1] = g.dy;
        row[fxCol] = g.dfx;
        row[sCol + 2 * o.sleeve] = g.dsx;
        row[sCol + 2 * o.sleeve + 1] = g.dsy;
        A.push(row);
        l.push(o.u - g.v);
        sigma.push(o.sigma);
        continue;
      }
      const b = bearingModel(cam, s, par[fxCol]);
      row[3 * o.photo] = b.dx;
      row[3 * o.photo + 1] = b.dy;
      row[3 * o.photo + 2] = b.dyaw;
      row[fxCol] = b.dfx;
      row[sCol + 2 * o.sleeve] = b.dsx;
      row[sCol + 2 * o.sleeve + 1] = b.dsy;
      A.push(row);
      l.push(o.u - b.u);
      sigma.push(o.sigma);
    }
    input.control.forEach((c, j) => {
      for (const k of [0, 1]) {
        const row = Array<number>(m).fill(0);
        row[sCol + 2 * j + k] = 1;
        A.push(row);
        l.push((k === 0 ? c.x : c.y) - par[sCol + 2 * j + k]);
        sigma.push(1);
      }
    });
    const rowF = Array<number>(m).fill(0);
    rowF[fxCol] = 1;
    A.push(rowF);
    l.push(input.fx0 - par[fxCol]);
    sigma.push(sigFx);
    return { A, l, sigma, blocks: [{ start: priorStart, cov: priorCov, weight: priorW }] };
  };

  let lsq = build();
  let Ni: number[][] | null = null;
  let PA: number[][] = [];
  for (let it = 0; it < 15; it++) {
    const ne = normals(lsq, m);
    PA = ne.PA;
    Ni = invSpd(ne.N);
    if (!Ni) throw new Error('The session does not solve: some photo sees too few sleeves.');
    const rhs = Array<number>(m).fill(0);
    for (let i = 0; i < lsq.A.length; i++) for (let p = 0; p < m; p++) rhs[p] += PA[i][p] * lsq.l[i];
    const dx = Ni.map((r) => r.reduce((s, v, q) => s + v * rhs[q], 0));
    dx.forEach((d, i) => { par[i] += d; });
    for (let p = 0; p < P; p++) par[3 * p + 2] = wrap(par[3 * p + 2]);
    lsq = build();
    if (Math.max(...dx.map(Math.abs)) < 1e-9) break;
  }
  const ne = normals(lsq, m);
  PA = ne.PA;
  Ni = invSpd(ne.N);
  if (!Ni) throw new Error('The session does not solve.');
  const v = lsq.l.map((x) => -x);
  const Pv = weightTimes(lsq, v);
  const vpv = v.reduce((s, x, i) => s + x * Pv[i], 0);
  const dof = lsq.A.length - m;

  // Image rows: r, w, MDB, reliability shift.
  const rows: ImageRow[] = obs.map((o, i) => {
    const a = lsq.A[i];
    const s2 = rowCov(lsq, i);
    const qvv = Math.max(s2 - quad(a, Ni!, a), 0);
    const r = qvv / s2;
    const w = qvv > 1e-18 ? v[i] / Math.sqrt(qvv) : 0;
    const mdb = r > 1e-12 ? (MDB_DELTA0 * Math.sqrt(s2)) / Math.sqrt(r) : Infinity;
    // ∇x = Ni Aᵀ P e_i · MDB; for a diagonal-weight row, Aᵀ P e_i = a_i / σ_i².
    const cx = Ni![3 * o.photo].reduce((s, q, k) => s + q * a[k], 0) / s2;
    const cy = Ni![3 * o.photo + 1].reduce((s, q, k) => s + q * a[k], 0) / s2;
    const shift = Number.isFinite(mdb) ? Math.hypot(cx, cy) * mdb : (Math.hypot(cx, cy) > 0 ? Infinity : 0);
    return { photo: o.photo, sleeve: input.control[o.sleeve].id, kind: o.kind, u: o.u, residualPx: v[i], r, w, mdbPx: mdb, shiftM: shift };
  });

  // Control prior w (diagonal of the block's Qvv, a session-level blunder test).
  const control = input.control.map((c, j) => {
    const ws = [0, 1].map((k) => {
      const i = priorStart + 2 * j + k;
      const qvv = Math.max(priorCov[2 * j + k][2 * j + k] - quad(lsq.A[i], Ni!, lsq.A[i]), 0);
      return qvv > 1e-18 ? v[i] / Math.sqrt(qvv) : 0;
    }) as [number, number];
    return { id: c.id, x: par[sCol + 2 * j], y: par[sCol + 2 * j + 1], w: ws };
  });

  let suspect: SessionResult['suspect'];
  for (const r of rows) if (!suspect || Math.abs(r.w) > Math.abs(suspect.w)) suspect = { sleeve: r.sleeve, w: r.w, kind: 'image' };
  for (const c of control) for (const w of c.w) if (!suspect || Math.abs(w) > Math.abs(suspect.w)) suspect = { sleeve: c.id, w, kind: 'control' };

  const photoCond = input.photos.map((_, p) => {
    // Bearing and range rows together: a 2-point fix is only well conditioned with its ranges.
    const ii = rows.map((r, i) => (r.photo === p ? i : -1)).filter((i) => i >= 0);
    return normalisedCond(ii.map((i) => [lsq.A[i][3 * p], lsq.A[i][3 * p + 1], lsq.A[i][3 * p + 2]]));
  });

  const pc = input.photos.flatMap((_, p) => [3 * p, 3 * p + 1]);
  return {
    photos: input.photos.map((ph, p) => ({
      pointId: ph.pointId,
      x: par[3 * p],
      y: par[3 * p + 1],
      yaw: par[3 * p + 2],
      cov: [3 * p, 3 * p + 1, 3 * p + 2].map((i) => [3 * p, 3 * p + 1, 3 * p + 2].map((j) => Ni![i][j])),
    })),
    control,
    fx: par[fxCol],
    sigmaFxRel: Math.sqrt(Ni[fxCol][fxCol]) / par[fxCol],
    rows,
    pointCovariance: pc.map((i) => pc.map((j) => Ni![i][j])),
    sigma0: dof > 0 ? Math.sqrt(vpv / dof) : NaN,
    suspect,
    photoCond,
  };
}

/** Condition number of B with unit-norm columns (sim8 danger-circle measure); ∞ if < 3 rows. */
export function normalisedCond(B: number[][]): number {
  if (B.length < 3) return Infinity;
  const norms = [0, 1, 2].map((c) => Math.hypot(...B.map((r) => r[c])) || 1);
  const BtB = [0, 1, 2].map((p) => [0, 1, 2].map((q) => B.reduce((s, r) => s + (r[p] / norms[p]) * (r[q] / norms[q]), 0)));
  const ev = sym3Eigen(BtB);
  const lo = Math.min(...ev);
  const hi = Math.max(...ev);
  return lo > 0 ? Math.sqrt(hi / lo) : Infinity;
}

function sym3Eigen(a: number[][]): number[] {
  // Jacobi on 3×3.
  const m = a.map((r) => r.slice());
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += m[p][q] ** 2;
    if (off < 1e-24) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(m[p][q]) < 1e-30) continue;
        const th = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const mkp = m[k][p];
          const mkq = m[k][q];
          m[k][p] = c * mkp - s * mkq;
          m[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < 3; k++) {
          const mpk = m[p][k];
          const mqk = m[q][k];
          m[p][k] = c * mpk - s * mqk;
          m[q][k] = s * mpk + c * mqk;
        }
      }
    }
  }
  return [m[0][0], m[1][1], m[2][2]];
}

// ---------------------------------------------------------------------------------------------
// 3. Gates per edge point
// ---------------------------------------------------------------------------------------------

export type EdgeClass = 'green' | 'amber' | 'red' | 'grey';

export interface EdgeGate {
  pointId: string;
  cls: EdgeClass;
  /** Plain-words reason, first the one that set the colour. */
  reasons: string[];
  rowCount: number;
  k: number;
  maxAbsW: number;
  /** max ∇x over rows, m (reliability-shift). */
  reliabilityShiftM: number;
  minR: number;
  /** Rows for the measurement-strength display. */
  rows: { sleeve: string; kind: ImageRowKind; r: number; mdbPx: number; w: number; shiftMm: number }[];
  /** Base points (bearing rows) and two-sleeve post ranges in this photo. */
  basePointCount: number;
  rangeCount: number;
  /** Photo fixed from 2 base points on two-sleeve posts: amber at best, never green. */
  twoPointFix: boolean;
  /** 95 % error ellipse semi-major of the edge point, m. */
  ellipse95M: number;
  calibrateFirst: boolean;
  /** Non-empty when the photo holds fewer than MIN_BASE_POINTS base points. */
  missing: string[];
  cond: number;
}

export function gateEdgePoints(input: SessionInput, res: SessionResult): EdgeGate[] {
  const calibrateFirst = (input.calibrationSigmaRel ?? 0) > CALIBRATE_FIRST_FX_REL;
  return input.photos.map((ph, p) => {
    const rows = res.rows.filter((r) => r.photo === p);
    const known = new Set(input.control.map((c) => c.id));
    const ctl = new Map(input.control.map((c) => [c.id, c]));
    const untied = ph.sightings.map((x) => x.id).filter((id) => !known.has(id));
    const nBase = rows.filter((r) => r.kind === 'bearing').length;
    const nRange = rows.length - nBase;
    const two = nBase === 2 && twoPointSightings(ph, ctl) != null;
    // Checked needs one spare reading over x, y, yaw: 4 base points, or 3 plus a post range.
    // Fewer than 3 base points is never checked (2 on two-sleeve posts is the unchecked 2-point fix).
    const short = !two && (nBase < 3 || rows.length < MIN_BASE_POINTS);
    const missing = short ? [`${Math.max(MIN_BASE_POINTS - rows.length, 3 - nBase, 1)} more`] : [];
    const n = rows.length;
    const c = res.photos[p].cov;
    const tr = c[0][0] + c[1][1];
    const det = c[0][0] * c[1][1] - c[0][1] * c[1][0];
    const ellipse95M = Math.sqrt(CHI2_2_95 * Math.max(tr / 2 + Math.sqrt(Math.max((tr * tr) / 4 - det, 0)), 0));
    const k = familyCriticalW(n);
    const maxAbsW = rows.reduce((s, r) => Math.max(s, Math.abs(r.w)), 0);
    // A row "moves the point" if its influence on x, y is not negligible.
    const moving = rows.filter((r) => r.shiftM > 1e-6 || !Number.isFinite(r.shiftM));
    const minR = moving.reduce((s, r) => Math.min(s, r.r), Infinity);
    const shift = rows.reduce((s, r) => Math.max(s, r.shiftM), 0);
    const cond = res.photoCond[p];
    const reasons: string[] = [];
    let cls: EdgeClass;
    if (two) {
      // No redundancy: 2 ranges + 1 angle for x, y, yaw. Amber at best, never green, and only
      // when the step-8 focal length passes (the ranges scale with fx).
      const worst = rows.reduce((a, b) => (Math.abs(b.w) > Math.abs(a.w) ? b : a));
      if (calibrateFirst) {
        cls = 'grey';
        reasons.push(`${TWO_POINT_LABEL}: calibrate first. The two post ranges scale with the focal length, known only to ±${((input.calibrationSigmaRel ?? 0) * 100).toFixed(2)} % (needs ≤ 0.5 %).`);
      } else if (maxAbsW > BLUNDER_W) {
        cls = 'red';
        reasons.push(`${TWO_POINT_LABEL}: a reading disagrees (${worst.sleeve}, w ${worst.w.toFixed(1)}). Check both posts, then retake.`);
      } else {
        cls = 'amber';
        reasons.push(`${TWO_POINT_LABEL}: from 2 two-sleeve posts, ±${(ellipse95M * 1000).toFixed(0)} mm (95 %). Nothing checks it; add a third base point in view to check it.`);
      }
    } else if (missing.length) {
      cls = 'grey';
      reasons.push(`Only ${nBase} base point${nBase === 1 ? '' : 's'} in this photo${nRange ? ` (${nRange} on two-sleeve posts)` : ''}; it needs at least ${MIN_BASE_POINTS}, or 3 with a two-sleeve post, or 2 two-sleeve posts for an unchecked 2-point fix. Retake with more in view, or add a base point that this spot can see.`);
    } else if (!(cond <= DANGER_COND_MAX)) {
      cls = 'grey';
      reasons.push('Weak geometry: this spot is near a circle through the sleeves it sees (danger circle).');
    } else if (minR < UNCHECKED_R) {
      cls = 'grey';
      reasons.push('Unchecked: one sleeve reading is not checked by the others.');
    } else if (maxAbsW > BLUNDER_W) {
      cls = 'red';
      const worst = rows.reduce((a, b) => (Math.abs(b.w) > Math.abs(a.w) ? b : a));
      reasons.push(`A sleeve reading disagrees (${worst.sleeve}, w ${worst.w.toFixed(1)}). Check that sleeve was not moved, then retake.`);
    } else if (maxAbsW > k) {
      cls = 'amber';
      reasons.push(`One reading is a little off (max |w| ${maxAbsW.toFixed(2)} above ${k.toFixed(2)}).`);
    } else if (shift <= SHIFT_GREEN_M) {
      cls = 'green';
      reasons.push(`Checked: an undetected error could move this point at most ${(shift * 1000).toFixed(0)} mm.`);
    } else if (shift <= SHIFT_AMBER_M) {
      cls = 'amber';
      reasons.push(`An undetected error could move this point up to ${(shift * 1000).toFixed(0)} mm (green needs ≤ ${tolerances.controlShiftGreenMm} mm).`);
    } else {
      // Decision (not in the sign-off): above the 60 mm cap the point is not checked well
      // enough for this class, so it is grey (unchecked), never green or amber.
      cls = 'grey';
      reasons.push(`Not checked well enough: an undetected error could move this point ${(shift * 1000).toFixed(0)} mm (limit ${tolerances.controlShiftAmberMm} mm).`);
    }
    if (calibrateFirst && !two) {
      if (cls === 'green') cls = 'amber';
      reasons.push(`Calibrate first: the step-8 focal length is only known to ±${((input.calibrationSigmaRel ?? 0) * 100).toFixed(2)} % (needs ≤ 0.5 %).`);
    }
    if (untied.length) reasons.push(`${untied.join(', ')} tapped but not tied into the base-point network yet.`);
    return {
      pointId: ph.pointId,
      cls,
      reasons,
      rowCount: n,
      k,
      maxAbsW,
      reliabilityShiftM: shift,
      minR: Number.isFinite(minR) ? minR : 0,
      rows: rows.map((r) => ({ sleeve: r.sleeve, kind: r.kind, r: r.r, mdbPx: r.mdbPx, w: r.w, shiftMm: r.shiftM * 1000 })),
      calibrateFirst,
      missing,
      cond,
      basePointCount: nBase,
      rangeCount: nRange,
      twoPointFix: two,
      ellipse95M,
    };
  });
}

/** Measurement-strength lines for one edge point: r, MDB and reliability shift per sleeve. */
export function strengthLines(g: EdgeGate): string[] {
  return [
    `${g.pointId}: ${g.cls}. ${g.reasons[0] ?? ''}`.trim(),
    `Reliability shift ${(g.reliabilityShiftM * 1000).toFixed(0)} mm · max |w| ${g.maxAbsW.toFixed(2)} (green ≤ ${g.k.toFixed(2)}) · ${g.basePointCount} base points${g.rangeCount ? `, ${g.rangeCount} post range${g.rangeCount === 1 ? '' : 's'}` : ''}${g.twoPointFix ? ` · ${TWO_POINT_LABEL}` : ''}`,
    ...g.rows.map((r) => `${r.sleeve}${r.kind === 'range' ? ' range' : ''}: r ${r.r.toFixed(2)} · MDB ${Number.isFinite(r.mdbPx) ? r.mdbPx.toFixed(1) : '∞'} px · w ${r.w.toFixed(2)} · ∇x ${Number.isFinite(r.shiftMm) ? r.shiftMm.toFixed(0) : '∞'} mm`),
  ];
}

// ---------------------------------------------------------------------------------------------
// Visibility (occlusion + frame), used by the step text check and the simulations
// ---------------------------------------------------------------------------------------------

/** Sleeves visible from a camera facing `yaw`: inside the usable frame and not hidden behind a nearer sleeve. */
export function visibleSleeves(cam: Xy, yaw: number, sleeves: readonly Xy[], widthM = SLEEVE_WIDTH_M): number[] {
  const out: number[] = [];
  sleeves.forEach((s, j) => {
    const th = Math.atan2(s.y - cam.y, s.x - cam.x);
    if (Math.abs(wrap(th - yaw)) >= HALF_FOV_RAD) return;
    const dj = Math.hypot(s.x - cam.x, s.y - cam.y);
    const hidden = sleeves.some((o, k) => {
      if (k === j) return false;
      const dk = Math.hypot(o.x - cam.x, o.y - cam.y);
      return dk < dj && Math.abs(wrap(Math.atan2(o.y - cam.y, o.x - cam.x) - th)) < widthM / dk;
    });
    if (!hidden) out.push(j);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// 4. Document adapter and circle verdict
// ---------------------------------------------------------------------------------------------

export interface PhotoLike {
  width: number;
  height: number;
  clicks: { pointId: string; px: number; py: number }[];
  originalFile?: {
    fullWidth?: number;
    fullHeight?: number;
    previewScaleX?: number;
    previewScaleY?: number;
    nativeCapture?: { gravity?: { x: number; y: number; z: number } | null };
  };
}

/** Point name of the bottom sleeve on a two-sleeve post: BAS03 → BAS03B. */
export function bottomSleevePoint(id: string): string {
  return `${id}B`;
}

/**
 * Image x of each tapped base point on one edge photo, in full-resolution px from the image
 * centre, levelled with the gravity sidecar when there is one (pitch and roll, the same
 * levelling the main solver uses: u = −fx·tan β, β = levelledBearing). Without gravity the
 * phone is taken as level.
 *
 * Two-sleeve posts: when the photo also has the bottom sleeve (BASnnB) tapped or scanned, the
 * levelled vertical separation Δy = fx·(tan e_top − tan e_bottom) is returned on the sighting.
 * The two must line up (same levelled bearing within 5 % of Δy + 10 px) with the top above the
 * bottom; otherwise no range is used and the post is listed in `misaligned`.
 */
export function sightingsFromPhoto(
  photo: PhotoLike,
  basePointIds: Set<string>,
  fxFull: number,
): { sightings: SleeveSighting[]; levelled: boolean; misaligned: string[] } {
  const of = photo.originalFile;
  const sx = of?.previewScaleX && of.previewScaleX > 0 ? of.previewScaleX : 1;
  const sy = of?.previewScaleY && of.previewScaleY > 0 ? of.previewScaleY : 1;
  const W = of?.fullWidth ?? photo.width / sx;
  const H = of?.fullHeight ?? photo.height / sy;
  const gravity = of?.nativeCapture?.gravity ?? null;
  const ray = (c: { px: number; py: number }) => {
    const px = c.px / sx;
    const py = c.py / sy;
    const r0 = { x: (px - W / 2) / fxFull, y: (py - H / 2) / fxFull, z: 1 };
    const r = gravity ? levelRay(r0, gravity) : r0;
    const beta = levelledBearing({ px, py, cx: W / 2, cy: H / 2, fx: fxFull, fy: fxFull, gravity });
    // y is down: tan of the elevation above level.
    return { beta, tanE: -r.y / Math.hypot(r.x, r.z) };
  };
  const misaligned: string[] = [];
  const sightings = photo.clicks.filter((c) => basePointIds.has(c.pointId)).map((c) => {
    const top = ray(c);
    const out: SleeveSighting = { id: c.pointId, u: -fxFull * Math.tan(top.beta) };
    const b = photo.clicks.find((k) => k.pointId === bottomSleevePoint(c.pointId));
    if (b) {
      const bot = ray(b);
      const dy = fxFull * (top.tanE - bot.tanE);
      const dx = fxFull * Math.abs(Math.tan(top.beta) - Math.tan(bot.beta));
      if (dy > 0 && dx <= POST_ALIGN_FRACTION * dy + POST_ALIGN_PX) out.dyPx = dy;
      else misaligned.push(c.pointId);
    }
    return out;
  });
  return { sightings, levelled: gravity != null, misaligned };
}

export interface ControlCircleOptions {
  tapes?: DiameterTapes;
  capM?: number;
  plantableCapM?: number;
  plannedPoints?: number;
}

/** Session → gates → the existing circle fit and tape comparison (circleVerdict), unchanged. */
export function controlCircleVerdict(input: SessionInput, opts: ControlCircleOptions = {}) {
  const res = adjustSession(input);
  const gates = gateEdgePoints(input, res);
  const blocking = gates.filter((g) => g.cls === 'red' || g.cls === 'grey').map((g) => `${g.pointId}: ${g.reasons[0]}`);
  const verdict = circleVerdict({
    points: res.photos.map((p) => ({ id: p.pointId, x: p.x, y: p.y })),
    covariance: res.pointCovariance,
    cameras: [],
    rays: [],
    tapes: opts.tapes,
    capM: opts.capM,
    plantableCapM: opts.plantableCapM,
    plannedPoints: opts.plannedPoints,
    rayGates: false,
    pointGuidance: blocking,
  });
  return { verdict, session: res, gates };
}
