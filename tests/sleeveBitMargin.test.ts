/** Bit margin (vision review): a partly covered sleeve must not slide into another garden ID. */
import { describe, expect, it } from 'vitest';
import { render } from './fixtures/sleeveSim';
import { sleeveBits } from '../scripts/markerSleeve';
import { BIT_MARGIN_FRACTION, detectSleeve } from '../src/workflows/guided/sleeveDetect';
import { scanSleeves } from '../src/workflows/guided/sleeveScan';
import { GARDEN_MARKER_IDS } from '../src/workflows/guided/markerSet';
import tolerances from '../workflow/tolerances.json';

const BLACK = 0.04;
const WHITE = 0.8;
const MID = (BLACK + WHITE) / 2;

/** 315 with the four payload bands where it differs from 389 (another garden ID) half covered. */
function occluded(push: number) {
  const a = sleeveBits('315');
  const b = sleeveBits('389');
  const diff = [...a].map((c, k) => (c !== b[k] ? k : -1)).filter((k) => k >= 0);
  // A grey-green leaf over part of each band: its mean lands just past the midpoint, on 389's side.
  const bandRefl = Object.fromEntries(diff.map((k) => [k, b[k] === '1' ? MID - push * (WHITE - BLACK) : MID + push * (WHITE - BLACK)]));
  return { diff, sim: render({ sleevePx: 460, sigma: 1.2, gamma: true, grad: 0, lambert: false, usm: 0, expo: 1, bits: a, bandRefl }) };
}

describe('sleeve bit margin', () => {
  it('margin is a tolerances.json key (0.25)', () => {
    expect(tolerances.sleeveBitMarginFraction).toBe(0.25);
    expect(BIT_MARGIN_FRACTION).toBe(0.25);
  });

  it('4 bits flipped by partial occlusion into another garden ID: without the margin it reads 389; with it, rejected, no pin', () => {
    const { diff, sim } = occluded(0.1);
    expect(diff).toHaveLength(4);
    expect(GARDEN_MARKER_IDS).toEqual(expect.arrayContaining(['315', '389']));
    const tapY = (sim.codeTop + sim.codeBot) / 2;
    const off = detectSleeve(sim.img, sim.cx, tapY, { bitMarginFraction: 0 });
    expect(off?.id).toBe('389'); // the attack works with no margin
    expect(off!.confidence).toBeGreaterThan(0);
    const on = detectSleeve(sim.img, sim.cx, tapY);
    expect(on?.confidence).toBe(0);
    expect(on?.reasons.join(' ')).toMatch(/too close to grey to read safely/);
    const scan = scanSleeves(sim.img, { markerIds: GARDEN_MARKER_IDS, budgetMs: 1e9 });
    expect(scan.sleeves).toEqual([]);
  });

  it('a clean sleeve still reads', () => {
    const sim = render({ sleevePx: 460, sigma: 1.2, gamma: true, grad: 0, lambert: false, usm: 0, expo: 1, bits: sleeveBits('315') });
    const d = detectSleeve(sim.img, sim.cx, (sim.codeTop + sim.codeBot) / 2);
    expect(d?.id).toBe('315');
    expect(d!.confidence).toBeGreaterThan(0);
  });
});
