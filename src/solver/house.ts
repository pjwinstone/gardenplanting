/**
 * House closing tolerance.
 * Wall lengths alone have no traverse misclosure. When turning angles are
 * measured, Q_m is the covariance of the open-traverse closing vector with the
 * first azimuth held by the datum. 2.45 times its semi-major is the 95% figure.
 * On the demo shed that is 93 mm (tapes, σ = 20 mm) and 144 mm (plus 0.2°).
 */

import { CHI2_2_95 } from './constants';
import { ellipseFrom2x2 } from './stats';
import { wrap } from './bearing';
import type { Xy } from './geometry';

export interface TraverseGeometry {
  lengths: number[];
  azimuth0: number;
  /** Turning angle applied at the start of legs 1..n-1. The datum holds leg 0. */
  turnings: number[];
}

export function traverseGeometry(corners: Xy[]): TraverseGeometry {
  const n = corners.length;
  const lengths: number[] = [];
  const az: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % n];
    lengths.push(Math.hypot(b.x - a.x, b.y - a.y));
    az.push(Math.atan2(b.y - a.y, b.x - a.x));
  }
  const turnings: number[] = [];
  for (let i = 1; i < n; i++) turnings.push(wrap(az[i] - az[i - 1]));
  return { lengths, azimuth0: az[0], turnings };
}

/** Closing coordinate of an open traverse. A perfect ring returns about (0, 0). */
export function openTraverse(lengths: number[], azimuth0: number, turnings: number[]): Xy {
  let x = 0;
  let y = 0;
  let az = azimuth0;
  for (let i = 0; i < lengths.length; i++) {
    if (i > 0) az += turnings[i - 1];
    x += lengths[i] * Math.cos(az);
    y += lengths[i] * Math.sin(az);
  }
  return { x, y };
}

export interface HouseTolerance {
  /** Angles were supplied, so a traverse misclosure exists. */
  hasTraverseMisclosure: boolean;
  /** 2×2 covariance of the closing vector, metres². */
  qM: [[number, number], [number, number]];
  semiMajor95M: number;
  semiMinor95M: number;
  /** mᵀ Q⁻¹ m when a misclosure vector is supplied. */
  chi2: number | null;
  /** True when chi2 ≤ χ²(2, 0.95). Null when there is no misclosure to test. */
  pass: boolean | null;
}

/**
 * Propagate Q_m. `angleSigmaRad` omitted or zero means directions are exact:
 * the number is still the distance-only closing scatter, and it is not a test.
 */
export function houseTolerance(
  corners: Xy[],
  distanceSigmaM: number | number[],
  angleSigmaRad?: number,
  misclosure?: Xy,
): HouseTolerance {
  const g = traverseGeometry(corners);
  const n = g.lengths.length;
  const sigL = Array.isArray(distanceSigmaM) ? distanceSigmaM : Array<number>(n).fill(distanceSigmaM);
  if (sigL.length !== n) throw new Error('distance σ must be one value or one per wall');
  const base = openTraverse(g.lengths, g.azimuth0, g.turnings);
  const eps = 1e-6;
  const Q: [[number, number], [number, number]] = [
    [0, 0],
    [0, 0],
  ];
  const add = (jx: number, jy: number, variance: number) => {
    Q[0][0] += jx * jx * variance;
    Q[0][1] += jx * jy * variance;
    Q[1][0] += jy * jx * variance;
    Q[1][1] += jy * jy * variance;
  };
  for (let i = 0; i < n; i++) {
    const L = g.lengths.slice();
    L[i] += eps;
    const p = openTraverse(L, g.azimuth0, g.turnings);
    add((p.x - base.x) / eps, (p.y - base.y) / eps, sigL[i] * sigL[i]);
  }
  const withAngles = angleSigmaRad != null && angleSigmaRad > 0;
  if (withAngles) {
    for (let i = 0; i < g.turnings.length; i++) {
      const t = g.turnings.slice();
      t[i] += eps;
      const p = openTraverse(g.lengths, g.azimuth0, t);
      add((p.x - base.x) / eps, (p.y - base.y) / eps, angleSigmaRad * angleSigmaRad);
    }
  }
  const ell = ellipseFrom2x2(Q[0][0], Q[0][1], Q[1][1]);
  let chi2: number | null = null;
  let pass: boolean | null = null;
  if (withAngles && misclosure) {
    chi2 = misclosureChi2(Q, misclosure);
    pass = chi2 <= CHI2_2_95;
  }
  return {
    hasTraverseMisclosure: withAngles,
    qM: Q,
    semiMajor95M: ell.major95M,
    semiMinor95M: ell.minor95M,
    chi2,
    pass,
  };
}

export interface AngleSumCheck {
  /** Σα − (n−2)π, radians. */
  misclosureRad: number;
  /** 1.96 σ √n, radians. */
  limitRad: number;
  pass: boolean;
}

/**
 * Interior-angle condition when all n corners were measured.
 * |Σα − (n−2)π| ≤ 1.96 σ √n. This sits beside the 2D Q_m test; it is not
 * replaced by it. A 1° error on the datum corner is invisible to Q_m.
 */
export function angleSumCheck(interiorAnglesRad: number[], sigmaRad: number): AngleSumCheck {
  const n = interiorAnglesRad.length;
  const expect = (n - 2) * Math.PI;
  const sum = interiorAnglesRad.reduce((s, a) => s + a, 0);
  const misclosureRad = wrap(sum - expect);
  const limitRad = 1.96 * sigmaRad * Math.sqrt(n);
  return {
    misclosureRad,
    limitRad,
    pass: Math.abs(misclosureRad) <= limitRad + 1e-15,
  };
}

export function misclosureChi2(q: [[number, number], [number, number]], m: Xy): number {
  const det = q[0][0] * q[1][1] - q[0][1] * q[1][0];
  if (!(Math.abs(det) > 0)) return Infinity;
  const ixx = q[1][1] / det;
  const ixy = -q[0][1] / det;
  const iyy = q[0][0] / det;
  return m.x * m.x * ixx + 2 * m.x * m.y * ixy + m.y * m.y * iyy;
}
