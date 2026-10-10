/**
 * Guided-workflow progress. Pure apart from the local mirror write.
 * The garden document is updated by the caller through the existing save path.
 */

import type { GardenDocument, Photo } from '../../model';
import { workflowById } from './definitions';
import type {
  StepState,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowId,
  WorkflowLink,
  WorkflowProgress,
  WorkflowRun,
  WorkflowStep,
  WorkflowTrigger,
} from './types';

export const WORKFLOW_MIRROR_KEY = 'garden-survey:workflow-progress';

const WORKFLOW_IDS = new Set<WorkflowId>([
  'circle-field-test',
  'print-fit-markers',
  'house-traverse',
  'ios-setup',
]);

export function emptyProgress(): WorkflowProgress {
  return { version: 1, runs: {} };
}

export function isWorkflowId(id: string | undefined): id is WorkflowId {
  return !!id && WORKFLOW_IDS.has(id as WorkflowId);
}

function pending(): StepState {
  return { status: 'pending', completedBy: null };
}

export function nameMatchesStation(value: string, stationId: string): boolean {
  const v = value.trim().toUpperCase();
  const id = stationId.trim().toUpperCase();
  if (!v || !id) return false;
  if (v === id) return true;
  if (v.startsWith(`${id} `) || v.startsWith(`${id}-`)) return true;
  return false;
}

function norm(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function endsMatch(
  event: { endA: string; endB: string; endAId?: string; endBId?: string },
  endA: string,
  endB: string,
): boolean {
  const a = norm(event.endA) === norm(endA) || norm(event.endAId) === norm(endA);
  const b = norm(event.endB) === norm(endB) || norm(event.endBId) === norm(endB);
  return a && b;
}

function eventMatches(trigger: Exclude<WorkflowTrigger, { all: WorkflowTrigger[] }>, event: WorkflowEvent | null): boolean {
  if (!event || event.type === 'manual.tick' || trigger.on === 'manual') return false;
  if (trigger.on !== event.type) return false;
  if (trigger.on === 'baseline.saved' && event.type === 'baseline.saved') {
    if (event.kind !== trigger.kind) return false;
    if (!endsMatch(event, trigger.endA, trigger.endB)) return false;
    if (trigger.offsetAMm !== undefined && event.offsetAMm !== trigger.offsetAMm) return false;
    if (trigger.offsetBMm !== undefined && event.offsetBMm !== trigger.offsetBMm) return false;
    return true;
  }
  if (trigger.on === 'photo.verified' && event.type === 'photo.verified') {
    if (event.photoCount < trigger.minPhotos) return false;
    return nameMatchesStation(event.stationId, trigger.stationId)
      || nameMatchesStation(event.pointLabel, trigger.stationId)
      || nameMatchesStation(event.objectName, trigger.stationId);
  }
  if (trigger.on === 'photo.marksConfirmed' && event.type === 'photo.marksConfirmed') {
    const named = nameMatchesStation(event.stationId, trigger.stationId)
      || nameMatchesStation(event.pointLabel, trigger.stationId)
      || nameMatchesStation(event.objectName, trigger.stationId);
    if (!named) return false;
    const got = new Set(event.marks);
    return trigger.marks.every((mark) => got.has(mark));
  }
  if (trigger.on === 'item.created' && event.type === 'item.created') {
    return norm(event.name) === norm(trigger.name) && event.geometry === trigger.geometry;
  }
  if (trigger.on === 'tape.entered' && event.type === 'tape.entered') {
    if (trigger.endA && !endsMatch(event, trigger.endA, trigger.endB ?? event.endB)) return false;
    if (trigger.endB && norm(event.endB) !== norm(trigger.endB) && norm(event.endBId) !== norm(trigger.endB)) {
      return false;
    }
    return true;
  }
  if (trigger.on === 'cloud.saved' && event.type === 'cloud.saved') return true;
  return false;
}

interface Collect {
  done: boolean;
  seen: Set<string>;
}

function collect(
  trigger: WorkflowTrigger,
  event: WorkflowEvent | null,
  seen: Set<string>,
  note: string | undefined,
  path: string,
  insideAll: boolean,
): Collect {
  if ('all' in trigger) {
    const next = new Set(seen);
    let done = true;
    trigger.all.forEach((child, index) => {
      const part = collect(child, event, next, note, `${path}/${index}`, true);
      for (const id of part.seen) next.add(id);
      if (!part.done) done = false;
    });
    return { done, seen: next };
  }
  const next = new Set(seen);
  if (trigger.on === 'manual') {
    if (!insideAll) return { done: false, seen: next };
    if ((note ?? '').trim() || next.has(path)) {
      next.add(path);
      return { done: true, seen: next };
    }
    return { done: false, seen: next };
  }
  if (next.has(path) || eventMatches(trigger, event)) {
    next.add(path);
    return { done: true, seen: next };
  }
  return { done: false, seen: next };
}

function seenList(seen: Set<string>): string[] | undefined {
  const list = [...seen];
  return list.length ? list : undefined;
}

function sameSeen(a: string[] | undefined, b: Set<string>): boolean {
  const left = [...(a ?? [])].sort().join('|');
  const right = [...b].sort().join('|');
  return left === right;
}

function reduceStep(step: WorkflowStep, state: StepState, event: WorkflowEvent | null, now: string): StepState {
  if (event?.type === 'manual.tick' && event.stepId === step.id && state.status !== 'complete') {
    return {
      status: 'complete',
      completedBy: 'manual',
      completedAt: now,
      note: event.note ?? state.note,
      seen: state.seen,
    };
  }
  const note = state.note;
  const check = collect(step.complete, event, new Set(state.seen ?? []), note, step.id, false);
  if (state.status === 'complete' && state.completedBy === 'auto') return state;
  if (state.status === 'complete' && state.completedBy === 'manual') {
    const manualOnly = 'on' in step.complete && step.complete.on === 'manual';
    if (!check.done || manualOnly) return state;
    return {
      ...state,
      completedBy: 'auto',
      completedAt: now,
      seen: seenList(check.seen),
    };
  }
  if (check.done) {
    return {
      status: 'complete',
      completedBy: 'auto',
      completedAt: now,
      note,
      seen: seenList(check.seen),
    };
  }
  if (sameSeen(state.seen, check.seen)) return state;
  return { ...state, seen: seenList(check.seen) };
}

export function reconcileRun(def: WorkflowDefinition, run: WorkflowRun): WorkflowRun {
  const known = new Set(def.steps.map((step) => step.id));
  const steps: Record<string, StepState> = {};
  const parked = new Set(run.parkedStepIds ?? []);
  for (const id of Object.keys(run.steps)) {
    if (known.has(id)) steps[id] = run.steps[id];
    else parked.add(id);
  }
  for (const step of def.steps) {
    if (!steps[step.id]) steps[step.id] = pending();
  }
  const currentOk = def.steps.some((step) => step.id === run.currentStepId);
  const parkedStepIds = [...parked];
  return {
    ...run,
    workflowId: def.id,
    revision: def.revision,
    currentStepId: currentOk ? run.currentStepId : (def.steps[0]?.id ?? run.currentStepId),
    steps,
    parkedStepIds: parkedStepIds.length ? parkedStepIds : undefined,
  };
}

function freshRun(def: WorkflowDefinition, now: string): WorkflowRun {
  const steps: Record<string, StepState> = {};
  for (const step of def.steps) steps[step.id] = pending();
  return {
    workflowId: def.id,
    revision: def.revision,
    currentStepId: def.steps[0].id,
    updatedAt: now,
    steps,
  };
}

export function readProgress(doc: { workflowProgress?: WorkflowProgress } | undefined): WorkflowProgress {
  const raw = doc?.workflowProgress;
  if (!raw || raw.version !== 1 || !raw.runs || typeof raw.runs !== 'object') return emptyProgress();
  const runs: WorkflowProgress['runs'] = {};
  for (const [id, run] of Object.entries(raw.runs)) {
    if (!isWorkflowId(id) || !run || typeof run !== 'object') continue;
    runs[id] = run;
  }
  return {
    version: 1,
    activeId: isWorkflowId(raw.activeId) ? raw.activeId : undefined,
    runs,
  };
}

function progressJson(progress: WorkflowProgress): string {
  return JSON.stringify(progress);
}

export function writeWorkflowMirror(progress: WorkflowProgress): void {
  try {
    localStorage.setItem(WORKFLOW_MIRROR_KEY, JSON.stringify(progress));
  } catch {
    /* private mode, or no localStorage in this runtime */
  }
}

export function readWorkflowMirror(): WorkflowProgress | null {
  try {
    const raw = localStorage.getItem(WORKFLOW_MIRROR_KEY);
    if (!raw) return null;
    return readProgress({ workflowProgress: JSON.parse(raw) as WorkflowProgress });
  } catch {
    return null;
  }
}

export function commitWorkflow(doc: GardenDocument, progress: WorkflowProgress): GardenDocument {
  writeWorkflowMirror(progress);
  const empty = !progress.activeId && Object.keys(progress.runs).length === 0;
  if (empty) {
    if (!doc.workflowProgress) return doc;
    const next = { ...doc };
    delete next.workflowProgress;
    return next;
  }
  if (progressJson(readProgress(doc)) === progressJson(progress)) return doc;
  return { ...doc, workflowProgress: progress };
}

export function withWorkflowEvent(doc: GardenDocument, event: WorkflowEvent, now = new Date().toISOString()): GardenDocument {
  const progress = readProgress(doc);
  const next = applyWorkflowEvent(progress, event, now);
  if (progressJson(progress) === progressJson(next)) return doc;
  return commitWorkflow(doc, next);
}

export function applyWorkflowEvent(progress: WorkflowProgress, event: WorkflowEvent, now = new Date().toISOString()): WorkflowProgress {
  const activeId = progress.activeId;
  if (!activeId) return progress;
  const def = workflowById(activeId);
  const run = progress.runs[activeId];
  if (!def || def.status !== 'ready' || !run || run.finishedAt) return progress;
  const reconciled = reconcileRun(def, run);
  const nextRun = reduceRun(def, reconciled, event, now);
  if (progressJson({ version: 1, runs: { [activeId]: nextRun } }) === progressJson({ version: 1, runs: { [activeId]: run } })) {
    return progress;
  }
  return {
    ...progress,
    runs: { ...progress.runs, [activeId]: nextRun },
  };
}

/** Apply one event to a run. Tests use this with a one-step definition. */
export function reduceRun(def: WorkflowDefinition, run: WorkflowRun, event: WorkflowEvent, now = new Date().toISOString()): WorkflowRun {
  const steps = { ...run.steps };
  let changed = false;
  for (const step of def.steps) {
    // An early autosave must not tick "Save and send" before the surveyor is on it.
    if (event.type === 'cloud.saved' && step.id !== run.currentStepId) continue;
    const state = steps[step.id] ?? pending();
    const reduced = reduceStep(step, state, event, now);
    if (reduced !== state) {
      steps[step.id] = reduced;
      changed = true;
    }
  }
  if (!changed) return run;
  return { ...run, steps, updatedAt: now };
}

function readyDef(id: string): { def: WorkflowDefinition } | { error: string } {
  const def = workflowById(id);
  if (!def) return { error: 'Unknown workflow.' };
  if (def.status !== 'ready' || def.steps.length === 0) return { error: `${def.title} is coming soon.` };
  return { def };
}

export interface WorkflowMove {
  progress: WorkflowProgress;
  link?: WorkflowLink;
  notice?: string;
  changed: boolean;
}

export function startWorkflow(progress: WorkflowProgress, id: string, now = new Date().toISOString()): WorkflowMove {
  const ready = readyDef(id);
  if ('error' in ready) return { progress, notice: ready.error, changed: false };
  const existing = progress.runs[ready.def.id];
  const run = existing ? reconcileRun(ready.def, existing) : freshRun(ready.def, now);
  const nextRun: WorkflowRun = { ...run, finishedAt: undefined, updatedAt: now };
  const next: WorkflowProgress = {
    version: 1,
    activeId: ready.def.id,
    runs: { ...progress.runs, [ready.def.id]: nextRun },
  };
  return { progress: next, link: ready.def.steps[0]?.link, changed: true };
}

export function resumeWorkflow(progress: WorkflowProgress, id: string, now = new Date().toISOString()): WorkflowMove {
  const ready = readyDef(id);
  if ('error' in ready) return { progress, notice: ready.error, changed: false };
  const existing = progress.runs[ready.def.id];
  if (!existing || existing.finishedAt) return { progress, notice: `${ready.def.title} has nothing to resume.`, changed: false };
  const run = reconcileRun(ready.def, existing);
  const changed = progress.activeId !== ready.def.id || progressJson({ version: 1, runs: { [id]: run } }) !== progressJson({ version: 1, runs: { [id]: existing } });
  const next: WorkflowProgress = {
    ...progress,
    activeId: ready.def.id,
    runs: { ...progress.runs, [ready.def.id]: changed ? { ...run, updatedAt: now } : run },
  };
  return { progress: next, changed };
}

export function reviewWorkflow(progress: WorkflowProgress, id: string): WorkflowMove {
  const ready = readyDef(id);
  if ('error' in ready) return { progress, notice: ready.error, changed: false };
  const existing = progress.runs[ready.def.id];
  if (!existing?.finishedAt) return resumeWorkflow(progress, id);
  if (progress.activeId === ready.def.id) return { progress, changed: false };
  return {
    progress: { ...progress, activeId: ready.def.id },
    changed: true,
  };
}

function activePair(progress: WorkflowProgress): { def: WorkflowDefinition; run: WorkflowRun } | undefined {
  const id = progress.activeId;
  if (!id) return undefined;
  const def = workflowById(id);
  const run = progress.runs[id];
  if (!def || def.status !== 'ready' || !run) return undefined;
  return { def, run: reconcileRun(def, run) };
}

function openSteps(def: WorkflowDefinition, run: WorkflowRun): WorkflowStep[] {
  return def.steps.filter((step) => run.steps[step.id]?.status !== 'complete');
}

export function openStepNotice(def: WorkflowDefinition, run: WorkflowRun): string {
  const open = openSteps(def, run);
  if (open.length === 1) return `${open[0].title} is still open.`;
  return `${open.length} steps are still open.`;
}

export function advanceWorkflow(progress: WorkflowProgress, now = new Date().toISOString()): WorkflowMove {
  const pair = activePair(progress);
  if (!pair) return { progress, notice: 'Start a workflow first.', changed: false };
  if (pair.run.finishedAt) return { progress, notice: `${pair.def.title} is already finished.`, changed: false };
  const index = pair.def.steps.findIndex((step) => step.id === pair.run.currentStepId);
  const at = index < 0 ? 0 : index;
  if (at >= pair.def.steps.length - 1) return doneWorkflow(progress, now);
  const nextStep = pair.def.steps[at + 1];
  const run: WorkflowRun = { ...pair.run, currentStepId: nextStep.id, updatedAt: now };
  return {
    progress: { ...progress, runs: { ...progress.runs, [pair.def.id]: run } },
    link: nextStep.link,
    changed: true,
  };
}

export function backWorkflow(progress: WorkflowProgress, now = new Date().toISOString()): WorkflowMove {
  const pair = activePair(progress);
  if (!pair || pair.run.finishedAt) return { progress, changed: false };
  const index = pair.def.steps.findIndex((step) => step.id === pair.run.currentStepId);
  if (index <= 0) return { progress, changed: false };
  const prev = pair.def.steps[index - 1];
  const run: WorkflowRun = { ...pair.run, currentStepId: prev.id, updatedAt: now };
  return {
    progress: { ...progress, runs: { ...progress.runs, [pair.def.id]: run } },
    changed: true,
  };
}

export function doneWorkflow(progress: WorkflowProgress, now = new Date().toISOString()): WorkflowMove {
  const pair = activePair(progress);
  if (!pair) return { progress, changed: false };
  if (pair.run.finishedAt) {
    if (!progress.activeId) return { progress, changed: false };
    return { progress: { ...progress, activeId: undefined }, changed: true };
  }
  if (openSteps(pair.def, pair.run).length > 0) {
    return { progress, notice: openStepNotice(pair.def, pair.run), changed: false };
  }
  const run: WorkflowRun = { ...pair.run, finishedAt: now, updatedAt: now };
  return {
    progress: { ...progress, runs: { ...progress.runs, [pair.def.id]: run } },
    changed: true,
  };
}

export function tickWorkflow(progress: WorkflowProgress, stepId: string, note?: string, now = new Date().toISOString()): WorkflowMove {
  const next = applyWorkflowEvent(progress, { type: 'manual.tick', stepId, note }, now);
  const changed = progressJson(progress) !== progressJson(next);
  return { progress: next, changed };
}

export function noteWorkflow(progress: WorkflowProgress, stepId: string, note: string, now = new Date().toISOString()): WorkflowMove {
  const pair = activePair(progress);
  if (!pair) return { progress, changed: false };
  const step = pair.def.steps.find((item) => item.id === stepId);
  const state = pair.run.steps[stepId];
  if (!step || !state) return { progress, changed: false };
  const withNote: StepState = { ...state, note };
  const steps = { ...pair.run.steps, [stepId]: withNote };
  let run: WorkflowRun = { ...pair.run, steps };
  const reduced = reduceStep(step, withNote, null, now);
  if (reduced !== withNote) {
    run = { ...run, steps: { ...steps, [stepId]: reduced }, updatedAt: now };
  } else if (note !== state.note) {
    run = { ...run, updatedAt: now };
  } else {
    return { progress, changed: false };
  }
  return {
    progress: { ...progress, runs: { ...progress.runs, [pair.def.id]: run } },
    changed: true,
  };
}

export function pausedRun(progress: WorkflowProgress): { id: WorkflowId; run: WorkflowRun; def: WorkflowDefinition } | undefined {
  for (const def of [workflowById('print-fit-markers'), workflowById('circle-field-test')]) {
    if (!def) continue;
    const run = progress.runs[def.id];
    if (!run || run.finishedAt || progress.activeId === def.id) continue;
    return { id: def.id, run, def };
  }
  for (const [id, run] of Object.entries(progress.runs)) {
    if (!isWorkflowId(id) || !run || run.finishedAt || id === progress.activeId) continue;
    const def = workflowById(id);
    if (!def) continue;
    return { id, run, def };
  }
  return undefined;
}

function photoOnStation(doc: GardenDocument, photo: Photo, stationId: string): boolean {
  const points = doc.points.filter((point) => {
    if (nameMatchesStation(point.id, stationId) || nameMatchesStation(point.label ?? '', stationId)) return true;
    const object = doc.objects.find((item) => item.id === point.objectId);
    return !!object && nameMatchesStation(object.name, stationId);
  });
  const ids = new Set(points.map((point) => point.id));
  if (photo.addPointId && ids.has(photo.addPointId)) return true;
  return points.some((point) => (point.photoIds ?? []).includes(photo.id));
}

export function countVerifiedUsablePhotos(doc: GardenDocument, stationId: string): number {
  return doc.photos.filter((photo) => {
    if (!photoOnStation(doc, photo, stationId)) return false;
    if (photo.originalFile?.uploadStatus !== 'verified') return false;
    if ((photo.originalFile.usabilityNote ?? '').includes('Not usable')) return false;
    return true;
  }).length;
}

function stationIdsOnPhoto(doc: GardenDocument, photo: Photo): string[] {
  const progress = readProgress(doc);
  const def = progress.activeId ? workflowById(progress.activeId) : undefined;
  if (!def) return [];
  const found = new Set<string>();
  const walk = (trigger: WorkflowTrigger) => {
    if ('all' in trigger) {
      trigger.all.forEach(walk);
      return;
    }
    if (trigger.on === 'photo.verified' && photoOnStation(doc, photo, trigger.stationId)) {
      found.add(trigger.stationId);
    }
  };
  for (const step of def.steps) walk(step.complete);
  return [...found];
}

/** Fold a verified, usable still into the active workflow. Same doc if nothing changes. */
export function workflowAfterVerifiedPhoto(doc: GardenDocument, photoId: string, now = new Date().toISOString()): GardenDocument {
  const photo = doc.photos.find((item) => item.id === photoId);
  if (!photo || photo.originalFile?.uploadStatus !== 'verified') return doc;
  if ((photo.originalFile.usabilityNote ?? '').includes('Not usable')) return doc;
  const point = doc.points.find((item) => item.id === photo.addPointId)
    ?? doc.points.find((item) => (item.photoIds ?? []).includes(photo.id));
  const object = point ? doc.objects.find((item) => item.id === point.objectId) : undefined;
  let next = doc;
  for (const stationId of stationIdsOnPhoto(doc, photo)) {
    next = withWorkflowEvent(next, {
      type: 'photo.verified',
      stationId,
      pointLabel: point?.label ?? '',
      objectName: object?.name ?? '',
      photoCount: countVerifiedUsablePhotos(next, stationId),
    }, now);
  }
  return next;
}
