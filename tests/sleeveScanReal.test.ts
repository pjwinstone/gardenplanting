/**
 * Harness for real iPhone photos (tests/fixtures/real/README.md). Skips while the folder has no
 * labelled fixtures.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanSleeves } from '../src/workflows/guided/sleeveScan';
import { GARDEN_MARKER_IDS } from '../src/workflows/guided/markerSet';

const DIR = join(__dirname, 'fixtures', 'real');
const AXIS_TOL_PX = 0.3;

interface RealFixture {
  image: string;
  markerIds?: string[];
  sleeves: { id: string; axisX: number; midY: number; bandPx?: number }[];
  note?: string;
}

/** 8-bit binary PGM (P5). */
export function readPgm(buf: Buffer): { width: number; height: number; grey: Uint8Array } {
  let pos = 0;
  const token = (): string => {
    for (;;) {
      while (pos < buf.length && /\s/.test(String.fromCharCode(buf[pos]))) pos += 1;
      if (buf[pos] === 0x23) { while (pos < buf.length && buf[pos] !== 0x0a) pos += 1; continue; }
      break;
    }
    const start = pos;
    while (pos < buf.length && !/\s/.test(String.fromCharCode(buf[pos]))) pos += 1;
    return buf.subarray(start, pos).toString('ascii');
  };
  if (token() !== 'P5') throw new Error('Not a binary PGM (P5).');
  const width = Number(token());
  const height = Number(token());
  const max = Number(token());
  if (max > 255) throw new Error('Only 8-bit PGM is supported.');
  pos += 1;
  return { width, height, grey: new Uint8Array(buf.buffer, buf.byteOffset + pos, width * height) };
}

const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')).sort() : [];

describe.skipIf(files.length === 0)('real iPhone fixtures', () => {
  it('meets the sim bars on the labelled photos', () => {
    let n = 0; let found = 0; let fp = 0; let worst7 = 0;
    const lines: string[] = [];
    for (const f of files) {
      const fx = JSON.parse(readFileSync(join(DIR, f), 'utf8')) as RealFixture;
      const img = readPgm(readFileSync(join(DIR, fx.image)));
      const res = scanSleeves(img, { markerIds: fx.markerIds ?? GARDEN_MARKER_IDS });
      for (const s of res.sleeves) {
        const t = fx.sleeves.find((q) => q.id === s.id);
        if (!t || Math.abs(s.axisX - t.axisX) > 3) fp += 1;
      }
      let fileFound = 0; let fileN = 0;
      for (const t of fx.sleeves) {
        const s = res.sleeves.find((q) => q.id === t.id);
        // Recall counts sleeves with bands ≥ 4 px (the label's bandPx, else the scan's own when found).
        const band = t.bandPx ?? s?.bandPx;
        if (s) {
          found += 1; n += 1; fileFound += 1; fileN += 1;
          if (s.bandPx >= 7) worst7 = Math.max(worst7, Math.abs(s.axisX - t.axisX));
        } else if (band === undefined || band >= 4) { n += 1; fileN += 1; }
      }
      lines.push(`${f}: ${fileFound}/${fileN} found, ${res.sleeves.length} reported, ${res.ms.toFixed(0)} ms${res.partial ? ' (partial)' : ''}${fx.note ? ` · ${fx.note}` : ''}`);
    }
    process.stderr.write(`[sleeveScan real]\n${lines.join('\n')}\nrecall ${found}/${n}, false positives ${fp}, worst axis-x (bands ≥ 7 px) ${worst7.toFixed(3)} px\n`);
    expect(fp).toBe(0);
    if (n) expect(found / n).toBeGreaterThanOrEqual(0.95);
    expect(worst7).toBeLessThan(AXIS_TOL_PX);
  }, 300_000);
});
