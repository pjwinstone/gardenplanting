/**
 * Base point list (shared by Home and the circle test's "Grow the base grid" step). Its own
 * scroll area: touches, wheel and scroll inside it never reach the roller. Tap a base point to
 * edit it (Add point > Base point, filled in). A diagonal warning shows amber/red with the reason.
 */
import { baseGridOf, baseNetworkForDoc, baseWarnings, primaryTie } from '../baseGrid';
import type { GardenDocument } from '../model';
import { pointNet, t } from './stepNet';

/**
 * Keep scrolling inside `node` away from the roller wheel (or the plan). Only gestures that
 * move or scroll are stopped; touchend/pointerup/click still bubble, so a tap still lands.
 */
export function containScroll(node: HTMLElement): void {
  for (const type of ['touchmove', 'pointermove', 'wheel', 'scroll'] as const) {
    node.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
  }
  // The roller starts a gesture on touchstart/pointerdown; it must not see one that began here.
  for (const type of ['touchstart', 'pointerdown'] as const) {
    node.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
  }
}

/** Finger travel below this (px) is a tap; above it the list was scrolled or swiped. */
export const TAP_SLOP_PX = 10;
/** Leftward travel beyond this (px), mostly sideways, reveals Delete. */
export const SWIPE_PX = 40;

export type RowGesture = 'tap' | 'scroll' | 'swipe-left' | 'swipe-right';

/** Classify one finger gesture on a row from its total travel (pure, for tests). */
export function classifyGesture(dx: number, dy: number): RowGesture {
  if (Math.hypot(dx, dy) < TAP_SLOP_PX) return 'tap';
  if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 2 * Math.abs(dy)) return dx < 0 ? 'swipe-left' : 'swipe-right';
  return 'scroll';
}

/** One line under the list title (deleted, or why BAS01 stays); cleared after it is shown once. */
let listNotice: string | null = null;
export function setListNotice(text: string | null): void {
  listNotice = text;
}

/** Rows with Delete showing (survives a redraw). */
const swiped = new Set<string>();
export function clearSwiped(): void {
  swiped.clear();
}

/**
 * Track one gesture on a row. A scroll or swipe swallows the click that follows it, so ending
 * a scroll on a row never opens it; a swipe left reveals Delete, a swipe right hides it.
 */
export function wireRowGestures(item: HTMLElement, id: string): void {
  let start: { x: number; y: number } | null = null;
  let last: RowGesture = 'tap';
  const at = (e: PointerEvent | TouchEvent) => ('touches' in e ? (e.touches[0] ?? e.changedTouches[0]) : e);
  const down = (e: PointerEvent | TouchEvent) => {
    const p = at(e);
    if (!p) return;
    start = { x: p.clientX, y: p.clientY };
    last = 'tap';
  };
  const move = (e: PointerEvent | TouchEvent) => {
    const p = at(e);
    if (!start || !p) return;
    const g = classifyGesture(p.clientX - start.x, p.clientY - start.y);
    if (g !== 'tap') last = g;
  };
  const up = () => {
    if (!start) return;
    start = null;
    if (last === 'swipe-left') swiped.add(id);
    if (last === 'swipe-right') swiped.delete(id);
    item.classList.toggle('base-list-swiped', swiped.has(id));
  };
  item.addEventListener('pointerdown', down, { passive: true });
  item.addEventListener('pointermove', move, { passive: true });
  item.addEventListener('pointerup', up, { passive: true });
  item.addEventListener('touchstart', down, { passive: true });
  item.addEventListener('touchmove', move, { passive: true });
  item.addEventListener('touchend', up, { passive: true });
  item.addEventListener('pointercancel', () => { start = null; last = 'scroll'; }, { passive: true });
  // Capture phase on the item: runs before the shell's click handler sees the row.
  item.addEventListener('click', (e) => {
    if (last !== 'tap') {
      e.stopPropagation();
      e.preventDefault();
      last = 'tap';
    }
  }, true);
}

/** Confirm text for deleting a base point (pure, for tests). */
export function deleteConfirmText(_doc: GardenDocument, id: string): string {
  return t(pointNet, 'delete_confirm', { id });
}

export interface BasePointRow {
  id: string;
  line: string;
  warning?: string;
  level?: 'amber' | 'red';
  /** Deleted: greyed, not a marker any more, still links the grid. */
  deleted?: boolean;
}

/** Rows for the list (pure, for tests). */
export function basePointRows(doc: GardenDocument): BasePointRow[] {
  const grid = baseGridOf(doc);
  const net = baseNetworkForDoc(doc);
  const warn = baseWarnings(doc);
  const live = grid.ids.map((id) => ({ id, deleted: false }));
  const gone = grid.deletedIds.map((id) => ({ id, deleted: true }));
  return [...live, ...gone].map(({ id, deleted }) => {
    const xy = id === 'BAS01' ? { x: 0, y: 0 } : net?.points[id];
    const tie = primaryTie(doc, id);
    const sep = grid.postSeparation[id];
    const parts = [
      xy ? t(pointNet, 'list_position', { n: xy.y.toFixed(3), e: xy.x.toFixed(3) }) : t(pointNet, 'list_not_placed'),
      tie ? t(pointNet, 'list_from', { from: tie.from }) : '',
      sep ? t(pointNet, 'list_post', { sep: sep.toFixed(2) }) : '',
    ].filter(Boolean);
    const w = warn[id];
    if (deleted) return { id, line: parts.join(' · '), warning: t(pointNet, 'list_deleted'), deleted: true };
    return { id, line: parts.join(' · '), ...(w ? { warning: w.text, level: Math.abs(w.w) > 2 * 3.29 ? ('red' as const) : ('amber' as const) } : {}) };
  });
}

export function renderBasePointList(doc: GardenDocument): HTMLElement {
  const box = document.createElement('div');
  box.className = 'base-list';
  box.dataset.testid = 'base-point-list';
  containScroll(box);
  const head = document.createElement('div');
  head.className = 'base-list-head';
  head.textContent = t(pointNet, 'list_title', { n: baseGridOf(doc).ids.length });
  box.append(head);
  if (listNotice) {
    const n = document.createElement('p');
    n.className = 'workflow-notice';
    n.dataset.testid = 'base-list-notice';
    n.textContent = listNotice;
    box.append(n);
    listNotice = null;
  }
  const rows = basePointRows(doc);
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'screen-muted';
    p.textContent = t(pointNet, 'list_empty');
    box.append(p);
  }
  for (const r of rows) {
    const item = document.createElement('div');
    item.className = 'base-list-item' + (swiped.has(r.id) ? ' base-list-swiped' : '');
    item.dataset.testid = `base-item-${r.id}`;
    wireRowGestures(item, r.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'base-list-row' + (r.level ? ` base-list-${r.level}` : '') + (r.deleted ? ' base-list-deleted' : '');
    b.dataset.cmd = 'screen-edit-base';
    b.dataset.value = r.id;
    b.dataset.testid = `base-row-${r.id}`;
    const title = document.createElement('b');
    title.textContent = r.id;
    const line = document.createElement('span');
    line.textContent = r.line;
    b.append(title, line);
    if (r.warning) {
      const w = document.createElement('small');
      w.textContent = r.warning;
      b.append(w);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = r.deleted ? 'base-list-restore' : 'base-list-delete';
    del.dataset.cmd = r.deleted ? 'screen-restore-base' : 'screen-delete-base';
    del.dataset.value = r.id;
    del.dataset.testid = `base-${r.deleted ? 'restore' : 'delete'}-${r.id}`;
    del.textContent = t(pointNet, r.deleted ? 'list_restore' : 'list_delete');
    item.append(b, del);
    box.append(item);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'screen-btn';
  add.dataset.cmd = 'screen-add-base';
  add.dataset.testid = 'base-list-add';
  add.textContent = t(pointNet, 'list_add');
  box.append(add);
  return box;
}
