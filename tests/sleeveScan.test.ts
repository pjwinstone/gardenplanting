/**
 * Whole-photo sleeve detection (docs/marker-detection.md) on simulated scenes.
 * Pass bars: zero false positives on the negatives, recall ≥ 95 % for bands ≥ 4 px,
 * axis-x error < 0.3 px for bands ≥ 7 px.
 */
import { describe, expect, it } from 'vitest';
import { renderScene, type Background, type SceneSleeve } from './fixtures/sleeveSim';
import { scanSleeves, type ScanResult } from '../src/workflows/guided/sleeveScan';
import { GARDEN_MARKER_IDS } from '../src/workflows/guided/markerSet';

const SET = GARDEN_MARKER_IDS;
const W = 800;
const H = 900;

function scene(background: Background, sleeves: SceneSleeve[], seed = 7) {
  return renderScene({ width: W, height: H, background, sleeves, seed });
}

/** Every reported sleeve must match a true one by ID and position, otherwise it is a false positive. */
function score(res: ScanResult, truth: ReturnType<typeof scene>['truth']) {
  const fp = res.sleeves.filter((s) => {
    const t = truth.find((q) => q.id === s.id);
    return !t || Math.abs(s.axisX - t.axisXAt(s.midY)) > 3 || Math.abs(s.midY - t.midCodeY) > 0.5 * (s.codeBottomY - s.codeTopY);
  });
  const hits = truth.map((t) => {
    const s = res.sleeves.find((q) => q.id === t.id);
    return { t, s, err: s ? s.axisX - t.axisXAt(s.midY) : NaN };
  });
  return { fp, hits };
}

describe('negatives: no sleeve, or a sleeve from another garden', { timeout: 120_000 }, () => {
  const bgs: Background[] = ['plain', 'fence', 'brick', 'trellis', 'deckchair', 'foliage', 'pole'];
  for (const bg of bgs) {
    it(`${bg}: nothing reported`, () => {
      const sc = scene(bg, [], 11);
      const res = scanSleeves(sc.img, { markerIds: SET, budgetMs: 1e9 });
      expect(res.sleeves).toEqual([]);
      expect(res.duplicates).toEqual([]);
    });
  }
  it('a readable sleeve whose ID is not in this garden is not reported', () => {
    const sc = scene('fence', [{ id: '24B', distM: 4, x: 400.4, y: 450, tiltDeg: 6 }]);
    expect(SET).not.toContain('24B');
    const res = scanSleeves(sc.img, { markerIds: SET, budgetMs: 1e9 });
    expect(res.sleeves).toEqual([]);
  });
});

describe('positives: recall, false positives and axis-x error by distance', { timeout: 120_000 }, () => {
  const bgs: Background[] = ['fence', 'brick', 'trellis', 'deckchair', 'foliage'];
  const dists = [2, 3, 4, 5, 6, 7, 8, 9];
  it('meets the bars across backgrounds, 2–9 m, tilt 5–10°', () => {
    const misses: string[] = [];
    const per = new Map<number, { n: number; found: number; errs: number[]; fp: number; band: number }>();
    let k = 0;
    for (const bg of bgs) {
      for (const d of dists) {
        k += 1;
        const t1 = 5 + (k % 6);
        const t2 = -(5 + ((k * 3) % 6));
        const sc = scene(bg, [
          { id: '315', distM: d, x: 250.3 + (k % 5) * 0.2, y: 450, tiltDeg: t1 },
          { id: '8A3', distM: d, x: 560.7 - (k % 3) * 0.3, y: 430, tiltDeg: t2 },
        ], k);
        const res = scanSleeves(sc.img, { markerIds: SET, budgetMs: 1e9 });
        const { fp, hits } = score(res, sc.truth);
        const row = per.get(d) ?? { n: 0, found: 0, errs: [], fp: 0, band: sc.truth[0].bandPx };
        row.fp += fp.length;
        for (const h of hits) {
          row.n += 1;
          if (!h.s) misses.push(`MISS ${bg} d=${d} ${h.t.id} k=${k}`);
          if (h.s) {
            row.found += 1;
            row.errs.push(Math.abs(h.err));
            if (Math.abs(h.err) > 0.3 && h.t.bandPx >= 7) misses.push(`ERR ${bg} d=${d} ${h.t.id} ${h.err.toFixed(2)}`);
            expect(h.s.notForCal).toBe(h.s.bandPx < 7);
          }
        }
        per.set(d, row);
      }
    }
    const lines: string[] = [];
    let n = 0; let found = 0; let fpAll = 0; let worst7 = 0;
    for (const [d, r] of per) {
      n += r.n; found += r.found; fpAll += r.fp;
      const maxErr = r.errs.length ? Math.max(...r.errs) : NaN;
      const meanErr = r.errs.length ? r.errs.reduce((a, b) => a + b, 0) / r.errs.length : NaN;
      lines.push(`d=${d} m band=${r.band.toFixed(1)} px recall=${r.found}/${r.n} fp=${r.fp} axisErr mean=${meanErr.toFixed(3)} max=${maxErr.toFixed(3)} px`);
      if (r.band >= 7) worst7 = Math.max(worst7, maxErr);
    }
    process.stderr.write(`[sleeveScan sim]\n${lines.join('\n')}\n${misses.join("\n")}\nrecall ${found}/${n} = ${(100 * found / n).toFixed(1)} %, false positives ${fpAll}\n`);
    expect(fpAll).toBe(0);
    expect(worst7).toBeLessThan(0.3);
    expect(found / n).toBeGreaterThanOrEqual(0.95);
  }, 300_000);

  it('two sleeves 0.3 m apart at 6 m are both found', () => {
    // 0.3 m at 6 m ≈ 145 px between axes.
    const sc = scene('fence', [
      { id: '459', distM: 6, x: 330.2, y: 450, tiltDeg: 7 },
      { id: '6BA', distM: 6, x: 475.6, y: 455, tiltDeg: -6 },
    ]);
    const res = scanSleeves(sc.img, { markerIds: SET, budgetMs: 1e9 });
    const { fp, hits } = score(res, sc.truth);
    expect(fp).toEqual([]);
    expect(hits.every((h) => h.s)).toBe(true);
  });

  it('partial foliage over one side still gives the sleeve', () => {
    const sc = scene('foliage', [{ id: '952', distM: 4, x: 400.4, y: 450, tiltDeg: 8, foliage: 0.25 }]);
    const res = scanSleeves(sc.img, { markerIds: SET, budgetMs: 1e9 });
    const { fp } = score(res, sc.truth);
    expect(fp).toEqual([]);
    // Either found, or left to a manual tap; never a wrong ID or position.
    for (const s of res.sleeves) expect(s.id).toBe('952');
  });

  it('14 m (bands < 4 px) is left to a manual tap, with no wrong output', () => {
    const sc = scene('plain', [{ id: 'DAC', distM: 14, x: 400.4, y: 450, tiltDeg: 6 }]);
    const res = scanSleeves(sc.img, { markerIds: SET, budgetMs: 1e9 });
    expect(score(res, sc.truth).fp).toEqual([]);
    for (const s of res.sleeves) expect(s.bandPx).toBeGreaterThanOrEqual(4);
  });
});

describe('rules', { timeout: 120_000 }, () => {
  it('the same ID twice in one photo goes to manual', () => {
    const sc = scene('plain', [
      { id: '315', distM: 4, x: 250.3, y: 450, tiltDeg: 6 },
      { id: '315', distM: 4, x: 560.7, y: 450, tiltDeg: -6 },
    ]);
    const res = scanSleeves(sc.img, { markerIds: SET, budgetMs: 1e9 });
    expect(res.sleeves.filter((s) => s.id === '315')).toEqual([]);
    expect(res.duplicates).toContain('315');
  });

  it('the time cap returns partial results', () => {
    const sc = scene('fence', [{ id: '315', distM: 4, x: 400.4, y: 450, tiltDeg: 6 }]);
    let t = 0;
    const res = scanSleeves(sc.img, { markerIds: SET, budgetMs: 5, now: () => (t += 1) });
    expect(res.partial).toBe(true);
  });
});
