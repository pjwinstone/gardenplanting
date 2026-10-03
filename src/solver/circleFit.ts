/**
 * Geometric (orthogonal-distance) circle fit, started from Kåsa.
 * The centre and radius are in the same frame as the points. σ_R is reported.
 * An arc under about 90° does not determine a radius.
 */

import { invertSpd } from './linalg';

export interface CircleFit {
  cx: number;
  cy: number;
  r: number;
  /** RMS orthogonal residual, metres. */
  rmsM: number;
  /** Formal σ of the radius. Null when three points leave no redundancy. */
  sigmaRM: number | null;
  /** Central angle spanned by the points. */
  arcRad: number;
  /** True when the arc is under about 90°. */
  radiusWeak: boolean;
}

interface Xy {
  x: number;
  y: number;
}

/** Algebraic seed. Kåsa alone pulls the radius small on a short arc. */
export function kasaSeed(pts: Xy[]): { cx: number; cy: number; r: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;
  let sumX3 = 0;
  let sumY3 = 0;
  let sumX2Y = 0;
  let sumXY2 = 0;
  for (const p of pts) {
    const x2 = p.x * p.x;
    const y2 = p.y * p.y;
    sumX += p.x;
    sumY += p.y;
    sumX2 += x2;
    sumY2 += y2;
    sumXY += p.x * p.y;
    sumX3 += x2 * p.x;
    sumY3 += y2 * p.y;
    sumX2Y += x2 * p.y;
    sumXY2 += p.x * y2;
  }
  const C = n * sumX2 - sumX * sumX;
  const D = n * sumXY - sumX * sumY;
  const E = n * sumY2 - sumY * sumY;
  const G = 0.5 * (n * sumX3 + n * sumXY2 - sumX * (sumX2 + sumY2));
  const H = 0.5 * (n * sumY3 + n * sumX2Y - sumY * (sumX2 + sumY2));
  const denom = C * E - D * D;
  if (Math.abs(denom) < 1e-14) return null;
  const cx = (G * E - D * H) / denom;
  const cy = (C * H - D * G) / denom;
  let rSum = 0;
  for (const p of pts) rSum += Math.hypot(p.x - cx, p.y - cy);
  const r = rSum / n;
  if (!(r > 0) || !Number.isFinite(r)) return null;
  return { cx, cy, r };
}

function arcSpan(pts: Xy[], cx: number, cy: number): number {
  const ang = pts
    .map((p) => Math.atan2(p.y - cy, p.x - cx))
    .sort((a, b) => a - b);
  if (ang.length < 2) return 0;
  let maxGap = ang[0] + 2 * Math.PI - ang[ang.length - 1];
  for (let i = 1; i < ang.length; i++) maxGap = Math.max(maxGap, ang[i] - ang[i - 1]);
  return 2 * Math.PI - maxGap;
}

/** Orthogonal-distance fit. Returns null when the points do not determine a circle. */
export function fitCircleGeometric(pts: Xy[]): CircleFit | null {
  const seed = kasaSeed(pts);
  if (!seed) return null;
  let cx = seed.cx;
  let cy = seed.cy;
  let r = seed.r;
  for (let iter = 0; iter < 40; iter++) {
    const j: number[][] = [];
    const v: number[] = [];
    for (const p of pts) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      if (!(d > 1e-12)) return null;
      // e = d − R. Jacobian of e w.r.t. (cx, cy, R).
      j.push([-dx / d, -dy / d, -1]);
      v.push(d - r);
    }
    const n = 3;
    const N = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const g = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      for (let a = 0; a < n; a++) {
        g[a] += j[i][a] * v[i];
        for (let b = 0; b < n; b++) N[a][b] += j[i][a] * j[i][b];
      }
    }
    for (let a = 0; a < n; a++) N[a][a] += 1e-8;
    const inv = invertSpd(N);
    if (!inv) return null;
    const step = [
      inv[0][0] * g[0] + inv[0][1] * g[1] + inv[0][2] * g[2],
      inv[1][0] * g[0] + inv[1][1] * g[1] + inv[1][2] * g[2],
      inv[2][0] * g[0] + inv[2][1] * g[1] + inv[2][2] * g[2],
    ];
    cx -= step[0];
    cy -= step[1];
    r -= step[2];
    if (r < 0) r = Math.abs(r);
    if (Math.hypot(step[0], step[1], step[2]) < 1e-9) break;
  }
  let rss = 0;
  const j: number[][] = [];
  for (const p of pts) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy);
    const e = d - r;
    rss += e * e;
    j.push([-dx / d, -dy / d, -1]);
  }
  const dof = pts.length - 3;
  const N = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < pts.length; i++) {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) N[a][b] += j[i][a] * j[i][b];
    }
  }
  let sigmaR: number | null = null;
  if (dof > 0) {
    const inv = invertSpd(N);
    if (inv) sigmaR = Math.sqrt(Math.max(0, (rss / dof) * inv[2][2]));
  }
  const arc = arcSpan(pts, cx, cy);
  return {
    cx,
    cy,
    r,
    rmsM: Math.sqrt(rss / pts.length),
    sigmaRM: sigmaR,
    arcRad: arc,
    radiusWeak: arc < Math.PI / 2,
  };
}
