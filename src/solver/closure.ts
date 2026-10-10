/**
 * Duplicate-point closure report.
 *
 * The closing observations are solved on copies of the start marks (C1′, C2′,
 * H1′). The datum stays on the originals. Raw |w| is mostly the open-chain
 * fx uncertainty, so it is not a blunder test. The tests are the 2-D
 * position χ² (wᵀ Q⁻¹ w against χ²(2) = 5.99), the azimuth z-test |az|/σ
 * against 1.96, and the closure χ² = dᵀ Q_d⁺ d against χ²(rank).
 */

import { CHI2_2_95, Z_95 } from './constants';
import { jacobiEigen, zeros } from './linalg';
import { chi2Ppf, ellipseFrom2x2, nees2 } from './stats';
import type { SolveResult } from './types';

export interface ClosurePair {
  /** Original point, for example C1. */
  id: string;
  /** Duplicate that received the closing observations, for example C1′. */
  duplicateId: string;
}

export interface ClosureRequest {
  pairs: ClosurePair[];
  /**
   * Last mark of the open chain. Along-track points from this mark back to
   * the start: u = (start − from) / |start − from|.
   */
  fromId: string;
  /** Start mark. Defaults to the datum origin. */
  startId?: string;
  /** Next mark, for the azimuth misclosure. Defaults to the datum axis point. */
  axisId?: string;
}

export interface ClosureReport {
  /** Duplicate start minus original start, metres. */
  positionM: { x: number; y: number };
  /** Components of `positionM` along and across the return to the start. */
  alongM: number;
  acrossM: number;
  /** az(start′ → axis′) − az(start → axis), radians. */
  azimuthRad: number;
  sigmaAlongM: number;
  sigmaAcrossM: number;
  sigmaAzimuthRad: number;
  /** 95% semi-major of the 2D position misclosure, metres. */
  position95M: number;
  /** 1.96 σ of the azimuth, radians. */
  azimuth95Rad: number;
  /** A-priori 3×3 cofactor of (wx, wy, azimuth). */
  qW: number[][];
  /**
   * 2-D position test, χ²(2): wᵀ Q_w⁻¹ w. Passes at 5.99. This is not a
   * one-dimensional w-test. The azimuth check below is a z-test.
   */
  positionW2: number;
  positionLimit: number;
  positionPass: boolean;
  /** Azimuth z-test: |azimuth| / σ. Passes at 1.96. */
  azimuthStandardised: number;
  azimuthLimit: number;
  azimuthPass: boolean;
  /** dᵀ Q_d⁺ d over every duplicate. */
  chi2: number;
  rank: number;
  chi2Limit95: number;
  chi2Pass: boolean;
  /** Plane distance |w|. Mostly fx. Not a blunder test. */
  rawMisclosureM: number;
  rawMisclosureIsBlunderTest: false;
  /** Duplicate minus original, x then y, in `pairs` order. */
  d: number[];
  /**
   * Pseudoinverse of Q_d, same order as `d`. A Monte Carlo trial reuses this
   * from the noise-free solve. Rebuilding it from each noisy covariance is
   * not the χ²(rank) test.
   */
  qDPlus: number[][];
}

interface Xy {
  x: number;
  y: number;
}

interface Slot {
  id: string;
  axis: 'x' | 'y';
}

function pointXy(result: SolveResult, id: string, originId: string, axisId: string): Xy | null {
  if (id === originId) return { x: 0, y: 0 };
  const p = result.points.find((q) => q.id === id);
  if (!p || p.x == null || p.y == null) return null;
  if (id === axisId) return { x: p.x, y: 0 };
  return { x: p.x, y: p.y };
}

function slotsFor(ids: string[], axisId: string): Slot[] {
  const slots: Slot[] = [];
  for (const id of ids) {
    slots.push({ id, axis: 'x' });
    if (id !== axisId) slots.push({ id, axis: 'y' });
  }
  return slots;
}

function slotIndex(slots: Slot[], id: string, axis: 'x' | 'y'): number {
  return slots.findIndex((s) => s.id === id && s.axis === axis);
}

function matMul(a: number[][], b: number[][]): number[][] {
  const n = a.length;
  const p = b.length;
  const m = b[0]?.length ?? 0;
  const c = zeros(n, m);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < p; k++) {
      const aik = a[i][k];
      if (aik === 0) continue;
      for (let j = 0; j < m; j++) c[i][j] += aik * b[k][j];
    }
  }
  return c;
}

function transpose(a: number[][]): number[][] {
  const n = a.length;
  const m = a[0]?.length ?? 0;
  const t = zeros(m, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) t[j][i] = a[i][j];
  return t;
}

/** Eigen-pseudoinverse. Eigenvalues below 1e-10 of the largest are zero. */
export function pseudoinverse(q: number[][]): { inv: number[][]; rank: number } {
  const eigen = jacobiEigen(q);
  const max = Math.max(...eigen.values.map((v) => Math.abs(v)), 0);
  const tol = Math.max(1e-12, 1e-10 * max);
  const n = q.length;
  const inv = zeros(n, n);
  let rank = 0;
  for (let k = 0; k < n; k++) {
    const lam = eigen.values[k];
    if (!(lam > tol)) continue;
    rank += 1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) inv[i][j] += (eigen.vectors[i][k] * eigen.vectors[j][k]) / lam;
    }
  }
  return { inv, rank };
}

export function closureChi2(d: number[], qDPlus: number[][]): number {
  let chi = 0;
  for (let i = 0; i < d.length; i++) {
    let row = 0;
    for (let j = 0; j < d.length; j++) row += qDPlus[i][j] * d[j];
    chi += d[i] * row;
  }
  return chi;
}

function fixed(id: string, axis: 'x' | 'y', originId: string, axisId: string): boolean {
  return id === originId || (id === axisId && axis === 'y');
}

/**
 * d = x′ − x stacked over the pairs. Null when a point or the cofactor is missing.
 * The vector does not need Q, so a Monte Carlo trial can form it from a noisy solve.
 */
export function duplicateMisclosure(result: SolveResult, request: ClosureRequest): number[] | null {
  const originId = result.datum.originId;
  const axisId = result.datum.axisPointId;
  const d: number[] = [];
  for (const pair of request.pairs) {
    const dup = pointXy(result, pair.duplicateId, originId, axisId);
    const orig = pointXy(result, pair.id, originId, axisId);
    if (!dup || !orig) return null;
    d.push(dup.x - orig.x, dup.y - orig.y);
  }
  return d;
}

/**
 * Closure of a solve whose closing shots were given to duplicate points.
 * Null when a named point is unset or the normal matrix was not inverted.
 */
export function closureReport(result: SolveResult, request: ClosureRequest): ClosureReport | null {
  const originId = result.datum.originId;
  const datumAxis = result.datum.axisPointId;
  const startId = request.startId ?? originId;
  const axisId = request.axisId ?? datumAxis;
  const startPair = request.pairs.find((p) => p.id === startId);
  const axisPair = request.pairs.find((p) => p.id === axisId);
  if (!startPair || !axisPair || request.pairs.length === 0) return null;

  const ids: string[] = [];
  const addId = (id: string) => {
    if (id !== originId && !ids.includes(id)) ids.push(id);
  };
  for (const pair of request.pairs) {
    addId(pair.duplicateId);
    addId(pair.id);
  }
  const slots = slotsFor(ids, datumAxis);
  const qPoints = result.jointCofactor(ids);
  if (!qPoints || qPoints.length !== slots.length) return null;

  const start = pointXy(result, startId, originId, datumAxis);
  const axis = pointXy(result, axisId, originId, datumAxis);
  const startDup = pointXy(result, startPair.duplicateId, originId, datumAxis);
  const axisDup = pointXy(result, axisPair.duplicateId, originId, datumAxis);
  const from = pointXy(result, request.fromId, originId, datumAxis);
  if (!start || !axis || !startDup || !axisDup || !from) return null;

  const d = duplicateMisclosure(result, request);
  if (!d) return null;

  const G: number[][] = [];
  for (const pair of request.pairs) {
    for (const axisName of ['x', 'y'] as const) {
      const row = slots.map(() => 0);
      const di = slotIndex(slots, pair.duplicateId, axisName);
      if (di >= 0) row[di] = 1;
      if (!fixed(pair.id, axisName, originId, datumAxis)) {
        const oi = slotIndex(slots, pair.id, axisName);
        if (oi >= 0) row[oi] = -1;
      }
      G.push(row);
    }
  }

  const qD = matMul(matMul(G, qPoints), transpose(G));
  const { inv: qDPlus, rank } = pseudoinverse(qD);
  const chi2 = closureChi2(d, qDPlus);
  const limit = rank > 0 ? chi2Ppf(0.95, rank) : 0;

  const az = (a: Xy, b: Xy) => Math.atan2(b.y - a.y, b.x - a.x);
  const azJacobian = (fromId: string, toId: string, a: Xy, b: Xy): number[] => {
    const row = slots.map(() => 0);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const r2 = dx * dx + dy * dy || 1e-18;
    const add = (id: string, axisName: 'x' | 'y', value: number) => {
      if (fixed(id, axisName, originId, datumAxis)) return;
      const i = slotIndex(slots, id, axisName);
      if (i >= 0) row[i] += value;
    };
    add(toId, 'x', -dy / r2);
    add(toId, 'y', dx / r2);
    add(fromId, 'x', dy / r2);
    add(fromId, 'y', -dx / r2);
    return row;
  };
  const gDup = azJacobian(startPair.duplicateId, axisPair.duplicateId, startDup, axisDup);
  const gOrig = azJacobian(startId, axisId, start, axis);
  const gAz = gDup.map((v, i) => v - gOrig[i]);
  const gPos: number[][] = [
    slots.map(() => 0),
    slots.map(() => 0),
    gAz,
  ];
  const ix = slotIndex(slots, startPair.duplicateId, 'x');
  const iy = slotIndex(slots, startPair.duplicateId, 'y');
  if (ix >= 0) gPos[0][ix] = 1;
  if (iy >= 0) gPos[1][iy] = 1;
  if (!fixed(startId, 'x', originId, datumAxis)) {
    const j = slotIndex(slots, startId, 'x');
    if (j >= 0) gPos[0][j] = -1;
  }
  if (!fixed(startId, 'y', originId, datumAxis)) {
    const j = slotIndex(slots, startId, 'y');
    if (j >= 0) gPos[1][j] = -1;
  }
  const qW = matMul(matMul(gPos, qPoints), transpose(gPos));

  const wx = startDup.x - start.x;
  const wy = startDup.y - start.y;
  const waz = Math.atan2(Math.sin(az(startDup, axisDup) - az(start, axis)), Math.cos(az(startDup, axisDup) - az(start, axis)));
  const span = Math.hypot(start.x - from.x, start.y - from.y);
  if (!(span > 1e-9)) return null;
  const ux = (start.x - from.x) / span;
  const uy = (start.y - from.y) / span;
  const vx = -uy;
  const vy = ux;
  const along = ux * wx + uy * wy;
  const across = vx * wx + vy * wy;
  const qxx = qW[0][0];
  const qxy = qW[0][1];
  const qyy = qW[1][1];
  const r00 = ux * qxx + uy * qxy;
  const r01 = ux * qxy + uy * qyy;
  const r10 = vx * qxx + vy * qxy;
  const r11 = vx * qxy + vy * qyy;
  const sigmaAlong = Math.sqrt(Math.max(0, r00 * ux + r01 * uy));
  const sigmaAcross = Math.sqrt(Math.max(0, r10 * vx + r11 * vy));
  const sigmaAz = Math.sqrt(Math.max(0, qW[2][2]));
  const ell = ellipseFrom2x2(qxx, qxy, qyy);
  const positionW2 = nees2(wx, wy, qxx, qxy, qyy);
  const azimuthStandardised = sigmaAz > 0 ? Math.abs(waz) / sigmaAz : Infinity;

  return {
    positionM: { x: wx, y: wy },
    alongM: along,
    acrossM: across,
    azimuthRad: waz,
    sigmaAlongM: sigmaAlong,
    sigmaAcrossM: sigmaAcross,
    sigmaAzimuthRad: sigmaAz,
    position95M: ell.major95M,
    azimuth95Rad: Z_95 * sigmaAz,
    qW,
    positionW2,
    positionLimit: CHI2_2_95,
    positionPass: positionW2 <= CHI2_2_95,
    azimuthStandardised,
    azimuthLimit: Z_95,
    azimuthPass: azimuthStandardised <= Z_95,
    chi2,
    rank,
    chi2Limit95: limit,
    chi2Pass: chi2 <= limit,
    rawMisclosureM: Math.hypot(wx, wy),
    rawMisclosureIsBlunderTest: false,
    d,
    qDPlus,
  };
}
