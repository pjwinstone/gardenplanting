/**
 * Positions for the step bar, the sheet, and the thumb control.
 * The menu button matches `.hamburger` in style.css:
 * 2.75rem square, bottom/right max(0.65rem, safe-area inset).
 * Chrome from this module is what the guided UI places, and what the layout test checks.
 */

export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ChromeMetrics {
  width: number;
  height: number;
  insets: SafeInsets;
  /** Root font size. The app does not change it. 16px matches 1rem. */
  rem?: number;
  /** Measured height of the collapsed bar. */
  barHeight: number;
  /** Measured height of the sheet, before the menu clearance clamps it. */
  sheetHeight: number;
  /** Measured width of the thumb pill. */
  thumbWidth?: number;
}

export interface ChromeRects {
  menu: Rect;
  bar: Rect;
  sheet: Rect;
  thumb: Rect;
  /** Top of the point dialog so it clears the bar. */
  dialogTop: number;
}

const MENU_REM = 2.75;
const MENU_EDGE_REM = 0.65;
const GAP = 12;
const THUMB_HEIGHT = 56;

function menuEdge(inset: number, rem: number): number {
  return Math.max(MENU_EDGE_REM * rem, inset);
}

export function menuButtonRect(width: number, height: number, insets: SafeInsets, rem = 16): Rect {
  const size = MENU_REM * rem;
  const right = menuEdge(insets.right, rem);
  const bottom = menuEdge(insets.bottom, rem);
  return { x: width - right - size, y: height - bottom - size, w: size, h: size };
}

export function workflowChromeRects(m: ChromeMetrics): ChromeRects {
  const rem = m.rem ?? 16;
  const menu = menuButtonRect(m.width, m.height, m.insets, rem);
  const left = m.insets.left + GAP;
  const rightInset = m.insets.right + GAP;
  const barMax = Math.max(0, menu.y - GAP - m.insets.top);
  const bar: Rect = {
    x: left,
    y: m.insets.top,
    w: Math.max(0, m.width - left - rightInset),
    h: Math.max(0, Math.min(m.barHeight, barMax)),
  };
  const sheetMax = menu.y - GAP - m.insets.top;
  const sheet: Rect = {
    x: left,
    y: m.insets.top,
    w: bar.w,
    h: Math.max(0, Math.min(m.sheetHeight, sheetMax)),
  };
  const thumbW = m.thumbWidth ?? 120;
  const thumb: Rect = {
    x: menu.x - GAP - thumbW,
    y: menu.y + menu.h - THUMB_HEIGHT,
    w: thumbW,
    h: THUMB_HEIGHT,
  };
  return {
    menu,
    bar,
    sheet,
    thumb,
    dialogTop: bar.y + bar.h + 8,
  };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function gapBetween(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
  if (dx === 0 && dy === 0) return 0;
  if (dx === 0) return dy;
  if (dy === 0) return dx;
  return Math.hypot(dx, dy);
}

/** Read the safe area the stylesheet published as custom properties. */
export function readSafeInsets(doc: Document): SafeInsets {
  const cs = doc.defaultView?.getComputedStyle(doc.documentElement);
  const px = (name: string) => {
    const raw = cs?.getPropertyValue(name).trim() ?? '';
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    top: px('--wf-safe-top'),
    right: px('--wf-safe-right'),
    bottom: px('--wf-safe-bottom'),
    left: px('--wf-safe-left'),
  };
}

export function placeRect(el: HTMLElement, rect: Rect): void {
  el.style.position = 'absolute';
  el.style.left = `${rect.x}px`;
  el.style.top = `${rect.y}px`;
  el.style.width = `${rect.w}px`;
  el.style.height = `${rect.h}px`;
}
