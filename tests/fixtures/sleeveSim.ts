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

// ---------------------------------------------------------------------------
// Whole-photo scenes (docs/marker-detection.md): backgrounds, several sleeves at 2–14 m, tilt,
// near neighbours, partial foliage. Linear-light render, 2×2 supersampling, Gaussian lens blur,
// sRGB-ish gamma, seeded sensor noise, 8-bit output. fx defaults to an iPhone main camera at 12 MP.
// ---------------------------------------------------------------------------

export type Background = 'plain' | 'fence' | 'brick' | 'trellis' | 'deckchair' | 'foliage' | 'pole';
export interface SceneSleeve {
  id: string;
  /** Distance, m. Sets the scale: px per mm = fx / (1000 · d). */
  distM: number;
  /** Axis x and the sleeve centre y, px. */
  x: number;
  y: number;
  tiltDeg?: number;
  /** Leaves over this fraction of the sleeve's width, on one side (0–0.5). */
  foliage?: number;
}
export interface SceneOpt {
  width: number;
  height: number;
  fx?: number;
  background: Background;
  sleeves: SceneSleeve[];
  sigma?: number;
  noise?: number;
  seed?: number;
  /** Background feature scale, as a distance (m): fence slats and bricks at this range. */
  bgDistM?: number;
}
export interface SceneTruth {
  id: string;
  bandPx: number;
  /** Axis x at a given y. */
  axisXAt: (y: number) => number;
  midCodeY: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const FX_12MP = 2900;

export function renderScene(o: SceneOpt): { img: { width: number; height: number; grey: Uint8ClampedArray }; truth: SceneTruth[] } {
  const fx = o.fx ?? FX_12MP;
  const W = o.width;
  const H = o.height;
  const rand = rng(o.seed ?? 7);
  const bgS = fx / (1000 * (o.bgDistM ?? 4)); // px per mm for the background
  // Foliage blobs for the 'foliage' background.
  const blobs: Array<[number, number, number, number]> = [];
  if (o.background === 'foliage') for (let i = 0; i < 400; i += 1) blobs.push([rand() * W, rand() * H, 6 + rand() * 30, 0.03 + rand() * 0.12]);
  const bg = (X: number, Y: number): number => {
    switch (o.background) {
      case 'fence': { // vertical slats 95 mm with 10 mm gaps, wood grain
        const u = (X / bgS) % 105;
        return u < 95 ? 0.22 + 0.03 * Math.sin(Y * 0.05 + X * 0.3) : 0.04;
      }
      case 'brick': { // 215 × 65 mm bricks, 10 mm mortar, stretcher bond
        const v = Y / bgS;
        const row = Math.floor(v / 75);
        const u = X / bgS + (row % 2 ? 112.5 : 0);
        const inMortar = v % 75 > 65 || u % 225 > 215;
        return inMortar ? 0.45 : 0.12 + 0.03 * ((row * 7 + Math.floor(u / 225)) % 3);
      }
      case 'trellis': { // diagonal laths 25 mm on 150 mm centres
        const a = ((X + Y) / bgS) % 150;
        const b = ((X - Y + 1e6) / bgS) % 150;
        return a < 25 || b < 25 ? 0.5 : 0.1;
      }
      case 'deckchair': { // vertical stripes 60 mm, alternating, plus horizontal frame bars
        const u = Math.floor(X / bgS / 60);
        const v = (Y / bgS) % 400;
        if (v < 30) return 0.3;
        return u % 2 ? 0.75 : 0.05;
      }
      case 'pole': { // a ranging pole: regular 100 mm black / white on a 30 mm cylinder, plus plain ground
        const cx = W * 0.5;
        const R = 30 * bgS * 0.5 * 2;
        if (Math.abs(X - cx) < R) return Math.floor(Y / bgS / 100) % 2 ? 0.04 : 0.8;
        return 0.2;
      }
      case 'foliage': {
        let v = 0.15;
        for (const [bx, by, r, val] of blobs) if ((X - bx) ** 2 + (Y - by) ** 2 < r * r) { v = val; }
        return v;
      }
      default:
        return 0.18;
    }
  };
  const ss = 2;
  const linImg = new Float64Array(W * H);
  const prepared = o.sleeves.map((sl) => {
    const s = fx / (1000 * sl.distM);
    const t = ((sl.tiltDeg ?? 0) * Math.PI) / 180;
    return { ...sl, s, R: 30.2 * s, rc: 6 * s, cos: Math.cos(t), sin: Math.sin(t), b: [...sleeveBits(sl.id)] };
  });
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    let acc = 0;
    for (let j = 0; j < ss; j += 1) for (let i = 0; i < ss; i += 1) {
      const X = x + (i + 0.5) / ss;
      const Y = y + (j + 0.5) / ss;
      let v = bg(X, Y);
      for (const p of prepared) {
        const dx = X - p.x;
        const dy = Y - p.y;
        const u = dx * p.cos - dy * p.sin; // across
        const a = dx * p.sin + dy * p.cos; // along, down
        const vm = a / p.s + 143.5;
        if (Math.abs(u) <= p.R && vm >= 0 && vm <= 287) {
          const c = vm - 17;
          let refl = 0.8;
          if (c >= 0 && c < 247) refl = p.b[Math.floor(c / 13)] === '1' ? 0.04 : 0.8;
          refl *= 0.75 + 0.25 * Math.cos(Math.asin(Math.min(1, u / p.R)) - 0.4); // soft side light
          if (p.foliage && u > p.R * (1 - 2 * p.foliage) && (Math.floor(vm / 20) % 3 !== 0)) refl = 0.07;
          v = refl;
        } else if (Math.abs(u) <= p.rc && (vm < 0 || vm > 287)) v = 0.14; // the cane
      }
      acc += v;
    }
    linImg[y * W + x] = acc / (ss * ss);
  }
  const blurred = blur(linImg, W, H, o.sigma ?? 0.9);
  const out = new Uint8ClampedArray(W * H);
  const n = o.noise ?? 1.5;
  for (let i = 0; i < out.length; i += 1) {
    const v = Math.min(1, Math.max(0, blurred[i]));
    const g = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    // Box–Muller-ish noise from two uniforms.
    const z = (rand() + rand() + rand() - 1.5) * 2;
    out[i] = Math.round(255 * g + n * z);
  }
  const truth = prepared.map((p) => {
    const tan = p.sin / p.cos;
    const midA = (140.5 - 143.5) * p.s; // mid-code along the axis
    const midY = p.y + midA * p.cos;
    return { id: p.id, bandPx: 13 * p.s, axisXAt: (yy: number) => p.x + tan * (yy - p.y), midCodeY: midY };
  });
  return { img: { width: W, height: H, grey: out }, truth };
}
