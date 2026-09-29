/** Main UI: plan-first layout, hamburger drawer, print tags. Calls toolbox + workflows. */

import type { GardenDocument } from './model';
import {
  confirmAbTogether,
  baselineReady,
  baselineTieReady,
  houseCornerCount,
  housePolygon,
  currentBaseline,
  currentSetup,
  applyCannedBaselineTie,
} from './model';
import { buildCoach, speakCoachLine } from './coach';
import { renderPlanSvg } from './planSvg';
import { renderTagsPrintHtml, triggerPrint } from './tagsPrint';
import { isSignedIn, signIn, signOut, subscribeAuth, type AuthInitResult } from './msalAuth';
import {
  getCloudStatus,
  setCloudBusy,
  setCloudMessage,
  setLastSaveIso,
  subscribeCloud,
} from './cloudStatus';
import { appBuild, appVersion, buildMenuTitle, buildStamp } from './buildInfo';
import { STAGE2_FIELD_STEPS } from './stage2Checklist';
import {
  clearErrorLog,
  getErrorLog,
  hasUnseenErrors,
  logError,
  markErrorsSeen,
  subscribeErrorLog,
  unseenErrorCount,
} from './errorLog';
import {
  ALL_ACTIONS,
  actionLabel,
  applyTransition,
  canTransition,
  legalActions,
  persistGardenLocal,
  exportGarden,
  importGarden,
  loadCachedGarden,
  createEmptyGarden,
  runAdjust as toolboxRunAdjust,
  saveGardenCloud,
  loadGardenCloud,
  type ModeAction,
} from './toolbox';
import {
  startStage2FieldWorkflow,
  loadSyntheticWorkflow,
  runMilestoneDemoWorkflow,
  saveBaselineLengthWorkflow,
  addHouseCornerWorkflow,
  closeHouseWorkflow,
  workflowAddPoint,
} from './workflows';
import {
  baselinesByTrust,
  createObject,
  objectsOnLayer,
  preferredBaseline,
  setBaselineTrust,
  setStickyPanel,
  stickyGeometry,
  stickyLayer,
  stickyObject,
  updatePointMeasurement,
} from './layers';
import { GEOMETRY_CHOICES, type GeometryType } from './model';

export type View = 'survey' | 'tags';

/** One hamburger accordion open at a time (point dialogue is separate, on-plan). */
export type MenuSection =
  | null
  | 'mode'
  | 'version'
  | 'recommend'
  | 'coach'
  | 'baseline'
  | 'tie'
  | 'house'
  | 'leapfrog'
  | 'adjust'
  | 'error-log'
  | 'tools'
  | 'cloud'
  | 'glossary';

/** Unified + Point / inspect dialogue (on the plan, not in the menu). */
export type PointDialogMode = null | 'add' | 'inspect';

export interface UiState {
  doc: GardenDocument;
  view: View;
  refuseMessage: string | null;
  /** Show Stage 2 field checklist summary in the survey layout. */
  showStage2Checklist: boolean;
  /** Hamburger drawer open. */
  menuOpen: boolean;
  /** Open drawer scrolled to Error log and mark unseen cleared. */
  openErrorLog: boolean;
  /** Which menu accordion section is expanded (one at a time). */
  menuFocus: MenuSection;
  /** On-plan + Point / inspect dialogue (null = closed). */
  pointDialog: PointDialogMode;
}

type Listener = () => void;

/** Drag offset for the point dialogue — survives re-renders without setState thrash.
 *  Default keeps clear of the bottom-right hamburger. */
let pointDialogPos = { x: 12, y: 56 };

const SEEN_BUILD_KEY = 'garden-survey-seen-build';

function currentBuildKey(): string {
  return `${appVersion()}·${appBuild()}`;
}

function hasSeenCurrentBuild(): boolean {
  try {
    return localStorage.getItem(SEEN_BUILD_KEY) === currentBuildKey();
  } catch {
    return true;
  }
}

function markCurrentBuildSeen(): void {
  try {
    localStorage.setItem(SEEN_BUILD_KEY, currentBuildKey());
  } catch {
    /* ignore quota / private mode */
  }
}

let state: UiState = {
  doc: loadCachedGarden() ?? createEmptyGarden(),
  view: 'survey',
  refuseMessage: null,
  showStage2Checklist: false,
  menuOpen: false,
  openErrorLog: false,
  menuFocus: 'recommend',
  pointDialog: null,
};

function openMenuSection(section: MenuSection): void {
  setState({
    menuOpen: true,
    menuFocus: section,
    openErrorLog: section === 'error-log',
    refuseMessage: state.refuseMessage,
  });
  if (section === 'error-log') markErrorsSeen();
}

function openPointDialog(mode: 'add' | 'inspect'): void {
  setState({
    pointDialog: mode,
    menuOpen: false,
    openErrorLog: false,
    refuseMessage: state.refuseMessage,
  });
}

function closePointDialog(): void {
  // Closing + Point / inspect returns chrome to Menu — do not leave mode stuck on ADD_POINT.
  setState({
    doc: {
      ...state.doc,
      session: {
        ...state.doc.session,
        mode: 'MENU',
        inspectingPointId: undefined,
      },
    },
    pointDialog: null,
    refuseMessage: null,
  });
}

/** Enter ADD_POINT when legal, then open the on-plan dialogue with sticky defaults. */
function startAddPointDialog(): void {
  const legal = new Set(legalActions(state.doc));
  if (
    legal.has('add_point') &&
    state.doc.session.mode !== 'ADD_POINT' &&
    state.doc.session.mode !== 'ADD_POINT_EXTRA_YAW'
  ) {
    const probe = canTransition(state.doc, 'add_point');
    if (probe.ok) {
      const { doc: next, result } = applyTransition(state.doc, 'add_point');
      if (result.ok) {
        const cleared = {
          ...next,
          session: { ...next.session, inspectingPointId: undefined },
        };
        setState({
          doc: cleared,
          refuseMessage: null,
          menuOpen: false,
          pointDialog: 'add',
          openErrorLog: false,
        });
        speakCoachLine(buildCoach(cleared).body[0] ?? '', cleared.session.speakSteps);
        return;
      }
    }
  }
  // Soft-set ADD_POINT for chrome when already legal/active, or dialog-only open.
  const base =
    state.doc.session.inspectingPointId != null
      ? {
          ...state.doc,
          session: { ...state.doc.session, inspectingPointId: undefined },
        }
      : state.doc;
  const doc =
    base.session.mode === 'ADD_POINT' || base.session.mode === 'ADD_POINT_EXTRA_YAW'
      ? base
      : { ...base, session: { ...base.session, mode: 'ADD_POINT' as const } };
  setState({
    doc,
    pointDialog: 'add',
    menuOpen: false,
    openErrorLog: false,
    refuseMessage: null,
  });
}

/** Mode shown in the Mode picker — Menu when no workflow dialog is active. */
function displayedChromeMode(): string {
  if (state.pointDialog === 'add') return 'ADD_POINT';
  if (state.pointDialog === 'inspect') return 'REVIEW';
  const m = state.doc.session.mode;
  if (m === 'START' || m === 'MENU') return 'MENU';
  if (m === 'ADD_POINT' || m === 'ADD_POINT_EXTRA_YAW') return 'MENU';
  if (m === 'HOUSE_BASELINE') return 'BASELINE';
  if (m === 'PLACE_ROD_A') return 'HOUSE_EDGES';
  if (m === 'PHOTO_TIE_HOUSE_ROD') return 'PHOTO_TIE_BASELINE';
  if ((m as string) === 'OCCUPY') return 'MENU';
  return m;
}

/** Picker entries — real session modes + Menu idle chrome. */
const MODE_PICKER: { value: string; label: string }[] = [
  { value: 'MENU', label: 'Menu' },
  { value: 'BASELINE', label: 'Baseline' },
  { value: 'PHOTO_TIE_BASELINE', label: 'Baseline photo tie' },
  { value: 'HOUSE_EDGES', label: 'Measure house edges' },
  { value: 'ADD_POINT', label: '+ Point' },
  { value: 'LEAPFROG', label: 'Leapfrog' },
  { value: 'RODS_MOVED', label: 'Rods moved' },
  { value: 'FENCE_TAG', label: 'Fence mark' },
  { value: 'ADJUST', label: 'Adjust' },
  { value: 'REVIEW', label: 'Review' },
];

function modeSectionStatus(): { tone: 'idle'; inline: string } {
  const current = displayedChromeMode();
  return {
    tone: 'idle',
    // Closed: Mode  Menu / Mode  + Point …
    inline: MODE_PICKER.find((m) => m.value === current)?.label ?? current,
  };
}

function buildModePicker(_doc: GardenDocument): HTMLElement {
  const body = el('div', { className: 'menu-acc__body', attrs: { 'data-testid': 'mode-panel' } });
  const current = displayedChromeMode();
  const sel = el('select', {
    className: 'menu-mode-select',
    attrs: {
      'data-cmd': 'select-chrome-mode',
      'data-testid': 'mode-picker',
      'aria-label': 'Survey mode',
    },
  }) as HTMLSelectElement;
  for (const opt of MODE_PICKER) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === current) o.selected = true;
    sel.appendChild(o);
  }
  body.appendChild(sel);
  body.appendChild(
    el('p', {
      className: 'menu-acc__meta',
      text: buildCoach(doc).banner,
    }),
  );
  return body;
}

function selectChromeMode(value: string): void {
  if (value === 'MENU') {
    setState({
      doc: {
        ...state.doc,
        session: { ...state.doc.session, mode: 'MENU', inspectingPointId: undefined },
      },
      pointDialog: null,
      menuOpen: true,
      menuFocus: 'recommend',
      openErrorLog: false,
    });
    return;
  }
  if (value === 'ADD_POINT') {
    startAddPointDialog();
    return;
  }
  if (value === 'BASELINE') {
    // Reuse Establish baseline open path
    if (state.doc.session.mode === 'START' || state.doc.session.mode === 'MENU') {
      const result = startStage2FieldWorkflow(state.doc);
      if (result.ok) {
        setState({
          doc: result.doc,
          view: 'survey',
          refuseMessage: null,
          showStage2Checklist: result.showChecklist,
          menuOpen: true,
          menuFocus: 'baseline',
          pointDialog: null,
          openErrorLog: false,
        });
        return;
      }
    }
    setState({
      doc: { ...state.doc, session: { ...state.doc.session, mode: 'BASELINE' } },
      pointDialog: null,
      menuOpen: true,
      menuFocus: 'baseline',
    });
    return;
  }
  if (value === 'PHOTO_TIE_BASELINE') {
    setState({
      pointDialog: null,
      menuOpen: true,
      menuFocus: 'tie',
    });
    if (canTransition(state.doc, 'take_baseline_tie').ok) {
      onModeAction('take_baseline_tie');
    }
    return;
  }
  if (value === 'HOUSE_EDGES') {
    setState({ pointDialog: null, menuOpen: true, menuFocus: 'house' });
    if (canTransition(state.doc, 'measure_house_edges').ok) {
      onModeAction('measure_house_edges');
    } else {
      setDoc({ ...state.doc, session: { ...state.doc.session, mode: 'HOUSE_EDGES' } }, null);
    }
    return;
  }
  if (value === 'LEAPFROG') {
    setState({ pointDialog: null, menuOpen: true, menuFocus: 'leapfrog' });
    if (canTransition(state.doc, 'start_leapfrog').ok) {
      onModeAction('start_leapfrog');
    }
    return;
  }
  if (value === 'RODS_MOVED') {
    onModeAction('rods_moved');
    return;
  }
  if (value === 'FENCE_TAG') {
    onModeAction('fence_mark');
    return;
  }
  if (value === 'ADJUST') {
    onModeAction('adjust');
    return;
  }
  if (value === 'REVIEW') {
    setState({
      doc: {
        ...state.doc,
        session: { ...state.doc.session, mode: 'REVIEW', inspectingPointId: undefined },
      },
      pointDialog: null,
      menuOpen: true,
      menuFocus: 'coach',
    });
  }
}

/** Surface a coach/refuse failure and append to the in-app error log. */
function surfaceFail(message: string, source = 'coach'): void {
  logError(message, { source });
  setState({ refuseMessage: message });
}

const listeners: Listener[] = [];

/** Debounce silent OneDrive backup after local edits when signed in. */
let cloudSaveTimer: ReturnType<typeof setTimeout> | null = null;

export function getState(): UiState {
  return state;
}

export function subscribe(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function setState(partial: Partial<UiState>): void {
  state = { ...state, ...partial };
  // Always notify listeners even if persistence fails — otherwise the UI freezes
  // on legal transitions while illegal refusals (no save) still appear to work.
  if (partial.doc) {
    const saved = persistGardenLocal(partial.doc);
    if (!saved.ok && !state.refuseMessage) {
      const msg = `Working copy updated, but could not save to this browser (${saved.error}). Export garden.json to keep your work.`;
      logError(msg, { source: 'persist' });
      state = { ...state, refuseMessage: msg };
    }
    scheduleCloudBackup(partial.doc);
  }
  for (const fn of [...listeners]) fn();
}

function setDoc(doc: GardenDocument, refuse: string | null = null): void {
  setState({ doc, refuseMessage: refuse });
}

function scheduleCloudBackup(doc: GardenDocument): void {
  if (!isSignedIn()) return;
  if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    void quietCloudSave(doc);
  }, 2500);
}

async function quietCloudSave(doc: GardenDocument): Promise<void> {
  if (!isSignedIn()) return;
  const result = await saveGardenCloud(doc);
  if (result.ok) {
    setLastSaveIso(result.savedAt);
    setCloudMessage(`Saved to OneDrive (${getCloudStatus().pathHint}).`);
  } else {
    setCloudMessage(`Could not auto-save to OneDrive: ${result.error}`);
  }
}

export function mount(root: HTMLElement): void {
  const shell = document.createElement('div');
  shell.className = 'app-shell';
  root.appendChild(shell);

  // Stable event delegation — survives innerHTML re-renders.
  shell.addEventListener('click', onShellClick);
  shell.addEventListener('change', onShellChange);

  const render = () => {
    shell.innerHTML = '';
    shell.appendChild(buildApp());
  };
  subscribe(render);
  subscribeAuth(render);
  subscribeCloud(render);
  subscribeErrorLog(render);
  render();
}

/**
 * After MSAL init: show real errors, welcome signed-in users, and try OneDrive load
 * when returning from a Microsoft redirect.
 */
export function applyAuthReady(init: AuthInitResult): void {
  if (!init.configured) return;

  if (init.error) {
    const msg = `Microsoft sign-in problem: ${init.error}`;
    logError(msg, { source: 'msal' });
    setCloudMessage(msg);
    return;
  }

  if (!init.signedIn) {
    // Keep the default “Not signed in…” line; no silent failure after a redirect attempt.
    return;
  }

  const who = init.accountLabel ? ` as ${init.accountLabel}` : '';
  if (init.fromRedirect) {
    setCloudMessage(`Signed in${who}. Loading garden.json from OneDrive…`);
    void restoreFromOneDriveAfterSignIn();
  } else {
    setCloudMessage(`Signed in${who}. Session restored on this device.`);
  }
}

async function restoreFromOneDriveAfterSignIn(): Promise<void> {
  if (!isSignedIn()) return;
  setCloudBusy(true);
  const result = await loadGardenCloud();
  setCloudBusy(false);
  if (!result.ok) {
    // Missing file is normal on first save — still signed in.
    if (result.missing) {
      setCloudMessage(
        `Signed in. No garden.json on OneDrive yet — use Save to OneDrive when ready.`,
      );
      return;
    }
    const msg = `Signed in, but could not load from OneDrive: ${result.error}`;
    logError(msg, { source: 'onedrive' });
    setCloudMessage(msg);
    return;
  }
  setDoc(result.doc, null);
  setCloudMessage(`Signed in. Loaded from OneDrive (${getCloudStatus().pathHint}).`);
}

function onShellClick(e: Event): void {
  const target = (e.target as HTMLElement | null)?.closest?.('[data-cmd]') as HTMLElement | null;
  if (!target) return;
  const cmd = target.getAttribute('data-cmd');
  if (!cmd) return;
  e.preventDefault();

  if (cmd === 'mode') {
    const action = target.getAttribute('data-action') as ModeAction | null;
    if (action) onModeAction(action);
    return;
  }
  if (cmd === 'toggle-menu') {
    if (state.menuOpen) {
      setState({ menuOpen: false, openErrorLog: false, refuseMessage: state.refuseMessage });
      return;
    }
    // Opening: first open after a new Build stamp → expand Version.
    // Also: if + Point dialog is closed, don't leave session stuck on ADD_POINT.
    let focus: MenuSection = state.menuFocus ?? 'recommend';
    if (!hasSeenCurrentBuild()) {
      focus = 'version';
      markCurrentBuildSeen();
    } else if (!focus) {
      focus = 'recommend';
    }
    let doc = state.doc;
    if (
      !state.pointDialog &&
      (doc.session.mode === 'ADD_POINT' || doc.session.mode === 'ADD_POINT_EXTRA_YAW')
    ) {
      doc = { ...doc, session: { ...doc.session, mode: 'MENU' } };
    }
    setState({
      doc,
      menuOpen: true,
      openErrorLog: false,
      menuFocus: focus,
      refuseMessage: state.refuseMessage,
    });
    return;
  }
  if (cmd === 'close-menu') {
    setState({ menuOpen: false, openErrorLog: false });
    return;
  }
  if (cmd === 'menu-accordion') {
    const section = (target.getAttribute('data-section') as MenuSection) || null;
    // Toggle: same section closes; otherwise one open at a time.
    const next = state.menuFocus === section ? null : section;
    setState({
      menuOpen: true,
      menuFocus: next,
      openErrorLog: next === 'error-log',
    });
    if (next === 'error-log') markErrorsSeen();
    return;
  }
  if (cmd === 'open-menu-section') {
    const section = (target.getAttribute('data-section') as MenuSection) || 'recommend';
    if (section === 'baseline') {
      if (state.doc.session.mode === 'START') {
        const result = startStage2FieldWorkflow(state.doc);
        if (result.ok) {
          setState({
            doc: result.doc,
            view: 'survey',
            refuseMessage: null,
            showStage2Checklist: result.showChecklist,
            menuOpen: true,
            menuFocus: 'baseline',
            openErrorLog: false,
          });
          speakCoachLine(
            buildCoach(result.doc).body[0] ?? '',
            result.doc.session.speakSteps,
          );
          return;
        }
      }
      openMenuSection('baseline');
      return;
    }
    openMenuSection(section);
    return;
  }
  if (cmd === 'open-point-dialog') {
    startAddPointDialog();
    return;
  }
  if (cmd === 'close-point-dialog') {
    closePointDialog();
    return;
  }
  if (cmd === 'open-error-log') {
    openMenuSection('error-log');
    return;
  }
  if (cmd === 'clear-error-log') {
    clearErrorLog();
    setState({ openErrorLog: true, menuOpen: true });
    return;
  }
  if (cmd === 'mark-errors-seen') {
    markErrorsSeen();
    return;
  }
  if (cmd === 'load-synthetic') {
    loadSynthetic();
    return;
  }
  if (cmd === 'run-milestone') {
    runMilestoneDemo();
    return;
  }
  if (cmd === 'start-stage2') {
    startStage2FieldLoop();
    return;
  }
  if (cmd === 'toggle-stage2-checklist') {
    setState({
      showStage2Checklist: !state.showStage2Checklist,
      refuseMessage: null,
      menuOpen: true,
      menuFocus: 'tools',
    });
    return;
  }
  if (cmd === 'new-garden') {
    setState({
      doc: createEmptyGarden(),
      refuseMessage: null,
      showStage2Checklist: false,
      menuOpen: false,
    });
    return;
  }
  if (cmd === 'export') {
    exportGarden(state.doc);
    return;
  }
  if (cmd === 'print-tags') {
    setState({ view: 'tags', refuseMessage: null, menuOpen: false });
    return;
  }
  if (cmd === 'back-survey') {
    setState({ view: 'survey' });
    return;
  }
  if (cmd === 'do-print') {
    triggerPrint();
    return;
  }
  if (cmd === 'add-photo') {
    const result = workflowAddPoint(state.doc);
    if (!result.ok) {
      surfaceFail(result.reason, 'add-point');
      setDoc(result.doc, result.reason);
      setState({ pointDialog: 'add', menuOpen: false });
      return;
    }
    setDoc(result.doc, null);
    setState({ pointDialog: 'add', menuOpen: false, openErrorLog: false });
    speakCoachLine(result.doc.session.lastAction ?? 'Point added.', result.doc.session.speakSteps);
    return;
  }
  if (cmd === 'inspect-point') {
    const pointId = target.getAttribute('data-point-id');
    if (!pointId) return;
    const pt = state.doc.points.find((p) => p.id === pointId);
    if (!pt) return;
    // Seed sticky panel from this point's measurement history
    let doc = {
      ...state.doc,
      session: {
        ...state.doc.session,
        inspectingPointId: pointId,
        stickyLayerId: pt.layerId ?? state.doc.session.stickyLayerId,
        stickyObjectId: pt.objectId ?? state.doc.session.stickyObjectId,
        stickyObjectName:
          (pt.objectId
            ? state.doc.objects?.find((o) => o.id === pt.objectId)?.name
            : undefined) ?? state.doc.session.stickyObjectName,
        stickyGeometryType:
          (pt.objectId
            ? state.doc.objects?.find((o) => o.id === pt.objectId)?.geometryType
            : undefined) ?? state.doc.session.stickyGeometryType,
        currentBaselineId:
          pt.measuredWithBaselineId ?? state.doc.session.currentBaselineId,
      },
    };
    if (pt.measuredWithBaselineId) {
      const bl = doc.baselines.find((b) => b.id === pt.measuredWithBaselineId);
      if (bl) doc = { ...doc, session: { ...doc.session, activeBaselineEnds: { a: bl.a, b: bl.b } } };
    }
    setDoc(doc, null);
    openPointDialog('inspect');
    return;
  }
  if (cmd === 'close-inspector' || cmd === 'close-point-dialog') {
    closePointDialog();
    return;
  }
  if (cmd === 'apply-inspector') {
    const panel = target.closest('.point-dialog') ?? target.closest('.add-point-panel');
    const pointId = state.doc.session.inspectingPointId;
    if (!pointId || !panel) return;
    const layerId = (panel.querySelector('[data-field=layer]') as HTMLSelectElement | null)?.value;
    const objectName = (
      panel.querySelector('[data-field=object-name]') as HTMLInputElement | null
    )?.value;
    const geometryType = (panel.querySelector('[data-field=geometry]') as HTMLSelectElement | null)
      ?.value as GeometryType | undefined;
    const baselineId = (panel.querySelector('[data-field=baseline]') as HTMLSelectElement | null)
      ?.value;
    const objectId =
      (panel.querySelector('[data-field=object]') as HTMLSelectElement | null)?.value || undefined;
    const next = updatePointMeasurement(state.doc, pointId, {
      layerId,
      objectId: objectId === '__new__' ? undefined : objectId,
      objectName,
      geometryType,
      measuredWithBaselineId: baselineId || undefined,
    });
    setDoc(
      {
        ...next,
        session: { ...next.session, inspectingPointId: pointId },
      },
      null,
    );
    setState({ pointDialog: 'inspect', menuOpen: false });
    return;
  }
  if (cmd === 'create-object') {
    const panel = target.closest('.point-dialog') ?? target.closest('.add-point-panel');
    const name =
      (panel?.querySelector('[data-field=object-name]') as HTMLInputElement | null)?.value?.trim() ||
      'Untitled';
    const layerId =
      (panel?.querySelector('[data-field=layer]') as HTMLSelectElement | null)?.value ||
      stickyLayer(state.doc).id;
    const geometryType = ((panel?.querySelector('[data-field=geometry]') as HTMLSelectElement | null)
      ?.value || stickyGeometry(state.doc)) as GeometryType;
    const { doc } = createObject(state.doc, { layerId, name, geometryType });
    setDoc(doc, null);
    return;
  }
  if (cmd === 'save-object') {
    // Rename / update sticky fields for the selected existing object.
    const panel = target.closest('.point-dialog') ?? target.closest('.add-point-panel');
    if (!panel) return;
    const objectId = (panel.querySelector('[data-field=object]') as HTMLSelectElement | null)?.value;
    if (!objectId || objectId === '__new__') {
      surfaceFail('Select an existing object to rename, or use + Object.', 'object');
      return;
    }
    const objectName =
      (panel.querySelector('[data-field=object-name]') as HTMLInputElement | null)?.value?.trim() ||
      undefined;
    const layerId = (panel.querySelector('[data-field=layer]') as HTMLSelectElement | null)?.value;
    const geometryType = (panel.querySelector('[data-field=geometry]') as HTMLSelectElement | null)
      ?.value as GeometryType | undefined;
    const objects = (state.doc.objects ?? []).map((o) =>
      o.id === objectId
        ? {
            ...o,
            name: objectName || o.name,
            layerId: layerId || o.layerId,
            geometryType: geometryType || o.geometryType,
          }
        : o,
    );
    setDoc(
      {
        ...state.doc,
        objects,
        session: {
          ...state.doc.session,
          stickyObjectId: objectId,
          stickyObjectName: objectName || state.doc.session.stickyObjectName,
          stickyLayerId: layerId || state.doc.session.stickyLayerId,
          stickyGeometryType: geometryType || state.doc.session.stickyGeometryType,
        },
      },
      null,
    );
    return;
  }
  if (cmd === 'save-baseline') {
    const panel = target.closest('.step-panel') ?? target.closest('[data-testid="baseline-form"]');
    const length = Number(
      (panel?.querySelector('[data-field=length]') as HTMLInputElement | null)?.value,
    );
    const offsetA = Number(
      (panel?.querySelector('[data-field=offset-a]') as HTMLInputElement | null)?.value || 0,
    );
    const offsetB = Number(
      (panel?.querySelector('[data-field=offset-b]') as HTMLInputElement | null)?.value || 0,
    );
    const baselineId =
      (panel?.querySelector('[data-field=baseline-id]') as HTMLInputElement | HTMLSelectElement | null)
        ?.value || undefined;
    const kind = ((panel?.querySelector('[data-field=kind]') as HTMLSelectElement | null)?.value ||
      'tape') as 'tape' | 'laser';
    const trustRaw = (panel?.querySelector('[data-field=trust]') as HTMLInputElement | null)?.value;
    const trust = trustRaw != null && trustRaw !== '' ? Number(trustRaw) : undefined;
    const result = saveBaselineLengthWorkflow(state.doc, length, offsetA, offsetB, true, {
      baselineId,
      kind,
      trust,
    });
    if (!result.ok) {
      surfaceFail(result.reason ?? 'Could not save baseline.', 'baseline');
      openMenuSection('baseline');
      return;
    }
    setDoc(result.doc, null);
    setState({ menuOpen: true, menuFocus: 'baseline', openErrorLog: false });
    speakCoachLine(
      result.doc.session.lastAction ??
        'Baseline saved. Take a photo with both ends and the next house mark in frame.',
      result.doc.session.speakSteps,
    );
    return;
  }
  if (cmd === 'add-house-corner') {
    const panel = target.closest('.step-panel');
    const edgeRaw = (panel?.querySelector('[data-field=edge]') as HTMLInputElement | null)?.value;
    const edge = edgeRaw === '' || edgeRaw == null ? undefined : Number(edgeRaw);
    const offset = Number(
      (panel?.querySelector('[data-field=offset]') as HTMLInputElement | null)?.value || 0,
    );
    if (edge != null && !(edge > 0)) {
      surfaceFail('Edge length must be empty or a positive number in metres.', 'house');
      openMenuSection('house');
      return;
    }
    const next = addHouseCornerWorkflow(state.doc, edge, offset);
    setDoc(next, null);
    setState({ menuOpen: true, menuFocus: 'house', openErrorLog: false });
    speakCoachLine(next.session.lastAction ?? 'Corner added.', next.session.speakSteps);
    return;
  }
  if (cmd === 'close-house') {
    const result = closeHouseWorkflow(state.doc);
    if (result.warn) {
      logError(result.note, { source: 'close-house' });
      setDoc(result.doc, result.note);
    } else {
      setDoc(result.doc, null);
    }
    setState({
      menuOpen: true,
      menuFocus: menuFocusAfterMode(result.doc.session.mode),
      openErrorLog: false,
    });
    speakCoachLine(result.note, result.doc.session.speakSteps);
    return;
  }
  if (cmd === 'record-tie') {
    if (!baselineReady(state.doc)) {
      surfaceFail(
        'Cannot record a baseline tie — establish the baseline length first.',
        'tie',
      );
      openMenuSection('baseline');
      return;
    }
    const next = applyCannedBaselineTie(state.doc);
    setDoc(next, null);
    setState({ menuOpen: true, menuFocus: 'recommend', openErrorLog: false });
    speakCoachLine(
      'I see both baseline ends and a target mark. Good tie.',
      next.session.speakSteps,
    );
    return;
  }
  if (cmd === 'confirm-ab') {
    setDoc(confirmAbTogether(state.doc), null);
    setState({ menuOpen: true, menuFocus: 'leapfrog', openErrorLog: false });
    return;
  }
  if (cmd === 'ms-signin') {
    void onSignIn();
    return;
  }
  if (cmd === 'ms-signout') {
    void onSignOut();
    return;
  }
  if (cmd === 'onedrive-save') {
    void onOneDriveSave();
    return;
  }
  if (cmd === 'onedrive-load') {
    void onOneDriveLoad();
    return;
  }
}

async function onSignIn(): Promise<void> {
  setCloudBusy(true);
  setCloudMessage('Opening Microsoft sign-in (redirect)…');
  const result = await signIn();
  // loginRedirect navigates away on success; only clear busy on failure.
  if (!result.ok) {
    setCloudBusy(false);
    const msg = result.error ?? 'Sign-in failed.';
    logError(msg, { source: 'msal' });
    setCloudMessage(msg);
  }
}

async function onSignOut(): Promise<void> {
  setCloudBusy(true);
  setCloudMessage('Signing out…');
  const result = await signOut();
  setCloudBusy(false);
  if (!result.ok) {
    const msg = result.error ?? 'Sign-out failed.';
    logError(msg, { source: 'msal' });
    setCloudMessage(msg);
  }
}

async function onOneDriveSave(): Promise<void> {
  setCloudBusy(true);
  setCloudMessage('Saving garden.json to OneDrive…');
  const result = await saveGardenCloud(state.doc);
  setCloudBusy(false);
  if (result.ok) {
    setLastSaveIso(result.savedAt);
    setCloudMessage(`Saved to OneDrive (${getCloudStatus().pathHint}).`);
  } else {
    logError(result.error, { source: 'onedrive' });
    setCloudMessage(result.error);
  }
}

async function onOneDriveLoad(): Promise<void> {
  setCloudBusy(true);
  setCloudMessage('Loading garden.json from OneDrive…');
  const result = await loadGardenCloud();
  setCloudBusy(false);
  if (!result.ok) {
    logError(result.error, { source: 'onedrive' });
    setCloudMessage(result.error);
    return;
  }
  setDoc(result.doc, null);
  setCloudMessage(`Loaded from OneDrive (${getCloudStatus().pathHint}). Browser cache updated.`);
}

function onShellChange(e: Event): void {
  const t = e.target as HTMLInputElement | HTMLSelectElement | null;
  if (!t) return;
  const cmd = t.getAttribute('data-cmd');
  if (cmd === 'speak-toggle') {
    setDoc({
      ...state.doc,
      session: { ...state.doc.session, speakSteps: (t as HTMLInputElement).checked },
    });
    return;
  }
  if (cmd === 'select-chrome-mode') {
    selectChromeMode(t.value);
    return;
  }
  if (cmd === 'sticky-baseline') {
    setDoc(setStickyPanel(state.doc, { currentBaselineId: t.value || undefined }), null);
    return;
  }
  if (cmd === 'sticky-layer') {
    setDoc(setStickyPanel(state.doc, { stickyLayerId: t.value }), null);
    return;
  }
  if (cmd === 'sticky-object') {
    if (t.value === '__new__') {
      setDoc(setStickyPanel(state.doc, { stickyObjectId: null }), null);
      return;
    }
    const obj = state.doc.objects?.find((o) => o.id === t.value);
    setDoc(
      setStickyPanel(state.doc, {
        stickyObjectId: t.value,
        stickyObjectName: obj?.name,
        stickyGeometryType: obj?.geometryType,
        stickyLayerId: obj?.layerId,
      }),
      null,
    );
    return;
  }
  if (cmd === 'sticky-object-name') {
    setDoc(setStickyPanel(state.doc, { stickyObjectName: t.value }), null);
    return;
  }
  if (cmd === 'sticky-geometry') {
    setDoc(setStickyPanel(state.doc, { stickyGeometryType: t.value as GeometryType }), null);
    return;
  }
  if (cmd === 'baseline-trust') {
    const id = t.getAttribute('data-baseline-id');
    if (!id) return;
    setDoc(setBaselineTrust(state.doc, id, Number(t.value)), null);
    return;
  }
}

function buildApp(): HTMLElement {
  const app = el('div', { className: 'app app--plan-first' });
  if (state.view === 'tags') {
    app.appendChild(buildTagsView());
    return app;
  }
  app.appendChild(buildSurveyView());
  return app;
}

function buildSurveyView(): HTMLElement {
  const doc = state.doc;
  const coach = buildCoach(doc);
  const legal = new Set(legalActions(doc));

  const wrap = el('div', { className: 'survey-layout survey-layout--plan-first' });

  const plan = el('section', {
    className: 'plan plan--backdrop',
    attrs: { 'aria-label': 'Garden plan' },
  });
  const planHost = el('div', {
    className: 'plan__svg plan__svg--full',
    attrs: { 'data-testid': 'plan-svg' },
  });
  planHost.innerHTML = renderPlanSvg(doc, 960, 720);
  plan.appendChild(planHost);
  wrap.appendChild(plan);

  // Plan chrome: bottom-right hamburger only (+ translucent point dialogue when open).
  wrap.appendChild(buildHamburgerButton());

  if (state.pointDialog) {
    const dialog = buildPointDialog(doc, state.pointDialog);
    wrap.appendChild(dialog);
    attachPointDialogDrag(dialog);
  }

  if (state.refuseMessage) {
    wrap.appendChild(
      el('div', {
        className: 'refuse refuse--overlay',
        attrs: { role: 'alert' },
        text: state.refuseMessage,
      }),
    );
  }

  if (state.menuOpen) {
    wrap.appendChild(buildMenuDrawer(doc, coach, legal));
  }

  return wrap;
}

/** Floating hamburger — red while unseen errors remain. */
function buildHamburgerButton(): HTMLElement {
  const unseen = hasUnseenErrors();
  const count = unseenErrorCount();
  const btn = el('button', {
    className: 'hamburger' + (unseen ? ' hamburger--alert' : ''),
    attrs: {
      type: 'button',
      'data-cmd': unseen && !state.menuOpen ? 'open-error-log' : 'toggle-menu',
      'data-testid': 'hamburger',
      'aria-label': unseen
        ? `Menu — ${count} unseen error${count === 1 ? '' : 's'}`
        : state.menuOpen
          ? 'Close menu'
          : 'Open menu',
      'aria-expanded': state.menuOpen ? 'true' : 'false',
    },
  });
  btn.appendChild(el('span', { className: 'hamburger__bars', attrs: { 'aria-hidden': 'true' } }));
  if (unseen) {
    btn.appendChild(
      el('span', {
        className: 'hamburger__badge',
        text: count > 9 ? '9+' : String(count),
        attrs: { 'aria-hidden': 'true' },
      }),
    );
  }
  return btn;
}

/** Tiny recommend body used inside the hamburger accordion. */
function buildRecommendBody(
  doc: GardenDocument,
  coach: ReturnType<typeof buildCoach>,
  legal: Set<ModeAction>,
): HTMLElement {
  const body = el('div', { className: 'menu-acc__body', attrs: { 'data-testid': 'recommend-next' } });
  body.appendChild(
    el('p', {
      className: 'menu-acc__coach',
      text: coach.body[0] ?? 'Open a workflow below.',
    }),
  );
  if (coach.residualLine) {
    body.appendChild(el('p', { className: 'menu-acc__meta', text: coach.residualLine }));
  }
  const actions = el('div', { className: 'menu-drawer__row' });
  if (doc.session.mode === 'START' || legal.has('establish_baseline')) {
    actions.appendChild(
      el('button', {
        className: 'btn btn--stage2',
        text: 'Establish baseline',
        attrs: {
          type: 'button',
          'data-cmd': 'open-menu-section',
          'data-section': 'baseline',
        },
      }),
    );
  }
  if (legal.has('add_point') || doc.session.mode === 'ADD_POINT') {
    actions.appendChild(
      el('button', {
        className: 'btn btn--suggested',
        text: '+ Point',
        attrs: {
          type: 'button',
          'data-cmd': 'open-point-dialog',
          'data-testid': 'recommend-add-point',
        },
      }),
    );
  }
  if (coach.nextAction && legal.has(coach.nextAction) && coach.nextAction !== 'add_point' && coach.nextAction !== 'establish_baseline') {
    actions.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: coach.nextButton ?? actionLabel(coach.nextAction),
        attrs: {
          type: 'button',
          'data-cmd': 'mode',
          'data-action': coach.nextAction,
        },
      }),
    );
  }
  body.appendChild(actions);
  return body;
}

function buildBaselineForm(doc: GardenDocument): HTMLElement {
  const panel = el('div', {
    className: 'menu-acc__body step-panel',
    attrs: { 'data-testid': 'baseline-form' },
  });
  const ranked = baselinesByTrust(doc);
  const active = preferredBaseline(doc) ?? currentBaseline(doc);
  const ptA = active ? doc.points.find((p) => p.id === active.a) : undefined;
  const ptB = active ? doc.points.find((p) => p.id === active.b) : undefined;

  panel.appendChild(
    el('p', {
      text: active
        ? `Editing ${active.a}–${active.b}${active.label ? ` (${active.label})` : ''}. Save updates this baseline only.`
        : 'Default: one house edge. Enter length (m) and optional mark offsets (mm).',
    }),
  );

  const form = el('div', { className: 'step-form' });

  if (ranked.length > 1) {
    const pickWrap = el('label', { className: 'field' });
    pickWrap.appendChild(el('span', { text: 'Baseline' }));
    const pick = el('select', {
      attrs: {
        'data-field': 'baseline-id',
        'data-cmd': 'sticky-baseline',
        'aria-label': 'Select baseline',
        'data-testid': 'baseline-picker',
      },
    }) as HTMLSelectElement;
    for (const b of ranked) {
      const opt = document.createElement('option');
      opt.value = b.id;
      const used = b.usedForMeasurementCount ?? 0;
      opt.textContent = `${b.a}–${b.b} · ${b.lengthM.toFixed(3)} m · T${b.trust ?? 50}${used ? ` · used ×${used}` : ''}`;
      if (b.id === active?.id) opt.selected = true;
      pick.appendChild(opt);
    }
    pickWrap.appendChild(pick);
    form.appendChild(pickWrap);
  } else if (active) {
    form.appendChild(
      el('input', {
        attrs: { type: 'hidden', 'data-field': 'baseline-id', value: active.id },
      }),
    );
  }

  form.appendChild(
    textField('End A', 'end-a', active?.a ?? 'HSE01', {
      readonly: Boolean(active),
      hint: ptA?.label,
    }),
  );
  form.appendChild(
    textField('End B', 'end-b', active?.b ?? 'HSE02', {
      readonly: Boolean(active),
      hint: ptB?.label,
    }),
  );
  form.appendChild(
    numField('Length (m)', 'length', active ? String(active.lengthM) : '7'),
  );
  form.appendChild(
    numField('Offset A (mm)', 'offset-a', String(ptA?.offsetMm ?? 0)),
  );
  form.appendChild(
    numField('Offset B (mm)', 'offset-b', String(ptB?.offsetMm ?? 0)),
  );

  const kindWrap = el('label', { className: 'field' });
  kindWrap.appendChild(el('span', { text: 'Measure with' }));
  const kindSel = el('select', {
    attrs: { 'data-field': 'kind', 'aria-label': 'Tape or laser' },
  }) as HTMLSelectElement;
  for (const k of [
    { id: 'tape', label: 'Tape' },
    { id: 'laser', label: 'Laser' },
  ] as const) {
    const opt = document.createElement('option');
    opt.value = k.id;
    opt.textContent = k.label;
    if ((active?.kind ?? 'tape') === k.id) opt.selected = true;
    kindSel.appendChild(opt);
  }
  kindWrap.appendChild(kindSel);
  form.appendChild(kindWrap);

  const trustVal = String(active?.trust ?? 60);
  const trustWrap = el('label', { className: 'field field--trust' });
  trustWrap.appendChild(el('span', { text: `Trust ${trustVal}` }));
  trustWrap.appendChild(
    el('input', {
      attrs: {
        type: 'range',
        min: '0',
        max: '100',
        value: trustVal,
        'data-field': 'trust',
        'aria-label': 'Baseline trust',
      },
    }),
  );
  form.appendChild(trustWrap);

  panel.appendChild(form);
  panel.appendChild(
    el('button', {
      className: 'btn btn--util btn--stage2',
      text: active ? 'Save baseline' : 'Save baseline',
      attrs: { type: 'button', 'data-cmd': 'save-baseline' },
    }),
  );
  return panel;
}

function textField(
  label: string,
  field: string,
  value: string,
  opts: { readonly?: boolean; hint?: string } = {},
): HTMLElement {
  const wrap = el('label', { className: 'field' });
  wrap.appendChild(el('span', { text: opts.hint ? `${label} · ${opts.hint}` : label }));
  wrap.appendChild(
    el('input', {
      attrs: {
        type: 'text',
        'data-field': field,
        value,
        readonly: opts.readonly ? 'true' : undefined,
      },
    }),
  );
  return wrap;
}

function buildTieForm(doc: GardenDocument): HTMLElement {
  const panel = el('div', { className: 'menu-acc__body step-panel' });
  panel.appendChild(
    el('p', {
      text: baselineTieReady(doc)
        ? 'Both baseline ends + target mark present. Add point or measure more house edges.'
        : 'v1: one frame with both baseline ends and the house mark. Indoors, use demo clicks.',
    }),
  );
  if (!baselineTieReady(doc)) {
    panel.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Record baseline tie (demo clicks)',
        attrs: { type: 'button', 'data-cmd': 'record-tie' },
      }),
    );
  }
  return panel;
}

function buildHouseForm(doc: GardenDocument): HTMLElement {
  const panel = el('div', { className: 'menu-acc__body step-panel' });
  const n = houseCornerCount(doc);
  const closed = housePolygon(doc)?.closed;
  panel.appendChild(
    el('p', {
      text: closed
        ? `House closed with ${n} corners.`
        : `${n} corner(s) so far. Add next edge length (optional) + offset mm.`,
    }),
  );
  if (!closed) {
    const form = el('div', { className: 'step-form' });
    form.appendChild(numField('Next edge (m, optional)', 'edge', ''));
    form.appendChild(numField('Offset (mm)', 'offset', '0'));
    panel.appendChild(form);
    panel.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Add house corner',
        attrs: { type: 'button', 'data-cmd': 'add-house-corner' },
      }),
    );
    if (n >= 3) {
      panel.appendChild(
        el('button', {
          className: 'btn btn--util btn--stage2',
          text: 'Close house',
          attrs: { type: 'button', 'data-cmd': 'close-house' },
        }),
      );
    }
  }
  return panel;
}

function buildLeapfrogForm(doc: GardenDocument): HTMLElement {
  const panel = el('div', { className: 'menu-acc__body step-panel' });
  const setup = currentSetup(doc);
  panel.appendChild(
    el('p', {
      text: setup?.abPhotographedTogether
        ? 'A and B are in a shared photo. Rods moved is now legal.'
        : 'Photograph A and B together before you pick A up.',
    }),
  );
  if (!setup?.abPhotographedTogether) {
    panel.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Confirm A and B photographed together',
        attrs: { type: 'button', 'data-cmd': 'confirm-ab' },
      }),
    );
  }
  return panel;
}

function menuAccordion(
  id: MenuSection,
  title: string,
  body: HTMLElement,
  status?: { tone: 'ok' | 'warn' | 'error' | 'idle'; text?: string; inline?: string },
): HTMLElement {
  const tone = status?.tone ?? 'idle';
  const details = el('details', {
    className: 'menu-acc' + (tone !== 'idle' ? ` menu-acc--${tone}` : ''),
    attrs: {
      'data-section': id ?? undefined,
      'data-testid': id ? `menu-acc-${id}` : undefined,
      'data-status': tone,
    },
  });
  if (state.menuFocus === id) details.setAttribute('open', 'true');
  const summary = el('summary', {
    className: 'menu-acc__summary' + (tone !== 'idle' ? ` menu-acc__summary--${tone}` : ''),
    attrs: {
      'data-cmd': 'menu-accordion',
      'data-section': id ?? undefined,
    },
  });
  if (tone !== 'idle') {
    const iconLabel =
      tone === 'ok' ? 'Ready' : tone === 'warn' ? 'Not ready' : 'Problem';
    summary.appendChild(
      el('span', {
        className: `menu-acc__status-icon menu-acc__status-icon--${tone}`,
        attrs: {
          'aria-hidden': 'true',
          title: status?.text ?? status?.inline ?? iconLabel,
        },
      }),
    );
  } else {
    // Neutral spacer/dot on the left so titles align with status-bearing rows.
    summary.appendChild(
      el('span', {
        className: 'menu-acc__dot menu-acc__dot--idle',
        attrs: { 'aria-hidden': 'true' },
      }),
    );
  }
  summary.appendChild(el('span', { className: 'menu-acc__label', text: title }));
  if (status?.inline) {
    summary.appendChild(
      el('span', {
        className: 'menu-acc__inline',
        text: status.inline,
        attrs: { 'data-testid': id ? `menu-inline-${id}` : undefined },
      }),
    );
  }
  // Optional multi-line subtitle — kept for rare long detail; compact rows use inline.
  if (status?.text) {
    summary.appendChild(
      el('span', {
        className: 'menu-acc__status',
        text: status.text,
        attrs: { 'data-testid': id ? `menu-status-${id}` : undefined },
      }),
    );
  }
  // Prevent native toggle racing with our one-at-a-time state
  summary.addEventListener('click', (ev) => {
    ev.preventDefault();
  });
  details.appendChild(summary);
  details.appendChild(body);
  return details;
}

/** Concertina status for Sign in (see docs/design-philosophy-status-colours.md). */
function cloudSectionStatus(
  doc: GardenDocument,
): { tone: 'ok' | 'warn' | 'error' | 'idle'; inline?: string; text?: string } {
  const cloud = getCloudStatus();
  if (!cloud.configured) {
    return { tone: 'error', inline: 'not configured' };
  }
  if (cloud.message && /could not|error|problem|fail|denied|missing/i.test(cloud.message)) {
    return { tone: 'error', inline: 'error' };
  }
  if (!cloud.signedIn) {
    return { tone: 'warn', inline: 'not signed in' };
  }
  const gardenLoaded =
    doc.baselines.length > 0 ||
    doc.points.some((p) => p.x != null && p.y != null) ||
    Boolean(cloud.lastSaveIso);
  if (gardenLoaded) {
    // Collapsed: Sign in  garden loaded  ●green
    return { tone: 'ok', inline: 'garden loaded' };
  }
  return { tone: 'warn', inline: 'no garden' };
}

function baselineSectionStatus(
  doc: GardenDocument,
): { tone: 'ok' | 'warn' | 'error' | 'idle'; inline?: string } {
  if (baselineReady(doc)) {
    const bl = preferredBaseline(doc) ?? currentBaseline(doc);
    return {
      tone: 'ok',
      // One-line closed header: Baseline  A — B  ●
      inline: bl ? `${bl.a} — ${bl.b}` : undefined,
    };
  }
  return { tone: 'warn', inline: 'not set' };
}

/** Unified translucent + Point / inspect dialogue (same fields both modes). */
function buildPointDialog(doc: GardenDocument, mode: 'add' | 'inspect'): HTMLElement {
  const inspectingId = mode === 'inspect' ? doc.session.inspectingPointId : undefined;
  const pt = inspectingId ? doc.points.find((p) => p.id === inspectingId) : undefined;

  const dialog = el('section', {
    className: 'point-dialog',
    attrs: {
      'data-testid': 'point-dialog',
      role: 'dialog',
      'aria-label': mode === 'inspect' ? 'Point inspector' : '+ Point',
      style: `transform: translate(${pointDialogPos.x}px, ${pointDialogPos.y}px)`,
    },
  });

  const head = el('div', { className: 'point-dialog__head' });
  const drag = el('div', {
    className: 'point-dialog__drag',
    attrs: { 'data-drag-handle': 'true', title: 'Drag to move' },
  });
  drag.appendChild(
    el('h2', {
      className: 'point-dialog__title',
      text: mode === 'inspect' ? (pt ? `Point ${pt.id}` : 'Point') : '+ Point',
      attrs: { 'data-testid': 'point-dialog-title' },
    }),
  );
  drag.appendChild(
    el('span', {
      className: 'point-dialog__grip',
      text: '⠿',
      attrs: { 'aria-hidden': 'true' },
    }),
  );
  head.appendChild(drag);
  head.appendChild(
    el('button', {
      className: 'btn btn--util point-dialog__close',
      text: '✕',
      attrs: {
        type: 'button',
        'data-cmd': 'close-point-dialog',
        'data-testid': 'point-dialog-close',
        'aria-label': 'Close dialogue',
        title: 'Close',
      },
    }),
  );
  dialog.appendChild(head);

  const grid = el('div', { className: 'point-dialog__grid' });

  // Baseline — named only via the select (optgroup / first option), not repeated above.
  const blWrap = el('label', { className: 'field' });
  const blSel = el('select', {
    attrs: { 'data-field': 'baseline', 'data-cmd': 'sticky-baseline', 'aria-label': 'Baseline' },
  }) as HTMLSelectElement;
  const ranked = baselinesByTrust(doc);
  const blHeader = document.createElement('option');
  blHeader.value = '';
  blHeader.disabled = true;
  blHeader.textContent = 'Baseline…';
  if (!ranked.length) blHeader.selected = true;
  blSel.appendChild(blHeader);
  for (const b of ranked) {
    const opt = document.createElement('option');
    opt.value = b.id;
    const used = b.usedForMeasurementCount ?? 0;
    opt.textContent = `${b.a}–${b.b} · T${b.trust ?? 50}${used ? ` · ×${used}` : ''}`;
    if (b.id === (doc.session.currentBaselineId ?? ranked[0]?.id)) opt.selected = true;
    blSel.appendChild(opt);
  }
  blWrap.appendChild(blSel);
  grid.appendChild(blWrap);

  const curBl = ranked.find((b) => b.id === doc.session.currentBaselineId) ?? ranked[0];
  if (curBl) {
    const trustWrap = el('label', { className: 'field field--trust' });
    trustWrap.appendChild(
      el('input', {
        attrs: {
          type: 'range',
          min: '0',
          max: '100',
          value: String(curBl.trust ?? 50),
          'data-cmd': 'baseline-trust',
          'data-baseline-id': curBl.id,
          'aria-label': `Trust ${curBl.a}–${curBl.b}`,
          title: `Trust ${curBl.trust ?? 50}`,
        },
      }),
    );
    grid.appendChild(trustWrap);
  }

  const layerWrap = el('label', { className: 'field' });
  const layerSel = el('select', {
    attrs: { 'data-field': 'layer', 'data-cmd': 'sticky-layer', 'aria-label': 'Layer' },
  }) as HTMLSelectElement;
  const layerHeader = document.createElement('option');
  layerHeader.value = '';
  layerHeader.disabled = true;
  layerHeader.textContent = 'Layer…';
  layerSel.appendChild(layerHeader);
  const layers = doc.layers?.length ? doc.layers : [{ id: 'walkway', name: 'Walkway' }];
  const stickyL = stickyLayer(doc).id;
  for (const l of layers) {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;
    if (l.id === stickyL) opt.selected = true;
    layerSel.appendChild(opt);
  }
  layerWrap.appendChild(layerSel);
  grid.appendChild(layerWrap);

  const objWrap = el('label', { className: 'field' });
  const objSel = el('select', {
    attrs: { 'data-field': 'object', 'data-cmd': 'sticky-object', 'aria-label': 'Object' },
  }) as HTMLSelectElement;
  const objHeader = document.createElement('option');
  objHeader.value = '';
  objHeader.disabled = true;
  objHeader.textContent = 'Object…';
  objSel.appendChild(objHeader);
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ Object';
  objSel.appendChild(newOpt);
  for (const o of objectsOnLayer(doc, stickyL)) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name;
    if (o.id === doc.session.stickyObjectId) opt.selected = true;
    objSel.appendChild(opt);
  }
  if (!doc.session.stickyObjectId) newOpt.selected = true;
  objWrap.appendChild(objSel);
  grid.appendChild(objWrap);

  const nameWrap = el('label', { className: 'field' });
  nameWrap.appendChild(
    el('input', {
      attrs: {
        type: 'text',
        'data-field': 'object-name',
        'data-cmd': 'sticky-object-name',
        value: doc.session.stickyObjectName ?? stickyObject(doc)?.name ?? '',
        placeholder: 'Object name…',
        'aria-label': 'Object name',
      },
    }),
  );
  grid.appendChild(nameWrap);

  const geoWrap = el('label', { className: 'field' });
  const geoSel = el('select', {
    attrs: { 'data-field': 'geometry', 'data-cmd': 'sticky-geometry', 'aria-label': 'Geometry' },
  }) as HTMLSelectElement;
  const geoHeader = document.createElement('option');
  geoHeader.value = '';
  geoHeader.disabled = true;
  geoHeader.textContent = 'Geometry…';
  geoSel.appendChild(geoHeader);
  const geo = stickyGeometry(doc);
  for (const g of GEOMETRY_CHOICES) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.label;
    if (g.id === geo) opt.selected = true;
    geoSel.appendChild(opt);
  }
  geoWrap.appendChild(geoSel);
  grid.appendChild(geoWrap);

  dialog.appendChild(grid);

  // Photos list only when there is something to show (no duplicate instructional prose).
  if (pt) {
    const photos = (pt.photoIds ?? [])
      .map((id) => doc.photos.find((p) => p.id === id))
      .filter(Boolean);
    if (photos.length) {
      const photosSection = el('div', { className: 'point-dialog__photos' });
      const list = el('ul', { className: 'point-dialog__photo-list' });
      for (const ph of photos) {
        list.appendChild(el('li', { text: `${ph!.id}${ph!.note ? ` — ${ph!.note}` : ''}` }));
      }
      photosSection.appendChild(list);
      dialog.appendChild(photosSection);
    }
    const obj = pt.objectId ? doc.objects?.find((o) => o.id === pt.objectId) : undefined;
    if (obj?.residualMm != null) {
      dialog.appendChild(
        el('p', {
          className: 'point-dialog__residual',
          text: `~${obj.residualMm.toFixed(0)} mm`,
        }),
      );
    }
  }

  const actionsRow = el('div', { className: 'point-dialog__actions' });
  actionsRow.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: '+ Object',
      attrs: {
        type: 'button',
        'data-cmd': 'create-object',
        'data-testid': 'plus-object',
        'aria-label': 'Create new object',
      },
    }),
  );
  // Save renames/updates the selected existing object (name + layer + geometry).
  if (mode === 'inspect' || doc.session.stickyObjectId) {
    actionsRow.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Save',
        attrs: {
          type: 'button',
          'data-cmd': mode === 'inspect' ? 'apply-inspector' : 'save-object',
          'data-testid': 'point-dialog-save',
          'aria-label': 'Save object changes',
        },
      }),
    );
  }
  if (mode === 'add') {
    actionsRow.appendChild(
      el('button', {
        className: 'btn btn--suggested',
        text: '+ Point',
        attrs: {
          type: 'button',
          'data-cmd': 'add-photo',
          'data-testid': 'add-photo',
          'aria-label': 'Add measurement point',
        },
      }),
    );
  }
  actionsRow.appendChild(
    el('button', {
      className: 'btn btn--util point-dialog__close-footer',
      text: 'Close',
      attrs: {
        type: 'button',
        'data-cmd': 'close-point-dialog',
        'data-testid': 'point-dialog-close-footer',
        'aria-label': 'Close dialogue',
      },
    }),
  );
  dialog.appendChild(actionsRow);
  return dialog;
}

/** Pointer drag on the dialogue header — updates transform live; persists offset. */
function attachPointDialogDrag(dialog: HTMLElement): void {
  const handle = dialog.querySelector('[data-drag-handle]') as HTMLElement | null;
  if (!handle) return;

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  const onMove = (ev: PointerEvent) => {
    if (!dragging) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const x = originX + dx;
    const y = originY + dy;
    dialog.style.transform = `translate(${x}px, ${y}px)`;
  };

  const onUp = (ev: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture(ev.pointerId);
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    pointDialogPos = { x: originX + dx, y: originY + dy };
    dialog.classList.remove('point-dialog--dragging');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };

  handle.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement).closest('button')) return;
    dragging = true;
    startX = ev.clientX;
    startY = ev.clientY;
    originX = pointDialogPos.x;
    originY = pointDialogPos.y;
    dialog.classList.add('point-dialog--dragging');
    handle.setPointerCapture(ev.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    ev.preventDefault();
  });
}

/** Full menu drawer — one accordion open at a time; plan stays chrome-free when closed. */
function buildMenuDrawer(
  doc: GardenDocument,
  coach: ReturnType<typeof buildCoach>,
  legal: Set<ModeAction>,
): HTMLElement {
  const root = el('div', {
    className: 'menu-drawer',
    attrs: { 'data-testid': 'menu-drawer', role: 'dialog', 'aria-label': 'Menu' },
  });
  root.appendChild(
    el('button', {
      className: 'menu-drawer__backdrop',
      attrs: { type: 'button', 'data-cmd': 'close-menu', 'aria-label': 'Close menu' },
    }),
  );

  const panel = el('div', { className: 'menu-drawer__panel' });
  const head = el('div', { className: 'menu-drawer__head' });
  head.appendChild(el('h2', { className: 'menu-drawer__title', text: 'Menu' }));
  panel.appendChild(head);

  // Always-visible thumb control — not buried in Recommended next / Tools.
  const quick = el('div', {
    className: 'menu-drawer__quick',
    attrs: { 'data-testid': 'menu-quick-actions' },
  });
  quick.appendChild(
    el('button', {
      className: 'btn btn--suggested btn--thumb',
      text: '+ Point',
      attrs: {
        type: 'button',
        'data-cmd': 'open-point-dialog',
        'data-testid': 'menu-open-add-point',
        'aria-label': 'Open + Point dialogue',
      },
    }),
  );
  panel.appendChild(quick);

  // —— Top: Mode + Version (near top of concertina) ——
  panel.appendChild(menuAccordion('mode', 'Mode', buildModePicker(doc), modeSectionStatus()));

  const versionBody = el('div', {
    className: 'menu-acc__body',
    attrs: { 'data-testid': 'version-panel' },
  });
  versionBody.appendChild(
    el('p', {
      className: 'menu-drawer__stamp',
      text: buildStamp(),
      attrs: { 'data-testid': 'build-stamp' },
    }),
  );
  panel.appendChild(menuAccordion('version', buildMenuTitle(), versionBody));

  // —— Workflows ——
  panel.appendChild(menuAccordion('recommend', 'Recommended next', buildRecommendBody(doc, coach, legal)));

  // + Point is NOT a concertina — quick / Mode / Tools open the on-plan dialogue and dismiss the menu.

  const coachBody = el('div', { className: 'menu-acc__body', attrs: { 'data-testid': 'coach-panel' } });
  for (const line of coach.body) {
    coachBody.appendChild(el('p', { className: 'menu-acc__coach', text: line }));
  }
  if (coach.residualLine) {
    coachBody.appendChild(el('p', { className: 'menu-acc__meta', text: coach.residualLine }));
  }
  if (coach.geometryLine) {
    coachBody.appendChild(el('p', { className: 'menu-acc__meta', text: coach.geometryLine }));
  }
  panel.appendChild(menuAccordion('coach', 'Coach', coachBody));

  panel.appendChild(
    menuAccordion('baseline', 'Baseline', buildBaselineForm(doc), baselineSectionStatus(doc)),
  );
  panel.appendChild(menuAccordion('tie', 'Baseline tie', buildTieForm(doc)));
  panel.appendChild(menuAccordion('house', 'House corners', buildHouseForm(doc)));
  panel.appendChild(menuAccordion('leapfrog', 'Leapfrog', buildLeapfrogForm(doc)));

  // —— Cloud ——
  const cloudBody = el('div', { className: 'menu-acc__body' });
  cloudBody.appendChild(buildCloudPanel());
  panel.appendChild(
    menuAccordion('cloud', 'Sign in', cloudBody, cloudSectionStatus(doc)),
  );

  // —— Tools ——
  const toolsBody = el('div', { className: 'menu-acc__body', attrs: { 'data-testid': 'tools-panel' } });
  toolsBody.appendChild(el('h4', { className: 'menu-acc__sub', text: 'Garden' }));
  const tools = el('div', { className: 'menu-drawer__row' });
  tools.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'New garden',
      attrs: { type: 'button', 'data-cmd': 'new-garden' },
    }),
  );
  tools.appendChild(
    el('button', {
      className: 'btn btn--util btn--stage2',
      text: 'Establish baseline (Stage 2)',
      attrs: { type: 'button', 'data-cmd': 'start-stage2' },
    }),
  );
  tools.appendChild(
    el('button', {
      className: 'btn btn--suggested btn--thumb',
      text: '+ Point',
      attrs: {
        type: 'button',
        'data-cmd': 'open-point-dialog',
        'data-testid': 'tools-open-add-point',
      },
    }),
  );
  toolsBody.appendChild(tools);

  toolsBody.appendChild(el('h4', { className: 'menu-acc__sub', text: 'All mode actions' }));
  const allList = el('div', { className: 'menu-drawer__actions' });
  for (const action of ALL_ACTIONS) {
    const isLegal = legal.has(action);
    allList.appendChild(
      el('button', {
        className:
          'btn btn--util' +
          (isLegal ? '' : ' btn--disabled') +
          (coach.nextAction === action ? ' btn--suggested' : ''),
        text: actionLabel(action),
        attrs: {
          type: 'button',
          'data-cmd': 'mode',
          'data-action': action,
          'aria-disabled': isLegal ? 'false' : 'true',
        },
      }),
    );
  }
  toolsBody.appendChild(allList);

  toolsBody.appendChild(el('h4', { className: 'menu-acc__sub', text: 'Print & checklist' }));
  const printRow = el('div', { className: 'menu-drawer__row' });
  printRow.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Print tags (A4 belts + FNC01–04)',
      attrs: { type: 'button', 'data-cmd': 'print-tags' },
    }),
  );
  printRow.appendChild(
    el('button', {
      className: 'btn btn--util btn--stage2',
      text: state.showStage2Checklist ? 'Hide Stage 2 checklist' : 'Show Stage 2 checklist',
      attrs: { type: 'button', 'data-cmd': 'toggle-stage2-checklist' },
    }),
  );
  toolsBody.appendChild(printRow);
  if (state.showStage2Checklist) {
    toolsBody.appendChild(buildStage2ChecklistPanel());
  }

  toolsBody.appendChild(el('h4', { className: 'menu-acc__sub', text: 'Load demo' }));
  const demos = el('div', { className: 'menu-drawer__row' });
  demos.appendChild(
    el('button', {
      className: 'btn btn--util btn--demo',
      text: 'Load synthetic demo',
      attrs: { type: 'button', 'data-cmd': 'load-synthetic' },
    }),
  );
  demos.appendChild(
    el('button', {
      className: 'btn btn--util btn--demo',
      text: 'Run milestone demo',
      attrs: { type: 'button', 'data-cmd': 'run-milestone' },
    }),
  );
  toolsBody.appendChild(demos);

  toolsBody.appendChild(el('h4', { className: 'menu-acc__sub', text: 'Export / Import' }));
  const io = el('div', { className: 'menu-drawer__row' });
  io.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Export garden.json',
      attrs: { type: 'button', 'data-cmd': 'export' },
    }),
  );
  const fileLabel = el('label', { className: 'btn btn--file', text: 'Import garden.json' });
  const fileInput = el('input', {
    attrs: { type: 'file', accept: 'application/json,.json', hidden: 'true' },
  }) as HTMLInputElement;
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const imported = await importGarden(f);
      setDoc(imported, null);
      setState({ menuOpen: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Import failed.';
      surfaceFail(msg, 'import');
    }
  });
  fileLabel.appendChild(fileInput);
  io.appendChild(fileLabel);
  toolsBody.appendChild(io);

  toolsBody.appendChild(el('h4', { className: 'menu-acc__sub', text: 'Settings' }));
  const speakLabel = el('label', { className: 'toggle' });
  const speak = el('input', {
    attrs: { type: 'checkbox', 'data-cmd': 'speak-toggle' },
  }) as HTMLInputElement;
  speak.checked = doc.session.speakSteps;
  speakLabel.appendChild(speak);
  speakLabel.appendChild(document.createTextNode(' Speak steps'));
  toolsBody.appendChild(speakLabel);
  panel.appendChild(menuAccordion('tools', 'Tools', toolsBody));

  // —— Error log ——
  const errBody = el('div', {
    className: 'menu-acc__body menu-drawer__errors',
    attrs: { 'data-testid': 'error-log', id: 'error-log' },
  });
  const errHead = el('div', { className: 'menu-drawer__row' });
  errHead.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Mark seen',
      attrs: { type: 'button', 'data-cmd': 'mark-errors-seen' },
    }),
  );
  errHead.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Clear',
      attrs: { type: 'button', 'data-cmd': 'clear-error-log' },
    }),
  );
  errBody.appendChild(errHead);
  const entries = getErrorLog();
  if (!entries.length) {
    errBody.appendChild(
      el('p', { className: 'menu-drawer__empty', text: 'No errors captured this session.' }),
    );
  } else {
    const list = el('ul', { className: 'error-log__list' });
    for (const entry of entries) {
      const item = el('li', { className: 'error-log__item' });
      const when = new Date(entry.at).toLocaleString();
      item.appendChild(
        el('div', {
          className: 'error-log__meta',
          text: `${when}${entry.source ? ` · ${entry.source}` : ''}`,
        }),
      );
      item.appendChild(el('div', { className: 'error-log__msg', text: entry.message }));
      if (entry.stack) {
        item.appendChild(el('pre', { className: 'error-log__stack', text: entry.stack }));
      }
      list.appendChild(item);
    }
    errBody.appendChild(list);
  }
  const errAcc = menuAccordion('error-log', 'Error log', errBody);
  panel.appendChild(errAcc);

  // —— Glossary ——
  const glossaryBody = el('div', {
    className: 'menu-acc__body glossary',
    attrs: { 'data-testid': 'glossary' },
  });
  const glossary: Array<[string, string]> = [
    ['+ Point', 'New measurement on the current object.'],
    ['+ Object', 'New named thing on the current layer.'],
    ['Baseline', 'Control segment used for measurements.'],
    ['Layer', 'Grouping plane for objects (e.g. walkway, bed).'],
    ['Object', 'Named thing you measure points on.'],
    ['Geometry', 'Shape hint for the object (square, circle, …).'],
    ['Menu', 'Idle mode when no workflow dialog is open.'],
  ];
  const dl = el('dl', { className: 'glossary__list' });
  for (const [term, def] of glossary) {
    dl.appendChild(el('dt', { className: 'glossary__term', text: term }));
    dl.appendChild(el('dd', { className: 'glossary__def', text: def }));
  }
  glossaryBody.appendChild(dl);
  panel.appendChild(menuAccordion('glossary', 'Glossary', glossaryBody));

  // Close is last in document flow (end of concertina list) — not a sticky overlay.
  // Backdrop click already closes; this is the thumb-reachable explicit control.
  const foot = el('div', {
    className: 'menu-drawer__foot',
    attrs: { 'data-testid': 'menu-drawer-foot' },
  });
  foot.appendChild(
    el('button', {
      className: 'btn btn--util menu-drawer__close',
      text: 'Close',
      attrs: {
        type: 'button',
        'data-cmd': 'close-menu',
        'data-testid': 'menu-close',
        'aria-label': 'Close menu',
      },
    }),
  );
  panel.appendChild(foot);

  root.appendChild(panel);

  if (state.openErrorLog || state.menuFocus === 'error-log') {
    queueMicrotask(() => {
      errAcc.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  } else if (state.menuFocus) {
    queueMicrotask(() => {
      const open = panel.querySelector(`details[data-section="${state.menuFocus}"]`);
      open?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  return root;
}

function buildCloudPanel(): HTMLElement {
  const cloud = getCloudStatus();
  const panel = el('section', {
    className: 'cloud-status',
    attrs: { 'aria-live': 'polite', 'data-testid': 'cloud-status' },
  });
  panel.appendChild(el('h2', { className: 'cloud-status__title', text: 'Microsoft / OneDrive' }));

  if (!cloud.configured) {
    panel.appendChild(
      el('p', {
        className: 'cloud-status__line',
        text: 'Sign-in is not configured on this build yet. Local cache and Export/Import still work. See docs/entra-onedrive-setup.md.',
      }),
    );
    return panel;
  }

  if (cloud.signedIn) {
    panel.appendChild(
      el('p', {
        className: 'cloud-status__line cloud-status__line--ok',
        text: `Signed in${cloud.accountLabel ? ` as ${cloud.accountLabel}` : ''}.`,
      }),
    );
  } else {
    panel.appendChild(
      el('p', {
        className: 'cloud-status__line',
        text: 'Not signed in. Sign in to save the garden map to OneDrive across devices.',
      }),
    );
  }

  panel.appendChild(
    el('p', {
      className: 'cloud-status__line cloud-status__meta',
      text: cloud.lastSaveLabel,
    }),
  );
  panel.appendChild(
    el('p', {
      className: 'cloud-status__line cloud-status__meta',
      text: `OneDrive path: ${cloud.pathHint}`,
    }),
  );

  if (cloud.message) {
    panel.appendChild(
      el('p', {
        className: 'cloud-status__line cloud-status__msg',
        text: cloud.message,
      }),
    );
  }
  if (cloud.busy) {
    panel.appendChild(
      el('p', {
        className: 'cloud-status__line cloud-status__busy',
        text: 'Working…',
      }),
    );
  }

  const row = el('div', { className: 'cloud-status__actions' });
  if (!cloud.signedIn) {
    row.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Sign in with Microsoft',
        attrs: {
          type: 'button',
          'data-cmd': 'ms-signin',
          disabled: cloud.busy ? 'true' : undefined,
        },
      }),
    );
  } else {
    row.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Save to OneDrive',
        attrs: {
          type: 'button',
          'data-cmd': 'onedrive-save',
          disabled: cloud.busy ? 'true' : undefined,
        },
      }),
    );
    row.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Load from OneDrive',
        attrs: {
          type: 'button',
          'data-cmd': 'onedrive-load',
          disabled: cloud.busy ? 'true' : undefined,
        },
      }),
    );
    row.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Sign out',
        attrs: {
          type: 'button',
          'data-cmd': 'ms-signout',
          disabled: cloud.busy ? 'true' : undefined,
        },
      }),
    );
  }
  panel.appendChild(row);
  return panel;
}

function buildStage2ChecklistPanel(): HTMLElement {
  const panel = el('section', {
    className: 'stage2-checklist',
    attrs: { 'data-testid': 'stage2-checklist', 'aria-label': 'Stage 2 field checklist' },
  });
  panel.appendChild(
    el('h2', { className: 'stage2-checklist__title', text: 'Stage 2 field checklist' }),
  );
  panel.appendChild(
    el('p', {
      className: 'stage2-checklist__intro',
      text: 'House → rod A → tie → Add point → (yaw) → leapfrog → rods moved → adjust. Full phone list: docs/stage-2-field-checklist.md',
    }),
  );
  const list = el('ol', { className: 'stage2-checklist__list' });
  for (const step of STAGE2_FIELD_STEPS) {
    const item = el('li', { className: 'stage2-checklist__item' });
    item.appendChild(
      el('strong', { className: 'stage2-checklist__mode', text: step.modeLabel }),
    );
    item.appendChild(document.createTextNode(` — ${step.doThis} `));
    item.appendChild(
      el('span', { className: 'stage2-checklist__btn', text: `(${step.button})` }),
    );
    list.appendChild(item);
  }
  panel.appendChild(list);
  return panel;
}

/** Begin Stage 2 via workflow (toolbox underneath). */
function startStage2FieldLoop(): void {
  const result = startStage2FieldWorkflow(state.doc);
  if (!result.ok) {
    surfaceFail(result.reason ?? 'Could not start Stage 2.', 'stage2');
    setState({
      showStage2Checklist: true,
      menuOpen: true,
      menuFocus: 'tools',
    });
    return;
  }
  setState({
    doc: result.doc,
    view: 'survey',
    refuseMessage: null,
    showStage2Checklist: result.showChecklist,
    menuOpen: true,
    menuFocus: 'baseline',
    openErrorLog: false,
  });
  const coach = buildCoach(result.doc);
  speakCoachLine(coach.body[0] ?? '', result.doc.session.speakSteps);
}

/** Prefer keeping workflow forms open in the drawer after a mode change. */
function menuFocusAfterMode(mode: string): MenuSection {
  switch (mode) {
    case 'BASELINE':
    case 'HOUSE_BASELINE':
      return 'baseline';
    case 'PHOTO_TIE_BASELINE':
    case 'PHOTO_TIE_HOUSE_ROD':
      return 'tie';
    case 'HOUSE_EDGES':
    case 'PLACE_ROD_A':
      return 'house';
    case 'LEAPFROG':
      return 'leapfrog';
    case 'ADD_POINT':
    case 'ADD_POINT_EXTRA_YAW':
      return 'recommend';
    case 'ADJUST':
      return 'coach';
    default:
      return 'recommend';
  }
}

function numField(label: string, field: string, value: string): HTMLElement {
  const wrap = el('label', { className: 'field' });
  wrap.appendChild(el('span', { text: label }));
  const attrs: Record<string, string | undefined> = {
    type: 'number',
    step: '0.001',
    'data-field': field,
  };
  if (value !== '') {
    attrs.min = '0';
    attrs.value = value;
  } else {
    attrs.min = '0';
    attrs.placeholder = 'optional';
  }
  wrap.appendChild(el('input', { attrs }));
  return wrap;
}

function buildTagsView(): HTMLElement {
  const wrap = el('div', { className: 'tags-view' });
  const toolbar = el('div', { className: 'tags-toolbar no-print' });
  toolbar.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: '← Back to survey',
      attrs: { type: 'button', 'data-cmd': 'back-survey' },
    }),
  );
  toolbar.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Print…',
      attrs: { type: 'button', 'data-cmd': 'do-print' },
    }),
  );
  wrap.appendChild(toolbar);
  const host = el('div', { className: 'tags-host' });
  host.innerHTML = renderTagsPrintHtml(state.doc);
  wrap.appendChild(host);
  return wrap;
}

function onModeAction(action: ModeAction): void {
  const doc = state.doc;

  if (action === 'close_house') {
    const probe = canTransition(doc, action);
    if (!probe.ok) {
      surfaceFail(probe.reason ?? 'Illegal transition.', 'mode');
      speakCoachLine(probe.reason ?? '', doc.session.speakSteps);
      return;
    }
    const result = closeHouseWorkflow(doc);
    if (result.warn) {
      logError(result.note, { source: 'close-house' });
      setDoc(result.doc, result.note);
    } else {
      setDoc(result.doc, null);
    }
    speakCoachLine(result.note, result.doc.session.speakSteps);
    setState({
      menuOpen: true,
      menuFocus: menuFocusAfterMode(result.doc.session.mode),
      openErrorLog: false,
    });
    return;
  }

  const probe = canTransition(doc, action);
  if (!probe.ok) {
    const reason = probe.reason ?? 'Illegal transition.';
    surfaceFail(reason, 'mode');
    speakCoachLine(reason, doc.session.speakSteps);
    return;
  }

  if (action === 'adjust') {
    runAdjust(doc);
    setState({
      menuOpen: true,
      menuFocus: 'coach',
      openErrorLog: false,
    });
    return;
  }

  // + Point always dismisses the hamburger and opens the on-plan dialog.
  if (action === 'add_point') {
    startAddPointDialog();
    return;
  }

  const { doc: next, result } = applyTransition(doc, action);
  if (!result.ok) {
    surfaceFail(result.reason ?? 'Illegal transition.', 'mode');
    speakCoachLine(result.reason ?? '', doc.session.speakSteps);
    return;
  }
  setDoc(next, null);
  setState({
    menuOpen: true,
    menuFocus: menuFocusAfterMode(next.session.mode),
    openErrorLog: false,
  });
  const coach = buildCoach(next);
  speakCoachLine(coach.body[0] ?? '', next.session.speakSteps);
}

function runAdjust(doc: GardenDocument): void {
  const result = toolboxRunAdjust(doc);
  if (!result.ok) {
    surfaceFail(result.reason ?? 'Illegal transition.', 'adjust');
    speakCoachLine(result.reason ?? '', doc.session.speakSteps);
    return;
  }
  setDoc(result.doc, null);
  const coach = buildCoach(result.doc);
  const spoken = result.residualNotes.join(' ') || coach.body.join(' ');
  speakCoachLine(spoken, result.doc.session.speakSteps);
}

function loadSynthetic(): void {
  const doc = loadSyntheticWorkflow();
  setDoc(doc, null);
  setState({ menuOpen: false });
  const coach = buildCoach(doc);
  speakCoachLine(coach.body[0] ?? '', doc.session.speakSteps);
}

/** One-click unstick for the milestone demo path. */
function runMilestoneDemo(): void {
  const result = runMilestoneDemoWorkflow();
  if (!result.ok) {
    logError(result.reason ?? 'Milestone demo failed.', { source: 'demo' });
    setState({
      doc: result.doc,
      view: 'survey',
      refuseMessage: result.reason ?? 'Milestone demo failed.',
      menuOpen: false,
    });
    return;
  }
  setState({
    doc: result.doc,
    view: 'survey',
    refuseMessage: null,
    showStage2Checklist: false,
    menuOpen: false,
  });
  const coach = buildCoach(result.doc);
  speakCoachLine(
    result.residualNotes.join(' ') || coach.body.join(' '),
    result.doc.session.speakSteps,
  );
}

function el(
  tag: string,
  opts: {
    className?: string;
    text?: string;
    attrs?: Record<string, string | undefined>;
  } = {},
): HTMLElement {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v !== undefined) node.setAttribute(k, v);
    }
  }
  return node;
}
