/**
 * Circle test edge points: the list (same pattern as the base point list: its own scroll, tap
 * vs scroll vs swipe, Delete / Restore) and the full-screen edge point pop-up (same style as the
 * base point form). Wording: workflow/point.net.yaml.
 */
import type { GardenDocument, Photo } from '../../model';
import { containScroll, wireRowGestures } from '../../screens/basePointList';
import { pointNet, t } from '../../screens/stepNet';
import type { CircleResultDetail, EdgePointRow } from './circleResult';
import type { WorkflowRun } from './types';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function btn(text: string, cmd: string, cls: string, data: Record<string, string> = {}, testid?: string): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  b.dataset.cmd = cmd;
  for (const [k, v] of Object.entries(data)) b.dataset[k] = v;
  if (testid) b.dataset.testid = testid;
  return b;
}

export function residualText(r: EdgePointRow): string {
  if (r.residualMm === undefined) return t(pointNet, 'edge_no_residual');
  const mm = Math.round(r.residualMm);
  return t(pointNet, 'edge_residual', { mm: `${mm > 0 ? '+' : ''}${mm}` });
}

/** The fitted circle so far, one or two lines (shown from 3 edge points). */
export function renderEdgeFitSummary(detail: CircleResultDetail): HTMLElement {
  const box = el('div', `edge-fit edge-fit--${detail.verdict.state}`);
  box.dataset.testid = 'edge-fit';
  box.append(el('b', '', t(pointNet, 'edge_fit_title')));
  box.append(el('p', '', detail.verdict.headline));
  const line = edgeFitLine(detail);
  if (line) box.append(el('p', 'edge-fit-num', line));
  return box;
}

/** '⌀ 12.001 m ± 12 mm · 8 points · rms 7 mm', or '' before a fit. */
export function edgeFitLine(detail: CircleResultDetail): string {
  const fit = detail.verdict.fit;
  if (!fit) return '';
  const n = detail.fitIds?.length ?? 0;
  // No redundancy: exact through the points, so no ± or rms to show.
  if (fit.dof <= 0) return `⌀ ${fit.diameterM.toFixed(3)} m · ${n} points · exact fit, no check possible`;
  return `⌀ ${fit.diameterM.toFixed(3)} m ± ${Math.round(fit.sigmaDM * 1000)} mm · ${n} points · rms ${Math.round(fit.rmsM * 1000)} mm`;
}

/** One line, no log: '8 points · 5 pass · 2 amber · 1 red · 1 deleted'. */
export function edgeSummaryText(rows: EdgePointRow[]): string {
  const live = rows.filter((r) => !r.deleted);
  const c = (lv: string) => live.filter((r) => r.level === lv).length;
  // Grey points are in the fit (only unchecked); only 'unused' ones are left out of it.
  const unused = c('unused');
  const grey = c('grey');
  return t(pointNet, 'edge_summary', { n: rows.length, pass: c('green'), amber: c('amber'), red: c('red'), deleted: rows.length - live.length })
    + (grey ? t(pointNet, 'edge_summary_grey', { grey }) : '')
    + (unused ? t(pointNet, 'edge_summary_unused', { unused }) : '');
}

/**
 * A button for one child substage: its name, and under it whether it is available (or why not)
 * and what it does / why now. Not available = still shown, disabled, with the reason.
 */
export function substageButton(label: string, cmd: string, testid: string, why: string, opts: { disabled?: boolean; primary?: boolean; data?: Record<string, string> } = {}): HTMLButtonElement {
  const b = btn('', cmd, `screen-btn substage-btn${opts.primary ? ' screen-primary' : ''}`, opts.data ?? {}, testid);
  b.append(el('b', 'substage-name', label), el('small', 'substage-why', why));
  b.dataset.why = why;
  if (opts.disabled) {
    b.disabled = true;
    b.setAttribute('aria-disabled', 'true');
  }
  return b;
}

export function renderEdgeList(rows: EdgePointRow[], opts: { focus?: string | null } = {}): HTMLElement {
  const box = el('div', 'base-list edge-list');
  box.dataset.testid = 'edge-point-list';
  containScroll(box);
  box.append(el('div', 'base-list-head', t(pointNet, 'edge_list_title', { n: rows.filter((r) => !r.deleted).length })));
  if (!rows.length) box.append(el('p', 'roller-hint', t(pointNet, 'edge_list_empty')));
  for (const r of rows) {
    const item = el('div', 'base-list-item');
    item.dataset.testid = `edge-item-${r.id}`;
    wireRowGestures(item, r.id);
    if (opts.focus === r.id) item.classList.add('edge-item--focus');
    const b = btn('', 'workflow-edge-open', `base-list-row edge-row edge-row--${r.level}${r.deleted ? ' base-list-deleted' : ''}${opts.focus === r.id ? ' edge-row--focus' : ''}`, { value: r.photoId, point: r.id }, `edge-row-${r.id}`);
    const head = el('span', 'edge-row-head');
    head.append(el('span', `edge-dot edge-dot--${r.level}`), el('b', '', r.id), el('span', 'edge-row-level', t(pointNet, `edge_level_${r.level}`)));
    b.append(head, el('span', 'edge-row-res', r.deleted ? t(pointNet, 'edge_modal_deleted') : residualText(r)));
    if (r.reason && !r.deleted) b.append(el('small', '', r.reason));
    const side = r.deleted
      ? btn(t(pointNet, 'list_restore'), 'workflow-edge-restore', 'base-list-restore', { value: r.photoId, point: r.id }, `edge-restore-${r.id}`)
      : btn(t(pointNet, 'list_delete'), 'workflow-edge-delete', 'base-list-delete', { value: r.photoId, point: r.id }, `edge-delete-${r.id}`);
    item.append(b, side);
    box.append(item);
  }
  return box;
}

/**
 * Full-screen pop-up for one edge point: heading, colour, residual and reason, the photo (with
 * Edit taps and Retake), the note, Delete or Restore; Cancel / Save fixed at the bottom. Its body
 * scrolls, so everything is reachable on a small phone.
 */
export function renderEdgeModal(opts: {
  row: EdgePointRow;
  photo: Photo | undefined;
  run: WorkflowRun;
  note: string;
  onNote: (text: string) => void;
  doc: GardenDocument | null;
}): HTMLElement {
  const { row, photo, note } = opts;
  const root = el('div', 'bm-root edge-modal');
  root.dataset.testid = 'edge-modal';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  const head = el('header', 'bm-head');
  const title = el('h2', 'bm-title', t(pointNet, 'edge_modal_title', { id: row.id }));
  title.dataset.testid = 'edge-modal-title';
  head.append(title);
  const status = el('p', `bm-sub edge-status edge-row--${row.level}`);
  status.dataset.testid = 'edge-modal-status';
  status.append(el('span', `edge-dot edge-dot--${row.level}`), document.createTextNode(` ${t(pointNet, `edge_level_${row.level}`)} · ${row.deleted ? t(pointNet, 'edge_modal_deleted') : residualText(row)}`));
  head.append(status);
  const body = el('div', 'bm-body');
  body.dataset.testid = 'edge-modal-body';
  containScroll(body);
  if (row.reason) body.append(el('p', 'bm-note', row.reason));
  body.append(el('b', 'bm-label', t(pointNet, 'edge_modal_photo')));
  // Retake first, full width, right above the photo: opens the retake screen (previous vs current),
  // the same one the photo strip opens.
  if (photo) body.append(el('p', 'roller-hint', t(pointNet, 'edge_retake_why')));
  if (photo) body.append(btn(t(pointNet, 'edge_modal_retake_btn', { id: row.id }), 'workflow-photos', 'screen-btn screen-primary edge-modal-retake', { step: 'edge-photos', photo: photo.id }, 'edge-modal-retake'));
  if (photo?.thumbnailDataUrl) {
    const img = el('img', 'edge-modal-photo');
    img.src = photo.thumbnailDataUrl;
    img.alt = `${row.id} photo`;
    img.dataset.testid = 'edge-modal-photo';
    body.append(img);
  }
  if (photo) body.append(el('p', 'roller-hint', photo.originalFile?.fileName ?? photo.id));
  const tapped = [...new Set((photo?.clicks ?? []).map((c) => c.pointId).filter((id) => /^BAS\d+$/.test(id)))].sort();
  body.append(el('p', 'bm-note', tapped.length ? t(pointNet, 'edge_modal_taps', { ids: tapped.join(', ') }) : t(pointNet, 'edge_modal_no_taps')));
  const acts = el('div', 'bm-row edge-modal-acts');
  if (photo) {
    const taps = btn(t(pointNet, 'edge_modal_edit_taps'), 'open-photo-mark', 'screen-btn', { photoId: photo.id }, 'edge-modal-taps');
    acts.append(taps);
  }
  body.append(acts);
  const noteWrap = el('label', 'bm-field');
  noteWrap.append(el('span', 'bm-label', t(pointNet, 'edge_modal_note')));
  const area = el('textarea', 'bm-input edge-note');
  area.rows = 3;
  area.value = note;
  area.dataset.testid = 'edge-modal-note';
  area.dataset.field = 'edge-note';
  // Typing keeps a draft only: no redraw, so the keyboard and caret stay put.
  area.addEventListener('input', () => opts.onNote(area.value));
  noteWrap.append(area);
  body.append(noteWrap);
  body.append(row.deleted
    ? btn(t(pointNet, 'edge_modal_restore'), 'workflow-edge-restore', 'screen-btn', { value: row.photoId, point: row.id }, 'edge-modal-restore')
    : btn(t(pointNet, 'edge_modal_delete'), 'workflow-edge-delete', 'screen-btn edge-modal-delete', { value: row.photoId, point: row.id }, 'edge-modal-delete'));
  const foot = el('footer', 'bm-foot');
  const btns = el('div', 'bm-btns');
  btns.append(
    btn(t(pointNet, 'edge_modal_cancel'), 'workflow-edge-cancel', 'screen-btn', {}, 'edge-modal-cancel'),
    btn(t(pointNet, 'edge_modal_save'), 'workflow-edge-save', 'screen-btn screen-primary', { point: row.id }, 'edge-modal-save'),
  );
  foot.append(btns);
  root.append(head, body, foot);
  return root;
}

/** The step's Photos viewer as the same full-screen pop-up: header, scrolling body, Close. */
export function wrapViewerModal(title: string, content: HTMLElement[]): HTMLElement {
  const root = el('div', 'bm-root viewer-modal');
  root.dataset.testid = 'workflow-photos-viewer';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  const head = el('header', 'bm-head');
  head.append(el('h2', 'bm-title', title));
  const body = el('div', 'bm-body');
  body.dataset.testid = 'viewer-body';
  containScroll(body);
  body.append(...content);
  const foot = el('footer', 'bm-foot');
  const btns = el('div', 'bm-btns');
  btns.append(btn(t(pointNet, 'viewer_close'), 'workflow-photos-close', 'screen-btn screen-primary', {}, 'workflow-photos-close'));
  foot.append(btns);
  root.append(head, body, foot);
  return root;
}
