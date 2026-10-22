/**
 * Base point list (shared by Home and the circle test's "Grow the base grid" step). Its own
 * scroll area: touches, wheel and scroll inside it never reach the roller. Tap a base point to
 * edit it (Add point > Base point, filled in). A diagonal warning shows amber/red with the reason.
 */
import { baseGridOf, baseNetworkForDoc, baseWarnings, primaryTie } from '../baseGrid';
import type { GardenDocument } from '../model';
import { pointNet, t } from './stepNet';

/** Stop scroll and touch gestures inside `node` from reaching the roller wheel (or the plan). */
export function containScroll(node: HTMLElement): void {
  for (const type of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointermove', 'pointerup', 'wheel', 'scroll'] as const) {
    node.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
  }
}

export interface BasePointRow {
  id: string;
  line: string;
  warning?: string;
  level?: 'amber' | 'red';
}

/** Rows for the list (pure, for tests). */
export function basePointRows(doc: GardenDocument): BasePointRow[] {
  const grid = baseGridOf(doc);
  const net = baseNetworkForDoc(doc);
  const warn = baseWarnings(doc);
  return grid.ids.map((id) => {
    const xy = id === 'BAS01' ? { x: 0, y: 0 } : net?.points[id];
    const tie = primaryTie(doc, id);
    const sep = grid.postSeparation[id];
    const parts = [
      xy ? t(pointNet, 'list_position', { n: xy.y.toFixed(3), e: xy.x.toFixed(3) }) : t(pointNet, 'list_not_placed'),
      tie ? t(pointNet, 'list_from', { from: tie.from }) : '',
      sep ? t(pointNet, 'list_post', { sep: sep.toFixed(2) }) : '',
    ].filter(Boolean);
    const w = warn[id];
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
  const rows = basePointRows(doc);
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'screen-muted';
    p.textContent = t(pointNet, 'list_empty');
    box.append(p);
  }
  for (const r of rows) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'base-list-row' + (r.level ? ` base-list-${r.level}` : '');
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
    box.append(b);
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
