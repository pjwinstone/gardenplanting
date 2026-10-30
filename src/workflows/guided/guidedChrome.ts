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
import { CIRCLE_RESULT_STEP_ID, circleResultDetailForRun, EDGE_PHOTOS_STEP_ID, edgeAssignmentsFor, edgePointRows, MIN_FIT_EDGE_POINTS, previousEdgePhoto, TAPE_DIAMETER_STEP_ID } from './circleResult';
import { edgeFitLine, edgeSummaryText, renderEdgeFitSummary, renderEdgeList, renderEdgeModal, substageButton, wrapViewerModal } from './edgePointUi';
import { circleEngine, circleFire, circleAt, circleEnter, setCircleFacts, circleNets } from '../../app/circle/circleEngine';
import { describe as describeScreen, renderButtons, renderHierarchy, stampPlace, type Frame } from '../../engine';
import { photoMarked } from './actionNet';
import { clearSwiped } from '../../screens/basePointList';
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
  supersededPhotosForStep,
  removeBaseTieWorkflow,
  saveBaseTieWorkflow,
  saveBasePostWorkflow,
  ADD_BASE_POINTS_STEP_ID,
  linkedPhotosForStep,
  saveCircleTapeWorkflow,
  deleteEdgePointWorkflow,
  restoreEdgePointWorkflow,
  saveEdgeNoteWorkflow,
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
  formatCountsLine,
  reasonLine,
  rollerPositionLabel,
  rollerRowIds,
  rowNumber,
  rowTitle,
  stateIconChar,
  stateIconClass,
} from './guidedRoller';
import { cameraCaptureContext, cameraLink } from './cameraCapture';
import { canonicalStepId, SETUP_STEP_ID } from './fieldTestMeta';
import { renderBasePointList } from '../../screens/basePointList';
import { pointNet, t } from '../../screens/stepNet';
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
/** Kept for hosts that set them; the step buttons go through the command path. */
export function chromeHooks(): unknown[] { return [chromeRerender, chromeCommit]; }
/** Last roller panel and the state it was drawn from. Reused while nothing changed, so a
 * re-render from elsewhere (photo loop, cloud status, error log) does not rebuild the wheel
 * under the user's finger or swallow a tap on a row pill. */
let photosViewerPhoto: string | null = null;
let rollerCache: { key: string; panel: HTMLElement; busy: () => boolean; recentre: () => void; lastScroll?: number } | null = null;
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
/** Circle test: the edge point whose pop-up is open, and its unsaved note. */
let edgeOpen: { photoId: string; pointId: string } | null = null;
let edgeNoteDraft: string | null = null;
let panelScroll: { step: string; top: number } | null = null;
/** One line on the edge point list after a delete or restore; cleared when shown. */
let edgeNotice: string | null = null;
/**
 * Circle test navigation (workflow/nets/circle-test.nets.yaml). One frame per open level; Back,
 * Save and Cancel pop one level and put focus back on the row you were on. Nothing here moves you
 * unless you tap: redraws, refits and uploads only redraw in place.
 */
/** The circle test's place comes only from the engine (src/app/circle/circleEngine.ts). */
let helpOpen = false;
let allStepsOpen = false;
function isEdgeStep(id: string | undefined | null): boolean { return id === EDGE_PHOTOS_STEP_ID || id === CIRCLE_RESULT_STEP_ID; }
/** Guards read these facts; refreshed before every command, so a move is judged on the state you saw. */
function refreshCircleFacts(doc: GardenDocument, progress: WorkflowProgress, pointId: string | null): void {
  const run = progress.activeId ? progress.runs[progress.activeId] : undefined;
  if (!run || progress.activeId !== 'circle-field-test') return;
  const detail = circleResultDetailForRun(doc, run);
  const rows = edgePointRows(doc, run, detail);
  const backTo = circleEngine.stack().find((f) => f.net === 'circle_test')?.focus;
  const point = rows.find((r) => r.id === (pointId ?? edgeOpen?.pointId));
  setCircleFacts({
    points: rows.length,
    live: rows.filter((r) => !r.deleted).length,
    deleted: rows.filter((r) => r.deleted).length,
    fitN: detail.fitIds?.length ?? rows.filter((r) => !r.deleted).length,
    cameFromStep: !!backTo && !isEdgeStep(backTo),
    pointDeleted: !!point?.deleted,
  });
}
/** After a step change you made: the engine follows (open the list, or leave it for the step). */
function followStep(from: string | undefined, to: string | undefined): void {
  if (from === to) return;
  if (isEdgeStep(to) && circleAt('circle_test', 'steps')) circleEngine.fire('open_edge_points', { focus: from });
  else if (!isEdgeStep(to) && circleAt('edge_points', 'list')) circleEngine.fire('pick_step');
}
/** The edge point row to highlight (and scroll to once, after you come back to the list). */
let edgeFocus: string | null = null;
let edgeFocusPending = false;
let edgeListScroll = 0;
/** Add edge point: the points before the camera opened, so the new one gets the focus. */
let edgeAddBefore: Set<string> | null = null;

function focusEdgeRow(id: string | null | undefined): void {
  if (!id) return;
  edgeFocus = id;
  edgeFocusPending = true;
}

/** Where you are in the circle test branch (for tests: only your taps may change it). */
export function guidedNavState(doc: GardenDocument | null): { step: string | null; overlay: string | null; frames: Frame[]; fitOpen: boolean; place: string } {
  const progress = doc ? readProgress(doc) : undefined;
  const run = progress?.activeId ? progress.runs[progress.activeId] : undefined;
  return {
    step: run?.currentStepId ?? null,
    overlay: photosViewerStep ? `viewer:${photosViewerPhoto ?? photosViewerStep}` : edgeOpen ? `edge:${edgeOpen.pointId}` : null,
    frames: circleEngine.stack(),
    fitOpen: circleAt('edge_fit'),
    place: circleEngine.path().join(' / '),
  };
}

/** Test hook: start from a clean circle test view. */
export function resetGuidedNav(): void {
  circleEngine.reset();
  helpOpen = false;
  allStepsOpen = false;
  edgeFocus = null;
  edgeFocusPending = false;
  edgeListScroll = 0;
  edgeAddBefore = null;
  edgeOpen = null;
  edgeNoteDraft = null;
  photosViewerStep = null;
  photosViewerPhoto = null;
}

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
  refreshCircleFacts(doc, progress, source.getAttribute('data-point'));
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
      // The roller stays put; the notice names the step that blocks Done.
      if (blocker) move = { ...move, notice: doneBlockerNotice(blocker) };
    }
  }
  else if (cmd === 'workflow-scroll' || cmd === 'workflow-step-pick') {
    const from = progress.activeId ? progress.runs[progress.activeId]?.currentStepId : undefined;
    move = scrollWorkflowToStep(progress, stepId || '');
    if (move.changed) followStep(from, stepId);
    if (cmd === 'workflow-step-pick') allStepsOpen = false;
  }
  else if (cmd === 'workflow-steps-all') { allStepsOpen = !allStepsOpen; return {}; }
  else if (cmd === 'workflow-help') { helpOpen = !helpOpen; return {}; }
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
    // Confirm saves the Set-up and stays on it: you move on with the roller (no auto-advance).
    if (move.changed) setupDraft = {};
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
    if (move.changed) baseTieDraft = { from: tie.to, to: '', e: '', n: '', d: '', s: '' };
  }
  else if (cmd === 'workflow-base-post') {
    const text = baseTieDraft.s.replace(',', '.').trim();
    const sep = text ? Number(text) : null;
    move = saveBasePostWorkflow(progress, baseTieDraft.to, sep === null || Number.isFinite(sep) ? sep : NaN);
    if (move.changed) baseTieDraft = { ...baseTieDraft, s: '' };
  }
  else if (cmd === 'workflow-base-tie-remove') {
    move = removeBaseTieWorkflow(progress, source.getAttribute('data-tie') ?? '');
  }
  else if (cmd === 'workflow-edge-open') {
    const photoId = source.getAttribute('data-value') ?? '';
    const pointId = source.getAttribute('data-point') ?? '';
    if (!photoId) return {};
    if (!circleFire('open_point', { arg: pointId, focus: pointId })) return {};
    edgeOpen = { photoId, pointId };
    edgeNoteDraft = null;
    edgeFocus = pointId;
    return {};
  }
  else if (cmd === 'workflow-edge-cancel') {
    circleFire('cancel');
    focusEdgeRow(circleEngine.focus() ?? edgeOpen?.pointId);
    edgeOpen = null;
    edgeNoteDraft = null;
    return {};
  }
  else if (cmd === 'workflow-edge-save') {
    const pointId = source.getAttribute('data-point') ?? edgeOpen?.pointId ?? '';
    const text = edgeNoteDraft;
    circleFire('save');
    focusEdgeRow(circleEngine.focus() ?? pointId);
    edgeOpen = null;
    edgeNoteDraft = null;
    if (text === null) return {};
    move = saveEdgeNoteWorkflow(progress, pointId, text);
  }
  else if (cmd === 'workflow-edge-add') {
    // Add edge point: the camera for the edge photo step, at any time (also after 12).
    const def = progress.activeId ? workflowById(progress.activeId) : undefined;
    const link = pillLink(def, EDGE_PHOTOS_STEP_ID);
    if (!link) return {};
    const run = progress.activeId ? progress.runs[progress.activeId] : undefined;
    if (!circleFire('add_point', { focus: edgeFocus ?? undefined })) return {};
    edgeAddBefore = new Set(run ? edgePointRows(doc, run).map((r) => r.id) : []);
    return { link };
  }
  else if (cmd === 'workflow-edge-points') {
    // Level 2: open the edge point substage from another step; Back returns to that step.
    const run = progress.activeId ? progress.runs[progress.activeId] : undefined;
    if (!circleFire('open_edge_points', { focus: run?.currentStepId })) return {};
    move = scrollWorkflowToStep(progress, EDGE_PHOTOS_STEP_ID);
  }
  else if (cmd === 'workflow-edge-back') {
    if (!circleFire('back_to_steps')) return {};
    const to = circleEngine.focus();
    if (!to) return {};
    move = scrollWorkflowToStep(progress, to);
  }
  else if (cmd === 'workflow-edge-fit') {
    circleFire('show_fit');
    return {};
  }
  else if (cmd === 'workflow-edge-fit-close') {
    circleFire('close');
    return {};
  }
  else if (cmd === 'workflow-edge-delete') {
    const photoId = source.getAttribute('data-value') ?? '';
    const pointId = source.getAttribute('data-point') ?? '';
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(t(pointNet, 'edge_delete_confirm', { id: pointId })) : true;
    if (!ok) return {};
    // The net move first (its guard reads the points before the change), then the data.
    if (!circleFire(circleAt('edge_edit') ? 'delete' : 'delete_point', { arg: pointId }) && circleAt('edge_points')) return {};
    move = deleteEdgePointWorkflow(progress, pointId, photoId);
    // Stays where you are (list row greyed with Restore, or the pop-up with Restore).
    if (move.changed) {
      clearSwiped();
      focusEdgeRow(pointId);
    }
  }
  else if (cmd === 'workflow-edge-restore') {
    const photoId = source.getAttribute('data-value') ?? '';
    const pointId = source.getAttribute('data-point') ?? '';
    if (!circleFire(circleAt('edge_edit') ? 'restore' : 'restore_point', { arg: pointId }) && circleAt('edge_points')) return {};
    move = restoreEdgePointWorkflow(progress, photoId);
    if (move.changed) focusEdgeRow(pointId);
  }
  else if (cmd === 'workflow-photos') {
    photosViewerStep = stepId || null;
    // One full-screen layer at a time: the retake screen replaces the edge point pop-up.
    // Its Close goes back one level, to the pop-up.
    if (edgeOpen) circleFire('retake', { focus: `${edgeOpen.pointId}|${edgeOpen.photoId}` });
    edgeOpen = null;
    edgeNoteDraft = null;
    // From the photo strip: open on just that photo.
    photosViewerPhoto = source.getAttribute('data-photo');
    return {};
  }
  else if (cmd === 'workflow-photos-close') {
    photosViewerStep = null;
    photosViewerPhoto = null;
    if (circleFire('close')) {
      const [pointId, photoId] = (circleEngine.focus() ?? '').split('|');
      if (pointId && photoId) edgeOpen = { pointId, photoId };
    }
    return {};
  }
  else if (cmd === 'workflow-photo-retake') {
    // Photos viewer: Retake supersedes the step's photos and opens the camera straight away.
    const one = source.getAttribute('data-photo');
    const r = one && canonicalStepId(stepId) === EDGE_PHOTOS_STEP_ID ? retakeOnePhotoInDoc(doc, stepId, one) : retakeStepPhotosInDoc(doc, stepId);
    // Camera, then its tap screen; their Save / Close land on the list with this point in focus.
    // Camera, then its tap screen; their Save / Cancel land on the list with this point in focus.
    const inPopup = circleAt('edge_photo', 'viewer');
    const at = circleEngine.stack().find((f) => f.net === 'edge_points');
    if (inPopup) circleFire('retake_photo');
    if (inPopup) focusEdgeRow(at?.focus);
    photosViewerStep = null;
    edgeOpen = null;
    edgeNoteDraft = null;
    photosViewerPhoto = null;
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
    // The Photos viewer and the edge point pop-up are full-screen layers (renderGuidedOverlay),
    // drawn outside this root so nothing (hamburger, Tools) can sit on top of them.
    if (sheetOpen) root.append(renderDetailsSheet(def, run));
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
  // The engine follows the step you are on (resume lands on the steps or the list, no move).
  circleEnter(isEdgeStep(run.currentStepId));
  // Action states are part of the key: an upload status change must redraw the pill.
  const actions = def.steps.map((step) => deriveActionState(chromeDoc, run, step));
  const edgeSig = currentEdgeSignature(run);
  // The edge point view state too: a focus to bring back, the fit open, the level stack.
  const edgeView = { edgeFocus, edgeFocusPending, place: circleEngine.path(), helpOpen, allStepsOpen };
  const key = JSON.stringify({ id: progress.activeId, run, notice, sun: sunlightActive(), actions, edgeSig, edgeNotice, edgeView });
  // Same content: reuse the panel. The app redraws by emptying the shell and appending again, and
  // a list taken out of the page and put back loses its scroll (scrollTop 0 = Set-up in the
  // capsule). That was the "flips to step 0 with no touch" bug: any background redraw (upload,
  // archive drain timer, autosave, a diagonal-check notice) showed row 0, and the next touch
  // settled on it. So every redraw puts the current row back in the capsule, unless the user is
  // mid-scroll. This never changes currentStepId; only scroll settle, Next and Back do.
  if (rollerCache && rollerCache.key === key) {
    const cached = rollerCache;
    const top = panelScroll && panelScroll.step === run.currentStepId ? panelScroll.top : 0;
    requestAnimationFrame(() => {
      if (cached.panel.isConnected && top) cached.panel.scrollTop = top;
      // Re-attached list: put its own scroll back (it reads 0 after a detach).
      const list = cached.panel.querySelector<HTMLElement>('[data-testid="edge-point-list"]');
      if (list && cached.panel.isConnected) list.scrollTop = edgeListScroll;
      if (cached.panel.isConnected && !cached.busy()) cached.recentre();
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

  const currentId = run.currentStepId;
  const crumbs = el('div', 'eng-crumbs', circleEngine.stack().slice(1).map((f) => circleNets.nets[f.net]!.title).join(' › '));
  crumbs.dataset.testid = 'eng-crumbs';
  panel.append(crumbs);
  panel.append(renderStepBar(def, run));
  if (helpOpen) panel.append(renderHelpPanel());

  const currentStep = def.steps.find((item) => item.id === currentId);
  if (currentId === SETUP_STEP_ID) {
    panel.append(renderSetupForm(def, run));
  } else if (currentStep) {
    if (currentStep.id === TAPE_DIAMETER_STEP_ID) panel.append(renderCircleTapeForm(run));
    if (currentStep.id === ADD_BASE_POINTS_STEP_ID) panel.append(renderBaseTieForm(run));
    if (currentStep.id === CIRCLE_RESULT_STEP_ID) panel.append(renderCircleResult(chromeDoc, run));
    if (currentStep.id === EDGE_PHOTOS_STEP_ID || currentStep.id === CIRCLE_RESULT_STEP_ID) panel.append(renderEdgePanel(chromeDoc, run, currentStep.id === EDGE_PHOTOS_STEP_ID));
    else if (def.id === 'circle-field-test') panel.append(renderEdgePointsButton(chromeDoc, run));
    panel.append(renderButtonRow(def, run, currentStep));
  }
  if (currentId !== SETUP_STEP_ID) panel.append(renderRunPhotoStrip(def, run));
  if (notice) panel.append(el('p', 'workflow-notice', notice));

  rollerCache = { key, panel, busy: () => false, recentre: () => {}, lastScroll: undefined };
  // The panel scrolls (long step content): a redraw keeps its position on the same step.
  panel.addEventListener('scroll', () => { if (panel.isConnected) panelScroll = { step: currentId, top: panel.scrollTop }; }, { passive: true });
  const keepPanel = panelScroll && panelScroll.step === currentId ? panelScroll.top : 0;
  requestAnimationFrame(() => { if (keepPanel && panel.isConnected) panel.scrollTop = keepPanel; });
  return panel;
}

/**
 * Step buttons (they replace the roller): the current step with its pill and ?, the next step,
 * All steps (every step as a button) and Help. Each pick is a user move of the circle_test net.
 */
function renderStepBar(def: WorkflowDefinition, run: WorkflowRun): HTMLElement {
  const bar = el('div', 'step-bar');
  bar.dataset.testid = 'step-bar';
  const ids = rollerRowIds(def);
  const currentId = run.currentStepId;
  const at = ids.indexOf(currentId);
  const nextId = firstUnsettledStepId(def, run) ?? ids[at + 1];
  const stepBtn = (stepId: string, kind: string, testid: string) => {
    const state = stepId === SETUP_STEP_ID ? { status: run.setup?.status === 'unconfirmed' ? 'open' : 'ticked_by_you' } : run.steps[stepId];
    const b = button('', 'workflow-step-pick', { className: `step-btn${stepId === currentId ? ' step-btn--cur' : ''}`, step: stepId, testid });
    b.append(el('small', '', kind));
    b.append(el('span', `roller-ic ${stateIconClass(state?.status ?? 'open')}`, stateIconChar(state?.status ?? 'open', stepId)));
    b.append(el('b', '', ` ${rowNumber(def, stepId)} ${rowTitle(def, stepId)}`));
    return b;
  };
  const cur = el('div', 'step-cur');
  cur.dataset.testid = 'step-current';
  cur.append(stepBtn(currentId, 'Now', 'step-current-btn'));
  const step = def.steps.find((item) => item.id === currentId);
  const action = step ? deriveActionState(chromeDoc, run, step) : undefined;
  const pill = step && action ? actionPillLabel(step, action) : undefined;
  if (pill && action) {
    const pc = pillCommandFor(chromeDoc, run, step!, action);
    const node = button(pill, pc.cmd, { className: actionPillClass(action), step: currentId, testid: 'roller-pill' });
    node.dataset.action = action.place;
    const photoId = action.markPhotoId ?? action.photoId;
    if (photoId) node.dataset.photoId = photoId;
    if (pc.disabled) node.disabled = true;
    cur.append(node);
  }
  if (step) cur.append(button('?', 'workflow-expand', { className: 'roller-q', step: currentId }));
  bar.append(cur);
  if (nextId && nextId !== currentId) bar.append(stepBtn(nextId, 'Next', 'step-next'));
  else bar.append(el('div', 'step-btn', 'No next step'));
  bar.append(button(allStepsOpen ? 'Hide steps' : 'All steps', 'workflow-steps-all', { className: 'step-btn step-all', testid: 'step-all' }));
  bar.append(button(helpOpen ? 'Close help' : 'Help', 'workflow-help', { className: 'step-btn step-help', testid: 'step-help' }));
  if (allStepsOpen) {
    const all = el('div', 'step-list');
    all.dataset.testid = 'step-list';
    for (const id of ids) all.append(stepBtn(id, '', `step-pick-${id}`));
    bar.append(all);
  }
  return bar;
}

/** Help: the net hierarchy (from the YAML) with where you are marked. */
function renderHelpPanel(): HTMLElement {
  const box = el('div', 'help-panel');
  box.dataset.testid = 'help-panel';
  const w = circleEngine.where();
  box.append(renderHierarchy(document, circleNets, { nets: circleEngine.stack().map((f) => f.net), net: w.net, place: w.place }));
  return box;
}

function renderSetupForm(_def: WorkflowDefinition, run: WorkflowRun): HTMLElement {
  const form = el('div', 'roller-setup-form');
  const values = run.setup?.values;
  if (!values) return form;
  const grid = el('div', 'roller-form-grid');
  grid.append(formTile('Circle diameter (m)', 'circle_diameter_m', values.circle_diameter_m.toFixed(2)));
  grid.append(formTile('Edge points (at least 8)', 'edge_points', String(values.edge_points)));
  grid.append(formTile('Two-sleeve post: sleeves apart, default (m)', 'post_separation_m', values.post_separation_m.toFixed(3)));
  grid.append(formTile('Calibration distance (m)', 'calibration_distance_m', values.calibration_distance_m.toFixed(1)));
  grid.append(formTile('Archive age before clean-out (days)', 'photo_archive_age_days', String(values.photo_archive_age_days)));
  grid.append(formTile('Circle diameter limit, base-grid class (mm)', 'tolerances_mm.circle_diameter_baseline', String(values.tolerances_mm.circle_diameter_baseline)));
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

let baseTieDraft: { from: string; to: string; e: string; n: string; d: string; s: string } = { from: 'BAS01', to: 'BAS02', e: '', n: '', d: '', s: '' };

/** Parse the tie form. null when From / To are missing or no reading is a number. */
export function baseTieFromDraft(draft: { from: string; to: string; e: string; n: string; d: string; s?: string } = baseTieDraft): { from: string; to: string; eastM?: number; northM?: number; diagonalM?: number } | null {
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

/** 'Grow the base grid': the N/E/diagonal tie form, two-sleeve posts, the ties so far and the network's checks. */
function renderBaseTieForm(_run: WorkflowRun): HTMLElement {
  // Base points are added and edited only through Add point > Base point (one Save base point
  // saves the tie and the post type together). Here: the shared list, with its own scroll area.
  const form = el('div', 'roller-setup-form');
  form.dataset.testid = 'base-tie-form';
  form.append(el('p', 'roller-hint', 'Tap a base point to edit it, or Add base point. Each save re-solves the whole base grid; a diagonal warning shows on the point with the reason.'));
  if (chromeDoc) form.append(renderBasePointList(chromeDoc));
  return form;
}

/**
 * What the row pill does. A photo step that already has its photo (uploading or done) opens the
 * shared photo viewer (previous + current photo, Retake) instead of a dead, disabled pill.
 */
export function pillCommandFor(doc: GardenDocument | null, run: WorkflowRun, step: WorkflowStep, action: ReturnType<typeof deriveActionState>): { cmd: string; disabled: boolean } {
  if (action.place === 'uploading' || action.place === 'done') {
    return stepPhotos(doc, run, step).length ? { cmd: 'workflow-photos', disabled: false } : { cmd: actionPillCommand(action), disabled: true };
  }
  return { cmd: actionPillCommand(action), disabled: false };
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
  const sheet = el('section', 'workflow-photos-content');
  const step = def.steps.find((s) => s.id === stepId);
  if (!step) return wrapViewerModal('', []);
  const viewerTitle = `${rowNumber(def, stepId)} ${step.title}: photos`;
  const all = stepPhotos(chromeDoc, run, step);
  const photos = photosViewerPhoto && all.some((p) => p.id === photosViewerPhoto) ? all.filter((p) => p.id === photosViewerPhoto) : all;
  const action = deriveActionState(chromeDoc, run, step);
  if (action.place === 'error') sheet.append(el('p', 'workflow-notice', actionReasonLine(action) || 'This step needs a new photo.'));
  const perPhoto = step.id === EDGE_PHOTOS_STEP_ID;
  if (all.length > 1) {
    sheet.append(el('p', 'workflow-detail', perPhoto
      ? 'Retake replaces just that photo; the new one takes the same edge point. The old one moves to the archive.'
      : `Retake replaces all ${all.length} photos of this step; the old ones move to the archive.`));
  }
  const edgeOf = perPhoto ? edgeAssignmentsFor(chromeDoc, run) : new Map<string, string>();
  // Previous (retaken) photo beside the current one, e.g. the calibration photo.
  const c = step.complete;
  // Edge points: the previous photo of that same edge point (opened on one photo).
  const onePoint = perPhoto && photos.length === 1 ? edgeOf.get(photos[0]!.id) : undefined;
  const previous = onePoint
    ? previousEdgePhoto(chromeDoc, run, onePoint)
    : !perPhoto && chromeDoc && 'on' in c && c.on === 'photo.uploaded' ? supersededPhotosForStep(chromeDoc, c.stationId, run).at(-1) : undefined;
  if (previous) {
    const item = el('div', 'workflow-photo-item workflow-photo-previous');
    item.dataset.testid = 'viewer-previous';
    item.append(el('div', 'workflow-photo-name', `${t(pointNet, 'calib_previous')} · ${previous.originalFile?.fileName ?? previous.id}`));
    if (previous.thumbnailDataUrl) {
      const img = document.createElement('img');
      img.src = previous.thumbnailDataUrl;
      img.alt = '';
      img.className = 'workflow-photo-thumb';
      item.append(img);
    }
    sheet.append(item);
  }
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
    item.append(el('div', 'workflow-photo-name', `${previous ? `${t(pointNet, 'calib_current')} · ` : ''}${edgeOf.get(photo.id) ? `${edgeOf.get(photo.id)} · ` : ''}${photo.originalFile?.fileName ?? photo.id}`));
    item.append(el('div', 'roller-hint', photoStatusLine(photo)));
    const retake = button('Retake', 'workflow-photo-retake', { step: stepId, testid: 'photo-retake', primary: photos.length === 1 });
    // One photo (opened from an edge point): the same big labelled button as the pop-up.
    if (photos.length === 1) retake.className = 'screen-btn screen-primary workflow-retake-wide';
    retake.dataset.photo = photo.id;
    item.append(retake);
    if (photo.originalFile?.uploadStatus === 'failed') {
      const retry = button('Retry upload', 'photo-upload-retry', { testid: 'photo-upload-retry' });
      retry.dataset.photoId = photo.id;
      item.append(retry);
    }
    sheet.append(item);
  }
  return wrapViewerModal(viewerTitle, [sheet]);
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
  actions.append(button('Pause', 'workflow-pause', { testid: 'workflow-pause' }));
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


/**
 * Photo strip on every step: every photo of this run, tap one to view or retake it. Uses the
 * same viewer and Retake as the step's Photos button (one photo for edge photos).
 */
function renderRunPhotoStrip(def: WorkflowDefinition, run: WorkflowRun): HTMLElement {
  const strip = el('div', 'screen-strip');
  strip.dataset.testid = 'run-photo-strip';
  for (const step of def.steps) {
    for (const photo of stepPhotos(chromeDoc, run, step)) {
      const b = button('', 'workflow-photos', { className: 'screen-thumb', step: step.id, testid: 'strip-thumb' });
      b.dataset.photo = photo.id;
      b.setAttribute('aria-label', `${step.title}: ${photo.originalFile?.fileName ?? photo.id}`);
      if (photo.thumbnailDataUrl) {
        const img = document.createElement('img');
        img.src = photo.thumbnailDataUrl;
        img.alt = '';
        b.append(img);
      }
      strip.append(b);
    }
  }
  return strip;
}

function currentEdgeSignature(run: WorkflowRun): string {
  if (run.currentStepId !== EDGE_PHOTOS_STEP_ID && run.currentStepId !== CIRCLE_RESULT_STEP_ID) return '';
  return JSON.stringify(edgePointRows(chromeDoc, run).map((r) => [r.id, r.photoId, r.level, r.residualMm === undefined ? null : Math.round(r.residualMm), r.deleted]));
}

/** Edge points step / circle result: the circle so far (from 3 points) and the edge point list. */
function renderEdgePanel(doc: GardenDocument | null, run: WorkflowRun, withFit: boolean): HTMLElement {
  const box = el('div', 'roller-setup-form edge-panel');
  box.dataset.testid = 'edge-panel';
  void withFit;
  const detail = circleResultDetailForRun(doc, run);
  const rows = edgePointRows(doc, run, detail);
  // A photo taken with Add edge point: once it is in the list, it has the focus.
  if (edgeAddBefore) {
    const added = rows.find((r) => !edgeAddBefore!.has(r.id));
    if (added) {
      focusEdgeRow(added.id);
      edgeAddBefore = null;
    }
  }
  box.addEventListener('pointerdown', () => { edgeFocusPending = false; }, { passive: true });
  const summary = el('p', 'edge-summary', edgeSummaryText(rows));
  summary.dataset.testid = 'edge-summary';
  box.append(summary);
  box.append(renderEdgeSubstages(doc, run, rows, detail));
  if (circleAt('edge_fit')) {
    const fit = el('div', 'edge-fit-open');
    fit.dataset.testid = 'edge-fit-panel';
    fit.append(renderEdgeFitSummary(detail));
    fit.append(button(t(pointNet, 'edge_fit_close'), 'workflow-edge-fit-close', { testid: 'edge-fit-close', className: 'screen-btn' }));
    box.append(fit);
  }
  const list = renderEdgeList(rows, { focus: edgeFocus });
  box.append(list);
  // Keep the list where it was over a redraw; after Save / Cancel / Delete / Restore bring the
  // row you were on into view, highlighted. Never moves the roller or the level.
  list.addEventListener('scroll', () => { if (list.isConnected) edgeListScroll = list.scrollTop; }, { passive: true });
  // The focus stays wanted until you touch the list or the panel yourself (a redraw in between,
  // e.g. the tap screen closing or an upload, brings the row back again rather than losing it).
  const pending = edgeFocusPending ? edgeFocus : null;
  list.addEventListener('pointerdown', () => { edgeFocusPending = false; }, { passive: true });
  list.addEventListener('touchstart', () => { edgeFocusPending = false; }, { passive: true });
  // Two frames: after the panel has put back its own scroll position.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!list.isConnected) return;
    // Hidden under a full-screen layer (tap screen, camera): bring the row back on the next draw.
    if (pending && (list.clientHeight === 0 || document.querySelector('.photo-tap, .photo-mark, .bm-root'))) return;
    const row = pending ? list.querySelector<HTMLElement>(`[data-testid="edge-item-${CSS.escape(pending)}"]`) : null;
    if (!row) {
      list.scrollTop = edgeListScroll;
      return;
    }
    // The list and the panel both scroll so the row sits in the middle of the screen.
    const rr = row.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    list.scrollTop += rr.top - lr.top - (list.clientHeight - rr.height) / 2;
    edgeListScroll = list.scrollTop;
    const panel = list.closest<HTMLElement>('.workflow-roller-sheet');
    if (panel) {
      const pr = panel.getBoundingClientRect();
      const lr2 = list.getBoundingClientRect();
      if (lr2.top < pr.top || lr2.bottom > pr.bottom) panel.scrollTop += lr2.top - pr.top - 8;
      panelScroll = { step: run.currentStepId, top: panel.scrollTop };
    }
  }));
  return box;
}

/**
 * Level 3 child buttons, drawn by the engine's renderer from edge_points@list: one per enabled
 * move, with its status and reason. Add edge point is pinned (sticky) at the top of the panel.
 */
function renderEdgeSubstages(doc: GardenDocument | null, run: WorkflowRun, rows: ReturnType<typeof edgePointRows>, detail: ReturnType<typeof circleResultDetailForRun>): HTMLElement {
  const bar = el('div', 'edge-substages');
  bar.dataset.testid = 'edge-substages';
  // Below 3 points there is no fit yet: count the live points that would go into it.
  const fitN = detail.fitIds?.length ?? rows.filter((r) => !r.deleted).length;
  const assign = [...edgeAssignmentsFor(doc, run).values()];
  const next = rows.length ? `EDG${String(Math.max(...assign.map((id) => Number(id.slice(3)) || 0)) + 1).padStart(2, '0')}` : 'EDG01';
  const unmarked = rows.find((r) => !r.deleted && doc?.photos.find((p) => p.id === r.photoId && !photoMarked(p)));
  const why = [
    !rows.length ? t(pointNet, 'edge_add_why_none')
      : fitN < MIN_FIT_EDGE_POINTS ? t(pointNet, 'edge_add_why_few', { n: fitN, more: MIN_FIT_EDGE_POINTS - fitN })
      : fitN === MIN_FIT_EDGE_POINTS ? t(pointNet, 'edge_add_why_three')
      : t(pointNet, 'edge_add_why_more', { n: fitN }),
    rows.length ? t(pointNet, 'edge_add_next', { id: next }) : '',
    unmarked ? t(pointNet, 'edge_add_unmarked', { id: unmarked.id }) : '',
  ].filter(Boolean).join(' ');
  const backTo = circleEngine.stack().find((f) => f.net === 'circle_test')?.focus;
  const def = workflowById(readProgress(doc ?? undefined).activeId ?? 'circle-field-test');
  const backTitle = backTo ? (backTo === SETUP_STEP_ID ? 'Set-up' : def?.steps.find((s) => s.id === backTo)?.title ?? backTo) : '';
  setCircleFacts({
    points: rows.length,
    live: rows.filter((r) => !r.deleted).length,
    deleted: rows.filter((r) => r.deleted).length,
    fitN,
    cameFromStep: !!backTo && !isEdgeStep(backTo),
  });
  if (!circleAt('edge_points', 'list')) return bar;
  const view = describeScreen(circleEngine, {
    label: (id) => (id === 'add_point' ? t(pointNet, 'edge_add_btn') : id === 'show_fit' ? t(pointNet, 'edge_fit_btn') : id === 'back_to_steps' ? t(pointNet, 'edge_back_btn', { step: backTitle || 'the step you came from' }) : undefined),
    text: (id) => (id === 'add_point' ? why : id === 'show_fit' ? `${edgeFitLine(detail)}. ${detail.verdict.headline}` : id === 'back_to_steps' ? '' : undefined),
  });
  const cmds: Record<string, string> = { add_point: 'workflow-edge-add', show_fit: 'workflow-edge-fit', back_to_steps: 'workflow-edge-back' };
  stampPlace(bar, circleEngine);
  const btns = view.buttons.filter((b) => cmds[b.id]);
  const pin = renderButtons(document, btns.filter((b) => b.id === 'add_point'), { cmd: (b) => cmds[b.id]! });
  pin.classList.add('edge-add-pin');
  pin.dataset.testid = 'edge-add-pin';
  bar.append(pin);
  bar.append(renderButtons(document, btns.filter((b) => b.id !== 'add_point'), { cmd: (b) => cmds[b.id]! }));
  for (const node of bar.querySelectorAll<HTMLButtonElement>('button')) node.classList.add('substage-btn');
  return bar;
}

/** Level 2 child button on the other circle test steps: open the edge point list. */
function renderEdgePointsButton(doc: GardenDocument | null, run: WorkflowRun): HTMLElement {
  const rows = edgePointRows(doc, run);
  const bar = el('div', 'edge-substages');
  bar.dataset.testid = 'circle-substages';
  bar.append(substageButton(t(pointNet, 'edge_points_btn', { n: rows.length }), 'workflow-edge-points', 'edge-points-open',
    rows.length ? `${edgeSummaryText(rows)}. ${t(pointNet, 'edge_points_why')}` : t(pointNet, 'edge_points_none')));
  bar.append(substageButton(t(pointNet, 'circle_pause_btn'), 'workflow-pause', 'workflow-pause', t(pointNet, 'circle_pause_why')));
  return bar;
}

/**
 * Full-screen layers of the guided workflow (Photos viewer, edge point pop-up). The app draws
 * this after everything else, outside the workflow root, so the hamburger and Tools never sit
 * on top. Typing in the pop-up keeps a draft and does not redraw; a redraw from elsewhere puts
 * the caret back.
 */
export function renderGuidedOverlay(doc: GardenDocument | null): HTMLElement | null {
  const progress = doc ? readProgress(doc) : undefined;
  const id = progress?.activeId;
  const def = id ? workflowById(id) : undefined;
  const run = id && progress ? progress.runs[id] : undefined;
  if (!def || !run || run.finishedAt) return null;
  if (photosViewerStep) return renderPhotosViewer(def, run, photosViewerStep);
  if (!edgeOpen || !circleAt('edge_edit', 'open')) return null;
  const open = edgeOpen;
  const row = edgePointRows(doc, run).find((r) => r.photoId === open.photoId);
  if (!row) {
    edgeOpen = null;
    return null;
  }
  const active = document.activeElement as HTMLTextAreaElement | null;
  const focus = active?.dataset?.field === 'edge-note' ? { start: active.selectionStart, end: active.selectionEnd } : null;
  const modal = renderEdgeModal({
    row,
    photo: doc?.photos.find((p) => p.id === row.photoId),
    run,
    doc,
    note: edgeNoteDraft ?? run.edgeNotes?.[row.id] ?? '',
    onNote: (text) => { edgeNoteDraft = text; },
  });
  if (focus) {
    requestAnimationFrame(() => {
      const area = modal.querySelector<HTMLTextAreaElement>('[data-field="edge-note"]');
      if (!area || !modal.isConnected) return;
      area.focus({ preventScroll: true });
      area.setSelectionRange(focus.start, focus.end);
    });
  }
  return modal;
}
