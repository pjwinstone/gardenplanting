/**
 * Picker, step bar, sheet, and the thumb Next.
 * Flags live here so a contrast toggle does not dirty the garden.
 */

import type { GardenDocument, Photo } from '../../model';
import {
  actionPillClass,
  actionPillCommand,
  actionPillLabel,
  actionReasonLine,
  deriveActionState,
  doneBlocker,
  doneBlockerNotice,
} from './actionNet';
import { baseNetworkForRun, CIRCLE_RESULT_STEP_ID, circleResultDetailForRun, EDGE_PHOTOS_STEP_ID, edgeAssignmentsFor, TAPE_DIAMETER_STEP_ID } from './circleResult';
import { strengthLines } from '../../solver/controlCluster';
import { GUIDED_WORKFLOWS, workflowById } from './definitions';
import { diagramSvg } from './diagrams';
import {
  advanceWorkflow,
  backWorkflow,
  commitWorkflow,
  confirmSetupWorkflow,
  counts,
  doneWorkflow,
  jumpWorkflowCount,
  noteWorkflow,
  pauseWorkflow,
  pausedRun,
  readProgress,
  restartWorkflow,
  resumeWorkflow,
  retakeEvidenceWorkflow,
  retakeStepPhotosInDoc,
  retakeOnePhotoInDoc,
  removeBaseTieWorkflow,
  saveBaseTieWorkflow,
  ADD_BASE_POINTS_STEP_ID,
  linkedPhotosForStep,
  saveCircleTapeWorkflow,
  scrollWorkflowToStep,
  skipWithNoteWorkflow,
  reviewWorkflow,
  startWorkflow,
  stepIsManualOnly,
  tickAgainWorkflow,
  tickWithReasonWorkflow,
  tickWorkflow,
  untickWorkflow,
  type WorkflowMove,
} from './engine';
import {
  attachRollerWheel,
  formatCountsLine,
  reasonLine,
  rollerPositionLabel,
  rollerRowIds,
  rowNumber,
  rowTitle,
  stateIconChar,
  stateIconClass,
  wheelHeightPx,
} from './guidedRoller';
import { cameraCaptureContext, cameraLink } from './cameraCapture';
import { canonicalStepId, SETUP_STEP_ID } from './fieldTestMeta';
import { firstUnsettledStepId, isSettled, normalizeStatus } from './guards';
import { placeRect, readSafeInsets, workflowChromeRects } from './layout';
import type { CircleTape, CircleTapeEdge, FieldTestSetupValues, WorkflowDefinition, WorkflowLink, WorkflowPastRun, WorkflowProgress, WorkflowRun, WorkflowStep } from './types';

const SUN_KEY = 'garden-survey:workflow-sunlight';

let pickerOpen = false;
let sheetOpen = false;
let notice: string | null = null;
let placedRoot: HTMLElement | null = null;
let chromeRerender: (() => void) | null = null;
/** Apply a workflow change to the app's *current* document (never a stale copy). */
let chromeCommit: ((update: (doc: GardenDocument) => GardenDocument) => void) | null = null;
/** Last roller panel and the state it was drawn from. Reused while nothing changed, so a
 * re-render from elsewhere (photo loop, cloud status, error log) does not rebuild the wheel
 * under the user's finger or swallow a tap on a row pill. */
let rollerCache: { key: string; panel: HTMLElement; touching: () => boolean; recentre: () => void } | null = null;
/** Set-up form edits not yet confirmed (dotted key -> typed text). Survives re-renders. */
let setupDraft: Record<string, string> = {};
let chromeDoc: GardenDocument | null = null;

export interface WorkflowCommandResult {
  doc?: GardenDocument;
  menuOpen?: boolean;
  link?: WorkflowLink;
  /** Async photo work the app runs with a Graph client (docs/photo-archive.md). */
  photoAction?: 'check-photos' | 'clean-archive' | 'archive-orphans' | 'archive-drain';
}

/** Step whose Photos viewer is open, or null. */
let photosViewerStep: string | null = null;

export interface PhotoPanelView {
  /** Plain lines from the last photo check (errors first). */
  lines: { kind: 'error' | 'warning' | 'info'; text: string }[];
  /** Unreferenced photos in OneDrive that "Archive N unreferenced photos" would move. */
  orphanCount: number;
  busy?: string;
}
let photoPanel: PhotoPanelView | null = null;

/** The app sets the Set-up photo panel (check result, busy line). */
export function setPhotoPanel(view: PhotoPanelView | null): void {
  photoPanel = view;
}

export function photosViewerOpen(): string | null {
  return photosViewerStep;
}

export function sunlightMode(): 'sun' | 'shade' | 'system' {
  try {
    const stored = localStorage.getItem(SUN_KEY);
    if (stored === 'sun' || stored === 'shade') return stored;
  } catch {
    /* private mode */
  }
  return 'system';
}

export function sunlightActive(): boolean {
  const mode = sunlightMode();
  if (mode === 'sun') return true;
  if (mode === 'shade') return false;
  return window.matchMedia?.('(prefers-contrast: more)').matches ?? false;
}

function cycleSun(): void {
  const mode = sunlightMode();
  try {
    if (mode === 'system') localStorage.setItem(SUN_KEY, 'sun');
    else if (mode === 'sun') localStorage.setItem(SUN_KEY, 'shade');
    else localStorage.removeItem(SUN_KEY);
  } catch {
    /* private mode */
  }
}

export function installWorkflowChrome(
  rerender: () => void,
  commit?: (update: (doc: GardenDocument) => GardenDocument) => void,
): void {
  chromeRerender = rerender;
  chromeCommit = commit ?? null;
  const media = window.matchMedia?.('(prefers-contrast: more)');
  media?.addEventListener?.('change', () => {
    if (sunlightMode() === 'system') rerender();
  });
  window.addEventListener('resize', () => {
    if (placedRoot?.isConnected) placeWorkflowChrome(placedRoot);
  });
}

export function workflowNoteChange(doc: GardenDocument, stepId: string, note: string): GardenDocument | undefined {
  const move = noteWorkflow(readProgress(doc), stepId, note);
  if (!move.changed) return undefined;
  notice = null;
  return commitWorkflow(doc, move.progress);
}

/**
 * Where a row pill goes. Camera position steps open the camera for that camera position
 * (no layer / point-type chooser); Save baseline opens the baseline save itself.
 */
export function pillLink(def: WorkflowDefinition | undefined, stepId: string): WorkflowLink | undefined {
  const camera = cameraCaptureContext(def, stepId);
  if (camera) return cameraLink(camera);
  if (stepId === 'tape-baseline') return { to: 'mode', mode: 'BASELINE' };
  return undefined;
}

export function handleWorkflowCommand(
  cmd: string,
  doc: GardenDocument,
  source: { getAttribute(name: string): string | null },
): WorkflowCommandResult {
  const workflowId = source.getAttribute('data-workflow') ?? '';
  const stepId = source.getAttribute('data-step') ?? '';
  const progress = readProgress(doc);
  if (cmd === 'workflow-open-picker') {
    pickerOpen = true;
    sheetOpen = false;
    notice = null;
    return { menuOpen: false };
  }
  if (cmd === 'workflow-close-picker') {
    pickerOpen = false;
    return {};
  }
  if (cmd === 'workflow-sun') {
    cycleSun();
    return {};
  }
  if (cmd === 'workflow-expand') {
    sheetOpen = true;
    return {};
  }
  if (cmd === 'workflow-go') {
    // Row pill (Take photos / Save baseline / Save): open the place in the app that makes the evidence.
    const def = progress.activeId ? workflowById(progress.activeId) : undefined;
    const step = def?.steps.find((item) => item.id === stepId);
    sheetOpen = false;
    const link = pillLink(def, stepId);
    if (link) return { link };
    if (!step?.link || step.link.to === 'none') {
      sheetOpen = true;
      return {};
    }
    return { link: step.link };
  }
  if (cmd === 'workflow-collapse') {
    sheetOpen = false;
    return {};
  }

  let move: WorkflowMove | undefined;
  if (cmd === 'workflow-start') move = startWorkflow(progress, workflowId);
  else if (cmd === 'workflow-resume') move = resumeWorkflow(progress, workflowId);
  else if (cmd === 'workflow-review') move = reviewWorkflow(progress, workflowId);
  else if (cmd === 'workflow-start-over') {
    const agreed = window.confirm('Start over? Notes from this run, such as sleeve R, heights, and CHK-BASE, stay under Past runs.');
    if (!agreed) return {};
    move = restartWorkflow(progress, workflowId || progress.activeId || '');
  }
  else if (cmd === 'workflow-next') move = advanceWorkflow(progress);
  else if (cmd === 'workflow-later') move = advanceWorkflow(progress);
  else if (cmd === 'workflow-back') move = backWorkflow(progress);
  else if (cmd === 'workflow-done') {
    move = doneWorkflow(progress);
    // Say exactly which step stopped Done and why (top net guard allActionsDone).
    const def = progress.activeId ? workflowById(progress.activeId) : undefined;
    const after = move.progress.activeId ? move.progress.runs[move.progress.activeId] : undefined;
    if (def && after && !after.finishedAt) {
      const blocker = doneBlocker(doc, def.steps, after);
      if (blocker && after.currentStepId === blocker.stepId) move = { ...move, notice: doneBlockerNotice(blocker) };
    }
  }
  else if (cmd === 'workflow-scroll') move = scrollWorkflowToStep(progress, stepId || '');
  else if (cmd === 'workflow-jump') {
    const kind = source.getAttribute('data-kind') as 'error' | 'warning' | 'open' | 'recheck' | null;
    if (kind) move = jumpWorkflowCount(progress, kind);
  }
  else if (cmd === 'workflow-setup') move = scrollWorkflowToStep(progress, SETUP_STEP_ID);
  else if (cmd === 'workflow-confirm-setup') {
    const active = progress.activeId ? progress.runs[progress.activeId] : undefined;
    const base = active?.setup?.values;
    const values = base ? setupValuesWithDraft(base) : undefined;
    if (values === null) {
      notice = 'Set-up values must be numbers above 0.';
      return {};
    }
    move = confirmSetupWorkflow(progress, values);
    if (move.changed) {
      setupDraft = {};
      const pair = move.progress.activeId ? move.progress.runs[move.progress.activeId] : undefined;
      const def = move.progress.activeId ? workflowById(move.progress.activeId) : undefined;
      if (pair && def && pair.currentStepId === SETUP_STEP_ID) {
        const target = firstUnsettledStepId(def, pair);
        const next = target && target !== SETUP_STEP_ID ? target : def.steps[0]?.id;
        if (next) move = { ...scrollWorkflowToStep(move.progress, next), notice: move.notice, changed: true };
      }
    }
  }
  else if (cmd === 'workflow-skip') {
    const active = progress.activeId ? progress.runs[progress.activeId] : undefined;
    const id = stepId || active?.currentStepId || '';
    const live = document.querySelector<HTMLTextAreaElement>(`textarea[data-step="${CSS.escape(id)}"]`)?.value;
    move = skipWithNoteWorkflow(progress, id, live ?? '');
  }
  else if (cmd === 'workflow-tick-reason') {
    const active = progress.activeId ? progress.runs[progress.activeId] : undefined;
    const id = stepId || active?.currentStepId || '';
    const live = document.querySelector<HTMLTextAreaElement>(`textarea[data-step="${CSS.escape(id)}"]`)?.value ?? '';
    move = tickWithReasonWorkflow(progress, id, live);
  }
  else if (cmd === 'workflow-circle-tape-edge') {
    const edge = source.getAttribute("data-edge");
    if (edge === 'inside' || edge === 'outside') circleTapeDraft = { ...circleTapeDraft, edge };
    return {};
  }
  else if (cmd === 'workflow-circle-tape') {
    const active = progress.activeId ? progress.runs[progress.activeId] : undefined;
    const tape = circleTapeFromDraft(circleTapeDraft, active?.circleTape);
    if (!tape) {
      notice = 'Type three diameters in metres, above 0.';
      return {};
    }
    move = saveCircleTapeWorkflow(progress, tape.diametersM, tape.edge);
    if (move.changed) circleTapeDraft = { d: ['', '', ''] };
  }
  else if (cmd === 'workflow-base-tie') {
    const tie = baseTieFromDraft(baseTieDraft);
    if (!tie) {
      notice = 'Type From and To (e.g. BAS01, BAS03) and at least one reading in metres.';
      return {};
    }
    move = saveBaseTieWorkflow(progress, tie);
    if (move.changed) baseTieDraft = { from: tie.to, to: '', e: '', n: '', d: '' };
  }
  else if (cmd === 'workflow-base-tie-remove') {
    move = removeBaseTieWorkflow(progress, source.getAttribute('data-tie') ?? '');
  }
  else if (cmd === 'workflow-photos') {
    photosViewerStep = stepId || null;
    return {};
  }
  else if (cmd === 'workflow-photos-close') {
    photosViewerStep = null;
    return {};
  }
  else if (cmd === 'workflow-photo-retake') {
    // Photos viewer: Retake supersedes the step's photos and opens the camera straight away.
    const one = source.getAttribute('data-photo');
    const r = one && canonicalStepId(stepId) === EDGE_PHOTOS_STEP_ID ? retakeOnePhotoInDoc(doc, stepId, one) : retakeStepPhotosInDoc(doc, stepId);
    photosViewerStep = null;
    const def = progress.activeId ? workflowById(progress.activeId) : undefined;
    const link = pillLink(def, stepId) ?? def?.steps.find((item) => item.id === stepId)?.link;
    if (!r.changed) return {};
    return { doc: r.doc, link, photoAction: r.superseded.length ? 'archive-drain' : undefined };
  }
  else if (cmd === 'workflow-check-photos') return { photoAction: 'check-photos' };
  else if (cmd === 'workflow-clean-archive') return { photoAction: 'clean-archive' };
  else if (cmd === 'workflow-archive-orphans') return { photoAction: 'archive-orphans' };
  else if (cmd === 'workflow-retake') {
    move = retakeEvidenceWorkflow(progress, stepId);
    const def = progress.activeId ? workflowById(progress.activeId) : undefined;
    const link = pillLink(def, stepId) ?? def?.steps.find((item) => item.id === stepId)?.link;
    if (move.changed && link) move = { ...move, link };
  }
  else if (cmd === 'workflow-untick') move = untickWorkflow(progress, stepId);
  else if (cmd === 'workflow-pause') move = pauseWorkflow(progress);
  else if (cmd === 'workflow-tick-again') move = tickAgainWorkflow(progress);
  else if (cmd === 'workflow-tick') {
    const active = progress.activeId ? progress.runs[progress.activeId] : undefined;
    const id = stepId || active?.currentStepId || '';
    const live = document.querySelector<HTMLTextAreaElement>(`textarea[data-step="${CSS.escape(id)}"]`)?.value;
    move = tickWorkflow(progress, id, live ?? active?.steps[id]?.note);
  }
  if (!move) return {};
  notice = move.notice ?? null;
  if (cmd === 'workflow-start' || cmd === 'workflow-resume' || cmd === 'workflow-review' || cmd === 'workflow-start-over') {
    pickerOpen = false;
    sheetOpen = false;
  }
  if (move.link && move.link.to !== 'none') {
    sheetOpen = false;
    pickerOpen = false;
  }
  if (!move.changed) return {};
  return { doc: commitWorkflow(doc, move.progress), link: move.link };
}

export function renderGuidedChrome(doc: GardenDocument): HTMLElement {
  chromeDoc = doc;
  const root = document.createElement('div');
  root.className = 'workflow-root' + (sunlightActive() ? ' workflow-sun' : '');
  root.dataset.testid = 'workflow-root';
  const progress = readProgress(doc);
  if (pickerOpen) root.append(renderPicker(progress));
  else appendActive(root, progress);
  placedRoot = root;
  requestAnimationFrame(() => {
    if (root.isConnected) placeWorkflowChrome(root);
  });
  return root;
}

export function placeWorkflowChrome(root: HTMLElement): void {
  const view = root.ownerDocument.defaultView;
  const width = root.ownerDocument.documentElement.clientWidth || view?.innerWidth || 0;
  const height = root.ownerDocument.documentElement.clientHeight || view?.innerHeight || 0;
  if (!width || !height) return;
  const insets = readSafeInsets(root.ownerDocument);
  const bar = root.querySelector<HTMLElement>('[data-testid="workflow-bar"]');
  const sheet = root.querySelector<HTMLElement>('[data-testid="workflow-sheet"], [data-testid="workflow-picker"]');
  const thumb = root.querySelector<HTMLElement>('[data-testid="workflow-thumb"]');
  const rects = workflowChromeRects({
    width,
    height,
    insets,
    barHeight: bar?.offsetHeight || 180,
    sheetHeight: sheet?.scrollHeight || sheet?.offsetHeight || 480,
    thumbWidth: Math.max(thumb?.offsetWidth || 0, 120),
  });
  if (bar) placeRect(bar, rects.bar);
  if (sheet) placeRect(sheet, rects.sheet);
  if (thumb) placeRect(thumb, rects.thumb);
  const offset = bar ? rects.dialogTop - insets.top : 0;
  root.ownerDocument.documentElement.style.setProperty('--workflow-chrome-offset', `${Math.max(0, offset)}px`);
}

function appendActive(root: HTMLElement, progress: WorkflowProgress): void {
  const id = progress.activeId;
  const def = id ? workflowById(id) : undefined;
  const run = id ? progress.runs[id] : undefined;
  if (!def || !run || def.status !== 'ready' || def.steps.length === 0) return;
  const roller = def.id === 'circle-field-test' && def.revision >= 3;
  if (roller && !run.finishedAt) {
    if (photosViewerStep) root.append(renderPhotosViewer(def, run, photosViewerStep));
    else if (sheetOpen) root.append(renderDetailsSheet(def, run));
    else root.append(renderRollerPanel(def, run, progress));
    return;
  }
  if (sheetOpen && !run.finishedAt) root.append(renderSheet(def, run));
  else root.append(renderBar(def, run, progress));
  if (!sheetOpen) root.append(renderThumb(def, run, progress));
}

function renderRollerPanel(
  def: WorkflowDefinition,
  run: WorkflowRun,
  progress: WorkflowProgress,
): HTMLElement {
  // Action states are part of the key: an upload status change must redraw the pill.
  const actions = def.steps.map((step) => deriveActionState(chromeDoc, run, step));
  const key = JSON.stringify({ id: progress.activeId, run, notice, sun: sunlightActive(), actions });
  if (rollerCache && rollerCache.key === key) {
    const cached = rollerCache;
    requestAnimationFrame(() => {
      if (cached.panel.isConnected && !cached.touching()) cached.recentre();
    });
    return cached.panel;
  }
  const panel = el('section', 'workflow-roller-sheet');
  panel.dataset.testid = 'workflow-bar';
  const top = el('div', 'roller-top');
  const hdr = el('div', 'roller-hdr');
  hdr.append(el('b', '', def.title));
  const right = el('span', 'roller-hdr-right');
  right.append(el('span', '', rollerPositionLabel(def, run)));
  const cog = button('', 'workflow-setup', { className: 'roller-cog', testid: 'workflow-setup-cog' });
  cog.setAttribute('aria-label', 'Set-up');
  cog.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  right.append(cog);
  hdr.append(right);
  top.append(hdr);
  const countsLine = el('div', 'roller-counts');
  countsLine.setAttribute('aria-live', 'polite');
  countsLine.textContent = formatCountsLine(def, run);
  top.append(countsLine);
  panel.append(top);

  const wheel = el('div', 'roller-wheel');
  wheel.style.height = `${wheelHeightPx(run)}px`;
  const cap = el('div', 'roller-cap');
  wheel.append(cap);
  const capTop = (wheelHeightPx(run) - ROW_PX) / 2;
  cap.style.top = `${capTop}px`;
  const list = el('div', 'roller-list');
  list.dataset.rollerList = '1';
  list.setAttribute('role', 'listbox');
  const pad = (wheelHeightPx(run) - ROW_PX) / 2;
  list.style.paddingTop = `${pad}px`;
  list.style.paddingBottom = `${pad}px`;
  const rowIds = rollerRowIds(def);
  const currentId = run.currentStepId;
  for (const stepId of rowIds) {
    const row = el('div', 'roller-row');
    row.dataset.stepId = stepId;
    row.setAttribute('role', 'option');
    const state = stepId === SETUP_STEP_ID
      ? { status: run.setup?.status === 'unconfirmed' ? 'open' : 'ticked_by_you' }
      : run.steps[stepId];
    row.append(el('span', 'roller-n', rowNumber(def, stepId)));
    const ic = el('span', `roller-ic ${stateIconClass(state?.status ?? 'open')}`, stateIconChar(state?.status ?? 'open', stepId));
    row.append(ic);
    const title = el('span', 'roller-t' + (stepId === currentId ? ' roller-t-cur' : ''), rowTitle(def, stepId));
    row.append(title);
    if (stepId === currentId) {
      const step = def.steps.find((item) => item.id === stepId);
      // Pill colour and text come only from the step's action sub-net (action.net.yaml).
      const action = step ? deriveActionState(chromeDoc, run, step) : undefined;
      const pill = step && action ? actionPillLabel(step, action) : undefined;
      if (pill && action) {
        const node = button(pill, actionPillCommand(action), { className: actionPillClass(action), step: stepId, testid: 'roller-pill' });
        node.dataset.action = action.place;
        const photoId = action.markPhotoId ?? action.photoId;
        if (photoId) node.dataset.photoId = photoId;
        if (action.place === 'uploading' || action.place === 'done') node.disabled = true;
        row.append(node);
      }
      row.append(button('?', 'workflow-expand', { className: 'roller-q', step: stepId }));
    }
    list.append(row);
  }
  wheel.append(list);
  panel.append(wheel);

  const currentStep = def.steps.find((item) => item.id === currentId);
  if (currentId === SETUP_STEP_ID) {
    panel.append(renderSetupForm(def, run));
  } else if (currentStep) {
    if (currentStep.id === TAPE_DIAMETER_STEP_ID) panel.append(renderCircleTapeForm(run));
    if (currentStep.id === ADD_BASE_POINTS_STEP_ID) panel.append(renderBaseTieForm(run));
    if (currentStep.id === CIRCLE_RESULT_STEP_ID) panel.append(renderCircleResult(chromeDoc, run));
    panel.append(renderButtonRow(def, run, currentStep));
  }
  if (notice) panel.append(el('p', 'workflow-notice', notice));

  const recentre = () => {
    const currentRow = list.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(currentId)}"]`);
    if (currentRow && list.clientHeight > 0) list.scrollTop = currentRow.offsetTop - pad;
  };
  let handle: { touching: () => boolean } = { touching: () => false };
  rollerCache = { key, panel, touching: () => handle.touching(), recentre };
  requestAnimationFrame(() => {
    recentre();
    handle = attachRollerWheel(wheel, rowIds, currentId, (stepId) => {
      if (stepId === currentId) return;
      const update = (doc: GardenDocument): GardenDocument => {
        const move = scrollWorkflowToStep(readProgress(doc), stepId);
        return move.changed ? commitWorkflow(doc, move.progress) : doc;
      };
      // Must reach the app's state.doc; a bare rerender redraws from the old doc and snaps back.
      if (chromeCommit) chromeCommit(update);
      else if (chromeDoc) {
        chromeDoc = update(chromeDoc);
        chromeRerender?.();
      }
    });
  });
  return panel;
}

const ROW_PX = 44;

function renderSetupForm(_def: WorkflowDefinition, run: WorkflowRun): HTMLElement {
  const form = el('div', 'roller-setup-form');
  const values = run.setup?.values;
  if (!values) return form;
  const grid = el('div', 'roller-form-grid');
  grid.append(formTile('Circle diameter (m)', 'circle_diameter_m', values.circle_diameter_m.toFixed(2)));
  grid.append(formTile('Edge points (at least 8)', 'edge_points', String(values.edge_points)));
  grid.append(formTile('Baseline BAS01–BAS02 (m)', 'baseline_length_m', values.baseline_length_m.toFixed(3)));
  grid.append(formTile('Calibration distance (m)', 'calibration_distance_m', values.calibration_distance_m.toFixed(1)));
  grid.append(formTile('Archive age before clean-out (days)', 'photo_archive_age_days', String(values.photo_archive_age_days)));
  grid.append(formTile('Tolerance baseline (mm)', 'tolerances_mm.baseline', String(values.tolerances_mm.baseline)));
  grid.append(formTile('Circle diameter limit, baseline class (mm)', 'tolerances_mm.circle_diameter_baseline', String(values.tolerances_mm.circle_diameter_baseline)));
  grid.append(formTile('Circle diameter limit, plantable (mm)', 'tolerances_mm.circle_diameter_plantable', String(values.tolerances_mm.circle_diameter_plantable)));
  form.append(grid);
  const act = el('div', 'roller-form-act');
  const dirty = Object.keys(setupDraft).length > 0;
  act.append(el('div', 'roller-hint', dirty || run.setup?.status === 'changed_mid_run' ? 'Set-up changed. Confirm when ready.' : ''));
  act.append(button('Confirm', 'workflow-confirm-setup', { primary: true, testid: 'workflow-confirm-setup' }));
  form.append(act);
  form.append(renderPhotoPanel());
  return form;
}

let circleTapeDraft: { d: string[]; edge?: CircleTapeEdge } = { d: ['', '', ''] };

/** 'Tape the diameter': three readings about 60° apart, and which edge the tape was on. */
function renderCircleTapeForm(run: WorkflowRun): HTMLElement {
  const form = el('div', 'roller-setup-form');
  const saved = run.circleTape;
  const grid = el('div', 'roller-form-grid');
  for (let i = 0; i < 3; i += 1) {
    const tile = el('label', 'roller-form-tile');
    tile.append(el('small', '', `Diameter ${i + 1} (m)${i ? `, turned about ${60 * i}°` : ''}`));
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.className = 'roller-form-input';
    input.dataset.testid = `circle-tape-${i + 1}`;
    input.value = circleTapeDraft.d[i] || (saved?.diametersM[i] !== undefined ? saved.diametersM[i]!.toFixed(3) : '');
    input.addEventListener('input', () => { circleTapeDraft.d[i] = input.value; });
    tile.append(input);
    grid.append(tile);
  }
  form.append(grid);
  const edge = circleTapeDraft.edge ?? saved?.edge ?? 'inside';
  const act = el('div', 'roller-form-act');
  act.append(el('div', 'roller-hint', 'Taped on the inside or the outside of the edge? Put the canes on that same edge.'));
  for (const side of ['inside', 'outside'] as const) {
    const b = button(side === 'inside' ? 'Inside edge' : 'Outside edge', 'workflow-circle-tape-edge', { testid: `circle-tape-${side}` });
    b.dataset.edge = side;
    if (side === edge) b.classList.add('roller-pill--on');
    act.append(b);
  }
  act.append(button('Save diameters', 'workflow-circle-tape', { primary: true, testid: 'workflow-circle-tape' }));
  form.append(act);
  return form;
}

/** Plain readings for the 'Tape the diameter' save. null when not three numbers above 0. */
export function circleTapeFromDraft(draft: { d: string[]; edge?: CircleTapeEdge } = circleTapeDraft, fallback?: CircleTape): { diametersM: number[]; edge: CircleTapeEdge } | null {
  const diametersM = [0, 1, 2].map((i) => {
    const text = draft.d[i] || (fallback?.diametersM[i] !== undefined ? String(fallback.diametersM[i]) : '');
    return Number(text.replace(',', '.').trim());
  });
  if (!diametersM.every((d) => Number.isFinite(d) && d > 0)) return null;
  return { diametersM, edge: draft.edge ?? fallback?.edge ?? 'inside' };
}

function renderCircleResult(doc: GardenDocument | null, run: WorkflowRun): HTMLElement {
  const box = el('div', 'roller-setup-form');
  const detail = circleResultDetailForRun(doc, run);
  const verdict = detail.verdict;
  box.dataset.state = verdict.state;
  box.dataset.testid = 'circle-result';
  box.append(el('p', `circle-verdict circle-verdict--${verdict.state}`, verdict.headline));
  for (const line of verdict.guidance) box.append(el('p', 'roller-hint', line));
  for (const line of verdict.warnings ?? []) box.append(el('p', 'roller-hint roller-hint--warn', line));
  if (detail.gates.length) box.append(renderMeasurementStrength(detail));
  return box;
}

/** Measurement strength per edge point: colour, reason, then r, MDB, w and ∇x per base point. */
function renderMeasurementStrength(detail: ReturnType<typeof circleResultDetailForRun>): HTMLElement {
  const wrap = document.createElement('details');
  wrap.className = 'measurement-strength';
  wrap.dataset.testid = 'measurement-strength';
  const counts = { green: 0, amber: 0, red: 0, grey: 0 };
  for (const g of detail.gates) counts[g.cls] += 1;
  const summary = document.createElement('summary');
  summary.textContent = `Measurement strength: ${counts.green} green · ${counts.amber} amber · ${counts.red} red · ${counts.grey} grey`;
  wrap.append(summary);
  if (detail.fx) wrap.append(el('p', 'roller-hint', `Focal length ${Math.round(detail.fx.fx)} px ± ${(detail.fx.sigmaRel * 100).toFixed(2)} % (${detail.fx.method === 'auto' ? 'found from the bands' : 'tapped by hand'}).`));
  if (detail.unlevelled) wrap.append(el('p', 'roller-hint', `${detail.unlevelled} photo${detail.unlevelled === 1 ? '' : 's'} had no tilt reading; taken as level.`));
  wrap.append(el('p', 'roller-hint', 'Reliability shift (∇x): how far an undetected error could move this point. r: how well a reading is checked (0–1). MDB: the smallest error the checks would catch.'));
  for (const g of detail.gates) {
    const item = el('div', `strength-point strength-point--${g.cls}`);
    item.dataset.point = g.pointId;
    const [head, ...rows] = strengthLines(g);
    item.append(el('p', 'roller-hint', head));
    for (const line of rows) item.append(el('p', 'roller-hint roller-hint--small', line));
    wrap.append(item);
  }
  return wrap;
}

let baseTieDraft: { from: string; to: string; e: string; n: string; d: string } = { from: 'BAS01', to: 'BAS02', e: '', n: '', d: '' };

/** Parse the tie form. null when From / To are missing or no reading is a number. */
export function baseTieFromDraft(draft = baseTieDraft): { from: string; to: string; eastM?: number; northM?: number; diagonalM?: number } | null {
  const num = (t: string): number | undefined => {
    const v = t.replace(',', '.').trim();
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const from = draft.from.trim().toUpperCase();
  const to = draft.to.trim().toUpperCase();
  const eastM = num(draft.e);
  const northM = num(draft.n);
  const diagonalM = num(draft.d);
  if (!from || !to) return null;
  if ([eastM, northM, diagonalM].some((v) => v !== undefined && Number.isNaN(v))) return null;
  if (eastM === undefined && northM === undefined && diagonalM === undefined) return null;
  return { from, to, eastM, northM, diagonalM };
}

/** 'Add base points': the N/E/diagonal tie form, the ties so far and the network's checks. */
function renderBaseTieForm(run: WorkflowRun): HTMLElement {
  const form = el('div', 'roller-setup-form');
  form.dataset.testid = 'base-tie-form';
  const grid = el('div', 'roller-form-grid');
  const field = (label: string, key: keyof typeof baseTieDraft, mode: 'text' | 'decimal') => {
    const tile = el('label', 'roller-form-tile');
    tile.append(el('small', '', label));
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = mode;
    input.className = 'roller-form-input';
    input.dataset.testid = `base-tie-${key}`;
    input.value = baseTieDraft[key];
    input.addEventListener('input', () => { baseTieDraft = { ...baseTieDraft, [key]: input.value }; });
    tile.append(input);
    grid.append(tile);
  };
  field('From (placed point)', 'from', 'text');
  field('To (new or other point)', 'to', 'text');
  field('East (m, minus = west)', 'e', 'decimal');
  field('North (m, minus = south)', 'n', 'decimal');
  field('Diagonal (m, the check)', 'd', 'decimal');
  form.append(grid);
  const act = el('div', 'roller-form-act');
  act.append(el('div', 'roller-hint', 'Tape East, then North, then the diagonal. The app re-adjusts after each tie.'));
  act.append(button('Save tie', 'workflow-base-tie', { primary: true, testid: 'workflow-base-tie' }));
  form.append(act);
  const ties = run.baseTies ?? [];
  const net = baseNetworkForRun(run);
  if (ties.length && !net) form.append(el('p', 'roller-hint roller-hint--warn', 'The ties do not place every point yet: a new point needs East and North from a placed point.'));
  if (net) {
    const placed = Object.keys(net.points).sort();
    form.append(el('p', 'roller-hint', `Placed: ${placed.map((id) => `${id} (E ${net.points[id].x.toFixed(3)}, N ${net.points[id].y.toFixed(3)})`).join(', ')}.`));
  }
  ties.forEach((t, i) => {
    const row = el('div', 'base-tie-row');
    const readings = [t.eastM != null ? `E ${t.eastM.toFixed(3)}` : '', t.northM != null ? `N ${t.northM.toFixed(3)}` : '', t.diagonalM != null ? `diag ${t.diagonalM.toFixed(3)}` : ''].filter(Boolean).join(' · ');
    const check = net?.diagonals.find((d) => d.tie === i);
    const checkText = check ? ` — diagonal ${check.flag}, w ${check.w.toFixed(2)}, ${(check.residualM * 1000).toFixed(0)} mm` : '';
    row.append(el('span', `roller-hint${check?.flag === 'red' ? ' roller-hint--warn' : ''}`, `${t.from}→${t.to}: ${readings}${checkText}`));
    const rm = button('Remove', 'workflow-base-tie-remove', { testid: 'base-tie-remove' });
    rm.dataset.tie = t.id;
    row.append(rm);
    form.append(row);
  });
  return form;
}

/** The step's photos (current ones), for the viewer and the Photos button. */
export function stepPhotos(doc: GardenDocument | null, run: WorkflowRun, step: WorkflowStep): Photo[] {
  const c = step.complete;
  if (!doc || !('on' in c) || c.on !== 'photo.uploaded') return [];
  return linkedPhotosForStep(doc, c.stationId, run, step.id).filter((p) => !p.supersededAt);
}

/** "Photos (n)": on photo steps that have photos, or whose action is in error (recovery lives in the viewer). */
function photosButtonFor(run: WorkflowRun, step: WorkflowStep): HTMLElement | null {
  const c = step.complete;
  if (!('on' in c) || c.on !== 'photo.uploaded') return null;
  const n = stepPhotos(chromeDoc, run, step).length;
  const action = deriveActionState(chromeDoc, run, step);
  if (n === 0 && action.place !== 'error' && action.place !== 'done') return null;
  return button(n ? `Photos (${n})` : 'Photos', 'workflow-photos', { step: step.id, testid: 'workflow-photos' });
}

function photoStatusLine(photo: Photo): string {
  const of = photo.originalFile;
  if (!of) return 'Not on record';
  if (of.uploadStatus === 'failed') return `Upload failed: ${of.uploadError ?? 'unknown error'}`;
  if (of.uploadStatus === 'verified') return of.usabilityNote ? `On OneDrive. ${of.usabilityNote}` : 'On the phone and OneDrive';
  return 'Uploading…';
}

function renderPhotosViewer(def: WorkflowDefinition, run: WorkflowRun, stepId: string): HTMLElement {
  const sheet = el('section', 'workflow-sheet workflow-photos-sheet');
  sheet.dataset.testid = 'workflow-photos-viewer';
  const step = def.steps.find((s) => s.id === stepId);
  if (!step) return sheet;
  sheet.append(el('h2', 'workflow-title', `${rowNumber(def, stepId)} ${step.title}: photos`));
  const photos = stepPhotos(chromeDoc, run, step);
  const action = deriveActionState(chromeDoc, run, step);
  if (action.place === 'error') sheet.append(el('p', 'workflow-notice', actionReasonLine(action) || 'This step needs a new photo.'));
  const perPhoto = step.id === EDGE_PHOTOS_STEP_ID;
  if (photos.length > 1) {
    sheet.append(el('p', 'workflow-detail', perPhoto
      ? 'Retake replaces just that photo; the new one takes the same edge point. The old one moves to the archive.'
      : `Retake replaces all ${photos.length} photos of this step; the old ones move to the archive.`));
  }
  const edgeOf = perPhoto ? edgeAssignmentsFor(chromeDoc, run) : new Map<string, string>();
  if (!photos.length) {
    sheet.append(el('p', 'workflow-detail', 'No photos for this step yet.'));
    const r = button('Retake', 'workflow-photo-retake', { primary: true, step: stepId, testid: 'photo-retake' });
    sheet.append(r);
  }
  for (const photo of photos) {
    const item = el('div', 'workflow-photo-item');
    item.dataset.photoId = photo.id;
    if (photo.thumbnailDataUrl) {
      const img = document.createElement('img');
      img.src = photo.thumbnailDataUrl;
      img.alt = photo.originalFile?.fileName ?? photo.id;
      img.className = 'workflow-photo-thumb';
      item.append(img);
    }
    item.append(el('div', 'workflow-photo-name', `${edgeOf.get(photo.id) ? `${edgeOf.get(photo.id)} · ` : ''}${photo.originalFile?.fileName ?? photo.id}`));
    item.append(el('div', 'roller-hint', photoStatusLine(photo)));
    const retake = button('Retake', 'workflow-photo-retake', { step: stepId, testid: 'photo-retake' });
    retake.dataset.photo = photo.id;
    item.append(retake);
    if (photo.originalFile?.uploadStatus === 'failed') {
      const retry = button('Retry upload', 'photo-upload-retry', { testid: 'photo-upload-retry' });
      retry.dataset.photoId = photo.id;
      item.append(retry);
    }
    sheet.append(item);
  }
  sheet.append(button('Close', 'workflow-photos-close', { testid: 'workflow-photos-close' }));
  return sheet;
}

function renderPhotoPanel(): HTMLElement {
  const box = el('div', 'roller-photo-panel');
  box.dataset.testid = 'setup-photo-panel';
  const act = el('div', 'roller-form-act');
  act.append(button('Check photos', 'workflow-check-photos', { testid: 'workflow-check-photos' }));
  act.append(button('Clean out archive', 'workflow-clean-archive', { testid: 'workflow-clean-archive' }));
  if (photoPanel && photoPanel.orphanCount > 0) {
    act.append(button(`Archive ${photoPanel.orphanCount} unreferenced photo${photoPanel.orphanCount === 1 ? '' : 's'}`, 'workflow-archive-orphans', { testid: 'workflow-archive-orphans' }));
  }
  box.append(act);
  if (photoPanel?.busy) box.append(el('p', 'roller-hint', photoPanel.busy));
  for (const line of photoPanel?.lines ?? []) box.append(el('p', `roller-hint roller-hint--${line.kind}`, line.text));
  return box;
}

function readDotted(values: FieldTestSetupValues, key: string): unknown {
  return key.split('.').reduce<unknown>((obj, part) => (obj as Record<string, unknown> | undefined)?.[part], values);
}

/** Apply the typed draft to a copy of the values. null when a typed value is not a number above 0. */
export function setupValuesWithDraft(values: FieldTestSetupValues, draft: Record<string, string> = setupDraft): FieldTestSetupValues | null {
  const next = JSON.parse(JSON.stringify(values)) as FieldTestSetupValues;
  for (const [key, text] of Object.entries(draft)) {
    const num = Number(text.replace(',', '.').trim());
    // A camera position distance may be 0 (not taped); everything else is above 0.
    const zeroOk = key.startsWith('camera_positions.');
    if (!Number.isFinite(num) || num < 0 || (num === 0 && !zeroOk)) return null;
    if (typeof readDotted(next, key) !== 'number') continue;
    const parts = key.split('.');
    const last = parts.pop()!;
    const holder = parts.reduce<Record<string, unknown>>((obj, part) => obj[part] as Record<string, unknown>, next as unknown as Record<string, unknown>);
    holder[last] = num;
  }
  return next;
}

function formTile(label: string, key: string, value: string): HTMLElement {
  const tile = el('label', 'roller-form-tile');
  tile.append(el('small', '', label));
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.className = 'roller-form-input';
  input.dataset.setupKey = key;
  input.dataset.testid = `setup-${key}`;
  input.value = setupDraft[key] ?? value;
  if (setupDraft[key] !== undefined) tile.classList.add('roller-form-tile--changed');
  input.addEventListener('input', () => {
    if (input.value === value) delete setupDraft[key];
    else setupDraft[key] = input.value;
    tile.classList.toggle('roller-form-tile--changed', setupDraft[key] !== undefined);
  });
  tile.append(input);
  return tile;
}

function renderButtonRow(def: WorkflowDefinition, run: WorkflowRun, step: WorkflowStep): HTMLElement {
  const row = el('div', 'roller-act');
  const hint = el('div', 'roller-hint', reasonLine(def, run, step) || actionReasonLine(deriveActionState(chromeDoc, run, step)));
  row.append(hint);
  const photosButton = photosButtonFor(run, step);
  if (photosButton) row.append(photosButton);
  const state = run.steps[step.id];
  const status = normalizeStatus(state?.status ?? 'open');
  const last = def.steps[def.steps.length - 1]?.id === step.id;
  const settled = isSettled(state);
  if (status === 'needs_recheck' && step.kind === 'user') {
    row.append(button('Tick again', 'workflow-tick-again'));
    row.append(button('Next', 'workflow-next'));
    return row;
  }
  if (!settled && (status === 'waiting_for_app' || status === 'evidence_failed' || status === 'open')) {
    if (step.kind === 'user' || step.kind === 'user+app') row.append(button('Tick', 'workflow-tick', { step: step.id }));
    row.append(button('Later', 'workflow-later'));
    return row;
  }
  if (step.kind === 'user' && !settled) {
    row.append(button('Tick', 'workflow-tick', { step: step.id }));
    row.append(button(last ? 'Done' : 'Next', last ? 'workflow-done' : 'workflow-next'));
    return row;
  }
  const open = counts(def, run).open + counts(def, run).errors;
  if (last && open > 0) {
    row.append(button(`Done · ${open} open`, 'workflow-done'));
    return row;
  }
  row.append(button(last ? 'Done' : 'Next', last ? 'workflow-done' : 'workflow-next', { primary: true }));
  return row;
}

function renderDetailsSheet(def: WorkflowDefinition, run: WorkflowRun): HTMLElement {
  const stepId = run.currentStepId;
  const step = stepId === SETUP_STEP_ID
    ? { id: SETUP_STEP_ID, title: 'Set-up', instruction: 'Check lengths and tolerances for this run.', detail: [] as string[] }
    : def.steps.find((item) => item.id === stepId);
  if (!step) return el('section', 'workflow-sheet');
  const sheet = el('section', 'workflow-sheet workflow-details-sheet');
  sheet.dataset.testid = 'workflow-sheet';
  sheet.append(el('h2', 'workflow-title', step.title));
  if ('instruction' in step) sheet.append(el('p', 'workflow-instruction', step.instruction));
  if ('detail' in step && step.detail) for (const line of step.detail) sheet.append(el('p', 'workflow-detail', line));
  if ('diagram' in step && step.diagram) {
    const host = el('div', 'workflow-diagram-host');
    host.innerHTML = diagramSvg(step.diagram);
    sheet.append(host);
  }
  const note = document.createElement('textarea');
  note.className = 'workflow-note';
  note.dataset.step = step.id;
  note.value = run.steps[step.id]?.note ?? run.steps[step.id]?.reason ?? '';
  note.rows = 3;
  sheet.append(note);
  const actions = el('div', 'workflow-sheet-actions');
  if (stepId !== SETUP_STEP_ID) {
    actions.append(button('Tick by hand', 'workflow-tick-reason', { step: stepId }));
    actions.append(button('Skip with a note', 'workflow-skip', { step: stepId }));
    actions.append(button('Untick', 'workflow-untick', { step: stepId }));
  }
  actions.append(button('Pause', 'workflow-pause'));
  actions.append(button('Close', 'workflow-collapse'));
  sheet.append(actions);
  return sheet;
}

function stepIndex(def: WorkflowDefinition, run: WorkflowRun): number {
  const index = def.steps.findIndex((step) => step.id === run.currentStepId);
  return index < 0 ? 0 : index;
}

function currentStep(def: WorkflowDefinition, run: WorkflowRun): WorkflowStep {
  return def.steps[stepIndex(def, run)];
}

function counter(def: WorkflowDefinition, run: WorkflowRun): string {
  return `${stepIndex(def, run) + 1}/${def.steps.length}`;
}

function recentlyAuto(state: WorkflowRun['steps'][string] | undefined): boolean {
  if (state?.status !== 'complete' || state.completedBy !== 'auto' || !state.completedAt) return false;
  const at = Date.parse(state.completedAt);
  return Number.isFinite(at) && Date.now() - at < 1600;
}

function uploadedStep(step: WorkflowStep): { stationId: string; minPhotos: number } | undefined {
  if ('on' in step.complete && step.complete.on === 'photo.uploaded') return step.complete;
  return undefined;
}

function autoSentence(step: WorkflowStep): string {
  const photo = uploadedStep(step);
  if (photo) {
    const noun = photo.minPhotos === 1 ? 'photo' : 'photos';
    return `${photo.minPhotos} ${noun} saved at ${photo.stationId}.`;
  }
  return 'Ticked from the app. You did not tap it.';
}

function nextLabel(step: WorkflowStep, last: boolean): string {
  if (stepIsManualOnly(step) || last) return 'Done';
  return 'Next';
}

function sunButton(): HTMLButtonElement {
  const mode = sunlightMode();
  const label = mode === 'sun' ? 'Sunlight' : mode === 'shade' ? 'Shade' : 'Contrast';
  return button(label, 'workflow-sun', { className: 'workflow-btn', testid: 'workflow-sun' });
}

function renderBar(def: WorkflowDefinition, run: WorkflowRun, progress: WorkflowProgress): HTMLElement {
  if (run.finishedAt) return renderFinished(def, progress);
  const step = currentStep(def, run);
  const state = run.steps[step.id];
  const done = state?.status === 'complete';
  const bar = el('section', 'workflow-bar' + (recentlyAuto(state) ? ' workflow-bar--tick' : ''));
  bar.dataset.testid = 'workflow-bar';
  bar.setAttribute('aria-label', `${def.title}, step ${counter(def, run)}`);
  const kicker = el('div', 'workflow-kicker');
  kicker.append(el('span', '', `${counter(def, run)}${done ? ' · ticked' : ''}`));
  kicker.append(sunButton());
  bar.append(kicker);
  bar.append(el('h2', 'workflow-title', done && step.doneTitle ? step.doneTitle : step.title));
  bar.append(el('p', 'workflow-instruction', done && step.doneInstruction ? step.doneInstruction : step.instruction));
  if (done && state?.completedBy === 'auto') {
    const line = el('div', 'workflow-tick-line');
    line.innerHTML = tickSvg();
    line.append(document.createTextNode(autoSentence(step)));
    bar.append(line);
  } else if (done) {
    bar.append(el('p', 'workflow-auto', 'Ticked by you.'));
  }
  if (notice) bar.append(el('p', 'workflow-notice', notice));
  const actions = el('div', 'workflow-actions');
  const back = button('Back', 'workflow-back', { disabled: stepIndex(def, run) === 0 });
  const details = button('Details', 'workflow-expand');
  const last = stepIndex(def, run) === def.steps.length - 1;
  actions.append(back, details, button(nextLabel(step, last), 'workflow-next', { primary: true }));
  bar.append(actions);
  return bar;
}

function renderFinished(def: WorkflowDefinition, progress: WorkflowProgress): HTMLElement {
  const bar = el('section', 'workflow-bar');
  bar.dataset.testid = 'workflow-bar';
  const kicker = el('div', 'workflow-kicker');
  kicker.append(el('span', '', 'Finished'));
  kicker.append(sunButton());
  bar.append(kicker);
  bar.append(el('h2', 'workflow-title', `${def.title} finished`));
  bar.append(el('p', 'workflow-instruction', `All ${def.steps.length} steps ticked. Saved on this phone.`));
  const paused = pausedRun(progress);
  if (paused) {
    const index = paused.def.steps.findIndex((step) => step.id === paused.run.currentStepId);
    const step = paused.def.steps[Math.max(0, index)];
    const block = el('div', 'workflow-paused');
    block.append(el('h2', 'workflow-title', paused.def.title));
    block.append(el('p', 'workflow-instruction', `Paused on ${step?.title ?? 'the first step'}. Step ${index + 1} of ${paused.def.steps.length}.`));
    bar.append(block);
  }
  const actions = el('div', 'workflow-actions');
  actions.append(button('Start over', 'workflow-start-over', { workflow: def.id }));
  actions.append(button('Done', 'workflow-done', { primary: true }));
  bar.append(actions);
  return bar;
}

function renderThumb(def: WorkflowDefinition, run: WorkflowRun, progress: WorkflowProgress): HTMLButtonElement {
  const paused = run.finishedAt ? pausedRun(progress) : undefined;
  if (paused) {
    return button('Resume', 'workflow-resume', {
      className: 'workflow-thumb',
      testid: 'workflow-thumb',
      workflow: paused.id,
    });
  }
  if (run.finishedAt) {
    return button('Done', 'workflow-done', {
      className: 'workflow-thumb',
      testid: 'workflow-thumb',
    });
  }
  const step = currentStep(def, run);
  const last = stepIndex(def, run) === def.steps.length - 1;
  return button(nextLabel(step, last), 'workflow-next', {
    className: 'workflow-thumb',
    testid: 'workflow-thumb',
  });
}

function renderSheet(def: WorkflowDefinition, run: WorkflowRun): HTMLElement {
  const step = currentStep(def, run);
  const state = run.steps[step.id];
  const sheet = el('section', 'workflow-sheet');
  sheet.dataset.testid = 'workflow-sheet';
  sheet.setAttribute('aria-label', step.title);
  const kicker = el('div', 'workflow-kicker');
  kicker.append(el('span', '', `${def.title} · ${counter(def, run)}`));
  kicker.append(sunButton());
  sheet.append(kicker);
  sheet.append(el('h2', 'workflow-title', step.title));
  sheet.append(el('p', 'workflow-instruction', step.instruction));
  if (step.diagram) {
    const host = el('div', 'workflow-diagram-host');
    host.innerHTML = diagramSvg(step.diagram);
    sheet.append(host);
  }
  for (const line of step.detail) sheet.append(el('p', 'workflow-detail', line));
  if (step.noteLabel) {
    sheet.append(el('label', 'workflow-note-label', step.noteLabel));
    const note = document.createElement('textarea');
    note.className = 'workflow-note';
    note.dataset.cmd = 'workflow-note';
    note.dataset.step = step.id;
    note.value = state?.note ?? '';
    note.rows = 2;
    sheet.append(note);
  }
  const manual = stepIsManualOnly(step);
  if (!manual) {
    const photo = uploadedStep(step);
    const hint = photo
      ? `Ticks when ${photo.minPhotos} ${photo.minPhotos === 1 ? 'photo is' : 'photos are'} saved at ${photo.stationId}.`
      : 'Ticks itself when the app sees this step. You can still tick it by hand.';
    sheet.append(el('p', 'workflow-auto', state?.status === 'complete'
      ? (state.completedBy === 'auto' ? autoSentence(step) : 'Ticked by you.')
      : hint));
  }
  if (run.parkedStepIds?.length) {
    sheet.append(el('p', 'workflow-notice', `Older steps kept aside: ${run.parkedStepIds.join(', ')}.`));
  }
  if (notice) sheet.append(el('p', 'workflow-notice', notice));
  const actions = el('div', 'workflow-sheet-actions');
  actions.append(button('Back', 'workflow-back', { disabled: stepIndex(def, run) === 0 }));
  actions.append(button('Close', 'workflow-collapse'));
  if (!manual && state?.status !== 'complete') {
    actions.append(button('Tick anyway', 'workflow-tick', { step: step.id }));
  }
  const last = stepIndex(def, run) === def.steps.length - 1;
  actions.append(button(nextLabel(step, last), 'workflow-next', { primary: true }));
  sheet.append(actions);
  return sheet;
}

function renderPicker(progress: WorkflowProgress): HTMLElement {
  const picker = el('section', 'workflow-picker');
  picker.dataset.testid = 'workflow-picker';
  picker.setAttribute('aria-label', 'Workflows');
  const kicker = el('div', 'workflow-kicker');
  kicker.append(el('span', '', 'Workflows'));
  kicker.append(sunButton());
  picker.append(kicker);
  picker.append(el('h2', 'workflow-title', 'What are you doing?'));
  for (const def of GUIDED_WORKFLOWS) {
    const run = progress.runs[def.id];
    const row = el('div', 'workflow-row');
    const copy = el('div', 'workflow-row-copy');
    copy.append(el('h3', '', def.title));
    copy.append(el('p', '', pickerSubtitle(def, run)));
    row.append(copy);
    row.append(pickerAction(def, run));
    picker.append(row);
  }
  const past = progress.pastRuns ?? [];
  if (past.length) {
    picker.append(el('h3', 'workflow-past-title', 'Past runs'));
    for (const item of past) picker.append(el('p', 'workflow-detail', formatPastRunLine(item)));
  }
  const close = button('Close', 'workflow-close-picker', { className: 'workflow-btn workflow-primary workflow-picker-close' });
  picker.append(close);
  return picker;
}

/** Workflow title, step titles, and a local time. Stored ids and ISO strings stay in the document. */
export function formatPastRunLine(item: WorkflowPastRun): string {
  const def = workflowById(item.workflowId);
  const title = def?.title ?? 'Earlier run';
  const when = formatPastRunWhen(item.finishedAt ?? item.archivedAt);
  const notes = item.notes.map((note) => {
    const stepTitle = def?.steps.find((step) => step.id === note.stepId)?.title ?? 'Note';
    return `${stepTitle}: ${note.note}`;
  });
  return [title, when, ...notes].filter((part) => part.length > 0).join(' · ');
}

function formatPastRunWhen(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
}

function pickerSubtitle(def: WorkflowDefinition, run: WorkflowRun | undefined): string {
  if (def.status !== 'ready') return 'Coming soon';
  if (!run) return `0/${def.steps.length}`;
  if (run.finishedAt) return 'Finished';
  const index = Math.max(0, def.steps.findIndex((step) => step.id === run.currentStepId));
  const step = def.steps[index];
  return `${index + 1}/${def.steps.length} · ${step?.title ?? ''}`;
}

function pickerAction(def: WorkflowDefinition, run: WorkflowRun | undefined): HTMLElement {
  if (def.status !== 'ready') {
    return button('Later', 'workflow-start', { workflow: def.id, disabled: true });
  }
  if (!run) return button('Start', 'workflow-start', { workflow: def.id, primary: true });
  if (run.finishedAt) {
    const actions = el('div', 'workflow-row-actions');
    actions.append(button('Review', 'workflow-review', { workflow: def.id, primary: true }));
    actions.append(button('Start over', 'workflow-start-over', { workflow: def.id }));
    return actions;
  }
  return button('Resume', 'workflow-resume', { workflow: def.id, primary: true });
}

function tickSvg(): string {
  return '<svg class="workflow-tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13 l5 5 l11 -12"/></svg>';
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(
  text: string,
  cmd: string,
  opts: { primary?: boolean; disabled?: boolean; className?: string; testid?: string; workflow?: string; step?: string } = {},
): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = opts.className ?? ('workflow-btn' + (opts.primary ? ' workflow-primary' : ''));
  node.dataset.cmd = cmd;
  node.textContent = text;
  if (opts.disabled) node.disabled = true;
  if (opts.testid) node.dataset.testid = opts.testid;
  if (opts.workflow) node.dataset.workflow = opts.workflow;
  if (opts.step) node.dataset.step = opts.step;
  return node;
}

export function workflowShowsNotice(): string | null {
  return notice;
}

/** Test hook. The running app does not call this. */
export function resetWorkflowChromeForTests(): void {
  pickerOpen = false;
  sheetOpen = false;
  notice = null;
}
