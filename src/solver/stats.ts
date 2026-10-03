/** χ², error ellipses, and the variance-factor test. */

import { ELLIPSE_95, VARIANCE_TEST_ALPHA } from './constants';
import { eigen2 } from './linalg';

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < LANCZOS.length; i++) x += LANCZOS[i] / (z + i + 1);
  const t = z + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Lower regularised gamma P(s, x) = γ(s, x) / Γ(s). */
export function gammaP(s: number, x: number): number {
  if (x <= 0) return 0;
  if (x < s + 1) {
    let term = 1 / s;
    let sum = term;
    for (let n = 1; n < 300; n++) {
      term *= x / (s + n);
      sum += term;
      if (term < sum * 1e-15) break;
    }
    return Math.max(0, Math.min(1, sum * Math.exp(-x + s * Math.log(x) - logGamma(s))));
  }
  // Lentz continued fraction for the upper incomplete gamma, then 1 − Q.
  let b = x + 1 - s;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let f = d;
  for (let i = 1; i < 300; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  const q = Math.exp(-x + s * Math.log(x) - logGamma(s)) * f;
  return Math.max(0, Math.min(1, 1 - q));
}

/** Cumulative distribution P(χ²_k ≤ x). */
export function chi2Cdf(x: number, k: number): number {
  if (x <= 0) return 0;
  return gammaP(k / 2, x / 2);
}

/** Quantile. Bisection on the CDF. */
export function chi2Ppf(p: number, k: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  let lo = 0;
  let hi = Math.max(1, k + 20 * Math.sqrt(k));
  while (chi2Cdf(hi, k) < p) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (chi2Cdf(mid, k) < p) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export type VarianceTest = 'ok' | 'high' | 'low' | 'undefined';

/**
 * One-sided upper-tail test of vᵀPv against χ²(dof) at `alpha` (default 5%).
 * `low` is information only: the σ's may be conservative. It is not a warning
 * and it does not withhold a point.
 */
export function varianceFactorTest(
  vPv: number,
  dof: number,
  alpha = VARIANCE_TEST_ALPHA,
): { result: VarianceTest; low: number | null; high: number | null } {
  if (!(dof > 0) || !Number.isFinite(vPv)) {
    return { result: 'undefined', low: null, high: null };
  }
  const low = chi2Ppf(alpha, dof);
  const high = chi2Ppf(1 - alpha, dof);
  if (vPv > high) return { result: 'high', low, high };
  if (vPv < low) return { result: 'low', low, high };
  return { result: 'ok', low, high };
}

export interface Ellipse {
  /** 1σ semi-major, metres. */
  major1M: number;
  /** 1σ semi-minor, metres. */
  minor1M: number;
  /** 95% semi-major, metres. */
  major95M: number;
  /** 95% semi-minor, metres. */
  minor95M: number;
  /** Azimuth of the 1σ major axis, radians from +X. */
  azimuthRad: number;
}

export function ellipseFrom2x2(qxx: number, qxy: number, qyy: number): Ellipse {
  const [lHi, lLo] = eigen2(qxx, qxy, qyy);
  const major1 = Math.sqrt(Math.max(0, lHi));
  const minor1 = Math.sqrt(Math.max(0, lLo));
  let azimuth = 0;
  const lam = lHi;
  if (Math.abs(qxy) > 1e-18) {
    azimuth = Math.atan2(lam - qxx, qxy);
  } else if (qyy > qxx) {
    azimuth = Math.PI / 2;
  }
  return {
    major1M: major1,
    minor1M: minor1,
    major95M: ELLIPSE_95 * major1,
    minor95M: ELLIPSE_95 * minor1,
    azimuthRad: azimuth,
  };
}

/** Squared Mahalanobis distance of a 2-vector under a 2×2 covariance. */
export function nees2(dx: number, dy: number, qxx: number, qxy: number, qyy: number): number {
  const det = qxx * qyy - qxy * qxy;
  if (!(det > 0)) return Infinity;
  return (dy * dy * qxx - 2 * dx * dy * qxy + dx * dx * qyy) / det;
}
