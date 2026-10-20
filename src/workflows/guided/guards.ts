/**
 * Named predicates for the Circle field test Petri net (field-test.net.yaml rev 3).
 */

import type { GardenDocument } from '../../model';
import {
  CAMERA_POSITION_LEGACY,
  canonicalStepId,
  defaultFieldTestSetup,
  type FieldTestSetupValues,
  migrateFieldTestSetup,
  SETUP_DEPENDS_ON,
  SETUP_STEP_ID,
} from './fieldTestMeta';
import type {
  StepState,
  StepStatus,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowRun,
  WorkflowRunSetup,
  WorkflowStep,
} from './types';

export const SETTLED: StepStatus[] = [
  'ticked_by_you',
  'ticked_by_app',
  'ticked_with_reason',
  'skipped_with_note',
];

export const COUNTS_AS_WARNING: StepStatus[] = ['ticked_with_reason', 'skipped_with_note'];
export const COUNTS_AS_ERROR: StepStatus[] = ['evidence_failed'];
export const COUNTS_AS_OPEN_EXTRA: StepStatus[] = ['needs_recheck'];

export function isUserStep(step: WorkflowStep): boolean {
  return step.kind === 'user' || step.kind === 'user+app';
}

export function needsAppEvidence(step: WorkflowStep): boolean {
  return step.kind === 'app' || step.kind === 'user+app';
}

export function isCurrentStep(stepId: string, run: WorkflowRun): boolean {
  return canonicalStepId(run.currentStepId) === canonicalStepId(stepId);
}

export function stepIndex(def: WorkflowDefinition, run: WorkflowRun): number {
  const id = canonicalStepId(run.currentStepId);
  if (id === SETUP_STEP_ID) return -1;
  const index = def.steps.findIndex((step) => step.id === id);
  return index < 0 ? 0 : index;
}

export function isLastStep(def: WorkflowDefinition, run: WorkflowRun): boolean {
  if (canonicalStepId(run.currentStepId) === SETUP_STEP_ID) return false;
  return stepIndex(def, run) >= def.steps.length - 1;
}

export function normalizeStatus(status: StepStatus): StepStatus {
  if (status === 'pending') return 'open';
  if (status === 'complete') return 'ticked_by_you';
  return status;
}

export function isSettled(state: StepState | undefined): boolean {
  if (!state) return false;
  const status = normalizeStatus(state.status);
  return SETTLED.includes(status);
}

export function isWaiting(state: StepState | undefined): boolean {
  if (!state) return false;
  const status = normalizeStatus(state.status);
  return status === 'waiting_for_app' || status === 'evidence_failed';
}

export function hasReason(note: string | undefined): boolean {
  return (note ?? '').trim().length >= 3;
}

export function hasNote(note: string | undefined): boolean {
  return hasReason(note);
}

export function isSkippable(step: WorkflowStep): boolean {
  return step.id !== 'save-to-onedrive';
}

export function setupValid(values: FieldTestSetupValues): boolean {
  if (!(values.circle_diameter_m > 0) || !(values.baseline_length_m >= values.circle_diameter_m / 2 - 1e-9)) return false;
  if (!Number.isInteger(values.edge_points) || values.edge_points < 8) return false;
  if (!Number.isInteger(values.camera_position_count) || values.camera_position_count < 3 || values.camera_position_count > 4) return false;
  // The solver places a camera from two tapes to BAS01/BAS02: at least two positions are taped.
  const positions = Object.values(values.camera_positions);
  if (positions.some((p) => p.to_bas01 < 0 || p.to_bas02 < 0)) return false;
  if (positions.filter((p) => p.to_bas01 > 0 && p.to_bas02 > 0).length < 2) return false;
  const tol = Object.values(values.tolerances_mm);
  return tol.every((v) => v > 0);
}

export function setupConfirmed(run: WorkflowRun): boolean {
  return run.setup?.status !== 'unconfirmed';
}

function dotGet(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function changedKeys(oldValues: FieldTestSetupValues, nextValues: FieldTestSetupValues): string[] {
  const keys = new Set<string>([
    'baseline_length_m',
    'circle_diameter_m',
    'edge_points',
    'camera_position_count',
    'calibration_distance_m',
    'camera_positions.position_1',
    'camera_positions.position_2',
    'camera_positions.position_3',
    'camera_positions.position_4',
    'tolerances_mm.baseline',
    'tolerances_mm.railway',
    'tolerances_mm.flower_bed',
    'tolerances_mm.tree',
    'tolerances_mm.camera_position',
    'tolerances_mm.circle_diameter_baseline',
    'tolerances_mm.circle_diameter_plantable',
  ]);
  const changed: string[] = [];
  for (const key of keys) {
    const a = dotGet(oldValues, key);
    const b = dotGet(nextValues, key);
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(key);
  }
  return changed;
}

export function dependsOnChanged(stepId: string, keys: string[]): boolean {
  const id = canonicalStepId(stepId);
  return keys.some((key) => (SETUP_DEPENDS_ON[key] ?? []).includes(id));
}

export function hasUnsettledSteps(def: WorkflowDefinition, run: WorkflowRun): boolean {
  return def.steps.some((step) => !isSettled(run.steps[step.id]));
}

export function noUnsettledSteps(def: WorkflowDefinition, run: WorkflowRun): boolean {
  return !hasUnsettledSteps(def, run);
}

export function nameMatchesCameraPosition(value: string, stepId: string): boolean {
  const v = value.trim().toUpperCase();
  if (!v) return false;
  const aliases = CAMERA_POSITION_LEGACY[canonicalStepId(stepId)] ?? [];
  for (const alias of aliases) {
    const a = alias.trim().toUpperCase();
    if (v === a || v.startsWith(`${a} `) || v.startsWith(`${a}-`)) return true;
  }
  return false;
}

export function evidenceMatches(
  step: WorkflowStep,
  event: WorkflowEvent,
  stationIdFromTrigger: string | undefined,
): boolean {
  if (!stationIdFromTrigger) return false;
  if (event.type === 'photo.uploaded') {
    if (event.photoCount < 1) return false;
    return (
      nameMatchesCameraPosition(event.stationId, step.id)
      || nameMatchesCameraPosition(event.pointLabel, step.id)
      || nameMatchesCameraPosition(event.objectName, step.id)
      || nameMatchesCameraPosition(stationIdFromTrigger, step.id)
    );
  }
  if (event.type === 'baseline.saved' && step.id === 'tape-baseline') {
    return event.kind === 'tape'
      && event.endA.toUpperCase() === 'BAS01'
      && event.endB.toUpperCase() === 'BAS02'
      && event.offsetAMm === 0
      && event.offsetBMm === 0;
  }
  if (event.type === 'cloud.saved' && step.id === 'save-to-onedrive') return true;
  return false;
}

export function evidencePassesChecks(step: WorkflowStep, event: WorkflowEvent): boolean {
  if (event.type === 'photo.uploaded') {
    if (event.photoCount < 1) return false;
    const min = step.complete && 'on' in step.complete && step.complete.on === 'photo.uploaded'
      ? step.complete.minPhotos
      : 1;
    return event.photoCount >= min;
  }
  if (event.type === 'baseline.saved') return true;
  if (event.type === 'cloud.saved') return true;
  return false;
}

export function photoEventFailed(event: WorkflowEvent): boolean {
  if (event.type !== 'photo.uploaded') return false;
  return event.photoCount < 1;
}

export interface WorkflowCounts {
  ticked: number;
  warnings: number;
  errors: number;
  open: number;
  recheck: number;
  total: number;
}

export function counts(def: WorkflowDefinition, run: WorkflowRun): WorkflowCounts {
  const total = def.steps.length;
  let ticked = 0;
  let warnings = 0;
  let errors = 0;
  let open = 0;
  let recheck = 0;
  for (const step of def.steps) {
    const state = run.steps[step.id];
    const status = normalizeStatus(state?.status ?? 'open');
    if (status === 'ticked_by_you' || status === 'ticked_by_app' || status === 'ticked_with_reason') ticked += 1;
    if (COUNTS_AS_WARNING.includes(status)) warnings += 1;
    if (COUNTS_AS_ERROR.includes(status)) errors += 1;
    if (status === 'open' || status === 'waiting_for_app') open += 1;
    if (status === 'needs_recheck') recheck += 1;
  }
  return { ticked, warnings, errors, open, recheck, total };
}

export type CountJumpKind = 'error' | 'warning' | 'open' | 'recheck';

export function nextIndexForCount(
  def: WorkflowDefinition,
  run: WorkflowRun,
  kind: CountJumpKind,
  afterStepId?: string,
): string | undefined {
  const order = [SETUP_STEP_ID, ...def.steps.map((s) => s.id)];
  const start = afterStepId ? order.indexOf(canonicalStepId(afterStepId)) + 1 : 0;
  const scan = start < 0 ? 0 : start;
  for (let i = scan; i < order.length; i += 1) {
    const id = order[i]!;
    if (id === SETUP_STEP_ID) {
      if (kind === 'recheck' && run.setup?.status === 'changed_mid_run') return SETUP_STEP_ID;
      if (kind === 'open' && run.setup?.status === 'unconfirmed') return SETUP_STEP_ID;
      continue;
    }
    const step = def.steps.find((s) => s.id === id);
    if (!step) continue;
    const status = normalizeStatus(run.steps[id]?.status ?? 'open');
    if (kind === 'error' && status === 'evidence_failed') return id;
    if (kind === 'warning' && COUNTS_AS_WARNING.includes(status)) return id;
    if (kind === 'open' && (status === 'open' || status === 'waiting_for_app')) return id;
    if (kind === 'recheck' && status === 'needs_recheck') return id;
  }
  for (let i = 0; i < scan; i += 1) {
    const id = order[i]!;
    if (id === SETUP_STEP_ID) continue;
    const status = normalizeStatus(run.steps[id]?.status ?? 'open');
    if (kind === 'error' && status === 'evidence_failed') return id;
    if (kind === 'warning' && COUNTS_AS_WARNING.includes(status)) return id;
    if (kind === 'open' && (status === 'open' || status === 'waiting_for_app')) return id;
    if (kind === 'recheck' && status === 'needs_recheck') return id;
  }
  return undefined;
}

export function firstUnsettledStepId(def: WorkflowDefinition, run: WorkflowRun): string | undefined {
  if (run.setup?.status === 'unconfirmed') return SETUP_STEP_ID;
  for (const step of def.steps) {
    const state = run.steps[step.id];
    const status = normalizeStatus(state?.status ?? 'open');
    if (!isSettled(state) || status === 'needs_recheck' || status === 'evidence_failed') {
      return step.id;
    }
  }
  return undefined;
}

export function ensureRunSetup(run: WorkflowRun): WorkflowRunSetup {
  if (!run.setup) return { status: 'unconfirmed', values: defaultFieldTestSetup() };
  return { ...run.setup, values: migrateFieldTestSetup(run.setup.values) };
}

export function hasStoredEvidence(
  _doc: GardenDocument | undefined,
  _step: WorkflowStep,
  _run: WorkflowRun,
): boolean {
  return false;
}
