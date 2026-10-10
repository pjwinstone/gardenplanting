/**
 * Picker, step bar, sheet, and the thumb Next.
 * Flags live here so a contrast toggle does not dirty the garden.
 */

import type { GardenDocument } from '../../model';
import { GUIDED_WORKFLOWS, workflowById } from './definitions';
import { diagramSvg } from './diagrams';
import {
  advanceWorkflow,
  backWorkflow,
  commitWorkflow,
  doneWorkflow,
  noteWorkflow,
  pausedRun,
  readProgress,
  restartWorkflow,
  resumeWorkflow,
  reviewWorkflow,
  startWorkflow,
  stepIsManualOnly,
  tickWorkflow,
  type WorkflowMove,
} from './engine';
import { placeRect, readSafeInsets, workflowChromeRects } from './layout';
import type { WorkflowDefinition, WorkflowLink, WorkflowProgress, WorkflowRun, WorkflowStep } from './types';

const SUN_KEY = 'garden-survey:workflow-sunlight';

let pickerOpen = false;
let sheetOpen = false;
let notice: string | null = null;
let placedRoot: HTMLElement | null = null;

export interface WorkflowCommandResult {
  doc?: GardenDocument;
  menuOpen?: boolean;
  link?: WorkflowLink;
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

export function installWorkflowChrome(rerender: () => void): void {
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
  if (cmd === 'workflow-collapse') {
    sheetOpen = false;
    return {};
  }

  let move: WorkflowMove | undefined;
  if (cmd === 'workflow-start') move = startWorkflow(progress, workflowId);
  else if (cmd === 'workflow-resume') move = resumeWorkflow(progress, workflowId);
  else if (cmd === 'workflow-review') move = reviewWorkflow(progress, workflowId);
  else if (cmd === 'workflow-start-over') move = restartWorkflow(progress, workflowId || progress.activeId || '');
  else if (cmd === 'workflow-next') move = advanceWorkflow(progress);
  else if (cmd === 'workflow-back') move = backWorkflow(progress);
  else if (cmd === 'workflow-done') move = doneWorkflow(progress);
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
  if (sheetOpen && !run.finishedAt) root.append(renderSheet(def, run));
  else root.append(renderBar(def, run, progress));
  if (!sheetOpen) root.append(renderThumb(def, run, progress));
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
  const close = button('Close', 'workflow-close-picker', { className: 'workflow-btn workflow-primary workflow-picker-close' });
  picker.append(close);
  return picker;
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
