import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LANDSCAPE_BAR_MAX_PX,
  gapBetween,
  menuButtonRect,
  rectsIntersect,
  workflowChromeRects,
  type SafeInsets,
} from '../src/workflows/guided/layout';

/**
 * Playwright is not installed in CI. The chrome and this test share
 * workflowChromeRects, and the UI writes those boxes as inline styles.
 */

const PHONE: SafeInsets = { top: 59, bottom: 34, left: 0, right: 0 };
const LANDSCAPE: SafeInsets = { top: 0, bottom: 21, left: 59, right: 59 };

function expectClearance(width: number, height: number, insets: SafeInsets, barHeight: number, sheetHeight: number): void {
  const rects = workflowChromeRects({
    width,
    height,
    insets,
    barHeight,
    sheetHeight,
    thumbWidth: 120,
    rem: 16,
  });
  expect(rectsIntersect(rects.bar, rects.menu)).toBe(false);
  expect(rectsIntersect(rects.sheet, rects.menu)).toBe(false);
  expect(rectsIntersect(rects.thumb, rects.menu)).toBe(false);
  expect(gapBetween(rects.bar, rects.menu)).toBeGreaterThanOrEqual(12);
  expect(gapBetween(rects.sheet, rects.menu)).toBeGreaterThanOrEqual(12);
  expect(gapBetween(rects.thumb, rects.menu)).toBeGreaterThanOrEqual(12);
  expect(rects.thumb.y + rects.thumb.h).toBeCloseTo(rects.menu.y + rects.menu.h, 5);
  expect(rects.dialogTop).toBe(rects.bar.y + rects.bar.h + 8);
  expect(rects.bar.y).toBe(insets.top);
  expect(rects.bar.x).toBeGreaterThanOrEqual(insets.left);
  expect(rects.bar.x + rects.bar.w).toBeLessThanOrEqual(width - insets.right);
}

describe('workflow chrome layout', () => {
  it('clears the menu button at 375, 393, and 430 with safe-area insets', () => {
    for (const width of [375, 393, 430]) {
      expectClearance(width, 852, PHONE, 200, 640);
      expectClearance(width, 812, PHONE, 220, 900);
    }
    expectClearance(852, 393, LANDSCAPE, 180, 500);
  });

  it('clamps a tall bar so it still stops 12px above the menu', () => {
    const rects = workflowChromeRects({
      width: 393,
      height: 852,
      insets: PHONE,
      barHeight: 900,
      sheetHeight: 900,
      thumbWidth: 120,
    });
    expect(rects.bar.y + rects.bar.h).toBeLessThanOrEqual(rects.menu.y - 12);
    expect(rectsIntersect(rects.bar, rects.menu)).toBe(false);
    const menu = menuButtonRect(393, 852, PHONE);
    expect(menu.w).toBe(44);
    expect(menu.h).toBe(44);
  });

  it('keeps a landscape phone bar within 110px at 844×390', () => {
    const barHeight = 104;
    expect(barHeight).toBeLessThanOrEqual(LANDSCAPE_BAR_MAX_PX);
    const rects = workflowChromeRects({
      width: 844,
      height: 390,
      insets: { top: 0, right: 0, bottom: 21, left: 47 },
      barHeight,
      sheetHeight: 320,
      thumbWidth: 88,
    });
    expect(rects.bar.h).toBeLessThanOrEqual(LANDSCAPE_BAR_MAX_PX);
    expect(rectsIntersect(rects.bar, rects.menu)).toBe(false);
    expect(gapBetween(rects.bar, rects.menu)).toBeGreaterThanOrEqual(12);
    const css = readFileSync(new URL('../src/workflows/guided/guidedChrome.css', import.meta.url), 'utf8');
    expect(css).toContain('max-height: 420px');
    expect(css).toContain('orientation: landscape');
    expect(css).toContain('text-overflow: ellipsis');
    expect(css).toContain('white-space: nowrap');
  });
});
