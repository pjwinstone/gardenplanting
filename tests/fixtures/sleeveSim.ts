/**
 * Photo & Marker Vision Reviewer's sleeve simulator (reviews/sleeve/sim.ts): linear-light render,
 * Gaussian blur, optional sRGB encoding, vertical light gradient, Lambert side light, glare stripe,
 * over-exposure clipping and unsharp mask. Truth is the code's first and last black edge.
 */
import { sleeveBits } from '../../scripts/markerSleeve';
const bits = sleeveBits('315');
export type SimOpt = { sleevePx: number; sigma: number; gamma: boolean; grad: number; lambert: boolean; usm: number; expo: number; flip?: boolean; reverse?: boolean; partial?: number; glare?: number; glareU?: number; bits?: string };
function gauss1d(a: Float64Array, w: number, h: number, s: number, horiz: boolean) {
  if (s <= 0) return a; const r = Math.ceil(3 * s); const k: number[] = []; let t = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-i * i / (2 * s * s)); k.push(v); t += v; }
  const o = new Float64Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let acc = 0; for (let i = -r; i <= r; i++) { const xx = horiz ? Math.min(w - 1, Math.max(0, x + i)) : x; const yy = horiz ? y : Math.min(h - 1, Math.max(0, y + i)); acc += a[yy * w + xx] * k[i + r]; } o[y * w + x] = acc / t; }
  return o;
}
function blur(a: Float64Array, w: number, h: number, s: number) { return gauss1d(gauss1d(a, w, h, s, true), w, h, s, false); }
export function render(o: SimOpt) {
  const s = o.sleevePx / 287, w = 200, h = Math.round(o.sleevePx * 1.6), cx = 100, top = (h - o.sleevePx) / 2;
  const R = 30.2 * s; const ss = 4; const lin = new Float64Array(w * h);
  let b = [...(o.bits ?? bits)]; if (o.reverse) b = b.reverse();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      const X = x + (i + .5) / ss, Y = y + (j + .5) / ss; const u = X - cx; let v = (Y - top) / s; if (o.flip) v = 287 - v;
      let refl: number;
      if (Math.abs(u) <= R && v >= 0 && v <= 287) {
        const c = v - 17; refl = 0.8;
        if (c >= 0 && c < 247) { const k = Math.floor(c / 13); if (o.partial == null || k >= o.partial) refl = b[k] === '1' ? 0.04 : 0.8; }
        if (o.lambert) refl *= Math.max(0.05, Math.cos(Math.asin(Math.min(1, u / R)) - 0.6)); // side light 34°
        if (o.glare && Math.abs(u / R - (o.glareU ?? 0)) < 0.12) refl += o.glare;
      } else if (Math.abs(u) <= R) refl = 0.25; else refl = 0.18;
      const g = 1 + o.grad * ((Y - top) / o.sleevePx - 0.5);
      acc += refl * g * o.expo;
    }
    lin[y * w + x] = acc / (ss * ss);
  }
  let img = blur(lin, w, h, o.sigma);
  const enc = new Float64Array(w * h);
  for (let i = 0; i < enc.length; i++) { const v = Math.min(1, Math.max(0, img[i])); enc[i] = 255 * (o.gamma ? Math.pow(v, 1 / 2.2) : v); }
  let out = enc;
  if (o.usm > 0) { const bl = blur(enc, w, h, 1.5); out = new Float64Array(w * h); for (let i = 0; i < out.length; i++) out[i] = Math.min(255, Math.max(0, enc[i] + o.usm * (enc[i] - bl[i]))); }
  return { img: { width: w, height: h, grey: out }, codeTop: top + (o.flip ? 23 : 17) * s, codeBot: top + (o.flip ? 287 - 17 : 287 - 23) * s, top, bot: top + o.sleevePx, cx, h };
}
