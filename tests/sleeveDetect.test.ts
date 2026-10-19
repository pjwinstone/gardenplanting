import { describe, expect, it } from 'vitest';
import { sleeveBits, CIRCLE_SLEEVES } from '../scripts/markerSleeve';
import { CODEBOOK_HEX, detectSleeve, MIN_CONFIDENCE, type GreyImage } from '../src/workflows/guided/sleeveDetect';
import { originalMatchesPreview } from '../src/workflows/guided/sleeveImage';
import { render as simRender, type SimOpt } from './fixtures/sleeveSim';
import { PUBLISHED_CODEBOOK } from '../scripts/markerSleeve';

/** Small deterministic PRNG so failures repeat. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Scene {
  w: number; h: number;
  /** Sleeve height in px (along the axis). */
  sleevePx: number;
  cx: number; cy: number;
  tiltDeg: number;
  noise: number;
  id?: string;
  upsideDown?: boolean;
  seed?: number;
  /** Remove the bands (plain white tube): detection must give up. */
  blank?: boolean;
  contrast?: number;
}

/**
 * Render a sleeved stick: 287 mm sleeve, 60.4 mm wide, 17 mm to the first band, 19 × 13 mm bands,
 * legends with dark text-like marks, a brown dowel above and below, textured background.
 * 4 × 4 supersampling gives the edge blur of a real lens; Gaussian-ish noise on top.
 */
function render(sc: Scene): { img: GreyImage; topY: number; bottomY: number } {
  const r = rng(sc.seed ?? 1);
  const bits = sleeveBits(sc.id ?? '315');
  const s = sc.sleevePx / 287; // px per mm
  const th = (sc.tiltDeg * Math.PI) / 180;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const white = 225;
  const black = white - (sc.contrast ?? 195);
  const textMarks: { v0: number; v1: number; u0: number; u1: number }[] = [];
  for (const [a, b] of [[1, 8], [265, 286]]) {
    for (let k = 0; k < 6; k += 1) {
      const v0 = a + r() * (b - a - 3);
      const u0 = -28 + r() * 50;
      textMarks.push({ v0, v1: v0 + 2 + r() * 2, u0, u1: u0 + 2 + r() * 5 });
    }
  }
  const bgSeed = r() * 1000;
  const shade = (u: number, v: number, X: number, Y: number): number => {
    // u: mm across the axis from centre; v: mm down from the sleeve top.
    if (Math.abs(u) <= 30.2 && v >= 0 && v <= 287) {
      if (sc.blank) return white;
      if (sc.upsideDown) v = 287 - v; // the whole sleeve, legends included
      for (const m of textMarks) if (u >= m.u0 && u <= m.u1 && v >= m.v0 && v <= m.v1) return black + 20;
      const c = v - 17;
      if (c >= 0 && c < 247) {
        const i = Math.floor(c / 13);
        return bits[i] === '1' ? black : white;
      }
      return white;
    }
    if (Math.abs(u) <= 30) return 110; // dowel
    return 140 + 40 * Math.sin(X * 0.031 + bgSeed) * Math.cos(Y * 0.017);
  };
  const grey = new Float32Array(sc.w * sc.h);
  const ss = 4;
  for (let y = 0; y < sc.h; y += 1) {
    for (let x = 0; x < sc.w; x += 1) {
      let acc = 0;
      for (let j = 0; j < ss; j += 1) for (let i = 0; i < ss; i += 1) {
        const X = x + (i + 0.5) / ss;
        const Y = y + (j + 0.5) / ss;
        const dx = X - sc.cx;
        const dy = Y - sc.cy;
        // Rotate into the stick frame (axis tilted by th from vertical).
        const u = (dx * cos - dy * sin) / s;
        const v = (dx * sin + dy * cos) / s + 143.5;
        acc += shade(u, v, X, Y);
      }
      const n = (r() + r() + r() - 1.5) * 2 * sc.noise;
      grey[y * sc.w + x] = Math.max(0, Math.min(255, acc / (ss * ss) + n));
    }
  }
  // Truth: axis ends, y component.
  const half = (287 / 2) * s;
  return { img: { width: sc.w, height: sc.h, grey }, topY: sc.cy - half * cos, bottomY: sc.cy + half * cos };
}

describe('sleeve detection from one rough tap', () => {
  const cases: (Scene & { name: string; tapDx: number; tapDy: number })[] = [
    { name: 'small, 4 m-ish', w: 160, h: 320, sleevePx: 215, cx: 80.3, cy: 160.7, tiltDeg: 0, noise: 4, tapDx: 6, tapDy: 30 },
    { name: 'medium, noisy', w: 220, h: 520, sleevePx: 380, cx: 110.6, cy: 250.2, tiltDeg: 0, noise: 10, tapDx: -10, tapDy: -60, seed: 3, id: '8A3' },
    { name: 'large', w: 300, h: 900, sleevePx: 760, cx: 150.1, cy: 455.4, tiltDeg: 0, noise: 6, tapDx: 15, tapDy: 100, seed: 5, id: 'EC5' },
    { name: 'tilt +1.5°', w: 240, h: 560, sleevePx: 420, cx: 120.4, cy: 280.3, tiltDeg: 1.5, noise: 6, tapDx: 5, tapDy: 0, seed: 7, id: '459' },
    { name: 'tilt −2.5°, noisy', w: 260, h: 600, sleevePx: 460, cx: 130.2, cy: 300.8, tiltDeg: -2.5, noise: 10, tapDx: -8, tapDy: 40, seed: 9, id: 'DAC' },
    { name: 'upside down', w: 200, h: 480, sleevePx: 340, cx: 100.5, cy: 240.5, tiltDeg: 0.8, noise: 6, tapDx: 3, tapDy: -20, seed: 11, upsideDown: true, id: '6BA' },
    { name: 'off-centre in a wide frame', w: 400, h: 400, sleevePx: 260, cx: 250.7, cy: 190.1, tiltDeg: 1, noise: 8, tapDx: 12, tapDy: 50, seed: 13, id: '952' },
  ];
  for (const c of cases) {
    it(`${c.name}: edges within 1 px of truth`, () => {
      const { img, topY, bottomY } = render(c);
      const d = detectSleeve(img, c.cx + c.tapDx, c.cy + c.tapDy);
      expect(d, "detected").toBeDefined();
      if (process.env.SLEEVE_REPORT) console.log(c.name, (d!.topY - topY).toFixed(3), (d!.bottomY - bottomY).toFixed(3), d!.confidence.toFixed(2), d!.modulePx.toFixed(2));
      expect(d!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
      expect(d!.upsideDown).toBe(!!c.upsideDown);
      expect(Math.abs(d!.topY - topY)).toBeLessThanOrEqual(1);
      expect(Math.abs(d!.bottomY - bottomY)).toBeLessThanOrEqual(1);
      expect(Math.abs(d!.heightPx - c.sleevePx)).toBeLessThanOrEqual(1);
    });
  }

  it('reads the printed code of every circle sleeve', () => {
    for (const [i, sl] of CIRCLE_SLEEVES.entries()) {
      const { img } = render({ w: 160, h: 400, sleevePx: 300, cx: 80, cy: 200, tiltDeg: 0, noise: 5, id: sl.id, seed: 20 + i });
      const d = detectSleeve(img, 82, 190)!;
      expect(d.bits).toBe(sleeveBits(sl.id));
    }
  });

  it('plain tube with no bands: low confidence or nothing, so the app asks for manual taps', () => {
    const { img } = render({ w: 200, h: 480, sleevePx: 340, cx: 100, cy: 240, tiltDeg: 0, noise: 6, blank: true });
    const d = detectSleeve(img, 100, 240);
    expect(!d || d.confidence < MIN_CONFIDENCE).toBe(true);
  });

  it('bands too small (sleeve far away): low confidence', () => {
    const { img } = render({ w: 120, h: 200, sleevePx: 45, cx: 60, cy: 100, tiltDeg: 0, noise: 6 });
    const d = detectSleeve(img, 60, 100);
    expect(!d || d.confidence < MIN_CONFIDENCE).toBe(true);
  });

  it('tap on the background: low confidence or nothing', () => {
    const { img } = render({ w: 600, h: 400, sleevePx: 300, cx: 500, cy: 200, tiltDeg: 0, noise: 6 });
    const d = detectSleeve(img, 80, 200);
    expect(!d || d.confidence < MIN_CONFIDENCE).toBe(true);
  });
});

describe("reviewer's sleeve sim (4 m, 215 px sleeve unless stated)", () => {
  const base: SimOpt = { sleevePx: 215, sigma: 0, gamma: false, grad: 0, lambert: false, usm: 0, expo: 1 };
  const cases: [string, Partial<SimOpt>][] = [
    ['clean linear', {}],
    ['blur σ1.5 linear', { sigma: 1.5 }],
    ['blur σ1.5 + sRGB', { sigma: 1.5, gamma: true }],
    ['blur σ2.5 + sRGB', { sigma: 2.5, gamma: true }],
    ['σ1.5 sRGB + USM 1.0', { sigma: 1.5, gamma: true, usm: 1 }],
    ['σ1.5 sRGB + gradient 40%', { sigma: 1.5, gamma: true, grad: 0.4 }],
    ['σ1.5 sRGB + Lambert side light', { sigma: 1.5, gamma: true, lambert: true }],
    ['σ1.5 sRGB over-exposed 1.4 (clipped)', { sigma: 1.5, gamma: true, expo: 1.4 }],
    ['all: σ2 sRGB USM gradient Lambert exp 1.2', { sigma: 2, gamma: true, usm: 1, grad: 0.4, lambert: true, expo: 1.2 }],
    ['all at 2 m (430 px)', { sleevePx: 430, sigma: 2, gamma: true, usm: 1, grad: 0.4, lambert: true, expo: 1.2 }],
    ['glare centre +0.6', { glare: 0.6 }],
    ['glare off-centre 0.3R +0.6', { glare: 0.6, glareU: 0.3 }],
    ['glare centre +0.6, σ2 sRGB', { glare: 0.6, sigma: 2, gamma: true }],
    ['upside down, σ1.2 sRGB', { flip: true, sigma: 1.2, gamma: true }],
  ];
  for (const [name, o] of cases) {
    it(`${name}: code length within 0.3%`, () => {
      const sc = simRender({ ...base, ...o });
      const d = detectSleeve(sc.img, sc.cx + 3, sc.h / 2)!;
      const err = ((d.codeBottomY - d.codeTopY) / (sc.codeBot - sc.codeTop) - 1) * 100;
      if (process.env.SLEEVE_REPORT) console.log(`SIM ${name}: ${err.toFixed(3)}% conf ${d.confidence.toFixed(2)} rms ${d.edgeRmsBands.toFixed(3)}`);
      expect(d.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
      expect(d.id).toBe('315');
      expect(Math.abs(err)).toBeLessThanOrEqual(0.3);
      expect(Math.abs(d.codeLengthPx - (sc.codeBot - sc.codeTop))).toBeLessThanOrEqual(0.3 * 0.01 * (sc.codeBot - sc.codeTop) + 1e-9);
    });
  }

  it('6 m (143 px sleeve, 6.4 px bands): hard reject under 7 px', () => {
    const sc = simRender({ ...base, sleevePx: 143, sigma: 2, gamma: true, usm: 1, grad: 0.4, lambert: true, expo: 1.2 });
    const d = detectSleeve(sc.img, sc.cx + 3, sc.h / 2);
    expect(!d || d.confidence === 0).toBe(true);
  });

  it('wrong ID: a valid sleeve that is not the expected one is rejected', () => {
    const sc = simRender({ ...base, sigma: 1.2, gamma: true });
    expect(detectSleeve(sc.img, sc.cx + 3, sc.h / 2, { expectedId: '315' })!.confidence).toBe(1);
    const d = detectSleeve(sc.img, sc.cx + 3, sc.h / 2, { expectedId: '8A3' })!;
    expect(d.confidence).toBe(0);
    expect(d.reasons.join(' ')).toMatch(/sleeve 315, expected 8A3/);
  });

  it('payload that is not a codebook word is rejected', () => {
    // Valid sync and stop, run-limited payload 0x223 (one bit from 222): not issued.
    const payload = (0x223).toString(2).padStart(12, '0');
    const sc = simRender({ ...base, sigma: 1.2, gamma: true, bits: `11110${payload}01` });
    const d = detectSleeve(sc.img, sc.cx + 3, sc.h / 2);
    expect(!d || d.confidence === 0).toBe(true);
  });

  it('partial code (top 6 bands blank) is not accepted', () => {
    const sc = simRender({ ...base, sigma: 1.2, gamma: true, partial: 6 });
    const d = detectSleeve(sc.img, sc.cx + 3, sc.h / 2);
    expect(!d || d.confidence < MIN_CONFIDENCE).toBe(true);
  });

  it('codebook copy matches the published Bank-1 list', () => {
    expect(CODEBOOK_HEX).toBe(PUBLISHED_CODEBOOK);
  });

  it('full-size photo must line up with the preview, else manual fallback', () => {
    expect(originalMatchesPreview(4032, 3024, 640, 480)).toBe(true);
    expect(originalMatchesPreview(3024, 4032, 640, 480)).toBe(false); // rotated by EXIF on one side only
    expect(originalMatchesPreview(4032, 2268, 640, 480)).toBe(false); // 16:9 crop
  });
});
