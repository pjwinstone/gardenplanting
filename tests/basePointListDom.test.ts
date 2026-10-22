// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDocument, type GardenDocument } from '../src/model';
import { deleteBasePoint, upsertBasePoint } from '../src/baseGrid';
import { classifyGesture, clearSwiped, renderBasePointList, SWIPE_PX, TAP_SLOP_PX } from '../src/screens/basePointList';
import * as S from '../src/screens/pointScreen';

function grid(): GardenDocument {
  let d = emptyDocument('g');
  d = upsertBasePoint(d, { id: 'BAS01' });
  d = upsertBasePoint(d, { id: 'BAS02', from: 'BAS01', northM: 0, eastM: 6, diagonalM: 6 });
  d = upsertBasePoint(d, { id: 'BAS03', from: 'BAS02', northM: 4, eastM: 0, diagonalM: 4 });
  return d;
}

/** Mount the list inside a fake roller and a fake shell, like the app does. */
function mount(d: GardenDocument) {
  document.body.innerHTML = '';
  const shell = document.createElement('div');
  const roller = document.createElement('div');
  const seen: string[] = [];
  const rollerSaw: string[] = [];
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend']) roller.addEventListener(type, () => rollerSaw.push(type));
  shell.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-cmd]') as HTMLElement | null;
    if (target) seen.push(`${target.dataset.cmd}:${target.dataset.value}`);
  });
  roller.append(renderBasePointList(d));
  shell.append(roller);
  document.body.append(shell);
  return { shell, seen, rollerSaw };
}

function gesture(row: HTMLElement, dx: number, dy: number) {
  const item = row.closest('.base-list-item') as HTMLElement;
  const ev = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: y });
  row.dispatchEvent(ev('pointerdown', 100, 100));
  row.dispatchEvent(ev('pointermove', 100 + dx / 2, 100 + dy / 2));
  row.dispatchEvent(ev('pointermove', 100 + dx, 100 + dy));
  row.dispatchEvent(ev('pointerup', 100 + dx, 100 + dy));
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return item;
}

describe('base point list: tap vs scroll vs swipe', () => {
  beforeEach(() => clearSwiped());

  it('classifies gestures by travel', () => {
    expect(classifyGesture(0, 0)).toBe('tap');
    expect(classifyGesture(TAP_SLOP_PX - 2, 3)).toBe('tap');
    expect(classifyGesture(2, 40)).toBe('scroll');
    expect(classifyGesture(-SWIPE_PX - 5, 4)).toBe('swipe-left');
    expect(classifyGesture(SWIPE_PX + 5, 4)).toBe('swipe-right');
    expect(classifyGesture(-45, 40)).toBe('scroll');
  });

  it('a tap on a row reaches the shell click handler (opens edit); the roller never sees it start', () => {
    const { seen, rollerSaw } = mount(grid());
    gesture(document.querySelector('[data-testid="base-row-BAS02"]') as HTMLElement, 2, 1);
    expect(seen).toEqual(['screen-edit-base:BAS02']);
    expect(rollerSaw).not.toContain('pointerdown');
    expect(rollerSaw).not.toContain('pointermove');
  });

  it('scrolling the list and lifting on a row does not open it', () => {
    const { seen } = mount(grid());
    gesture(document.querySelector('[data-testid="base-row-BAS02"]') as HTMLElement, 0, 60);
    expect(seen).toEqual([]);
  });

  it('swipe left reveals Delete (no edit); swipe right hides it', () => {
    const { seen } = mount(grid());
    const row = document.querySelector('[data-testid="base-row-BAS03"]') as HTMLElement;
    const item = gesture(row, -80, 3);
    expect(item.classList.contains('base-list-swiped')).toBe(true);
    expect(seen).toEqual([]);
    gesture(row, 80, 3);
    expect(item.classList.contains('base-list-swiped')).toBe(false);
  });

  it('tapping a row opens the prefilled edit, on top of the circle test', () => {
    let d = grid();
    S.installScreens({ getDoc: () => d, setDoc: (x: GardenDocument) => { d = x; }, rerender: () => {}, takePhoto: () => {}, openCircleTest: () => {}, drainArchive: () => {} } as never);
    S.resetScreens();
    const { seen } = mount(d);
    const row = document.querySelector('[data-testid="base-row-BAS02"]') as HTMLElement;
    gesture(row, 1, 1);
    expect(seen).toEqual(['screen-edit-base:BAS02']);
    S.handleScreenCommand('screen-edit-base', row);
    expect(S.currentScreen()).toBe('add-point');
    const sheet = S.renderScreens(d)!;
    expect(sheet.dataset.testid).toBe('base-modal');
    // The base point form must stack above the circle test (workflow-root z-index 36).
    const css = readFileSync('src/screens/screens.css', 'utf8');
    const z = Number(/\.bm-root \{[^}]*z-index: (\d+)/.exec(css)![1]);
    const wf = Number(/\.workflow-root \{[^}]*z-index: (\d+)/.exec(readFileSync('src/workflows/guided/guidedChrome.css', 'utf8'))![1]);
    expect(z).toBeGreaterThan(wf);
  });

  it('a deleted point is greyed with Restore, and a tap still opens its edit', () => {
    const { seen } = mount(deleteBasePoint(grid(), 'BAS02'));
    const row = document.querySelector('[data-testid="base-row-BAS02"]') as HTMLElement;
    expect(row.classList.contains('base-list-deleted')).toBe(true);
    expect(document.querySelector('[data-testid="base-restore-BAS02"]')).toBeTruthy();
    gesture(row, 1, 1);
    expect(seen).toEqual(['screen-edit-base:BAS02']);
  });
});
