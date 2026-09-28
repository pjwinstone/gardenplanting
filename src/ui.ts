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
import { buildStamp } from './buildInfo';
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
} from './workflows';

export type View = 'survey' | 'tags';

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
}

type Listener = () => void;

let state: UiState = {
  doc: loadCachedGarden() ?? createEmptyGarden(),
  view: 'survey',
  refuseMessage: null,
  showStage2Checklist: false,
  menuOpen: false,
  openErrorLog: false,
};

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
    setState({
      menuOpen: !state.menuOpen,
      openErrorLog: false,
      refuseMessage: state.refuseMessage,
    });
    return;
  }
  if (cmd === 'close-menu') {
    setState({ menuOpen: false, openErrorLog: false });
    return;
  }
  if (cmd === 'open-error-log') {
    markErrorsSeen();
    setState({ menuOpen: true, openErrorLog: true });
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
      menuOpen: false,
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
  if (cmd === 'save-baseline') {
    const panel = target.closest('.step-panel');
    const length = Number(
      (panel?.querySelector('[data-field=length]') as HTMLInputElement | null)?.value,
    );
    const offsetA = Number(
      (panel?.querySelector('[data-field=offset-a]') as HTMLInputElement | null)?.value || 0,
    );
    const offsetB = Number(
      (panel?.querySelector('[data-field=offset-b]') as HTMLInputElement | null)?.value || 0,
    );
    const result = saveBaselineLengthWorkflow(state.doc, length, offsetA, offsetB, true);
    if (!result.ok) {
      surfaceFail(result.reason ?? 'Could not save baseline.', 'baseline');
      return;
    }
    setDoc(result.doc, null);
    speakCoachLine(
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
      return;
    }
    const next = addHouseCornerWorkflow(state.doc, edge, offset);
    setDoc(next, null);
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
    speakCoachLine(result.note, result.doc.session.speakSteps);
    return;
  }
  if (cmd === 'record-tie') {
    if (!baselineReady(state.doc)) {
      surfaceFail(
        'Cannot record a baseline tie — establish the baseline length first.',
        'tie',
      );
      return;
    }
    const next = applyCannedBaselineTie(state.doc);
    setDoc(next, null);
    speakCoachLine(
      'I see both baseline ends and a target mark. Good tie.',
      next.session.speakSteps,
    );
    return;
  }
  if (cmd === 'confirm-ab') {
    setDoc(confirmAbTogether(state.doc), null);
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
  const t = e.target as HTMLInputElement | null;
  if (!t || t.getAttribute('data-cmd') !== 'speak-toggle') return;
  setDoc({
    ...state.doc,
    session: { ...state.doc.session, speakSteps: t.checked },
  });
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

  wrap.appendChild(buildHamburgerButton());
  wrap.appendChild(buildMinimalChrome(doc, coach, legal));

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

  const below = el('div', { className: 'survey-below' });
  if (state.showStage2Checklist) {
    below.appendChild(buildStage2ChecklistPanel());
  }
  const step = buildStepPanel(doc);
  if (step) below.appendChild(step);
  if (doc.photos.length) {
    const thumbs = el('div', { className: 'thumbs' });
    for (const ph of doc.photos) {
      const card = el('figure', { className: 'thumb' });
      if (ph.thumbnailDataUrl) {
        card.appendChild(
          el('img', {
            attrs: { src: ph.thumbnailDataUrl, alt: ph.note ?? ph.id },
          }),
        );
      }
      card.appendChild(
        el('figcaption', {
          text: `${ph.id}${ph.occupyPointId ? ` → ${ph.occupyPointId}` : ''}`,
        }),
      );
      thumbs.appendChild(card);
    }
    below.appendChild(thumbs);
  }
  wrap.appendChild(below);

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

/** Mid-workflow chrome only: short coach line + primary next action. */
function buildMinimalChrome(
  doc: GardenDocument,
  coach: ReturnType<typeof buildCoach>,
  legal: Set<ModeAction>,
): HTMLElement {
  const chrome = el('div', {
    className: 'minimal-chrome',
    attrs: { role: 'status', 'data-testid': 'minimal-chrome' },
  });
  chrome.appendChild(
    el('p', {
      className: 'minimal-chrome__coach',
      text: coach.body[0] ?? 'Follow the next action.',
      attrs: { 'aria-live': 'polite' },
    }),
  );
  if (coach.residualLine) {
    chrome.appendChild(
      el('p', { className: 'minimal-chrome__meta', text: coach.residualLine }),
    );
  }

  const actions = el('div', { className: 'minimal-chrome__actions' });
  if (coach.nextAction && legal.has(coach.nextAction)) {
    actions.appendChild(
      el('button', {
        className: 'btn btn--suggested minimal-chrome__primary',
        text: coach.nextButton ?? actionLabel(coach.nextAction),
        attrs: {
          type: 'button',
          'data-cmd': 'mode',
          'data-action': coach.nextAction,
        },
      }),
    );
  } else if (doc.session.mode === 'START') {
    actions.appendChild(
      el('button', {
        className: 'btn btn--stage2 minimal-chrome__primary',
        text: 'Establish baseline',
        attrs: { type: 'button', 'data-cmd': 'start-stage2' },
      }),
    );
  }
  if (actions.childNodes.length) chrome.appendChild(actions);
  return chrome;
}

/** Full menu drawer — Sign-in, Tools, actions, Print, checklist, demos, I/O, stamp, Settings, Error log. */
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
  head.appendChild(
    el('button', {
      className: 'btn btn--util menu-drawer__close',
      text: 'Close',
      attrs: { type: 'button', 'data-cmd': 'close-menu' },
    }),
  );
  panel.appendChild(head);

  panel.appendChild(
    el('p', {
      className: 'menu-drawer__mode',
      text: coach.banner,
    }),
  );

  // Sign in / OneDrive
  panel.appendChild(sectionTitle('Sign in / OneDrive'));
  panel.appendChild(buildCloudPanel());

  // Tools
  panel.appendChild(sectionTitle('Tools'));
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
  panel.appendChild(tools);

  // All mode actions
  panel.appendChild(sectionTitle('All mode actions'));
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
  panel.appendChild(allList);

  // Print tags
  panel.appendChild(sectionTitle('Print tags'));
  panel.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Print tags (A4 belts + FNC01–04)',
      attrs: { type: 'button', 'data-cmd': 'print-tags' },
    }),
  );

  // Stage 2 checklist
  panel.appendChild(sectionTitle('Stage 2 checklist'));
  panel.appendChild(
    el('button', {
      className: 'btn btn--util btn--stage2',
      text: state.showStage2Checklist ? 'Hide Stage 2 checklist' : 'Show Stage 2 checklist',
      attrs: { type: 'button', 'data-cmd': 'toggle-stage2-checklist' },
    }),
  );

  // Load demo
  panel.appendChild(sectionTitle('Load demo'));
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
  panel.appendChild(demos);

  // Export / Import
  panel.appendChild(sectionTitle('Export / Import'));
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
  panel.appendChild(io);

  // Build stamp
  panel.appendChild(sectionTitle('Build stamp'));
  panel.appendChild(
    el('p', {
      className: 'menu-drawer__stamp',
      text: buildStamp(),
      attrs: { 'data-testid': 'build-stamp' },
    }),
  );

  // Settings
  panel.appendChild(sectionTitle('Settings'));
  const speakLabel = el('label', { className: 'toggle' });
  const speak = el('input', {
    attrs: { type: 'checkbox', 'data-cmd': 'speak-toggle' },
  }) as HTMLInputElement;
  speak.checked = doc.session.speakSteps;
  speakLabel.appendChild(speak);
  speakLabel.appendChild(document.createTextNode(' Speak steps'));
  panel.appendChild(speakLabel);

  // Error log
  const errSection = el('section', {
    className: 'menu-drawer__errors',
    attrs: { 'data-testid': 'error-log', id: 'error-log' },
  });
  errSection.appendChild(sectionTitle('Error log'));
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
  errSection.appendChild(errHead);

  const entries = getErrorLog();
  if (!entries.length) {
    errSection.appendChild(
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
    errSection.appendChild(list);
  }
  panel.appendChild(errSection);

  root.appendChild(panel);

  // Scroll to Error log when opened via the red hamburger.
  if (state.openErrorLog) {
    queueMicrotask(() => {
      errSection.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  return root;
}

function sectionTitle(text: string): HTMLElement {
  return el('h3', { className: 'menu-drawer__section', text });
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
      text: 'House → rod A → tie → occupy → (yaw) → leapfrog → rods moved → adjust. Full phone list: docs/stage-2-field-checklist.md',
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
    setState({ showStage2Checklist: true, menuOpen: false });
    return;
  }
  setState({
    doc: result.doc,
    view: 'survey',
    refuseMessage: null,
    showStage2Checklist: result.showChecklist,
    menuOpen: false,
  });
  const coach = buildCoach(result.doc);
  speakCoachLine(coach.body[0] ?? '', result.doc.session.speakSteps);
}

function buildStepPanel(doc: GardenDocument): HTMLElement | null {
  const mode = doc.session.mode;

  if (mode === 'START') {
    // START: demos and checklist live in the hamburger — no button wall on the plan.
    return null;
  }

  if (mode === 'BASELINE' || mode === 'HOUSE_BASELINE') {
    const panel = el('section', { className: 'step-panel' });
    panel.appendChild(el('h2', { text: 'Establish baseline (house edge)' }));
    panel.appendChild(
      el('p', {
        text: baselineReady(doc)
          ? `Baseline set (${currentBaseline(doc)?.a}–${currentBaseline(doc)?.b}). Take baseline tie next.`
          : 'Default: one house edge. Enter length in metres and optional mark offsets (mm) if the roll is not the true corner.',
      }),
    );
    const form = el('div', { className: 'step-form' });
    form.appendChild(numField('Length (m)', 'length', '7'));
    form.appendChild(numField('Offset A (mm)', 'offset-a', '0'));
    form.appendChild(numField('Offset B (mm)', 'offset-b', '0'));
    panel.appendChild(form);
    panel.appendChild(
      el('button', {
        className: 'btn btn--util btn--stage2',
        text: 'Save baseline',
        attrs: { type: 'button', 'data-cmd': 'save-baseline' },
      }),
    );
    return panel;
  }

  if (mode === 'PHOTO_TIE_BASELINE' || mode === 'PHOTO_TIE_HOUSE_ROD') {
    const panel = el('section', { className: 'step-panel' });
    panel.appendChild(el('h2', { text: 'Baseline photo tie' }));
    panel.appendChild(
      el('p', {
        text: baselineTieReady(doc)
          ? 'Both baseline ends + target mark present. Occupy or measure more house edges.'
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

  if (mode === 'HOUSE_EDGES' || mode === 'PLACE_ROD_A') {
    const panel = el('section', { className: 'step-panel' });
    const n = houseCornerCount(doc);
    const closed = housePolygon(doc)?.closed;
    panel.appendChild(el('h2', { text: 'Grow house corners' }));
    panel.appendChild(
      el('p', {
        text: closed
          ? `House closed with ${n} corners.`
          : `${n} corner(s) so far (~10 typical). Add the next edge length if you taped it, plus offset mm.`,
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

  if (mode === 'LEAPFROG') {
    const panel = el('section', { className: 'step-panel' });
    const setup = currentSetup(doc);
    panel.appendChild(el('h2', { text: 'Leapfrog A + B' }));
    panel.appendChild(
      el('p', {
        text: setup?.abPhotographedTogether
          ? 'A and B are in a shared photo. Rods moved is now legal.'
          : 'Photograph A and B together before you pick A up. Confirm below — otherwise Rods moved is refused.',
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

  if (mode === 'OCCUPY' || mode === 'ADJUST') {
    const panel = el('section', { className: 'step-panel step-panel--hint' });
    panel.appendChild(
      el('p', {
        text:
          mode === 'OCCUPY'
            ? 'Field: keep occupying points, or Start leapfrog when you need rod B. Press Adjust when you want millimetre residuals on the plan.'
            : 'Read the coach residuals in mm. Good enough (<~15 mm) → keep surveying. Over ~50 mm → remeasure. Print tags anytime.',
      }),
    );
    if (mode === 'ADJUST') {
      panel.appendChild(
        el('button', {
          className: 'btn btn--util btn--demo',
          text: 'Print tags (A4 belts + FNC01–04)',
          attrs: { type: 'button', 'data-cmd': 'print-tags' },
        }),
      );
    }
    return panel;
  }

  return null;
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
    setState({ menuOpen: false });
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
    setState({ menuOpen: false });
    return;
  }

  const { doc: next, result } = applyTransition(doc, action);
  if (!result.ok) {
    surfaceFail(result.reason ?? 'Illegal transition.', 'mode');
    speakCoachLine(result.reason ?? '', doc.session.speakSteps);
    return;
  }
  setDoc(next, null);
  setState({ menuOpen: false });
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
