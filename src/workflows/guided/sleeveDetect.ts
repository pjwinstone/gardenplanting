/**
 * Find the calibration sleeve's top and bottom edge from one rough tap.
 *
 * The sleeve (docs/MARKER_VISION_DESIGN.md §5) is 287 mm tall. From the top: 9 mm legend, 8 mm white
 * quiet zone, 19 code bands of 13 mm (247 mm), 8 mm quiet zone, 15 mm legend. The code starts with the
 * sync `11110` (the only run of four blacks) and ends with the stop `01`, so it begins and ends on a
 * black edge. We measure those two crisp black edges, not the paper edge against an unknown background,
 * and scale out to the paper: top = codeTop − 17/247 · code, bottom = codeBottom + 23/247 · code.
 *
 * Pure TypeScript on a grey image (full resolution, never the 640 px preview).
 */

export const SLEEVE_H_MM = 287;
export const CODE_MM = 247;
export const CODE_TOP_FROM_TOP_MM = 17;
export const CODE_BOTTOM_FROM_BOTTOM_MM = 23;
export const BANDS = 19;
/** Below this the app asks for manual top and bottom taps. */
export const MIN_CONFIDENCE = 0.6;
/** Hard reject: bands shorter than this cannot be read safely after blur (MARKER_VISION_DESIGN §4). */
export const MIN_BAND_PX = 7;
/** Hard reject: RMS of the band edges about the fitted grid, in bands. */
export const MAX_EDGE_RMS_BANDS = 0.25;
/** Bank-1 codebook (61 words, minimum distance 4). Same list as scripts/markerSleeve.ts PUBLISHED_CODEBOOK. */
export const CODEBOOK_HEX =
  '222 22D 244 24B 271 28E 293 2B4 2DD 2E7 315 31A 36E 389 447 459 46A 474 48B 495 4A6 4CC 4D2 513 51C 525 5B9 637 6BA 6E9 72B 74D 756 88D 896 8A3 8CA 8D1 919 926 94C 952 96B 975 9BA 9C7 A3B A57 B9C BA5 C6D C73 DAC DB7 DC9 DD4 E24 E4E E99 EC5 EE2';
const CODEBOOK = new Set(CODEBOOK_HEX.split(' '));

export interface DetectOptions {
  /** The sleeve's ID (e.g. '315') when the app knows which cane was photographed. A different ID is rejected. */
  expectedId?: string;
  /**
   * Hard band-size gate in px (default MIN_BAND_PX = 7, the height / fx gate). The whole-photo scan
   * passes 4 to read IDs and rays from smaller sleeves; those are flagged not-for-CAL.
   */
  minBandPx?: number;
}

/** sRGB 0–255 to linear light 0–1. */
const LINEAR = (() => {
  const t = new Float64Array(256);
  for (let i = 0; i < 256; i += 1) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return t;
})();
function toLinear(v: number): number {
  if (!(v > 0)) return 0;
  if (v >= 255) return 1;
  const i = Math.floor(v);
  return LINEAR[i] + (LINEAR[Math.min(255, i + 1)] - LINEAR[i]) * (v - i);
}

export interface GreyImage {
  width: number;
  height: number;
  /** Row-major luminance 0–255, length width × height. */
  grey: ArrayLike<number>;
}

export interface SleeveDetection {
  /** Edges of the sleeve paper along the stick axis, image pixels (pixel-edge convention, y down). */
  topY: number;
  bottomY: number;
  /** Column of the stick axis at those rows. */
  topX: number;
  bottomX: number;
  heightPx: number;
  /** Measured code ends (first and last black edge). */
  codeTopY: number;
  codeBottomY: number;
  codeTopX: number;
  codeBottomX: number;
  /** Code length along the axis (19 bands = 247 mm), from the fitted band grid. Use this for fx. */
  codeLengthPx: number;
  /** Band pitch from the grid fit. */
  modulePx: number;
  /** RMS of the band edges about the fitted grid, in bands. */
  edgeRmsBands: number;
  /** Decoded ID (3 hex digits) when the payload is a codebook word. */
  id?: string;
  upsideDown: boolean;
  /** 0–1. Below MIN_CONFIDENCE, fall back to manual taps. */
  confidence: number;
  /** The 19 bands as read, top of the sleeve first ('1' black). */
  bits: string;
  reasons: string[];
}

export function greyFromRgba(width: number, height: number, rgba: ArrayLike<number>): GreyImage {
  const grey = new Float32Array(width * height);
  for (let i = 0, j = 0; i < grey.length; i += 1, j += 4) grey[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return { width, height, grey };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Column centre and width of the banded stick around the tap, from vertical-gradient energy. */
function locateStick(img: GreyImage, tapX: number, y0: number, y1: number): { cx: number; halfW: number } {
  const { width, grey } = img;
  const reach = Math.round(clamp(img.height * 0.08, 20, 400));
  const xa = clamp(Math.round(tapX) - reach, 0, width - 1);
  const xb = clamp(Math.round(tapX) + reach, 0, width - 1);
  const energy: number[] = [];
  for (let x = xa; x <= xb; x += 1) {
    let e = 0;
    for (let y = y0; y < y1 - 1; y += 1) e += Math.abs(grey[(y + 1) * width + x] - grey[y * width + x]);
    energy.push(e);
  }
  // Smooth a little so one noisy column does not split the run.
  const sm = energy.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = -2; k <= 2; k += 1) if (energy[i + k] !== undefined) { s += energy[i + k]; n += 1; }
    return s / n;
  });
  const t = Math.round(tapX) - xa;
  let best = clamp(t, 0, sm.length - 1);
  // Peak nearest the tap: climb from the tap within a few columns, else global max near the tap.
  let max = -1;
  for (let i = 0; i < sm.length; i += 1) {
    const score = sm[i] / (1 + Math.abs(i - t) / reach);
    if (score > max) { max = score; best = i; }
  }
  const sorted = [...sm].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)];
  const half = floor + (sm[best] - floor) / 2;
  let l = best;
  let r = best;
  while (l > 0 && sm[l - 1] >= half) l -= 1;
  while (r < sm.length - 1 && sm[r + 1] >= half) r += 1;
  return { cx: xa + (l + r) / 2 + 0.5, halfW: Math.max(1, (r - l + 1) / 2) };
}

/** Mean luminance across a strip that follows a (possibly tilted) axis x = cx + slope·(y − yRef). */
function profileAlong(img: GreyImage, cx: number, slope: number, yRef: number, halfStrip: number, linear = true): Float64Array {
  const { width, height, grey } = img;
  const out = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    const xc = cx + slope * (y + 0.5 - yRef) - 0.5;
    let s = 0;
    let n = 0;
    const x0 = Math.ceil(xc - halfStrip);
    const x1 = Math.floor(xc + halfStrip);
    for (let x = x0; x <= x1; x += 1) {
      if (x < 0 || x >= width) continue;
      s += linear ? toLinear(grey[y * width + x]) : grey[y * width + x] / 255;
      n += 1;
    }
    // Averaged in linear light, then scaled to 0–255 so thresholds keep their units.
    out[y] = n ? (255 * s) / n : NaN;
  }
  return out;
}

function otsu(values: number[]): number {
  const hist = new Array(256).fill(0);
  for (const v of values) hist[clamp(Math.round(v), 0, 255)] += 1;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 128;
  for (let i = 0; i < 256; i += 1) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = i + 0.5; }
  }
  return thr;
}

interface Run { black: boolean; start: number; end: number }

/** Sub-pixel threshold crossings (pixel-edge coordinates) and the runs between them. */
function runsOf(p: Float64Array, thr: number, y0: number, y1: number): Run[] {
  const runs: Run[] = [];
  let black = p[y0] < thr;
  let start = y0;
  for (let y = y0 + 1; y < y1; y += 1) {
    const b = p[y] < thr;
    if (b === black) continue;
    // Crossing between sample centres y−0.5 and y+0.5.
    const a = p[y - 1];
    const c = p[y];
    const f = a === c ? 0.5 : (thr - a) / (c - a);
    const edge = y - 0.5 + clamp(f, 0, 1);
    runs.push({ black, start, end: edge });
    black = b;
    start = edge;
  }
  runs.push({ black, start, end: y1 });
  return runs;
}

interface Candidate { codeTop: number; codeBottom: number; upsideDown: boolean; bits: string; score: number; reasons: string[]; module: number; id?: string; reject?: boolean }

/** Read the 19 bands between two code ends and score how well they match the printed layout. */
function readCode(p: Float64Array, thr: number, codeTop: number, codeBottom: number, upsideDown: boolean): Candidate {
  const module = (codeBottom - codeTop) / BANDS;
  let bits = '';
  for (let i = 0; i < BANDS; i += 1) {
    const a = Math.round(codeTop + (i + 0.3) * module);
    const b = Math.round(codeTop + (i + 0.7) * module);
    let s = 0;
    let n = 0;
    for (let y = a; y <= Math.max(a, b); y += 1) if (Number.isFinite(p[y])) { s += p[y]; n += 1; }
    bits += n && s / n < thr ? '1' : '0';
  }
  const read = upsideDown ? [...bits].reverse().join('') : bits;
  const reasons: string[] = [];
  let score = 1;
  if (!read.startsWith('11110')) { score *= 0.2; reasons.push('sync not found'); }
  if (!read.endsWith('01')) { score *= 0.3; reasons.push('stop not found'); }
  const payload = read.slice(5, 17);
  if (/1111|0000/.test(payload)) { score *= 0.4; reasons.push('payload breaks the run limit'); }
  const hex = Number.parseInt(payload, 2).toString(16).toUpperCase().padStart(3, '0');
  const id = CODEBOOK.has(hex) ? hex : undefined;
  if (!id) { score *= 0.1; reasons.push('code is not a printed sleeve ID'); }
  // Quiet zones just outside the code must be light.
  const q = Math.max(1, Math.round(module * 0.4));
  const light = (from: number, to: number) => {
    let s = 0;
    let n = 0;
    for (let y = Math.round(from); y < Math.round(to); y += 1) if (Number.isFinite(p[y])) { s += p[y]; n += 1; }
    return n > 0 && s / n > thr;
  };
  if (!light(codeTop - q - 1, codeTop - 1)) { score *= 0.5; reasons.push('no quiet zone above the code'); }
  if (!light(codeBottom + 1, codeBottom + q + 1)) { score *= 0.5; reasons.push('no quiet zone below the code'); }
  return { codeTop, codeBottom, upsideDown, bits, score, reasons, module, id, reject: !id };
}

interface Grid { top: number; pitch: number; rmsBands: number; edges: number }

function median(v: number[]): number {
  const s = v.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
}

function slice(p: Float64Array, from: number, to: number): number[] {
  const out: number[] = [];
  for (let y = Math.max(0, Math.round(from)); y <= Math.min(p.length - 1, Math.round(to)); y += 1) out.push(p[y]);
  return out;
}

/**
 * Fit a uniform grid y_k = top + k·pitch to every black/white transition of the code (both ends and
 * each internal change). Each edge is found at its own local mid-level (median of the band interiors
 * either side, in linear light), so shading, gradients, blur and gamma do not bias it.
 */
function fitGrid(p: Float64Array, cand: Candidate): Grid | undefined {
  let top = cand.codeTop;
  let pitch = cand.module;
  let result: Grid | undefined;
  for (let iter = 0; iter < 3; iter += 1) {
    const ks: number[] = [];
    const ys: number[] = [];
    for (let k = 0; k <= BANDS; k += 1) {
      const above = k === 0 ? '0' : cand.bits[k - 1];
      const below = k === BANDS ? '0' : cand.bits[k];
      if (above === below) continue;
      const e = top + k * pitch;
      const hiA = k === 0 ? slice(p, e - 0.45 * pitch, e - 0.15 * pitch) : slice(p, e - 0.7 * pitch, e - 0.3 * pitch);
      const hiB = k === BANDS ? slice(p, e + 0.15 * pitch, e + 0.45 * pitch) : slice(p, e + 0.3 * pitch, e + 0.7 * pitch);
      const thr = (median(hiA) + median(hiB)) / 2;
      if (!Number.isFinite(thr)) continue;
      let best: number | undefined;
      const lo = Math.max(1, Math.floor(e - 0.4 * pitch));
      const hi = Math.min(p.length - 1, Math.ceil(e + 0.4 * pitch));
      for (let y = lo; y <= hi; y += 1) {
        const a = p[y - 1];
        const c = p[y];
        if ((a - thr) * (c - thr) > 0 || a === c) continue;
        const pos = y - 0.5 + (thr - a) / (c - a);
        if (best === undefined || Math.abs(pos - e) < Math.abs(best - e)) best = pos;
      }
      if (best === undefined) continue;
      ks.push(k);
      ys.push(best);
    }
    if (ks.length < 4 || !ks.includes(0) || !ks.includes(BANDS)) return undefined;
    const n = ks.length;
    const mk = ks.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i += 1) { sxy += (ks[i] - mk) * (ys[i] - my); sxx += (ks[i] - mk) ** 2; }
    pitch = sxy / sxx;
    top = my - pitch * mk;
    let ss = 0;
    for (let i = 0; i < n; i += 1) ss += (ys[i] - (top + pitch * ks[i])) ** 2;
    result = { top, pitch, rmsBands: Math.sqrt(ss / n) / pitch, edges: n };
  }
  return result;
}

/** Nearest black-edge crossing in `edges` to `want`, within `tol`. */
function nearest(edges: number[], want: number, tol: number): number | undefined {
  let best: number | undefined;
  for (const e of edges) if (Math.abs(e - want) <= tol && (best === undefined || Math.abs(e - want) < Math.abs(best - want))) best = e;
  return best;
}

function detectOnProfile(p: Float64Array, tapY: number, h: number): Candidate | undefined {
  const y0 = 0;
  const y1 = h;
  const vals: number[] = [];
  for (let y = y0; y < y1; y += 1) if (Number.isFinite(p[y])) vals.push(p[y]);
  if (vals.length < 20) return undefined;
  let thr = otsu(vals);
  let runs = runsOf(p, thr, y0, y1);
  let best: Candidate | undefined;
  for (let pass = 0; pass < 2; pass += 1) {
    const blacks = runs.filter((r) => r.black && r.start > y0 && r.end < y1);
    const topEdges = blacks.map((r) => r.start);
    const botEdges = blacks.map((r) => r.end);
    // Sync candidates: the longest black runs, nearest the tap first.
    const sync = [...blacks].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 6);
    best = undefined;
    for (const s of sync) {
      const len = s.end - s.start;
      if (len < 6) continue;
      const m = len / 4;
      for (const upsideDown of [false, true]) {
        let codeTop: number | undefined;
        let codeBottom: number | undefined;
        if (!upsideDown) {
          codeTop = s.start;
          codeBottom = nearest(botEdges, s.start + BANDS * m, m * 0.6);
        } else {
          codeBottom = s.end;
          codeTop = nearest(topEdges, s.end - BANDS * m, m * 0.6);
        }
        if (codeTop === undefined || codeBottom === undefined) continue;
        const c = readCode(p, thr, codeTop, codeBottom, upsideDown);
        // The tap should be on (or near) the sleeve.
        const sleeveTop = codeTop - (upsideDown ? 23 : 17) * c.module / 13;
        const sleeveBottom = codeBottom + (upsideDown ? 17 : 23) * c.module / 13;
        if (c.reject) c.score *= 0.5;
        if (tapY < sleeveTop - c.module * 3 || tapY > sleeveBottom + c.module * 3) { c.score *= 0.3; c.reasons.push('tap is off the detected sleeve'); }
        if (!best || c.score > best.score) best = c;
      }
    }
    if (!best || pass === 1) break;
    // Refine the threshold to the mid level between the code's black and white bands.
    const blackVals: number[] = [];
    const whiteVals: number[] = [];
    for (let i = 0; i < BANDS; i += 1) {
      const a = Math.round(best.codeTop + (i + 0.3) * best.module);
      const b = Math.round(best.codeTop + (i + 0.7) * best.module);
      for (let y = a; y <= b; y += 1) if (Number.isFinite(p[y])) (best.bits[i] === '1' ? blackVals : whiteVals).push(p[y]);
    }
    const med = (v: number[]) => { const s = [...v].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    if (!blackVals.length || !whiteVals.length) break;
    const dark = med(blackVals);
    const lightLevel = med(whiteVals);
    thr = (dark + lightLevel) / 2;
    if (lightLevel - dark < 25) { best.score *= 0.5; best.reasons.push('low contrast'); }
    runs = runsOf(p, thr, y0, y1);
  }
  return best;
}

/**
 * Detect the sleeve from a rough tap at (tapX, tapY) in this image's pixels (sRGB grey).
 * Returns undefined when nothing like a sleeve is near the tap. Hard rejects come back with
 * confidence 0 and a reason, so the app falls back to manual taps.
 */
export function detectSleeve(img: GreyImage, tapX: number, tapY: number, opts: DetectOptions = {}): SleeveDetection | undefined {
  const { height } = img;
  const band = Math.round(clamp(height * 0.25, 20, height / 2));
  const ya = clamp(Math.round(tapY) - band, 0, height - 1);
  const yb = clamp(Math.round(tapY) + band, 1, height);
  const stick = locateStick(img, tapX, ya, yb);
  const halfStrip = Math.max(1, stick.halfW * 0.4);
  let slope = 0;
  // Find and read the code on the encoded values (robust to how the file was encoded); measure the
  // edges in linear light.
  let profile = profileAlong(img, stick.cx, 0, tapY, halfStrip);
  const bestOf = (a?: Candidate, b?: Candidate) => (!a ? b : !b ? a : b.score > a.score ? b : a);
  const findOn = (cx: number, sl: number, yRef: number, lin: Float64Array) =>
    bestOf(detectOnProfile(lin, tapY, height), detectOnProfile(profileAlong(img, cx, sl, yRef, halfStrip, false), tapY, height));
  let cand = findOn(stick.cx, 0, tapY, profile);
  if (cand) {
    const span = cand.codeBottom - cand.codeTop;
    const upper = locateStick(img, stick.cx, clamp(Math.round(cand.codeTop), 0, height - 1), clamp(Math.round(cand.codeTop + span * 0.3), 1, height));
    const lower = locateStick(img, stick.cx, clamp(Math.round(cand.codeBottom - span * 0.3), 0, height - 1), clamp(Math.round(cand.codeBottom), 1, height));
    const s = (lower.cx - upper.cx) / (span * 0.7);
    if (Number.isFinite(s) && Math.abs(s) < 0.2) {
      const mid = cand.codeTop + span / 2;
      const cx = (upper.cx + lower.cx) / 2;
      const p2 = profileAlong(img, cx, s, mid, halfStrip);
      const again = findOn(cx, s, mid, p2);
      if (again && again.score >= cand.score) {
        cand = again;
        profile = p2;
        slope = s;
        stick.cx = cx + s * (tapY - mid);
      }
    }
  }
  if (!cand) return undefined;
  const reasons = [...cand.reasons];
  let confidence = cand.score;
  let codeTop = cand.codeTop;
  let pitch = cand.module;
  let rms = 1;
  const grid = fitGrid(profile, cand);
  if (grid) {
    codeTop = grid.top;
    pitch = grid.pitch;
    rms = grid.rmsBands;
  } else {
    confidence = 0;
    reasons.push('band edges could not be fitted');
  }
  if (cand.reject) confidence = 0;
  if (rms > MAX_EDGE_RMS_BANDS) { confidence = 0; reasons.push(`band edges uneven (RMS ${rms.toFixed(2)} band)`); }
  const minBand = opts.minBandPx ?? MIN_BAND_PX;
  if (pitch < minBand) { confidence = 0; reasons.push(`bands ${pitch.toFixed(1)} px, under ${minBand} px; move closer`); }
  if (opts.expectedId && cand.id && cand.id !== opts.expectedId.toUpperCase()) {
    confidence = 0;
    reasons.push(`sleeve ${cand.id}, expected ${opts.expectedId.toUpperCase()}`);
  }
  const codeBottom = codeTop + BANDS * pitch;
  const code = codeBottom - codeTop;
  const scale = code / CODE_MM; // px per mm (vertical component)
  // Paper ends: display only. Measurements use the code length.
  const topY = codeTop - (cand.upsideDown ? CODE_BOTTOM_FROM_BOTTOM_MM : CODE_TOP_FROM_TOP_MM) * scale;
  const bottomY = codeBottom + (cand.upsideDown ? CODE_TOP_FROM_TOP_MM : CODE_BOTTOM_FROM_BOTTOM_MM) * scale;
  const xAt = (y: number) => stick.cx + slope * (y - tapY);
  const along = Math.hypot(1, slope);
  return {
    topY,
    bottomY,
    topX: xAt(topY),
    bottomX: xAt(bottomY),
    heightPx: (bottomY - topY) * along,
    codeTopY: codeTop,
    codeBottomY: codeBottom,
    codeTopX: xAt(codeTop),
    codeBottomX: xAt(codeBottom),
    codeLengthPx: code * along,
    modulePx: pitch * along,
    edgeRmsBands: rms,
    id: cand.id,
    upsideDown: cand.upsideDown,
    confidence: clamp(confidence, 0, 1),
    bits: cand.bits,
    reasons,
  };
}
