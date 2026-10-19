/**
 * Step roller overlay for the Circle field test (field-test.net.yaml rev 3).
 */

import { SETUP_STEP_ID } from './fieldTestMeta';
import { counts, normalizeStatus } from './guards';
import type { WorkflowDefinition, WorkflowRun, WorkflowStep } from './types';

const ROW_PX = 44;
const WHEEL_ROWS = 5;

export function rollerRowIds(def: WorkflowDefinition): string[] {
  return [SETUP_STEP_ID, ...def.steps.map((step) => step.id)];
}

export function rollerPositionLabel(def: WorkflowDefinition, run: WorkflowRun): string {
  const id = run.currentStepId;
  if (id === SETUP_STEP_ID) return 'Set-up';
  const index = def.steps.findIndex((step) => step.id === id);
  if (index < 0) return '';
  return `Step ${index + 1} of ${def.steps.length}`;
}

export function formatCountsLine(def: WorkflowDefinition, run: WorkflowRun): string {
  const c = counts(def, run);
  const parts: string[] = [];
  parts.push(`${c.ticked} of ${c.total} ticked`);
  if (c.warnings) parts.push(`${c.warnings} warning${c.warnings === 1 ? '' : 's'}`);
  if (c.errors) parts.push(`${c.errors} error${c.errors === 1 ? '' : 's'}`);
  if (c.recheck) parts.push(`${c.recheck} to re-check`);
  if (c.open) parts.push(`${c.open} open`);
  if (run.setup?.status === 'unconfirmed') return 'Set-up not confirmed';
  return parts.join(' · ');
}

export function rowTitle(def: WorkflowDefinition, stepId: string): string {
  if (stepId === SETUP_STEP_ID) return 'Set-up';
  return def.steps.find((step) => step.id === stepId)?.title ?? stepId;
}

export function rowNumber(def: WorkflowDefinition, stepId: string): string {
  if (stepId === SETUP_STEP_ID) return '0';
  const step = def.steps.find((item) => item.id === stepId);
  return step?.n?.toString() ?? '';
}

export function stateIconClass(status: string): string {
  const s = normalizeStatus(status as Parameters<typeof normalizeStatus>[0]);
  switch (s) {
    case 'ticked_by_you':
      return 'ok';
    case 'ticked_by_app':
      return 'app';
    case 'ticked_with_reason':
    case 'skipped_with_note':
    case 'needs_recheck':
      return 'warn';
    case 'evidence_failed':
      return 'err';
    case 'waiting_for_app':
      return 'wait';
    default:
      return 'open';
  }
}

export function stateIconChar(status: string, stepId: string): string {
  if (stepId === SETUP_STEP_ID) return '⚙';
  const s = normalizeStatus(status as Parameters<typeof normalizeStatus>[0]);
  if (s === 'ticked_by_you' || s === 'ticked_by_app') return '✓';
  if (s === 'waiting_for_app') return '⏳';
  if (s === 'evidence_failed') return '×';
  if (s === 'needs_recheck') return '↻';
  if (s === 'ticked_with_reason') return '!';
  if (s === 'skipped_with_note') return '→';
  return '';
}

export function reasonLine(_def: WorkflowDefinition, run: WorkflowRun, step: WorkflowStep): string {
  const state = run.steps[step.id];
  if (!state) return '';
  const status = normalizeStatus(state.status);
  if (status === 'evidence_failed') return state.reason ?? 'Evidence failed. Retake.';
  if (status === 'needs_recheck') return 'A Set-up value changed. Check this step again.';
  if (status === 'ticked_with_reason') return state.reason ?? '';
  if (status === 'skipped_with_note') return state.note ?? '';
  return '';
}

export function wheelHeightPx(run: WorkflowRun): number {
  return run.currentStepId === SETUP_STEP_ID ? ROW_PX * 2 : ROW_PX * WHEEL_ROWS;
}

export interface RollerWheelHandle {
  /** True while a finger (or mouse) is on the wheel. A re-render must not move it then. */
  touching(): boolean;
}

/**
 * Wire the wheel. Settle only commits a step after a real user gesture, and never from a
 * list that has left the document: a re-render mid-scroll used to fire the old list's
 * 120 ms timer on a detached node, where every row measures 0, so it picked row 0 (Set-up).
 */
export function attachRollerWheel(
  wheel: HTMLElement,
  rowIds: string[],
  currentId: string,
  onSettle: (stepId: string) => void,
): RollerWheelHandle {
  const list = wheel.querySelector<HTMLElement>('[data-roller-list]');
  let touching = false;
  const handle: RollerWheelHandle = { touching: () => touching };
  if (!list) return handle;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let raf = 0;
  let userMoved = false;
  let settleTimer: number | undefined;
  const update = () => {
    raf = 0;
    if (!list.isConnected) return;
    const center = list.clientHeight / 2;
    const rows = [...list.querySelectorAll<HTMLElement>('.roller-row')];
    rows.forEach((row) => {
      const mid = row.offsetTop + row.offsetHeight / 2 - list.scrollTop;
      const d = (mid - center) / ROW_PX;
      const scale = reduced ? 1 : 1 - Math.min(0.12, Math.abs(d) * 0.04);
      const opacity = reduced ? 1 : 1 - Math.min(0.65, Math.abs(d) * 0.35);
      const rotate = reduced ? 0 : -d * 20;
      row.style.transform = `rotateX(${rotate}deg) scale(${scale})`;
      row.style.opacity = `${opacity}`;
    });
  };
  const settle = () => {
    window.clearTimeout(settleTimer);
    settleTimer = undefined;
    if (!list.isConnected || list.clientHeight === 0) return;
    if (!userMoved || touching) return;
    const best = rollerRowAtCenter(list, rowIds);
    userMoved = false;
    if (best && best !== currentId) onSettle(best);
    update();
  };
  const start = () => {
    touching = true;
    userMoved = true;
  };
  const end = () => {
    touching = false;
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(settle, 120);
  };
  list.addEventListener('touchstart', start, { passive: true });
  list.addEventListener('touchend', end, { passive: true });
  list.addEventListener('touchcancel', end, { passive: true });
  list.addEventListener('pointerdown', start, { passive: true });
  list.addEventListener('pointerup', end, { passive: true });
  list.addEventListener('wheel', () => { userMoved = true; }, { passive: true });
  list.addEventListener('scroll', () => {
    if (!raf) raf = window.requestAnimationFrame(update);
    if (!userMoved || touching) return;
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(settle, 120);
  }, { passive: true });
  list.addEventListener('scrollend', settle);
  update();
  return handle;
}

/** The row whose centre is nearest the list centre, or undefined when the list is not laid out. */
export function rollerRowAtCenter(list: HTMLElement, rowIds: string[]): string | undefined {
  if (list.clientHeight === 0) return undefined;
  const center = list.scrollTop + list.clientHeight / 2;
  let best: string | undefined;
  let bestDist = Infinity;
  for (const row of list.querySelectorAll<HTMLElement>('.roller-row')) {
    const id = row.dataset.stepId ?? '';
    if (!rowIds.includes(id)) continue;
    const mid = row.offsetTop + row.offsetHeight / 2;
    const dist = Math.abs(mid - center);
    if (dist < bestDist) {
      bestDist = dist;
      best = id;
    }
  }
  return best;
}
