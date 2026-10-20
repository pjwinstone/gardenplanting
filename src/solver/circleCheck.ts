/**
 * Garden-circle validation (docs/garden-circle.md). The edge points come out of the main
 * adjustment with their joint covariance Σ. The circle (cx, cy, R) is then estimated from them
 * with an on-circle pseudo-observation per point (σ 15 mm): the radial residual |p − c| − R has
 * covariance C = N Σ Nᵀ + σ_c² I, N the radial unit vectors. In the linear model this sequential
 * step gives the same (cx, cy, R) and covariance as adding the pseudo-observations to the
 * adjustment itself, and it leaves the published point coordinates untouched.
 * Seeded by Kåsa, then Gauss–Newton. σ_D = 2 σ_R. Scale comes from the BAS tape; the diameter
 * only validates it.
 */

import tolerances from '../../workflow/tolerances.json';
import { kasaSeed } from './circleFit';
import { invertSpd } from './linalg';
import { chi2Ppf } from './stats';
import type { SolveResult } from './types';

export const CIRCLE_PSEUDO_SIGMA_M = 0.015;
export const MIN_EDGE_POINTS = 8;
export const MAX_GAP_DEG = 60;
export const MIN_COVERAGE_DEG = 270;
export const MIN_INTERSECTION_DEG = 30;
export const MIN_RAYS_PER_POINT = 2;
/** A camera gap this wide or wider means the cameras sit on fewer than three sides. */
export const MAX_CAMERA_GAP_DEG = 180;
export const MIN_CAMERA_POSITIONS = 3;
export const CIRCLE_CAP_BASELINE_M = tolerances.circleDiameterCapBaselineMm / 1000;
export const CAMERA_CLASS_M = tolerances.cameraPositionMm / 1000;
/** Advice: circle within ~2 baseline lengths; beyond that, warn (not a gate). */
export const BASELINE_REACH = 2;
export const CIRCLE_CAP_PLANTABLE_M = tolerances.circleDiameterCapPlantableMm / 1000;

export interface Xy {
  x: number;
  y: number;
}

export interface CircleEdgePoint extends Xy {
  id: string;
}

export interface CircleRay {
  pointId: string;
  cameraId: string;
}

export interface DiameterTapes {
  /** Each tape across the circle, m (max chord each time). */
  diametersM: number[];
  /** Which edge of the circle border the tape and the canes are on. */
  edge: 'inside' | 'outside';
}

export interface CircleCheckInput {
  points: CircleEdgePoint[];
  /** Joint covariance of the points, rows x0, y0, x1, y1 … in `points` order, m². */
  covariance: number[][];
  cameras: CircleEdgePoint[];
  rays: CircleRay[];
  tapes?: DiameterTapes;
  /** Baseline class cap (default 60 mm) and plantable class cap (default 100 mm), m. */
  capM?: number;
  plantableCapM?: number;
  pseudoSigmaM?: number;
  /** Edge points asked for in Set-up (a gate only when it is above MIN_EDGE_POINTS). */
  plannedPoints?: number;
  /** Baseline ends, to name sides in plain words. */
  bas01?: Xy;
  bas02?: Xy;
  /** Network solvability from the adjust (absent: not checked). */
  network?: CircleNetwork;
  /** Camera position class: 95% semi-major limit, m (default tolerances.json cameraPositionMm). */
  cameraClassM?: number;
  /** BAS01–BAS02 length, m, for the baseline-reach warning. */
  baselineM?: number;
}

export interface CircleNetwork {
  /** Normal matrix full rank: adjust converged, joint cofactor exists, no point unset for rank. */
  fullRank: boolean;
  /** Why not, in plain words. */
  rankNote?: string;
  /** Every camera position used, with its 95% error ellipse semi-major (m) and any station-class block. */
  cameras: { id: string; semiMajor95M?: number; block?: string }[];
}

export type CircleState = 'needs-data' | 'not-a-circle' | 'inconclusive' | 'weak' | 'green' | 'amber' | 'red';

export interface CircleFitResult {
  cx: number;
  cy: number;
  r: number;
  sigmaRM: number;
  diameterM: number;
  sigmaDM: number;
  chi2: number;
  dof: number;
  chi2Limit: number;
  chi2Pass: boolean;
  rmsM: number;
  expectedRmsM: number;
  residualsM: number[];
}

export interface CircleVerdict {
  state: CircleState;
  /** Advisory lines that do not block a pass (e.g. the baseline is short for this circle). */
  warnings?: string[];
  /** One plain line for the row. */
  headline: string;
  /** What to do next, plain words, most useful first. */
  guidance: string[];
  fit?: CircleFitResult;
  tapeMeanM?: number;
  sigmaTapeM?: number;
  deltaM?: number;
  sigmaDeltaM?: number;
  /** Max angular gap between edge points and the arc they cover, degrees. */
  maxGapDeg?: number;
  coverageDeg?: number;
  plantablePass?: boolean;
}

const DEG = Math.PI / 180;

/** Weighted orthogonal circle fit with the radial covariance and pseudo-observations. */
export function fitCircleWeighted(points: Xy[], covariance: number[][], pseudoSigmaM = CIRCLE_PSEUDO_SIGMA_M): CircleFitResult | null {
  const n = points.length;
  if (n < 3) return null;
  const seed = kasaSeed(points);
  if (!seed) return null;
  let { cx, cy, r } = seed;
  const radial = () => points.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1e-12;
    return { nx: dx / d, ny: dy / d, d };
  });
  const weight = (nv: { nx: number; ny: number }[]): number[][] | null => {
    const C: number[][] = [];
    for (let i = 0; i < n; i += 1) {
      C.push([]);
      for (let j = 0; j < n; j += 1) {
        const s = (a: number, b: number) => covariance[2 * i + a]?.[2 * j + b] ?? 0;
        let v = nv[i].nx * (s(0, 0) * nv[j].nx + s(0, 1) * nv[j].ny) + nv[i].ny * (s(1, 0) * nv[j].nx + s(1, 1) * nv[j].ny);
        if (i === j) v += pseudoSigmaM * pseudoSigmaM;
        C[i].push(v);
      }
    }
    return invertSpd(C);
  };
  let W: number[][] | null = null;
  let nv = radial();
  for (let iter = 0; iter < 20; iter += 1) {
    nv = radial();
    W = weight(nv);
    if (!W) return null;
    const A = nv.map((q) => [-q.nx, -q.ny, -1]);
    const e = nv.map((q) => q.d - r);
    const N = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const g = [0, 0, 0];
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const w = W[i][j];
        if (w === 0) continue;
        for (let a = 0; a < 3; a += 1) {
          g[a] += A[i][a] * w * e[j];
          for (let b = 0; b < 3; b += 1) N[a][b] += A[i][a] * w * A[j][b];
        }
      }
    }
    const inv = invertSpd(N);
    if (!inv) return null;
    const step = [0, 1, 2].map((a) => inv[a][0] * g[0] + inv[a][1] * g[1] + inv[a][2] * g[2]);
    cx -= step[0];
    cy -= step[1];
    r -= step[2];
    if (Math.hypot(step[0], step[1], step[2]) < 1e-9) break;
  }
  nv = radial();
  W = weight(nv);
  if (!W) return null;
  const A = nv.map((q) => [-q.nx, -q.ny, -1]);
  const e = nv.map((q) => q.d - r);
  const N = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let chi2 = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      chi2 += e[i] * W[i][j] * e[j];
      for (let a = 0; a < 3; a += 1) for (let b = 0; b < 3; b += 1) N[a][b] += A[i][a] * W[i][j] * A[j][b];
    }
  }
  const Q = invertSpd(N);
  if (!Q) return null;
  const sigmaR = Math.sqrt(Math.max(0, Q[2][2]));
  const dof = n - 3;
  const chi2Limit = dof > 0 ? chi2Ppf(0.95, dof) : Infinity;
  const rms = Math.sqrt(e.reduce((s, v) => s + v * v, 0) / n);
  // Expected RMS of the radial residual: the mean radial variance (points + pseudo-obs).
  let meanVar = 0;
  for (let i = 0; i < n; i += 1) {
    const s = (a: number, b: number) => covariance[2 * i + a]?.[2 * i + b] ?? 0;
    meanVar += nv[i].nx * (s(0, 0) * nv[i].nx + s(0, 1) * nv[i].ny) + nv[i].ny * (s(1, 0) * nv[i].nx + s(1, 1) * nv[i].ny) + pseudoSigmaM ** 2;
  }
  const expectedRms = Math.sqrt(meanVar / n);
  return {
    cx, cy, r,
    sigmaRM: sigmaR,
    diameterM: 2 * r,
    sigmaDM: 2 * sigmaR,
    chi2, dof, chi2Limit,
    chi2Pass: dof <= 0 || chi2 <= chi2Limit,
    rmsM: rms,
    expectedRmsM: expectedRms,
    residualsM: e,
  };
}

function azimuth(c: Xy, p: Xy): number {
  const a = Math.atan2(p.y - c.y, p.x - c.x);
  return a < 0 ? a + 2 * Math.PI : a;
}

/** Sorted azimuths, the largest gap between neighbours and where it starts. */
function gaps<T>(items: T[], az: (t: T) => number): { maxGap: number; from?: T; to?: T } {
  if (items.length === 0) return { maxGap: 2 * Math.PI };
  const s = [...items].sort((p, q) => az(p) - az(q));
  if (s.length === 1) return { maxGap: 2 * Math.PI, from: s[0], to: s[0] };
  let maxGap = az(s[0]) + 2 * Math.PI - az(s[s.length - 1]);
  let from = s[s.length - 1];
  let to = s[0];
  for (let i = 1; i < s.length; i += 1) {
    const g = az(s[i]) - az(s[i - 1]);
    if (g > maxGap) { maxGap = g; from = s[i - 1]; to = s[i]; }
  }
  return { maxGap, from, to };
}

/** Plain-words side of the circle in the direction `a` (radians, garden frame). */
export function sideWords(a: number, bas01?: Xy, bas02?: Xy): string {
  // Frame: x along BAS01 → BAS02, y away from the baseline into the garden.
  let ax = 0;
  if (bas01 && bas02) ax = Math.atan2(bas02.y - bas01.y, bas02.x - bas01.x);
  let rel = (a - ax) % (2 * Math.PI);
  if (rel < 0) rel += 2 * Math.PI;
  const k = Math.round(rel / (Math.PI / 2)) % 4;
  return ['the BAS02 end', 'the far side, away from the baseline', 'the BAS01 end', 'the baseline side'][k];
}

/** The edge points nearest an azimuth, to name a place on the circle. */
function nearestPoints(points: CircleEdgePoint[], c: Xy, a: number, k = 2): string[] {
  const d = (p: CircleEdgePoint) => {
    let x = Math.abs(azimuth(c, p) - a) % (2 * Math.PI);
    if (x > Math.PI) x = 2 * Math.PI - x;
    return x;
  };
  return [...points].sort((p, q) => d(p) - d(q)).slice(0, k).map((p) => p.id).sort();
}

function mm(m: number): string {
  return `${Math.round(m * 1000)} mm`;
}

/** The whole check: fit, tape comparison, geometry gates, and plain guidance. */
export function circleVerdict(input: CircleCheckInput): CircleVerdict {
  const cap = input.capM ?? CIRCLE_CAP_BASELINE_M;
  const plantCap = input.plantableCapM ?? CIRCLE_CAP_PLANTABLE_M;
  const { points } = input;
  const guidance: string[] = [];
  if (input.network && !input.network.fullRank) {
    return {
      state: 'needs-data',
      headline: `The survey network does not solve on its own yet${input.network.rankNote ? `: ${input.network.rankNote}` : ''}.`,
      guidance: ['Tape at least two camera positions (on the circle side of the baseline) to both BAS01 and BAS02. At each position, keep one cane from the previous photo in view as you turn.'],
    };
  }
  if (points.length < 3) {
    return { state: 'needs-data', headline: `Only ${points.length} edge point${points.length === 1 ? '' : 's'} placed. The circle needs at least ${MIN_EDGE_POINTS}.`, guidance: ['Mark more edge points in the photos.'] };
  }
  const fit = fitCircleWeighted(points, input.covariance, input.pseudoSigmaM);
  if (!fit) return { state: 'needs-data', headline: 'The edge points do not give a circle yet.', guidance: ['Mark more edge points, spread round the circle.'] };
  const c = { x: fit.cx, y: fit.cy };

  // Geometry gates.
  const g = gaps(points, (p) => azimuth(c, p));
  const maxGapDeg = g.maxGap / DEG;
  const coverageDeg = 360 - maxGapDeg;
  if (points.length < Math.max(MIN_EDGE_POINTS, Math.min(input.plannedPoints ?? 0, 64))) {
    guidance.push(`${points.length} edge points placed. Place at least ${Math.max(MIN_EDGE_POINTS, input.plannedPoints ?? 0)}, evenly round the circle.`);
  }
  if (maxGapDeg > MAX_GAP_DEG && g.from && g.to) {
    guidance.push(`Add a point between ${g.from.id} and ${g.to.id}. The gap there is ${Math.round(maxGapDeg)}°; keep every gap under ${MAX_GAP_DEG}°.`);
  }
  const camGap = gaps(input.cameras, (p) => azimuth(c, p));
  if (input.cameras.length < MIN_CAMERA_POSITIONS || camGap.maxGap / DEG >= MAX_CAMERA_GAP_DEG) {
    const mid = camGap.from && camGap.to && input.cameras.length > 1
      ? (azimuth(c, camGap.from) + camGap.maxGap / 2) % (2 * Math.PI)
      : (input.cameras.length === 1 ? (azimuth(c, input.cameras[0]) + Math.PI) % (2 * Math.PI) : Math.PI / 2);
    const near = nearestPoints(points, c, mid);
    guidance.push(`Take a photo from ${sideWords(mid, input.bas01, input.bas02)}, outside the circle beyond ${near.join(' and ')}. Cameras need to be on at least ${MIN_CAMERA_POSITIONS} sides.`);
  }
  const cams = new Map(input.cameras.map((q) => [q.id, q]));
  for (const p of points) {
    const from = [...new Set(input.rays.filter((ray) => ray.pointId === p.id).map((ray) => ray.cameraId))]
      .map((id) => cams.get(id)).filter((q): q is CircleEdgePoint => !!q);
    if (from.length < MIN_RAYS_PER_POINT) {
      const opposite = (azimuth(c, p) + Math.PI) % (2 * Math.PI);
      guidance.push(`${p.id} is in ${from.length === 1 ? 'only one photo' : 'no photo'}. Take a photo that shows it from ${from.length ? 'a second camera position' : sideWords(opposite, input.bas01, input.bas02)}.`);
      continue;
    }
    let best = 0;
    for (let i = 0; i < from.length; i += 1) {
      for (let j = i + 1; j < from.length; j += 1) {
        const a1 = Math.atan2(from[i].y - p.y, from[i].x - p.x);
        const a2 = Math.atan2(from[j].y - p.y, from[j].x - p.x);
        let d = Math.abs(a1 - a2) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        best = Math.max(best, Math.min(d, Math.PI - d));
      }
    }
    if (best / DEG < MIN_INTERSECTION_DEG) {
      const away = azimuth(p, from.reduce((s, q) => ({ x: s.x + q.x / from.length, y: s.y + q.y / from.length }), { x: 0, y: 0 }));
      const side = (away + Math.PI / 2) % (2 * Math.PI);
      guidance.push(`${p.id} is seen from directions only ${Math.round(best / DEG)}° apart (needs ${MIN_INTERSECTION_DEG}°). Take a photo of it from ${sideWords(side, input.bas01, input.bas02)}.`);
    }
  }

  // Network solvability (replaces "a baseline end in every photo"): full rank, every camera
  // position inside its class at 95%, every edge point on ≥ 2 rays (above).
  const net = input.network;
  const camClass = input.cameraClassM ?? CAMERA_CLASS_M;
  for (const cam of net?.cameras ?? []) {
    if (cam.block === 'danger') {
      guidance.push(`${cam.id} sits close to the danger circle (on a circle through the points it sees). Move it a few metres sideways, or tape it to BAS01 and BAS02.`);
    } else if (cam.semiMajor95M == null || !Number.isFinite(cam.semiMajor95M)) {
      guidance.push(`${cam.id} has no error ellipse. Tape it to BAS01 and BAS02, or show it more edge canes.`);
    } else if (cam.semiMajor95M > camClass) {
      guidance.push(`${cam.id} is only known to ± ${mm(cam.semiMajor95M)} (limit ${mm(camClass)}). Tape it to BAS01 and BAS02, or take a photo from it that shows more edge canes spread wide.`);
    }
  }
  const warnings: string[] = [];
  if (input.baselineM && input.baselineM > 0 && input.bas01 && input.bas02) {
    const mid = { x: (input.bas01.x + input.bas02.x) / 2, y: (input.bas01.y + input.bas02.y) / 2 };
    const far = points.filter((p) => Math.hypot(p.x - mid.x, p.y - mid.y) > BASELINE_REACH * input.baselineM!);
    if (far.length) {
      warnings.push(`${far.map((p) => p.id).join(', ')} ${far.length === 1 ? 'is' : 'are'} more than ${BASELINE_REACH} baseline lengths (${(BASELINE_REACH * input.baselineM).toFixed(1)} m) from the baseline. It still works, but a longer baseline is better: 8–10 m, roughly along the circle.`);
    }
  }

  const base: CircleVerdict = { state: 'weak', headline: '', guidance, fit, maxGapDeg, coverageDeg, warnings };
  const fitLine = `Fitted diameter ${(fit.diameterM).toFixed(3)} m ± ${mm(fit.sigmaDM)}`;

  // Not a circle: χ² or the residual RMS against what the covariance expects.
  if (!fit.chi2Pass || fit.rmsM > 2 * fit.expectedRmsM) {
    const worst = fit.residualsM.map((v, i) => ({ v, id: points[i].id })).sort((p, q) => Math.abs(q.v) - Math.abs(p.v))[0];
    return {
      ...base,
      state: 'not-a-circle',
      headline: `Not a circle: the points miss a circle by ${mm(fit.rmsM)} on average (expected about ${mm(fit.expectedRmsM)}).`,
      guidance: [`Check ${worst.id} sits on the edge (${mm(Math.abs(worst.v))} ${worst.v > 0 ? 'outside' : 'inside'} the fitted circle), and that every cane is on the same edge you taped.`, ...guidance],
    };
  }
  const tapes = input.tapes?.diametersM.filter((v) => Number.isFinite(v) && v > 0) ?? [];
  if (fit.sigmaDM > cap) {
    return {
      ...base,
      state: 'inconclusive',
      headline: `Inconclusive: the diameter is only known to ± ${mm(fit.sigmaDM)}, more than the ${mm(cap)} limit.`,
      guidance: guidance.length ? guidance : ['Add camera positions round the circle so each point is seen from wider angles.'],
    };
  }
  if (tapes.length < 3) {
    return {
      ...base,
      state: 'needs-data',
      headline: `${fitLine}. Tape the diameter 3 times to compare.`,
      guidance: [`Tape the diameter ${3 - tapes.length} more time${3 - tapes.length === 1 ? '' : 's'}, about 60° apart.`, ...guidance],
    };
  }
  const mean = tapes.reduce((s, v) => s + v, 0) / tapes.length;
  const spread = Math.max(...tapes) - Math.min(...tapes);
  const sigmaTape = spread / Math.sqrt(3) + 0.005;
  const delta = fit.diameterM - mean;
  const sigmaDelta = Math.hypot(fit.sigmaDM, sigmaTape);
  const ad = Math.abs(delta);
  const numbers = `${fitLine}, taped ${mean.toFixed(3)} m. Difference ${mm(ad)} (limit ${mm(cap)}).`;
  const tapeOut = { tapeMeanM: mean, sigmaTapeM: sigmaTape, deltaM: delta, sigmaDeltaM: sigmaDelta, plantablePass: ad <= plantCap };
  if (guidance.length) {
    return { ...base, ...tapeOut, state: 'weak', headline: `Weak geometry, so no pass yet. ${numbers}` };
  }
  const green = ad <= 1.96 * sigmaDelta && ad <= cap;
  const amber = !green && ((ad > 1.96 * sigmaDelta && ad <= 3.29 * sigmaDelta) || ad <= 1.5 * cap);
  const state: CircleState = green ? 'green' : amber ? 'amber' : 'red';
  const lead = green ? 'Pass.' : amber ? 'Close, check it.' : 'Fail.';
  const next = green ? [] : amber
    ? ['Re-tape the diameter, and check BAS01–BAS02 was taped sleeve to sleeve.']
    : ['Re-tape the baseline and the diameter. If they agree, check the calibration photo.'];
  return { ...base, ...tapeOut, state, headline: `${lead} ${numbers}`, guidance: next };
}

/**
 * Build the check from a solved garden: the named edge points with their joint covariance
 * (scaled by σ̂₀² when the adjustment scaled its covariances), the camera positions, and one
 * ray per used bearing.
 */
export function circleCheckFromSolve(
  result: SolveResult,
  edgePointIds: string[],
  extra: Omit<CircleCheckInput, 'points' | 'covariance' | 'cameras' | 'rays'> = {},
): CircleCheckInput {
  const byId = new Map(result.points.map((p) => [p.id, p]));
  const placed = edgePointIds.filter((id) => byId.get(id)?.x != null && byId.get(id)?.y != null);
  const points = placed.map((id) => ({ id, x: byId.get(id)!.x!, y: byId.get(id)!.y! }));
  const cof = placed.length ? result.jointCofactor(placed) : null;
  const scale = result.covarianceScaled && result.sigma0 != null ? result.sigma0 ** 2 : 1;
  const covariance = cof ? cof.map((row) => row.map((v) => v * scale)) : placed.flatMap(() => [[], []]);
  const edge = new Set(placed);
  const rays: CircleRay[] = [];
  const cameraIds = new Set<string>();
  for (const o of result.observations) {
    if (o.kind !== 'bearing' || !o.used) continue;
    const [cam, pt] = o.pointIds;
    if (!edge.has(pt)) continue;
    rays.push({ pointId: pt, cameraId: cam });
    cameraIds.add(cam);
  }
  const cameras = [...cameraIds].map((id) => byId.get(id)).filter((p) => p?.x != null && p?.y != null).map((p) => ({ id: p!.id, x: p!.x!, y: p!.y! }));
  const bas = (id: string) => (byId.get(id)?.x != null ? { x: byId.get(id)!.x!, y: byId.get(id)!.y ?? 0 } : undefined);
  const unsetRank = result.points.filter((p) => p.unsetCode === 'rank').map((p) => p.id);
  const fullRank = result.converged && placed.length > 0 && cof != null && unsetRank.length === 0;
  const mirrored = result.points.filter((p) => p.unsetCode === 'mirror').map((p) => p.id);
  const network: CircleNetwork = {
    fullRank,
    rankNote: !result.converged ? 'the adjustment did not converge'
      : unsetRank.length ? `${unsetRank.join(', ')} cannot be fixed from the measurements`
      : placed.length === 0 ? `no edge point could be placed${mirrored.length ? ` (${mirrored.join(', ')} could be on either side of the baseline: tape positions on the circle side of BAS01–BAS02)` : ''}`
      : cof == null && placed.length ? 'the edge points have no covariance' : undefined,
    cameras: cameras.map((c) => {
      const p = byId.get(c.id)!;
      return { id: c.id, semiMajor95M: p.semiMajor95M, block: p.stationClassBlock === 'danger' ? 'danger' : undefined };
    }),
  };
  return { points, covariance, cameras, rays, bas01: bas('BAS01'), bas02: bas('BAS02'), network, ...extra };
}
