/** Main UI: mode banner, coach, legal buttons, plan, print tags, storage. */

import type { GardenDocument } from './model';
import {
  emptyDocument,
  syntheticDocument,
  applyHouseBaseline,
  applyCannedTiePhoto,
  confirmAbTogether,
  houseRectangleClosed,
  tiePhotoReady,
  currentSetup,
  rodAPlaced,
} from './model';
import {
  ALL_ACTIONS,
  actionLabel,
  applyTransition,
  canTransition,
  legalActions,
  type ModeAction,
} from './modes';
import { buildCoach, speakCoachLine } from './coach';
import { runLayerA } from './adjustLayerA';
import { runLayerB } from './adjustLayerB';
import { renderPlanSvg } from './planSvg';
import { renderTagsPrintHtml, triggerPrint } from './tagsPrint';
import {
  saveDocument,
  exportGardenJson,
  importGardenJson,
  loadDocument,
} from './storage';
import { isSignedIn, signIn, signOut, subscribeAuth, type AuthInitResult } from './msalAuth';
import { loadGardenFromOneDrive, saveGardenToOneDrive } from './onedrive';
import {
  getCloudStatus,
  setCloudBusy,
  setCloudMessage,
  setLastSaveIso,
  subscribeCloud,
} from './cloudStatus';
import { buildStamp } from './buildInfo';

export type View = 'survey' | 'tags';

export interface UiState {
  doc: GardenDocument;
  view: View;
  refuseMessage: string | null;
}

type Listener = () => void;

let state: UiState = {
  doc: loadDocument() ?? emptyDocument(),
  view: 'survey',
  refuseMessage: null,
};

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
    const saved = saveDocument(partial.doc);
    if (!saved.ok && !state.refuseMessage) {
      state = {
        ...state,
        refuseMessage: `Working copy updated, but could not save to this browser (${saved.error}). Export garden.json to keep your work.`,
      };
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
  const result = await saveGardenToOneDrive(doc);
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
  render();
}

/**
 * After MSAL init: show real errors, welcome signed-in users, and try OneDrive load
 * when returning from a Microsoft redirect.
 */
export function applyAuthReady(init: AuthInitResult): void {
  if (!init.configured) return;

  if (init.error) {
    setCloudMessage(`Microsoft sign-in problem: ${init.error}`);
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
  const result = await loadGardenFromOneDrive();
  setCloudBusy(false);
  if (!result.ok) {
    // Missing file is normal on first save — still signed in.
    if (result.missing) {
      setCloudMessage(
        `Signed in. No garden.json on OneDrive yet — use Save to OneDrive when ready.`,
      );
      return;
    }
    setCloudMessage(`Signed in, but could not load from OneDrive: ${result.error}`);
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
  if (cmd === 'load-synthetic') {
    loadSynthetic();
    return;
  }
  if (cmd === 'run-milestone') {
    runMilestoneDemo();
    return;
  }
  if (cmd === 'new-garden') {
    setDoc(emptyDocument(), null);
    return;
  }
  if (cmd === 'export') {
    exportGardenJson(state.doc);
    return;
  }
  if (cmd === 'print-tags') {
    setState({ view: 'tags', refuseMessage: null });
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
  if (cmd === 'save-house') {
    const panel = target.closest('.step-panel');
    const back = Number((panel?.querySelector('[data-field=back]') as HTMLInputElement | null)?.value);
    const side = Number((panel?.querySelector('[data-field=side]') as HTMLInputElement | null)?.value);
    const diag = Number((panel?.querySelector('[data-field=diag]') as HTMLInputElement | null)?.value);
    if (![back, side, diag].every((n) => Number.isFinite(n) && n > 0)) {
      setState({ refuseMessage: 'House lengths must be positive numbers in metres.' });
      return;
    }
    const next = applyHouseBaseline(state.doc, back, side, diag);
    setDoc(next, null);
    speakCoachLine(
      'House tapes saved. We will not move on until the house rectangle closes.',
      next.session.speakSteps,
    );
    return;
  }
  if (cmd === 'record-tie') {
    if (!rodAPlaced(state.doc) || !houseRectangleClosed(state.doc)) {
      setState({
        refuseMessage:
          'Cannot record a tie yet — house must close and rod A must be declared first.',
      });
      return;
    }
    const next = applyCannedTiePhoto(state.doc);
    setDoc(next, null);
    speakCoachLine('I see rod A ends and house corners. Good tie.', next.session.speakSteps);
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
    setCloudMessage(result.error ?? 'Sign-in failed.');
  }
}

async function onSignOut(): Promise<void> {
  setCloudBusy(true);
  setCloudMessage('Signing out…');
  const result = await signOut();
  setCloudBusy(false);
  if (!result.ok) setCloudMessage(result.error ?? 'Sign-out failed.');
}

async function onOneDriveSave(): Promise<void> {
  setCloudBusy(true);
  setCloudMessage('Saving garden.json to OneDrive…');
  const result = await saveGardenToOneDrive(state.doc);
  setCloudBusy(false);
  if (result.ok) {
    setLastSaveIso(result.savedAt);
    setCloudMessage(`Saved to OneDrive (${getCloudStatus().pathHint}).`);
  } else {
    setCloudMessage(result.error);
  }
}

async function onOneDriveLoad(): Promise<void> {
  setCloudBusy(true);
  setCloudMessage('Loading garden.json from OneDrive…');
  const result = await loadGardenFromOneDrive();
  setCloudBusy(false);
  if (!result.ok) {
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
  const app = el('div', { className: 'app' });
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

  const wrap = el('div', { className: 'survey-layout' });

  const banner = el('header', { className: 'mode-banner', attrs: { role: 'status' } });
  banner.appendChild(el('div', { className: 'mode-banner__label', text: 'Session mode' }));
  banner.appendChild(el('h1', { className: 'mode-banner__mode', text: coach.banner }));
  banner.appendChild(
    el('p', {
      className: 'mode-banner__build',
      text: buildStamp(),
      attrs: { 'data-testid': 'build-stamp' },
    }),
  );
  wrap.appendChild(banner);

  const coachPanel = el('section', { className: 'coach', attrs: { 'aria-live': 'polite' } });
  coachPanel.appendChild(el('h2', { className: 'coach__title', text: 'Coach' }));
  for (const line of coach.body) {
    coachPanel.appendChild(el('p', { className: 'coach__line', text: line }));
  }
  if (coach.residualLine) {
    coachPanel.appendChild(el('p', { className: 'coach__residual', text: coach.residualLine }));
  }
  if (coach.nextButton) {
    coachPanel.appendChild(
      el('p', { className: 'coach__next', text: `Next: ${coach.nextButton}` }),
    );
  } else if (legal.size === 0) {
    coachPanel.appendChild(
      el('p', {
        className: 'coach__next',
        text: 'Next: use the step panel below (or Load synthetic demo)',
      }),
    );
  }
  wrap.appendChild(coachPanel);
  wrap.appendChild(buildCloudPanel());

  if (state.refuseMessage) {
    wrap.appendChild(
      el('div', {
        className: 'refuse',
        attrs: { role: 'alert' },
        text: state.refuseMessage,
      }),
    );
  }

  const actions = el('div', { className: 'actions' });
  for (const action of ALL_ACTIONS) {
    const isLegal = legal.has(action);
    actions.appendChild(
      el('button', {
        className:
          'btn' +
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
  wrap.appendChild(actions);

  const step = buildStepPanel(doc);
  if (step) wrap.appendChild(step);

  const utils = el('div', { className: 'utils' });
  utils.appendChild(
    el('button', {
      className: 'btn btn--util btn--demo',
      text: 'Load synthetic demo',
      attrs: { type: 'button', 'data-cmd': 'load-synthetic' },
    }),
  );
  utils.appendChild(
    el('button', {
      className: 'btn btn--util btn--demo',
      text: 'Run milestone demo (synthetic → Adjust)',
      attrs: { type: 'button', 'data-cmd': 'run-milestone' },
    }),
  );
  utils.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'New garden',
      attrs: { type: 'button', 'data-cmd': 'new-garden' },
    }),
  );
  utils.appendChild(
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
      const imported = await importGardenJson(f);
      setDoc(imported, null);
    } catch (err) {
      setState({ refuseMessage: err instanceof Error ? err.message : 'Import failed.' });
    }
  });
  fileLabel.appendChild(fileInput);
  utils.appendChild(fileLabel);
  utils.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Print tags',
      attrs: { type: 'button', 'data-cmd': 'print-tags' },
    }),
  );

  const speakLabel = el('label', { className: 'toggle' });
  const speak = el('input', {
    attrs: {
      type: 'checkbox',
      'data-cmd': 'speak-toggle',
    },
  }) as HTMLInputElement;
  speak.checked = doc.session.speakSteps;
  speakLabel.appendChild(speak);
  speakLabel.appendChild(document.createTextNode(' Speak steps'));
  utils.appendChild(speakLabel);
  wrap.appendChild(utils);

  const plan = el('section', { className: 'plan' });
  plan.appendChild(el('h2', { text: 'Plan' }));
  const planHost = el('div', { className: 'plan__svg', attrs: { 'data-testid': 'plan-svg' } });
  planHost.innerHTML = renderPlanSvg(doc);
  plan.appendChild(planHost);

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
    plan.appendChild(thumbs);
  }
  wrap.appendChild(plan);

  return wrap;
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

function buildStepPanel(doc: GardenDocument): HTMLElement | null {
  const mode = doc.session.mode;

  if (mode === 'START') {
    const panel = el('section', { className: 'step-panel' });
    panel.appendChild(el('h2', { text: 'Milestone path' }));
    panel.appendChild(
      el('p', {
        text: 'One click loads synthetic house + rod A + occupy photos and runs Adjust so the SVG plan appears. Or walk it: Load synthetic demo, then Adjust. Print tags anytime.',
      }),
    );
    panel.appendChild(
      el('button', {
        className: 'btn btn--util btn--demo',
        text: 'Run milestone demo (synthetic → Adjust)',
        attrs: { type: 'button', 'data-cmd': 'run-milestone' },
      }),
    );
    return panel;
  }

  if (mode === 'HOUSE_BASELINE') {
    const panel = el('section', { className: 'step-panel' });
    panel.appendChild(el('h2', { text: 'Enter house tapes' }));
    panel.appendChild(
      el('p', {
        text: houseRectangleClosed(doc)
          ? 'House rectangle closes. Rod A ready is now legal.'
          : 'Enter back wall, one side, and the diagonal (metres). Straights are declared with the back and side.',
      }),
    );
    const form = el('div', { className: 'step-form' });
    form.appendChild(numField('Back wall (m)', 'back', '8'));
    form.appendChild(numField('Side (m)', 'side', '6'));
    form.appendChild(numField('Diagonal (m)', 'diag', '10'));
    panel.appendChild(form);
    panel.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Save house lengths',
        attrs: { type: 'button', 'data-cmd': 'save-house' },
      }),
    );
    return panel;
  }

  if (mode === 'PLACE_ROD_A') {
    const panel = el('section', { className: 'step-panel' });
    panel.appendChild(el('h2', { text: 'Rod A' }));
    panel.appendChild(
      el('p', {
        text: rodAPlaced(doc)
          ? 'Rod A is declared at 4.000 m. Belts on both ends — take the tie photo.'
          : 'Rod A is not on the map yet. Use Load synthetic demo, or New garden and start again.',
      }),
    );
    return panel;
  }

  if (mode === 'PHOTO_TIE_HOUSE_ROD') {
    const panel = el('section', { className: 'step-panel' });
    panel.appendChild(el('h2', { text: 'Tie photo marks' }));
    panel.appendChild(
      el('p', {
        text: tiePhotoReady(doc)
          ? 'Four marks present. Occupy is legal.'
          : 'Record two house corners and both ends of rod A. Milestone uses canned demo clicks.',
      }),
    );
    if (!tiePhotoReady(doc)) {
      panel.appendChild(
        el('button', {
          className: 'btn btn--util',
          text: 'Record four marks (demo clicks)',
          attrs: { type: 'button', 'data-cmd': 'record-tie' },
        }),
      );
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
            ? 'Milestone: press Adjust to run Layer A then Layer B and draw the SVG plan. Print tags is always available below.'
            : 'Plan should show house, rod A, and occupies. Open Print tags for A4 rod belts + FNC01–04.',
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
  wrap.appendChild(
    el('input', {
      attrs: {
        type: 'number',
        step: '0.001',
        min: '0',
        value,
        'data-field': field,
      },
    }),
  );
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
  let doc = state.doc;

  const probe = canTransition(doc, action);
  if (!probe.ok) {
    const reason = probe.reason ?? 'Illegal transition.';
    setState({ refuseMessage: reason });
    speakCoachLine(reason, doc.session.speakSteps);
    return;
  }

  if (action === 'adjust') {
    runAdjust(doc);
    return;
  }

  const { doc: next, result } = applyTransition(doc, action);
  if (!result.ok) {
    setState({ refuseMessage: result.reason ?? 'Illegal transition.' });
    speakCoachLine(result.reason ?? '', doc.session.speakSteps);
    return;
  }
  setDoc(next, null);
  const coach = buildCoach(next);
  speakCoachLine(coach.body[0] ?? '', next.session.speakSteps);
}

function runAdjust(doc: GardenDocument): void {
  const gate = applyTransition(doc, 'adjust');
  if (!gate.result.ok) {
    setState({ refuseMessage: gate.result.reason ?? 'Illegal transition.' });
    return;
  }
  doc = gate.doc;
  const a = runLayerA(doc);
  const b = runLayerB({ ...doc, points: a.points }, a.points);
  const observations = [...a.observations, ...b.observations];
  const plain = observations
    .filter((o) => o.note)
    .slice(0, 3)
    .map((o) => o.note!)
    .join(' ');
  doc = {
    ...doc,
    points: b.points,
    photos: b.photos,
    observations,
    session: {
      ...doc.session,
      mode: 'ADJUST',
      lastAction: 'Adjust (Layer A then Layer B)',
      lastResidualMm:
          a.residualMm > 0
            ? a.residualMm
            : // Pose resection residuals can be large in v1; prefer house/rod mm for the coach line.
              Math.min(b.residualMm, 50),
      geometryOk: a.ok && b.ok,
    },
  };
  setDoc(doc, null);
  const coach = buildCoach(doc);
  speakCoachLine(plain || coach.body.join(' '), doc.session.speakSteps);
}

function loadSynthetic(): void {
  const doc = syntheticDocument();
  setDoc(doc, null);
  const coach = buildCoach(doc);
  speakCoachLine(coach.body[0] ?? '', doc.session.speakSteps);
}

/** One-click unstick for the milestone demo path. */
function runMilestoneDemo(): void {
  const doc = syntheticDocument();
  // Seed state then adjust without requiring a second click.
  state = { ...state, doc, view: 'survey', refuseMessage: null };
  runAdjust(doc);
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
