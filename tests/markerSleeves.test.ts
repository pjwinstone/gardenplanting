import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CIRCLE_SLEEVES,
  issuedWords,
  renderAllSleevesPdf,
  renderSleevePdf,
} from '../scripts/markerSleeve';

/** The 61 words printed in MARKER_VISION_DESIGN.md. Bank 2 is not in this list. */
const PUBLISHED =
  '222 22D 244 24B 271 28E 293 2B4 2DD 2E7 315 31A 36E 389 447 459 46A 474 48B 495 4A6 4CC 4D2 513 51C 525 5B9 637 6BA 6E9 72B 74D 756 88D 896 8A3 8CA 8D1 919 926 94C 952 96B 975 9BA 9C7 A3B A57 B9C BA5 C6D C73 DAC DB7 DC9 DD4 E24 E4E E99 EC5 EE2';

const markersDir = join(process.cwd(), 'docs/markers');

function pt(mm: number) {
  return (mm * 72) / 25.4;
}

function hamming(a: number, b: number) {
  let x = (a ^ b) & 0xfff;
  let n = 0;
  while (x) {
    n += x & 1;
    x >>= 1;
  }
  return n;
}

function reverse12(word: number) {
  let reversed = 0;
  for (let i = 0; i < 12; i++) reversed = (reversed << 1) | ((word >> i) & 1);
  return reversed & 0xfff;
}

/** MSB under the sync, then down the sleeve to the stop. */
function expectedBits(id: string) {
  const word = Number.parseInt(id, 16);
  let payload = '';
  for (let i = 11; i >= 0; i--) payload += (word >> i) & 1;
  return `11110${payload}01`;
}

function streamsOf(pdf: Buffer) {
  const latin = pdf.toString('latin1');
  const boxes = [...latin.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map(
    (match) => match.slice(1).map(Number),
  );
  const streams = [...latin.matchAll(/stream\n([\s\S]*?)endstream/g)].map((match) => match[1]);
  return { boxes, streams };
}

function rectsOf(stream: string) {
  const rects = [];
  for (const line of stream.split('\n')) {
    const match = line.match(/^(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) re$/);
    if (!match) continue;
    rects.push({ x: Number(match[1]), y: Number(match[2]), w: Number(match[3]), h: Number(match[4]) });
  }
  return rects;
}

function linesOf(stream: string) {
  const lines = stream.split('\n');
  const segs = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const start = lines[i].match(/^(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) m$/);
    const end = lines[i + 1].match(/^(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) l$/);
    if (!start || !end) continue;
    segs.push({
      x1: Number(start[1]),
      y1: Number(start[2]),
      x2: Number(end[1]),
      y2: Number(end[2]),
    });
  }
  return segs;
}

/**
 * Code column on the finished sheet. Top of the page is 297 mm.
 * 5 mm trim + 9 mm legend + 8 mm quiet, then 19 modules of 13 mm.
 * PDF y grows upward, so the top of the code is 297 - 5 - 9 - 8 = 275 mm.
 */
function readBands(stream: string) {
  const rects = rectsOf(stream);
  const wide = rects.filter((rect) => rect.w > pt(150));
  const codeTop = 297 - 5 - 9 - 8;
  let bits = '';
  for (let i = 0; i < 19; i++) {
    const cy = pt(codeTop - (i + 0.5) * 13);
    const cx = pt((16.5 + 205) / 2);
    const on = wide.some(
      (rect) => cx >= rect.x - 1 && cx <= rect.x + rect.w + 1 && cy >= rect.y - 1 && cy <= rect.y + rect.h + 1,
    );
    bits += on ? '1' : '0';
  }
  return { bits, rects, wide };
}

function expectSleevePage(stream: string, box: number[], point: string, id: string) {
  expect(box[0]).toBe(0);
  expect(box[1]).toBe(0);
  expect(Math.abs(box[2] - pt(210))).toBeLessThan(0.02);
  expect(Math.abs(box[3] - pt(297))).toBeLessThan(0.02);

  const { bits, rects, wide } = readBands(stream);
  expect(bits).toBe(expectedBits(id));
  expect(bits.startsWith('11110')).toBe(true);
  expect(bits.endsWith('01')).toBe(true);
  expect(Number.parseInt(bits.slice(5, 17), 2)).toBe(Number.parseInt(id, 16));

  const codeTop = pt(275);
  const topSlot = pt(275 - 0.5 * 13);
  const sync = wide.find((rect) => topSlot >= rect.y - 1 && topSlot <= rect.y + rect.h + 1);
  expect(sync).toBeTruthy();
  expect(Math.abs(sync!.h - pt(52))).toBeLessThan(0.05);
  expect(Math.abs(sync!.y + sync!.h - codeTop)).toBeLessThan(0.05);
  for (const rect of wide) {
    expect(rect.x).toBeLessThanOrEqual(pt(16.5) + 0.5);
    expect(rect.x + rect.w).toBeGreaterThanOrEqual(pt(205) - 0.5);
    const modules = rect.h / pt(13);
    expect(Math.abs(modules - Math.round(modules))).toBeLessThan(0.02);
  }

  const quietYs = [pt(24), pt(279)];
  for (const y of quietYs) {
    const ink = wide.some((rect) => y >= rect.y - 0.2 && y <= rect.y + rect.h + 0.2);
    expect(ink).toBe(false);
  }

  const bar100 = rects.find((rect) => Math.abs(rect.w - pt(100)) < 0.02 && rect.h < pt(3));
  expect(bar100).toBeTruthy();
  const bar50 = rects.find((rect) => Math.abs(rect.h - pt(50)) < 0.02 && rect.w < pt(3));
  expect(bar50).toBeTruthy();

  const trimSegs = linesOf(stream).filter(
    (line) =>
      Math.abs(line.x1 - pt(205)) < 0.02 &&
      Math.abs(line.x2 - pt(205)) < 0.02 &&
      Math.abs(line.y2 - line.y1) > pt(10),
  );
  expect(trimSegs.length).toBeGreaterThan(0);
  for (const line of trimSegs) {
    const y0 = Math.min(line.y1, line.y2);
    const y1 = Math.max(line.y1, line.y2);
    const overlaps = (a: number, b: number) => y1 > a + 0.4 && y0 < b - 0.4;
    expect(overlaps(pt(20), pt(28))).toBe(false);
    expect(overlaps(pt(28), pt(275))).toBe(false);
    expect(overlaps(pt(275), pt(283))).toBe(false);
  }
  const ruler180 = linesOf(stream).find(
    (line) => Math.abs(line.y1 - line.y2) < 0.02 && Math.abs(Math.abs(line.x2 - line.x1) - pt(180)) < 0.05,
  );
  const ruler250 = linesOf(stream).find(
    (line) => Math.abs(line.x1 - line.x2) < 0.02 && Math.abs(Math.abs(line.y2 - line.y1) - pt(250)) < 0.05,
  );
  expect(ruler180).toBeTruthy();
  expect(ruler250).toBeTruthy();

  expect(stream.includes(`(${point})`)).toBe(true);
  expect(stream.includes(`(${id})`)).toBe(true);
  expect(stream.includes('(PRINT AT 100% / ACTUAL SIZE)')).toBe(true);
  expect(stream.includes('(TOP)')).toBe(true);
  expect(stream.includes('(BOTTOM)')).toBe(true);
  expect(stream.includes('(GLUE UNDER)') || stream.includes('GLUE UNDER')).toBe(true);
}

describe('marker sleeves', () => {
  it('rebuilds the published Bank-1 codebook', () => {
    const hex = issuedWords().map((word) => word.toString(16).toUpperCase());
    expect(hex.join(' ')).toBe(PUBLISHED);
    expect(hex).toHaveLength(61);

    const words = hex.map((item) => Number.parseInt(item, 16));
    const set = new Set(words);
    let minDistance = 12;
    for (let i = 0; i < words.length; i++) {
      expect(set.has(reverse12(words[i])) && reverse12(words[i]) !== words[i]).toBe(false);
      expect(set.has((~words[i]) & 0xfff)).toBe(false);
      for (let j = i + 1; j < words.length; j++) minDistance = Math.min(minDistance, hamming(words[i], words[j]));
      for (let a = 0; a < 12; a++) {
        expect(set.has(words[i] ^ (1 << a))).toBe(false);
        for (let b = a + 1; b < 12; b++) {
          expect(set.has(words[i] ^ (1 << a) ^ (1 << b))).toBe(false);
          for (let c = b + 1; c < 12; c++) {
            expect(set.has(words[i] ^ (1 << a) ^ (1 << b) ^ (1 << c))).toBe(false);
          }
        }
      }
    }
    expect(minDistance).toBeGreaterThanOrEqual(4);
  });

  it('assigns circle rods codes at least distance 6, with no 4-band burst pair', () => {
    const issued = new Set(PUBLISHED.split(' '));
    expect(CIRCLE_SLEEVES).toEqual([
      { point: 'BAS01', id: '315' },
      { point: 'BAS02', id: '36E' },
      { point: 'CRC01', id: '459' },
      { point: 'CRC02', id: '6BA' },
      { point: 'CRC03', id: '8A3' },
      { point: 'CRC04', id: '952' },
      { point: 'CRC05', id: 'DAC' },
      { point: 'CRC06', id: 'EC5' },
    ]);
    const words = CIRCLE_SLEEVES.map((sleeve) => {
      expect(issued.has(sleeve.id)).toBe(true);
      return Number.parseInt(sleeve.id, 16);
    });
    for (let i = 0; i < words.length; i++) {
      for (let j = i + 1; j < words.length; j++) {
        expect(hamming(words[i], words[j])).toBeGreaterThanOrEqual(6);
        expect(differsOnlyInFourBandBurst(words[i], words[j])).toBe(false);
      }
    }
  });

  it('decodes every circle sleeve and checks the page and the 100 mm bar', () => {
    expect(CIRCLE_SLEEVES.map((sleeve) => sleeve.point)).toEqual([
      'BAS01',
      'BAS02',
      'CRC01',
      'CRC02',
      'CRC03',
      'CRC04',
      'CRC05',
      'CRC06',
    ]);
    const seen = new Set<string>();
    for (const sleeve of CIRCLE_SLEEVES) {
      expect(seen.has(sleeve.id)).toBe(false);
      seen.add(sleeve.id);
      const pdf = readFileSync(join(markersDir, `${sleeve.point}.pdf`));
      expect(Buffer.compare(pdf, renderSleevePdf(sleeve))).toBe(0);
      const { boxes, streams } = streamsOf(pdf);
      expect(streams).toHaveLength(1);
      expectSleevePage(streams[0], boxes[0], sleeve.point, sleeve.id);
    }

    const all = readFileSync(join(markersDir, 'all-sleeves.pdf'));
    expect(Buffer.compare(all, renderAllSleevesPdf())).toBe(0);
    const combined = streamsOf(all);
    expect(combined.streams).toHaveLength(CIRCLE_SLEEVES.length);
    CIRCLE_SLEEVES.forEach((sleeve, index) => {
      expectSleevePage(combined.streams[index], combined.boxes[index], sleeve.point, sleeve.id);
    });
  });

  it('decodes a 300 dpi render of every sleeve', (context) => {
    if (!pdftoppmAvailable()) context.skip();
    const dir = mkdtempSync(join(tmpdir(), 'sleeve-render-'));
    try {
      const pdf = join(markersDir, 'all-sleeves.pdf');
      execFileSync('pdftoppm', ['-r', '300', pdf, join(dir, 'page')], { stdio: 'ignore' });
      CIRCLE_SLEEVES.forEach((sleeve, index) => {
        const page = parsePpm(readFileSync(join(dir, `page-${index + 1}.ppm`)));
        expect(Math.abs(page.width - (210 / 25.4) * 300)).toBeLessThanOrEqual(2);
        expect(Math.abs(page.height - (297 / 25.4) * 300)).toBeLessThanOrEqual(2);
        expect(readPixels(page)).toBe(expectedBits(sleeve.id));
        const barMm = (blackRunNear(page, 285.8, 22) / page.width) * 210;
        expect(Math.abs(barMm - 100)).toBeLessThanOrEqual(0.5);
        expect(isBlack(page, mmX(page, 204.85), mmY(page, 18))).toBe(false);
        expect(isBlack(page, mmX(page, 204.85), mmY(page, 273))).toBe(false);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function differsOnlyInFourBandBurst(a: number, b: number) {
  const positions: number[] = [];
  let xor = (a ^ b) & 0xfff;
  for (let i = 0; i < 12; xor >>= 1, i++) if (xor & 1) positions.push(i);
  if (positions.length === 0) return false;
  return positions[positions.length - 1] - positions[0] + 1 <= 4;
}

function pdftoppmAvailable() {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
    return true;
  } catch (err) {
    return !(err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT');
  }
}

function parsePpm(buf: Buffer) {
  if (buf[0] !== 0x50 || buf[1] !== 0x36) throw new Error('render is not a P6 PPM');
  let i = 2;
  const tokens: string[] = [];
  while (tokens.length < 3) {
    while (i < buf.length && buf[i] <= 0x20) i += 1;
    if (buf[i] === 0x23) {
      while (i < buf.length && buf[i] !== 0x0a) i += 1;
      continue;
    }
    const start = i;
    while (i < buf.length && buf[i] > 0x20) i += 1;
    tokens.push(buf.toString('ascii', start, i));
  }
  if (i < buf.length && buf[i] <= 0x20) i += 1;
  const width = Number(tokens[0]);
  const height = Number(tokens[1]);
  if (tokens[2] !== '255') throw new Error(`PPM maxval ${tokens[2]}`);
  const rgb = buf.subarray(i, i + width * height * 3);
  if (rgb.length !== width * height * 3) throw new Error('PPM is short');
  return { width, height, rgb };
}

function mmX(page: { width: number }, mm: number) {
  return Math.round((mm / 210) * page.width);
}

function mmY(page: { height: number }, mmFromTop: number) {
  return Math.round((mmFromTop / 297) * page.height);
}

function isBlack(page: { width: number; rgb: Buffer }, x: number, y: number) {
  const offset = (y * page.width + x) * 3;
  return page.rgb[offset] < 128 && page.rgb[offset + 1] < 128 && page.rgb[offset + 2] < 128;
}

/** Nineteen band centres, MSB at the top, sampled in the middle of the pattern. */
function readPixels(page: { width: number; height: number; rgb: Buffer }) {
  const x = mmX(page, (16.5 + 205) / 2);
  let bits = '';
  for (let i = 0; i < 19; i++) {
    const y = mmY(page, 5 + 9 + 8 + (i + 0.5) * 13);
    bits += isBlack(page, x, y) ? '1' : '0';
  }
  return bits;
}

function blackRunNear(page: { width: number; height: number; rgb: Buffer }, yFromTopMm: number, xMm: number) {
  const y = mmY(page, yFromTopMm);
  const origin = mmX(page, xMm);
  let start = origin;
  while (start > 0 && isBlack(page, start - 1, y)) start -= 1;
  let end = origin;
  while (end < page.width && isBlack(page, end, y)) end += 1;
  return end - start;
}
