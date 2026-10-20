/**
 * Whole-photo sleeve detection (docs/marker-detection.md). Pure TypeScript on typed arrays so it
 * runs in a Web Worker (sleeveScan.worker.ts) and in tests.
 *
 * Stage A, on a ×2 downscale in linear light: per row, the horizontal gradient; opposite-sign edge
 * pairs (the two silhouette edges of a sleeve); pairs chained down the image into vertical tracks
 * of near-constant centre and width; each track scored by the vertical periodicity of its column
 * (1D autocorrelation of |∂y| in a sliding window). A sleeve is 60.4 mm wide and its bands are
 * 13 mm, so its width is 4.65 band pitches: the track width must be 4.65 ± 25 % of the pitch.
 *
 * Stage B, on full-resolution strips: the existing detectSleeve path reads the code, then the
 * false-positive gates (exact codeword, sync and stop, grid RMS ≤ 0.25 band, width / pitch
 * 4.65 ± 20 %, ID in this garden's set, each ID once per photo) and the bearing: axis x at
 * mid-code height as the midpoint of the two linear-light silhouette edges, plus tilt.
 */

import { BANDS, MAX_EDGE_RMS_BANDS, MIN_BAND_PX, detectSleeve, type GreyImage } from './sleeveDetect';

/** Sleeve width over band pitch: 2 × 30.2 mm / 13 mm. */
export const WIDTH_PER_PITCH = 4.65;
/** Stage A tolerance on width / pitch. */
export const STAGE_A_TOL = 0.25;
/** Stage B tolerance on width / pitch. */
export const STAGE_B_TOL = 0.2;
/** Smallest band, px, to detect and read the ID (ray use). Height / fx keeps MIN_BAND_PX (7). */
export const MIN_SCAN_BAND_PX = 4;
export const DEFAULT_BUDGET_MS = 2000;
/** Least even code fill across the silhouette (see codeCoverage). */
const MIN_CODE_COVERAGE = 0.3;
/** Largest spread of the axis between evenly filled silhouette reads, px. */
const MAX_AXIS_SPREAD_PX = 0.5;

export interface ScanOptions {
  /** This garden's sleeve IDs (3 hex digits). Any other ID is rejected. */
  markerIds: string[];
  /** Time cap. Past it the scan stops and returns what it has, with partial = true. */
  budgetMs?: number;
  now?: () => number;
}

export interface ScannedSleeve {
  id: string;
  /** Stick axis x at mid-code height, full-res pixel-edge coordinates, sub-pixel. */
  axisX: number;
  /** Mid-code height (y of the axis point). */
  midY: number;
  /** Lean of the axis from vertical, degrees, + = top leans left (x grows down the stick). */
  tiltDeg: number;
  /** dx/dy of the axis. */
  slope: number;
  bandPx: number;
  codeTopY: number;
  codeBottomY: number;
  /** Silhouette width across the axis. */
  widthPx: number;
  edgeRmsBands: number;
  confidence: number;
  /** Bands under 7 px: fine for the ray, not for height / focal length. */
  notForCal: boolean;
  /** How evenly the code fills the silhouette (0–1); picks between two reads of one sleeve. */
  codeCoverage: number;
}

export interface ScanResult {
  sleeves: ScannedSleeve[];
  /** IDs seen more than once: none of them is used; the user marks them by hand. */
  duplicates: string[];
  candidates: number;
  rejected: number;
  partial: boolean;
  ms: number;
}

const LIN = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return t;
})();

function lin(v: number): number {
  if (!(v > 0)) return 0;
  if (v >= 255) return 1;
  const i = v | 0;
  return LIN[i] + (LIN[Math.min(255, i + 1)] - LIN[i]) * (v - i);
}

/** ×2 downscale in linear light (box average of 2 × 2). */
export function downscaleLinear(img: GreyImage): { w: number; h: number; d: Float32Array } {
  const w = img.width >> 1;
  const h = img.height >> 1;
  const d = new Float32Array(w * h);
  const g = img.grey;
  const W = img.width;
  for (let y = 0; y < h; y += 1) {
    const r0 = 2 * y * W;
    const r1 = r0 + W;
    for (let x = 0; x < w; x += 1) {
      const c = 2 * x;
      d[y * w + x] = 0.25 * (lin(g[r0 + c]) + lin(g[r0 + c + 1]) + lin(g[r1 + c]) + lin(g[r1 + c + 1]));
    }
  }
  return { w, h, d };
}

interface Track {
  rows: number[];
  centres: number[];
  widths: number[];
  lastRow: number;
  centre: number;
  width: number;
}

export interface StageACandidate {
  /** Full-res centre x at mid window, top and bottom y of the periodic window, pitch, width. */
  cx: number;
  slope: number;
  y0: number;
  y1: number;
  pitch: number;
  width: number;
  score: number;
}

const GRAD_MIN = 0.035;
const MIN_W = 3;
const MAX_W = 70;

/** Stage A: candidate sleeve columns on the downscaled image. */
export function stageA(img: GreyImage, deadline = Infinity, now: () => number = Date.now): { cands: StageACandidate[]; partial: boolean } {
  const { w, h, d } = downscaleLinear(img);
  const active: Track[] = [];
  const done: Track[] = [];
  const ext: number[] = [];
  const sgn: number[] = [];
  const mag: number[] = [];
  let partial = false;
  for (let y = 0; y < h; y += 1) {
    if ((y & 31) === 0 && now() > deadline) { partial = true; break; }
    const row = y * w;
    ext.length = 0;
    sgn.length = 0;
    mag.length = 0;
    // Local extrema of the central-difference gradient above a floor.
    let prev = 0;
    let cur = d[row + 2] - d[row];
    for (let x = 1; x < w - 2; x += 1) {
      const next = d[row + x + 2] - d[row + x];
      const a = Math.abs(cur);
      if (a > GRAD_MIN && a >= Math.abs(prev) && a > Math.abs(next)) { ext.push(x); sgn.push(cur > 0 ? 1 : -1); mag.push(a); }
      prev = cur;
      cur = next;
    }
    // Opposite-sign pairs: each extremum with the next extremum of the other sign.
    const segs: Array<{ c: number; w: number }> = [];
    for (let i = 0; i < ext.length; i += 1) {
      const gi = mag[i];
      for (let j = i + 1; j < ext.length; j += 1) {
        const width = ext[j] - ext[i];
        if (width > MAX_W) break;
        // Shading inside the sleeve and texture make weak extrema: skip them.
        if (mag[j] < 0.4 * gi) continue;
        if (sgn[j] === sgn[i]) { if (mag[j] > 1.5 * gi) break; continue; }
        if (gi < 0.4 * mag[j]) break;
        if (width >= MIN_W) segs.push({ c: (ext[i] + ext[j]) / 2 + 0.5, w: width });
        break;
      }
    }
    // Extend tracks.
    const used = new Uint8Array(segs.length);
    for (const t of active) {
      let best = -1;
      let bestD = Infinity;
      for (let k = 0; k < segs.length; k += 1) {
        if (used[k]) continue;
        const dc = Math.abs(segs[k].c - t.centre);
        const dw = Math.abs(segs[k].w - t.width);
        if (dc <= 1.5 + 0.1 * t.width && dw <= 1.5 + 0.2 * t.width && dc < bestD) { best = k; bestD = dc; }
      }
      if (best >= 0) {
        used[best] = 1;
        t.rows.push(y);
        t.centres.push(segs[best].c);
        t.widths.push(segs[best].w);
        t.lastRow = y;
        t.centre = 0.7 * t.centre + 0.3 * segs[best].c;
        t.width = 0.8 * t.width + 0.2 * segs[best].w;
      }
    }
    for (let k = active.length - 1; k >= 0; k -= 1) {
      const t = active[k];
      if (y - t.lastRow > Math.max(4, 0.6 * t.width)) { done.push(t); active.splice(k, 1); }
    }
    for (let k = 0; k < segs.length; k += 1) {
      if (used[k]) continue;
      active.push({ rows: [y], centres: [segs[k].c], widths: [segs[k].w], lastRow: y, centre: segs[k].c, width: segs[k].w });
    }
    if (active.length > 4000) active.splice(0, active.length - 4000);
  }
  done.push(...active);

  const cands: StageACandidate[] = [];
  for (const t of done) {
    const wMed = medianOf(t.widths);
    const span = t.lastRow - t.rows[0];
    // The code alone is 19 pitches = 4.09 widths tall; allow foliage to hide part of it.
    if (t.rows.length < 8 || span < 2.2 * wMed) continue;
    if (t.rows.length < 0.4 * span) continue;
    const fit = lineFit(t.rows, t.centres);
    if (Math.abs(fit.b) > 0.25) continue;
    const per = periodicity(d, w, h, fit, t.rows[0], t.lastRow, wMed);
    if (!per) continue;
    cands.push({
      cx: 2 * (fit.a + fit.b * ((per.y0 + per.y1) / 2)),
      slope: fit.b,
      y0: 2 * per.y0,
      y1: 2 * per.y1,
      pitch: 2 * per.pitch,
      width: 2 * wMed,
      score: per.score,
    });
  }
  // Merge candidates on the same stick (keep the best).
  cands.sort((p, q) => q.score - p.score);
  const kept: StageACandidate[] = [];
  for (const c of cands) {
    const dup = kept.some((k) => Math.abs(k.cx - c.cx) < 0.25 * Math.max(k.width, c.width) && Math.abs(k.width - c.width) < 0.25 * Math.max(k.width, c.width) && c.y0 < k.y1 && c.y1 > k.y0);
    if (!dup) kept.push(c);
  }
  return { cands: kept, partial };
}

function medianOf(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function lineFit(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i += 1) { mx += xs[i]; my += ys[i]; }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxx > 0 ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

/**
 * Column vertical-periodicity score: |∂y| of the linear profile down the track, mean removed,
 * normalised autocorrelation at lags around the pitch the width predicts (width / 4.65 ± 25 %),
 * in a sliding window ~20 pitches long. Best window and lag win.
 */
function periodicity(
  d: Float32Array,
  w: number,
  h: number,
  fit: { a: number; b: number },
  r0: number,
  r1: number,
  width: number,
): { score: number; pitch: number; y0: number; y1: number } | undefined {
  const p0 = width / WIDTH_PER_PITCH;
  const pad = Math.ceil(3 * p0);
  const ya = Math.max(0, r0 - pad);
  const yb = Math.min(h - 1, r1 + pad);
  const n = yb - ya + 1;
  const half = Math.max(0.5, 0.2 * width);
  const prof = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const y = ya + i;
    const xc = fit.a + fit.b * y;
    const x0 = Math.max(0, Math.ceil(xc - half - 0.5));
    const x1 = Math.min(w - 1, Math.floor(xc + half - 0.5));
    let s = 0;
    let c = 0;
    for (let x = x0; x <= x1; x += 1) { s += d[y * w + x]; c += 1; }
    prof[i] = c ? s / c : 0;
  }
  const g = new Float32Array(n);
  for (let i = 1; i < n - 1; i += 1) g[i] = Math.abs(prof[i + 1] - prof[i - 1]);
  const win = Math.max(8, Math.round(20 * p0));
  const step = Math.max(1, Math.round(p0));
  const lagLo = p0 * (1 - STAGE_A_TOL);
  const lagHi = p0 * (1 + STAGE_A_TOL);
  let best: { score: number; pitch: number; y0: number; y1: number } | undefined;
  for (let s0 = 0; s0 + Math.min(win, n) <= n; s0 += step) {
    const e0 = Math.min(n, s0 + win);
    let mean = 0;
    for (let i = s0; i < e0; i += 1) mean += g[i];
    mean /= e0 - s0;
    let den = 0;
    for (let i = s0; i < e0; i += 1) den += (g[i] - mean) ** 2;
    if (den <= 1e-9) continue;
    // Contrast floor: a code has strong edges, a plain slat does not.
    if (mean < 0.004) continue;
    const acf = (lag: number): number => {
      const L = Math.floor(lag);
      const f = lag - L;
      let num = 0;
      for (let i = s0; i + L + 1 < e0; i += 1) {
        const shifted = g[i + L] * (1 - f) + g[i + L + 1] * f;
        num += (g[i] - mean) * (shifted - mean);
      }
      return num / den;
    };
    for (let lag = lagLo; lag <= lagHi + 1e-9; lag += 0.25) {
      // Band edges sit on a lattice of the pitch, but a code with few single-band runs has
      // few edge pairs exactly one pitch apart: take the best of the first three multiples.
      const score = Math.max(acf(lag), 0.6 * Math.max(acf(2 * lag), acf(3 * lag)));
      if (!best || score > best.score) best = { score, pitch: lag, y0: ya + s0, y1: ya + e0 };
    }
    if (e0 === n) break;
  }
  if (!best || best.score < 0.1) return undefined;
  return best;
}

/** Strip of the full-res image, copied (small). */
function strip(img: GreyImage, x0: number, y0: number, x1: number, y1: number): GreyImage {
  const xa = Math.max(0, Math.floor(x0));
  const ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(img.width, Math.ceil(x1));
  const yb = Math.min(img.height, Math.ceil(y1));
  const sw = Math.max(1, xb - xa);
  const sh = Math.max(1, yb - ya);
  const grey = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y += 1) for (let x = 0; x < sw; x += 1) grey[y * sw + x] = img.grey[(ya + y) * img.width + xa + x];
  return Object.assign({ width: sw, height: sh, grey }, { ox: xa, oy: ya });
}

/** The strip sheared by -slope about row y0, so a leaning sleeve reads as upright. */
function deskew(s: GreyImage, slope: number, y0: number): GreyImage {
  if (Math.abs(slope) < 0.02) return s;
  const { width: w, height: h } = s;
  const grey = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const dx = slope * (y + 0.5 - y0);
    const fl = Math.floor(dx);
    const fr = dx - fl;
    for (let x = 0; x < w; x += 1) {
      const xa = Math.min(w - 1, Math.max(0, x + fl));
      const xb = Math.min(w - 1, Math.max(0, x + fl + 1));
      grey[y * w + x] = s.grey[y * w + xa] * (1 - fr) + s.grey[y * w + xb] * fr;
    }
  }
  return { width: w, height: h, grey };
}

/** Sub-pixel position (pixel-edge coords) of the largest |∂x| in [xa, xb] on one linear row. */
function edgeWithStrength(row: Float32Array, xa: number, xb: number, xe?: number): { x: number; g: number } | undefined {
  const lo = Math.max(2, Math.floor(xa));
  const hi = Math.min(row.length - 3, Math.ceil(xb));
  const gAt = (x: number) => Math.abs(row[x + 1] - row[x - 1]);
  let bv = 0;
  for (let x = lo; x <= hi; x += 1) bv = Math.max(bv, gAt(x));
  if (bv <= 0) return undefined;
  // Local peaks at least half the strongest; nearest to the expected position wins
  // (a stripe edge a few px away must not capture the silhouette).
  let bi = -1;
  let bd = Infinity;
  for (let x = lo; x <= hi; x += 1) {
    const v = gAt(x);
    if (v < 0.5 * bv || v < gAt(x - 1) || v < gAt(x + 1)) continue;
    const dist = xe === undefined ? -v : Math.abs(x + 0.5 - xe);
    if (dist < bd) { bd = dist; bi = x; }
  }
  if (bi < 2) return undefined;
  const v = gAt(bi);
  const a = Math.abs(row[bi] - row[bi - 2]);
  const c = Math.abs(row[bi + 2] - row[bi]);
  const den = a - 2 * v + c;
  const off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  return { x: bi + 0.5 + off, g: v };
}

/** Robust line fit: drop weak edges, then one round of residual rejection. */
function robustEdgeLine(ys: number[], xs: number[], gs: number[]): { a: number; b: number; n: number } | undefined {
  const gMed = medianOf(gs);
  const i1 = ys.map((_, i) => i).filter((i) => gs[i] >= 0.35 * gMed);
  if (i1.length < 4) return undefined;
  let fit = lineFit(i1.map((i) => ys[i]), i1.map((i) => xs[i]));
  const res = i1.map((i) => Math.abs(xs[i] - (fit.a + fit.b * ys[i])));
  const lim = Math.max(0.6, 3 * medianOf(res));
  const i2 = i1.filter((_, k) => res[k] <= lim);
  if (i2.length < 4 || i2.length < 0.5 * i1.length) return undefined;
  fit = lineFit(i2.map((i) => ys[i]), i2.map((i) => xs[i]));
  return { a: fit.a, b: fit.b, n: i2.length };
}

/**
 * Bearing on the full-res strip: silhouette edges on the white-band rows (well inside each band),
 * midpoints fitted with a line x = a + b·y, read at mid-code height.
 */
function bearing(
  s: GreyImage,
  det: { codeTopY: number; codeBottomY: number; bits: string; modulePx: number },
  guide: { x0: number; y0: number; slope: number },
): { axisX: number; midY: number; slope: number; widthPx: number; n: number } | undefined {
  const pitchY = (det.codeBottomY - det.codeTopY) / BANDS;
  const midY = (det.codeTopY + det.codeBottomY) / 2;
  const row = new Float32Array(s.width);
  // Rows well inside every band (black and white): whichever band contrasts with the
  // background gives the silhouette, so a background matching one band colour cannot hide it.
  const rowsY: number[] = [];
  for (let k = 0; k < BANDS; k += 1) {
    const ya = Math.ceil(det.codeTopY + (k + 0.25) * pitchY);
    const yb = Math.floor(det.codeTopY + (k + 0.75) * pitchY);
    for (let y = ya; y <= yb; y += 1) if (y >= 0 && y < s.height) rowsY.push(y);
  }
  // Two passes: around the guide line, then around the first fit. The expected
  // half-width comes from the band pitch, so stripes beside the sleeve are not taken.
  let line = { a: guide.x0 - guide.slope * guide.y0, b: guide.slope };
  let out: { axisX: number; midY: number; slope: number; widthPx: number; n: number } | undefined;
  for (const tol of [0.25, 0.12, 0.08]) {
    const halfW = (WIDTH_PER_PITCH * det.modulePx * Math.hypot(1, line.b)) / 2;
    const slack = tol * halfW + 1;
    const ly: number[] = []; const lx: number[] = []; const lg: number[] = [];
    const ry: number[] = []; const rx: number[] = []; const rg: number[] = [];
    for (const y of rowsY) {
      for (let x = 0; x < s.width; x += 1) row[x] = lin(s.grey[y * s.width + x]);
      const xc = line.a + line.b * (y + 0.5);
      const xe = tol < 0.2 ? 1 : undefined;
      const l = edgeWithStrength(row, xc - halfW - slack - 0.5, xc - halfW + slack - 0.5, xe && xc - halfW);
      const r = edgeWithStrength(row, xc + halfW - slack - 0.5, xc + halfW + slack - 0.5, xe && xc + halfW);
      if (l) { ly.push(y + 0.5); lx.push(l.x); lg.push(l.g); }
      if (r) { ry.push(y + 0.5); rx.push(r.x); rg.push(r.g); }
    }
    const L = robustEdgeLine(ly, lx, lg);
    const R = robustEdgeLine(ry, rx, rg);
    if (!L || !R) return undefined;
    const xl = L.a + L.b * midY;
    const xr = R.a + R.b * midY;
    // Loose on the first passes; on the last, a width off by more than 5 % means one edge is
    // on the background, so the axis cannot be trusted to a fraction of a pixel.
    if (Math.abs((xr - xl) / (2 * halfW) - 1) > (tol < 0.1 ? 0.05 : 0.15)) return undefined;
    line = { a: (L.a + R.a) / 2, b: (L.b + R.b) / 2 };
    out = { axisX: (xl + xr) / 2, midY, slope: line.b, widthPx: xr - xl, n: Math.min(L.n, R.n) };
  }
  return out;
}

/**
 * How evenly the code fills the fitted silhouette: band contrast (white rows − black rows) in
 * 9 columns across ±0.8 of the half-width, as min / max. A silhouette taken from a background
 * edge leaves some of those columns off the sleeve, so the ratio collapses.
 */
function codeCoverage(
  s: GreyImage,
  det: { codeTopY: number; codeBottomY: number; bits: string },
  b: { axisX: number; midY: number; slope: number; widthPx: number },
): number {
  const pitchY = (det.codeBottomY - det.codeTopY) / BANDS;
  const half = b.widthPx / 2;
  const cs: number[] = [];
  for (let k = -4; k <= 4; k += 1) {
    const u = (k / 4) * 0.8 * half;
    let w = 0; let nw = 0; let bl = 0; let nb = 0;
    for (let i = 0; i < BANDS; i += 1) {
      const ya = Math.ceil(det.codeTopY + (i + 0.3) * pitchY);
      const yb = Math.floor(det.codeTopY + (i + 0.7) * pitchY);
      for (let y = ya; y <= yb; y += 1) {
        if (y < 0 || y >= s.height) continue;
        const x = Math.round(b.axisX + b.slope * (y + 0.5 - b.midY) + u - 0.5);
        if (x < 0 || x >= s.width) continue;
        const v = lin(s.grey[y * s.width + x]);
        if (det.bits[i] === '0') { w += v; nw += 1; } else { bl += v; nb += 1; }
      }
    }
    cs.push(nw && nb ? w / nw - bl / nb : 0);
  }
  const mx = Math.max(...cs);
  return mx > 0 ? Math.max(0, Math.min(...cs)) / mx : 0;
}

/** Stage B for one candidate. */
export function refine(
  img: GreyImage,
  c: StageACandidate,
  set: Set<string>,
  thorough = true,
): { sleeve?: ScannedSleeve; reason?: string } {
  const codeH = c.y1 - c.y0;
  const mid = (c.y0 + c.y1) / 2;
  // Stage A may see only part of the code (stripes behind it), so reach by the expected code height too.
  const reach = Math.max(codeH * 1.2, 1.3 * BANDS * c.pitch);
  const ya = mid - reach;
  const yb = mid + reach;
  const drift = (Math.abs(c.slope) + 0.12) * reach;
  const xa = c.cx - 1.6 * c.width - drift;
  const xb = c.cx + 1.6 * c.width + drift;
  const s = strip(img, xa, ya, xb, yb) as GreyImage & { ox: number; oy: number };
  // Read the code on a deskewed copy (the reader expects a near-upright sleeve), tapping at
  // the track centre and a little either side of it.
  const midL = mid - s.oy;
  // A track pulled by a striped background can have the wrong lean, so if the first lean
  // does not read, try a lean either side.
  let det: ReturnType<typeof detectSleeve> | undefined;
  let lean = c.slope;
  const leans = thorough ? [c.slope, c.slope - 0.12, c.slope + 0.12] : [c.slope];
  const offs = thorough ? [0, -0.2, 0.2] : [0];
  const dys = thorough ? [0, -0.3, 0.3] : [0];
  const codeExp = BANDS * c.pitch;
  search: for (const sl of leans) {
    if (Math.abs(sl) > 0.3) continue;
    const ds = deskew(s, sl, midL);
    for (const dy of dys) {
      for (const off of offs) {
        const d = detectSleeve(ds, c.cx - s.ox + off * c.width + sl * dy * codeExp, midL + dy * codeExp, { minBandPx: MIN_SCAN_BAND_PX });
        if (d && (!det || (d.id && !det.id))) { det = d; lean = sl; }
        if (det?.id) break search;
      }
    }
  }
  if (!det) return { reason: 'no code' };
  if (!det.id) return { reason: 'not a codeword' };
  if (det.reasons.some((r) => r.includes('sync') || r.includes('stop'))) return { reason: 'sync or stop missing' };
  if (det.confidence <= 0) return { reason: det.reasons.join('; ') || 'rejected' };
  if (det.edgeRmsBands > MAX_EDGE_RMS_BANDS) return { reason: 'grid RMS' };
  if (det.modulePx < MIN_SCAN_BAND_PX) return { reason: 'bands too small' };
  if (!set.has(det.id)) return { reason: `ID ${det.id} not in this garden` };
  // Guide the silhouette search from the code reader's centre and from the Stage A
  // track (a striped background can pull either one sideways); keep the better fit.
  const detMidY = (det.codeTopY + det.codeBottomY) / 2;
  // Back from deskewed to strip coordinates.
  const detX = (det.codeTopX + det.codeBottomX) / 2 + (Math.abs(lean) < 0.02 ? 0 : lean * (detMidY - midL));
  // Guides: the code reader's centre and the Stage A track, each at the reading lean and a
  // little either side (vertical stripes can drag a fit toward upright).
  const guides: { x0: number; y0: number; slope: number }[] = [];
  for (const sl of [lean, lean - 0.05, lean + 0.05]) {
    guides.push({ x0: detX, y0: detMidY, slope: sl }, { x0: c.cx - s.ox, y0: mid - s.oy, slope: sl });
  }
  // The code exists only on the sleeve: keep silhouettes the code fills evenly, and of those
  // the one whose two edges stay straight over the most rows.
  const reads: { r: NonNullable<ReturnType<typeof bearing>>; cov: number }[] = [];
  for (const g of guides) {
    const r = bearing(s, det, g);
    if (r) reads.push({ r, cov: codeCoverage(s, det, r) });
  }
  const bestCov = reads.reduce((m, q) => Math.max(m, q.cov), 0);
  let b: ReturnType<typeof bearing>;
  // Evenly filled reads that disagree on the axis mean a background edge is competing with
  // the silhouette: leave that sleeve to a manual tap rather than give a wrong bearing.
  const good = reads.filter((q) => q.cov >= 0.8 * bestCov);
  if (good.length > 1) {
    const xs = good.map((q) => q.r.axisX);
    if (Math.max(...xs) - Math.min(...xs) > MAX_AXIS_SPREAD_PX) return { reason: 'bearing ambiguous' };
  }
  for (const q of good) if (!b || q.r.n > b.n) b = q.r;
  if (b && bestCov < MIN_CODE_COVERAGE) return { reason: `code coverage ${bestCov.toFixed(2)}` };
  if (!b) return { reason: 'no silhouette' };
  const across = b.widthPx / Math.hypot(1, b.slope);
  const ratio = across / det.modulePx;
  if (Math.abs(ratio / WIDTH_PER_PITCH - 1) > STAGE_B_TOL) return { reason: `width / pitch ${ratio.toFixed(2)}` };
  return {
    sleeve: {
      id: det.id,
      axisX: b.axisX + s.ox,
      midY: b.midY + s.oy,
      slope: b.slope,
      tiltDeg: (Math.atan(b.slope) * 180) / Math.PI,
      bandPx: det.modulePx,
      codeTopY: det.codeTopY + s.oy,
      codeBottomY: det.codeBottomY + s.oy,
      widthPx: across,
      edgeRmsBands: det.edgeRmsBands,
      confidence: det.confidence,
      notForCal: det.modulePx < MIN_BAND_PX,
      codeCoverage: bestCov,
    },
  };
}

/** Both stages. Holds the one full-res grey image it is given; everything else is small. */
export function scanSleeves(img: GreyImage, opts: ScanOptions): ScanResult {
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const t0 = now();
  const deadline = t0 + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const set = new Set(opts.markerIds.map((id) => id.trim().toUpperCase()));
  const a = stageA(img, deadline, now);
  let partial = a.partial;
  const found: ScannedSleeve[] = [];
  let rejected = 0;
  // Pass 1 reads each candidate once; pass 2 retries the rest harder (other leans and taps)
  // while time remains.
  const retry: StageACandidate[] = [];
  const consider = (r: { sleeve?: ScannedSleeve }) => {
    if (!r.sleeve) return false;
    // Same sleeve found twice from two tracks: keep one.
    // Same sleeve read from two tracks (one pulled sideways by the background): the same code
    // rows. Keep the read whose silhouette the code fills best.
    const n = r.sleeve;
    const same = found.findIndex((f) => f.id === n.id
      && Math.abs(f.codeTopY - n.codeTopY) < 2 * f.bandPx && Math.abs(f.codeBottomY - n.codeBottomY) < 2 * f.bandPx
      && Math.abs(f.axisX - n.axisX) < 3 * f.widthPx);
    if (same >= 0) {
      const f = found[same];
      if (n.codeCoverage > f.codeCoverage + 0.02 || (Math.abs(n.codeCoverage - f.codeCoverage) <= 0.02 && n.confidence > f.confidence)) found[same] = n;
    } else found.push(r.sleeve);
    return true;
  };
  for (const c of a.cands) {
    if (now() > deadline) { partial = true; break; }
    if (!consider(refine(img, c, set, false))) retry.push(c);
  }
  for (const c of retry) {
    if (partial || now() > deadline) { partial = true; break; }
    const covered = found.some((f) => Math.abs(f.axisX + f.slope * ((c.y0 + c.y1) / 2 - f.midY) - c.cx) < f.widthPx && c.y0 < f.codeBottomY && c.y1 > f.codeTopY);
    if (covered) { rejected += 1; continue; }
    if (!consider(refine(img, c, set, true))) rejected += 1;
  }
  const counts = new Map<string, number>();
  for (const f of found) counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
  const duplicates = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  return {
    sleeves: found.filter((f) => counts.get(f.id) === 1).sort((p, q) => p.axisX - q.axisX),
    duplicates,
    candidates: a.cands.length,
    rejected,
    partial,
    ms: now() - t0,
  };
}
