/**
 * Closed-form geometry: circle intersections, the two-mark arc, resection,
 * ray crossing, and the trilateration ellipse.
 * The isosceles range is exported only so its focal-length danger stays visible.
 * The adjustment does not call it.
 */

import { DANGER_RATIO_WARN, ELLIPSE_95, THETA_REJECT_RAD } from './constants';
import { circularMean, wrap } from './bearing';

export interface Xy {
  x: number;
  y: number;
}

export function hypot2(a: Xy, b: Xy): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Two circle intersections. Empty when the circles do not meet. */
export function intersectCircles(c0: Xy, r0: number, c1: Xy, r1: number): Xy[] {
  const dx = c1.x - c0.x;
  const dy = c1.y - c0.y;
  const d = Math.hypot(dx, dy);
  if (!(d > 1e-12) || d > r0 + r1 + 1e-9 || d < Math.abs(r0 - r1) - 1e-9) return [];
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h2 = r0 * r0 - a * a;
  const h = Math.sqrt(Math.max(0, h2));
  const px = c0.x + (a * dx) / d;
  const py = c0.y + (a * dy) / d;
  if (h < 1e-9) return [{ x: px, y: py }];
  const ox = (-dy / d) * h;
  const oy = (dx / d) * h;
  return [
    { x: px + ox, y: py + oy },
    { x: px - ox, y: py - oy },
  ];
}

/**
 * Closest point on the line of centres when two circles miss.
 * `gapM` is how far apart the circles stay (positive = separated).
 */
export function closestOnLineOfCentres(
  c0: Xy,
  r0: number,
  c1: Xy,
  r1: number,
): { point: Xy; gapM: number } | null {
  const dx = c1.x - c0.x;
  const dy = c1.y - c0.y;
  const d = Math.hypot(dx, dy);
  if (!(d > 1e-12)) return null;
  const ux = dx / d;
  const uy = dy / d;
  if (d > r0 + r1) {
    const gap = d - r0 - r1;
    return { point: { x: c0.x + ux * (r0 + gap / 2), y: c0.y + uy * (r0 + gap / 2) }, gapM: gap };
  }
  const gap = Math.abs(r0 - r1) - d;
  const along = r0 > r1 ? r0 - gap / 2 : d + r1 - gap / 2;
  return { point: { x: c0.x + ux * along, y: c0.y + uy * along }, gapM: gap };
}

export function subtended(p: Xy, a: Xy, b: Xy): number {
  return Math.abs(wrap(Math.atan2(b.y - p.y, b.x - p.x) - Math.atan2(a.y - p.y, a.x - p.x)));
}

export interface ArcStation {
  radiusM: number;
  thetaRad: number;
  /** Camera-side circle centre. */
  centre: Xy;
  candidates: Xy[];
  unique: boolean;
  /** True when no coordinate should be published. */
  noCoordinate: boolean;
  code: 'flat-angle' | 'arc-only' | 'two-candidates' | 'unique' | 'miss';
  midpointTape: boolean;
}

/**
 * Two marks put the camera on an arc through A and B.
 * One tape generally cuts that arc twice. A tape shorter than the baseline,
 * to one end, is the case that leaves a single point.
 */
export function arcStation(opts: {
  a: Xy;
  b: Xy;
  bearingA: number;
  bearingB: number;
  tape?: { to: 'a' | 'b' | 'mid'; lengthM: number };
}): ArcStation {
  const { a, b } = opts;
  const L = hypot2(a, b);
  const theta = Math.abs(wrap(opts.bearingB - opts.bearingA));
  const emptyCentre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (!(L > 1e-6) || theta < THETA_REJECT_RAD || Math.PI - theta < THETA_REJECT_RAD) {
    return {
      radiusM: Infinity,
      thetaRad: theta,
      centre: emptyCentre,
      candidates: [],
      unique: false,
      noCoordinate: true,
      code: 'flat-angle',
      midpointTape: opts.tape?.to === 'mid',
    };
  }
  const R = L / (2 * Math.sin(theta));
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ux = dx / L;
  const uy = dy / L;
  const left = wrap(opts.bearingB - opts.bearingA) > 0;
  const nx = left ? -uy : uy;
  const ny = left ? ux : -ux;
  const offset = R * Math.cos(theta);
  const centre = { x: (a.x + b.x) / 2 + nx * offset, y: (a.y + b.y) / 2 + ny * offset };
  if (!opts.tape) {
    return {
      radiusM: R,
      thetaRad: theta,
      centre,
      candidates: [],
      unique: false,
      noCoordinate: true,
      code: 'arc-only',
      midpointTape: false,
    };
  }
  const tapeCentre =
    opts.tape.to === 'a' ? a : opts.tape.to === 'b' ? b : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const hits = intersectCircles(centre, R, tapeCentre, opts.tape.lengthM).filter(
    (p) => Math.abs(subtended(p, a, b) - theta) < 1e-3,
  );
  return {
    radiusM: R,
    thetaRad: theta,
    centre,
    candidates: hits,
    unique: hits.length === 1,
    noCoordinate: hits.length !== 1,
    code: hits.length === 1 ? 'unique' : hits.length > 1 ? 'two-candidates' : 'miss',
    midpointTape: opts.tape.to === 'mid',
  };
}

export interface ResectionStart {
  position: Xy;
  yawRad: number;
  danger: DangerAssessment;
}

export interface DangerAssessment {
  kind: 'circle' | 'line';
  /** |ρ − R| / R, or distance-to-line / range when the marks are collinear. */
  ratio: number;
  warn: boolean;
  circumRadiusM: number | null;
}

export function dangerAssessment(station: Xy, marks: Xy[]): DangerAssessment {
  if (marks.length < 3) {
    return { kind: 'line', ratio: Infinity, warn: false, circumRadiusM: null };
  }
  const [a, b, c] = marks;
  const ab = hypot2(a, b);
  const bc = hypot2(b, c);
  const ca = hypot2(c, a);
  const area =
    Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  if (!(area > 1e-8)) {
    const range =
      (hypot2(station, a) + hypot2(station, b) + hypot2(station, c)) / 3 || 1;
    const line = distanceToLine(station, a, b);
    const ratio = line / range;
    return { kind: 'line', ratio, warn: ratio < DANGER_RATIO_WARN, circumRadiusM: null };
  }
  const R = (ab * bc * ca) / (4 * area);
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const ux =
    ((a.x * a.x + a.y * a.y) * (b.y - c.y) +
      (b.x * b.x + b.y * b.y) * (c.y - a.y) +
      (c.x * c.x + c.y * c.y) * (a.y - b.y)) /
    d;
  const uy =
    ((a.x * a.x + a.y * a.y) * (c.x - b.x) +
      (b.x * b.x + b.y * b.y) * (a.x - c.x) +
      (c.x * c.x + c.y * c.y) * (b.x - a.x)) /
    d;
  const rho = Math.hypot(station.x - ux, station.y - uy);
  const ratio = Math.abs(rho - R) / R;
  return { kind: 'circle', ratio, warn: ratio < DANGER_RATIO_WARN, circumRadiusM: R };
}

function distanceToLine(p: Xy, a: Xy, b: Xy): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / L;
}

/**
 * Three marks: intersect the AB arc with the AC arc and discard A.
 * Yaw is the circular mean of azimuth − bearing.
 */
export function resectThree(
  marks: { x: number; y: number; bearing: number }[],
): ResectionStart | null {
  if (marks.length < 3) return null;
  const [a, b, c] = marks;
  const ab = arcStation({
    a,
    b,
    bearingA: a.bearing,
    bearingB: b.bearing,
  });
  const ac = arcStation({
    a,
    b: c,
    bearingA: a.bearing,
    bearingB: c.bearing,
  });
  if (!Number.isFinite(ab.radiusM) || !Number.isFinite(ac.radiusM)) return null;
  const hits = intersectCircles(ab.centre, ab.radiusM, ac.centre, ac.radiusM).filter(
    (p) => hypot2(p, a) > 1e-3 && hypot2(p, b) > 1e-3 && hypot2(p, c) > 1e-3,
  );
  if (hits.length === 0) return null;
  // Prefer the hit that reproduces the bearing differences. Both circles already
  // encode the side; if two remain, take the one closest to reproducing yaw.
  let best = hits[0];
  let bestYaw = yawFromBearings(best, marks);
  let bestCost = bearingCost(best, bestYaw, marks);
  for (const hit of hits.slice(1)) {
    const yaw = yawFromBearings(hit, marks);
    const cost = bearingCost(hit, yaw, marks);
    if (cost < bestCost) {
      best = hit;
      bestYaw = yaw;
      bestCost = cost;
    }
  }
  if (bestCost > (5 * Math.PI) / 180) return null;
  return {
    position: best,
    yawRad: bestYaw,
    danger: dangerAssessment(best, marks.map((m) => ({ x: m.x, y: m.y }))),
  };
}

/**
 * Try every triple. The first three clicks are not special: a concyclic
 * triple is skipped in favour of a better-conditioned one. Failure is
 * `danger` when a finite arc still will not resect, and `flat-angle` only
 * when a subtended angle is the numeric θ → 0 guard.
 */
export function resectFromMarks(marks: { x: number; y: number; bearing: number }[]): {
  start: ResectionStart | null;
  failure: 'flat-angle' | 'danger' | 'miss' | null;
} {
  if (marks.length < 3) return { start: null, failure: 'miss' };
  let best: ResectionStart | null = null;
  let sawFlat = false;
  let sawOther = false;
  for (let i = 0; i < marks.length; i++) {
    for (let j = i + 1; j < marks.length; j++) {
      for (let k = j + 1; k < marks.length; k++) {
        const triple = [marks[i], marks[j], marks[k]];
        const attempt = resectThree(triple);
        if (!attempt) {
          const ab = arcStation({
            a: triple[0],
            b: triple[1],
            bearingA: triple[0].bearing,
            bearingB: triple[1].bearing,
          });
          const ac = arcStation({
            a: triple[0],
            b: triple[2],
            bearingA: triple[0].bearing,
            bearingB: triple[2].bearing,
          });
          if (!Number.isFinite(ab.radiusM) || !Number.isFinite(ac.radiusM)) sawFlat = true;
          else sawOther = true;
          continue;
        }
        if (!best || attempt.danger.ratio > best.danger.ratio) best = attempt;
      }
    }
  }
  if (best) return { start: best, failure: null };
  if (sawOther) return { start: null, failure: 'danger' };
  if (sawFlat) return { start: null, failure: 'flat-angle' };
  return { start: null, failure: 'miss' };
}

function yawFromBearings(station: Xy, marks: { x: number; y: number; bearing: number }[]): number {
  return circularMean(
    marks.map((m) => wrap(Math.atan2(m.y - station.y, m.x - station.x) - m.bearing)),
  );
}

function bearingCost(station: Xy, yaw: number, marks: { x: number; y: number; bearing: number }[]): number {
  let s = 0;
  for (const m of marks) {
    const pred = wrap(Math.atan2(m.y - station.y, m.x - station.x) - yaw);
    s += Math.abs(wrap(m.bearing - pred));
  }
  return s;
}

export interface RayHit {
  point: Xy;
  /** True when the crossing is behind either camera. Not a seed. */
  behind: boolean;
}

/**
 * Absolute-azimuth ray intersection.
 * Parallel rays return null. A crossing with t ≤ 0 on either ray is behind
 * that camera and is returned with `behind` set, not as a point to publish.
 */
export function intersectRays(s1: Xy, az1: number, s2: Xy, az2: number): RayHit | null {
  const d1x = Math.cos(az1);
  const d1y = Math.sin(az1);
  const d2x = Math.cos(az2);
  const d2y = Math.sin(az2);
  const det = d1x * d2y - d1y * d2x;
  if (Math.abs(det) < 1e-10) return null;
  const t1 = ((s2.x - s1.x) * d2y - (s2.y - s1.y) * d2x) / det;
  const t2 = ((s2.x - s1.x) * d1y - (s2.y - s1.y) * d1x) / det;
  const point = { x: s1.x + t1 * d1x, y: s1.y + t1 * d1y };
  return { point, behind: t1 <= 1e-6 || t2 <= 1e-6 };
}

/** Crossing angle of two directions, in (0, π/2]. */
export function crossingAngle(az1: number, az2: number): number {
  const d = Math.abs(wrap(az1 - az2));
  return d > Math.PI / 2 ? Math.PI - d : d;
}

/**
 * 1σ semi-axes of an equal-σ distance intersection from two fixed points.
 * φ is the angle at the new point. σ√2 / sin φ is the 2D DRMS, not an axis.
 */
export function trilaterationEllipse(phiRad: number, sigmaM: number): {
  major1M: number;
  minor1M: number;
  major95M: number;
  drmsM: number;
} {
  const major1 = sigmaM / (Math.SQRT2 * Math.sin(phiRad / 2));
  const minor1 = sigmaM / (Math.SQRT2 * Math.cos(phiRad / 2));
  const hi = Math.max(major1, minor1);
  const lo = Math.min(major1, minor1);
  return {
    major1M: hi,
    minor1M: lo,
    major95M: ELLIPSE_95 * hi,
    drmsM: (sigmaM * Math.SQRT2) / Math.sin(phiRad),
  };
}

/**
 * Old isosceles station, d = (L/2) / tan(θ/2).
 * Not a solver. A 10% focal-length error moves the 7 m / 20° case by ±1.98 m.
 */
export function isoscelesRange(lengthM: number, thetaRad: number): number {
  return lengthM / 2 / Math.tan(thetaRad / 2);
}

export function intersectionAngle(p: Xy, a: Xy, b: Xy): number {
  const v1x = a.x - p.x;
  const v1y = a.y - p.y;
  const v2x = b.x - p.x;
  const v2y = b.y - p.y;
  const n1 = Math.hypot(v1x, v1y) || 1;
  const n2 = Math.hypot(v2x, v2y) || 1;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return Math.acos(cos);
}

/** Slope distance to horizontal. Null when |Δh| exceeds the slope. */
export function horizontalDistance(slopeM: number, deltaHM = 0, faceOffsetM = 0): number | null {
  const s = slopeM + faceOffsetM;
  const h2 = s * s - deltaHM * deltaHM;
  if (h2 < 0) return null;
  return Math.sqrt(h2);
}

export function distanceSigma(opts: {
  lengthM: number;
  sigmaM?: number;
  aM?: number;
  bPerM?: number;
  instrument?: 'tape' | 'laser' | 'rod';
}): number {
  if (opts.aM != null && opts.bPerM != null) return Math.hypot(opts.aM, opts.bPerM * opts.lengthM);
  if (opts.sigmaM != null) return opts.sigmaM;
  if (opts.instrument === 'laser') return 0.005;
  if (opts.instrument === 'rod') return 0.005;
  return 0.02;
}

/**
 * True when the axis point came out with x < 0, or every point whose side
 * was chosen by the garden-sign fallback sits on the opposite side of that
 * sign. Bearings, rays, and branch choices are not counted: they cannot
 * reflect at the same cost, and a garden that lies wholly on −Y is legitimate
 * when `solveGardenDocument` still passes sign +1.
 */
export function wholeGardenReflection(opts: {
  axisX: number;
  gardenSign: 1 | -1;
  points: { x: number; y: number; fromGardenSign?: boolean }[];
}): boolean {
  if (opts.axisX < -1e-4) return true;
  let sided = 0;
  let wrong = 0;
  const tol = 1e-3 * Math.max(1, Math.abs(opts.axisX));
  for (const p of opts.points) {
    if (!p.fromGardenSign) continue;
    const cross = opts.axisX * p.y;
    if (Math.abs(cross) < tol) continue;
    sided++;
    if (opts.gardenSign * cross < 0) wrong++;
  }
  return sided >= 2 && wrong === sided;
}

/** Which mirror of a distance intersection lies on the garden side of A→B. */
export function gardenSide(a: Xy, b: Xy, candidates: Xy[], sign: 1 | -1): Xy | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const scored = candidates.map((p) => ({
    p,
    cross: dx * (p.y - a.y) - dy * (p.x - a.x),
  }));
  scored.sort((u, v) => sign * v.cross - sign * u.cross);
  return scored[0].p;
}

export function bothOnBaseline(a: Xy, b: Xy, origin: Xy, axis: Xy): boolean {
  return Math.abs(crossTrack(a, origin, axis)) < 1e-6 && Math.abs(crossTrack(b, origin, axis)) < 1e-6;
}

function crossTrack(p: Xy, a: Xy, b: Xy): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  return (dx * (p.y - a.y) - dy * (p.x - a.x)) / L;
}
