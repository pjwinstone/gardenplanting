/**
 * Guided-workflow progress. Pure apart from the local mirror write.
 * The garden document is updated by the caller through the existing save path.
 */

import { getGardenCloudFileName, onedrivePathFor } from '../../cloudConfig';
import type { GardenDocument, Photo } from '../../model';
import { workflowById } from './definitions';
import type {
  StepState,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowId,
  WorkflowLink,
  WorkflowPastRun,
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

function stationNamed(
  event: { stationId: string; pointLabel: string; objectName: string },
  stationId: string,
): boolean {
  return nameMatchesStation(event.stationId, stationId)
    || nameMatchesStation(event.pointLabel, stationId)
    || nameMatchesStation(event.objectName, stationId);
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
    if (trigger.endA && trigger.endB && !endsMatch(event, trigger.endA, trigger.endB)) return false;
    if (trigger.offsetAMm !== undefined && event.offsetAMm !== trigger.offsetAMm) return false;
    if (trigger.offsetBMm !== undefined && event.offsetBMm !== trigger.offsetBMm) return false;
    return true;
  }
  if (trigger.on === 'photo.uploaded' && event.type === 'photo.uploaded') {
    if (event.photoCount < trigger.minPhotos) return false;
    return stationNamed(event, trigger.stationId);
  }
  if (trigger.on === 'markers.detected' && event.type === 'markers.detected') {
    if (event.markerIds.length < trigger.minPhotos) return false;
    return stationNamed(event, trigger.stationId);
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
  if (trigger.on === 'traverse.phase' && event.type === 'traverse.phase') return event.phase === trigger.phase;
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
    startedAt: run.startedAt || run.updatedAt,
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
    startedAt: now,
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
    pastRuns: readPastRuns(raw.pastRuns),
  };
}

/** Finished runs kept on the garden. Older than this are dropped; the newest stays last. */
export const PAST_RUN_LIMIT = 20;

function capPastRuns(list: WorkflowPastRun[]): WorkflowPastRun[] | undefined {
  if (!list.length) return undefined;
  return list.length > PAST_RUN_LIMIT ? list.slice(-PAST_RUN_LIMIT) : list;
}

function readPastRuns(raw: unknown): WorkflowPastRun[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list: WorkflowPastRun[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as WorkflowPastRun;
    if (!isWorkflowId(row.workflowId) || typeof row.startedAt !== 'string') continue;
    const notes = Array.isArray(row.notes)
      ? row.notes.flatMap((note) => {
        if (!note || typeof note.stepId !== 'string' || typeof note.note !== 'string') return [];
        const text = note.note.trim();
        return text ? [{ stepId: note.stepId, note: text }] : [];
      })
      : [];
    list.push({
      workflowId: row.workflowId,
      startedAt: row.startedAt,
      finishedAt: typeof row.finishedAt === 'string' ? row.finishedAt : undefined,
      archivedAt: typeof row.archivedAt === 'string' ? row.archivedAt : row.startedAt,
      notes,
    });
  }
  return capPastRuns(list);
}

function progressJson(progress: WorkflowProgress): string {
  return JSON.stringify(progress);
}

interface WorkflowMirrorRecord {
  gardenCreatedAt: string;
  /** OneDrive path of the garden file, for example `Garden Survey/garden-v1.json`. */
  gardenFile: string;
  progress: WorkflowProgress;
}

export function gardenFileKey(): string {
  try {
    return onedrivePathFor(getGardenCloudFileName());
  } catch {
    return '';
  }
}

export function writeWorkflowMirror(progress: WorkflowProgress, gardenCreatedAt = '', gardenFile = gardenFileKey()): void {
  try {
    const record: WorkflowMirrorRecord = { gardenCreatedAt, gardenFile, progress };
    localStorage.setItem(WORKFLOW_MIRROR_KEY, JSON.stringify(record));
  } catch {
    /* private mode, or no localStorage in this runtime */
  }
}

export function readWorkflowMirror(gardenCreatedAt?: string, gardenFile?: string): WorkflowProgress | null {
  try {
    const raw = localStorage.getItem(WORKFLOW_MIRROR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkflowMirrorRecord> & WorkflowProgress;
    const progress = parsed.progress?.version === 1 ? parsed.progress : parsed.version === 1 ? parsed : undefined;
    if (!progress) return null;
    if (gardenCreatedAt !== undefined) {
      if (!parsed.progress || parsed.gardenCreatedAt !== gardenCreatedAt) return null;
      if (gardenFile !== undefined && parsed.gardenFile !== gardenFile) return null;
    }
    return readProgress({ workflowProgress: progress });
  } catch {
    return null;
  }
}

/**
 * Use the mirror only when this garden has no workflow field and the mirror
 * was written for the same createdAt. A field that is already on the document
 * wins, including a newer OneDrive copy.
 */
export function hydrateWorkflowProgress(doc: GardenDocument): GardenDocument {
  if (doc.workflowProgress) return doc;
  const mirrored = readWorkflowMirror(doc.createdAt, gardenFileKey());
  if (!mirrored) return doc;
  if (!mirrored.activeId && Object.keys(mirrored.runs).length === 0 && !(mirrored.pastRuns?.length)) return doc;
  return { ...doc, workflowProgress: mirrored };
}

export function commitWorkflow(doc: GardenDocument, progress: WorkflowProgress): GardenDocument {
  writeWorkflowMirror(progress, doc.createdAt);
  const empty = !progress.activeId && Object.keys(progress.runs).length === 0 && !(progress.pastRuns?.length);
  if (empty) {
    if (!doc.workflowProgress) return doc;
    const next = { ...doc };
    delete next.workflowProgress;
    return next;
  }
  if (progressJson(readProgress(doc)) === progressJson(progress)) return doc;
  return { ...doc, workflowProgress: progress };
}

/** A workflow module can fold document entities after the tick. Set once, from that module. */
let workflowEventHook: ((doc: GardenDocument, event: WorkflowEvent, now: string) => GardenDocument) | null = null;

export function setWorkflowEventHook(
  hook: (doc: GardenDocument, event: WorkflowEvent, now: string) => GardenDocument,
): void {
  workflowEventHook = hook;
}

export function withWorkflowEvent(doc: GardenDocument, event: WorkflowEvent, now = new Date().toISOString()): GardenDocument {
  const progress = readProgress(doc);
  const next = applyWorkflowEvent(progress, event, now);
  const committed = progressJson(progress) === progressJson(next) ? doc : commitWorkflow(doc, next);
  return workflowEventHook ? workflowEventHook(committed, event, now) : committed;
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

function triggerStation(trigger: WorkflowTrigger): string | undefined {
  if ('all' in trigger) {
    for (const child of trigger.all) {
      const station = triggerStation(child);
      if (station) return station;
    }
    return undefined;
  }
  if (trigger.on === 'photo.uploaded' || trigger.on === 'markers.detected') return trigger.stationId;
  return undefined;
}

function eventPhotoIds(event: WorkflowEvent): string[] | undefined {
  if (event.type === 'photo.uploaded' || event.type === 'markers.detected') return event.photoIds;
  return undefined;
}

/** Apply one event to a run. Tests use this with a one-step definition. */
export function reduceRun(def: WorkflowDefinition, run: WorkflowRun, event: WorkflowEvent, now = new Date().toISOString()): WorkflowRun {
  const steps = { ...run.steps };
  let changed = false;
  for (const step of def.steps) {
    // An early autosave must not tick "Save and send" before the surveyor is on it.
    if (event.type === 'cloud.saved' && step.id !== run.currentStepId) continue;
    const state = steps[step.id] ?? pending();
    let reduced = reduceStep(step, state, event, now);
    const ids = eventPhotoIds(event);
    const station = triggerStation(step.complete);
    if (ids && station && (event.type === 'photo.uploaded' || event.type === 'markers.detected') && nameMatchesStation(event.stationId, station)) {
      const nextIds = ids.length ? [...ids] : undefined;
      const prev = (reduced.consumedPhotoIds ?? []).join('|');
      const next = (nextIds ?? []).join('|');
      if (prev !== next) reduced = { ...reduced, consumedPhotoIds: nextIds };
    }
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

function archivedRun(run: WorkflowRun, now: string): WorkflowPastRun {
  const notes = Object.entries(run.steps).flatMap(([stepId, state]) => {
    const note = state.note?.trim();
    return note ? [{ stepId, note }] : [];
  });
  return {
    workflowId: run.workflowId,
    startedAt: run.startedAt || run.updatedAt,
    finishedAt: run.finishedAt,
    archivedAt: now,
    notes,
  };
}

export function restartWorkflow(progress: WorkflowProgress, id: string, now = new Date().toISOString()): WorkflowMove {
  const ready = readyDef(id);
  if ('error' in ready) return { progress, notice: ready.error, changed: false };
  const existing = progress.runs[ready.def.id];
  if (!existing?.finishedAt) return { progress, notice: `${ready.def.title} is not finished.`, changed: false };
  const run = freshRun(ready.def, now);
  const next: WorkflowProgress = {
    version: 1,
    activeId: ready.def.id,
    runs: { ...progress.runs, [ready.def.id]: run },
    pastRuns: capPastRuns([...(progress.pastRuns ?? []), archivedRun(existing, now)]),
  };
  return { progress: next, link: ready.def.steps[0]?.link, changed: true };
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

export function stepIsManualOnly(step: WorkflowStep): boolean {
  return 'on' in step.complete && step.complete.on === 'manual';
}

function tickManualCurrent(progress: WorkflowProgress, now: string): WorkflowProgress {
  const pair = activePair(progress);
  if (!pair || pair.run.finishedAt) return progress;
  const step = pair.def.steps.find((item) => item.id === pair.run.currentStepId);
  if (!step || !stepIsManualOnly(step)) return progress;
  if (pair.run.steps[step.id]?.status === 'complete') return progress;
  return tickWorkflow(progress, step.id, pair.run.steps[step.id]?.note, now).progress;
}

export function advanceWorkflow(progress: WorkflowProgress, now = new Date().toISOString()): WorkflowMove {
  const initial = activePair(progress);
  if (!initial) return { progress, notice: 'Start a workflow first.', changed: false };
  if (initial.run.finishedAt) return { progress, notice: `${initial.def.title} is already finished.`, changed: false };
  const ticked = tickManualCurrent(progress, now);
  const pair = activePair(ticked) ?? initial;
  const index = pair.def.steps.findIndex((step) => step.id === pair.run.currentStepId);
  const at = index < 0 ? 0 : index;
  if (at >= pair.def.steps.length - 1) return doneWorkflow(ticked, now);
  const nextStep = pair.def.steps[at + 1];
  const run: WorkflowRun = { ...pair.run, currentStepId: nextStep.id, updatedAt: now };
  return {
    progress: { ...ticked, runs: { ...ticked.runs, [pair.def.id]: run } },
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
  const index = pair.def.steps.findIndex((step) => step.id === pair.run.currentStepId);
  const step = pair.def.steps[index < 0 ? 0 : index];
  const open = openSteps(pair.def, pair.run);
  const last = index >= pair.def.steps.length - 1;
  const onlyThis = !!step && open.length === 1 && open[0].id === step.id;
  const ticked = step && stepIsManualOnly(step) && (last || onlyThis)
    ? tickManualCurrent(progress, now)
    : progress;
  const nextPair = activePair(ticked) ?? pair;
  if (openSteps(nextPair.def, nextPair.run).length > 0) {
    return {
      progress: ticked,
      notice: openStepNotice(nextPair.def, nextPair.run),
      changed: progressJson(progress) !== progressJson(ticked),
    };
  }
  const run: WorkflowRun = { ...nextPair.run, finishedAt: now, updatedAt: now };
  return {
    progress: { ...ticked, runs: { ...ticked.runs, [nextPair.def.id]: run } },
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

function photoTimeMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Photos that can tick a station step in this run.
 * Verified means the OneDrive upload checked out. There is no marker detector.
 * A photo counts only when it was captured and received at or after the run
 * started, and no other step in the run has already consumed its id.
 * A missing capture or receive time does not count.
 */
export function countUploadedPhotosForStep(
  doc: GardenDocument,
  stationId: string,
  run: WorkflowRun,
  stepId: string,
): { count: number; photoIds: string[] } {
  const start = photoTimeMs(run.startedAt);
  if (start === undefined) return { count: 0, photoIds: [] };
  const taken = new Set<string>();
  for (const [id, state] of Object.entries(run.steps)) {
    if (id === stepId) continue;
    for (const photoId of state.consumedPhotoIds ?? []) taken.add(photoId);
  }
  const photoIds = doc.photos.filter((photo) => {
    if (taken.has(photo.id)) return false;
    if (!photoOnStation(doc, photo, stationId)) return false;
    if (photo.originalFile?.uploadStatus !== 'verified') return false;
    if ((photo.originalFile.usabilityNote ?? '').includes('Not usable')) return false;
    const captured = photoTimeMs(photo.originalFile?.capturedAt) ?? photoTimeMs(photo.exifDateTimeOriginal);
    const received = photoTimeMs(photo.originalFile?.receivedAt);
    if (captured === undefined || received === undefined) return false;
    return captured >= start && received >= start;
  }).map((photo) => photo.id);
  return { count: photoIds.length, photoIds };
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
    if (trigger.on === 'photo.uploaded' && photoOnStation(doc, photo, trigger.stationId)) {
      found.add(trigger.stationId);
    }
  };
  for (const step of def.steps) walk(step.complete);
  return [...found];
}

/** Fold an uploaded, usable still into the active workflow. Same doc if nothing changes. */
export function workflowAfterUploadedPhoto(doc: GardenDocument, photoId: string, now = new Date().toISOString()): GardenDocument {
  const photo = doc.photos.find((item) => item.id === photoId);
  if (!photo || photo.originalFile?.uploadStatus !== 'verified') return doc;
  if ((photo.originalFile.usabilityNote ?? '').includes('Not usable')) return doc;
  const point = doc.points.find((item) => item.id === photo.addPointId)
    ?? doc.points.find((item) => (item.photoIds ?? []).includes(photo.id));
  const object = point ? doc.objects.find((item) => item.id === point.objectId) : undefined;
  let next = doc;
  for (const stationId of stationIdsOnPhoto(next, photo)) {
    const progress = readProgress(next);
    const activeId = progress.activeId;
    const def = activeId ? workflowById(activeId) : undefined;
    const raw = activeId ? progress.runs[activeId] : undefined;
    if (!def || !raw) continue;
    const run = reconcileRun(def, raw);
    const step = def.steps.find((item) => {
      const station = triggerStation(item.complete);
      return !!station && nameMatchesStation(stationId, station);
    });
    if (!step) continue;
    const counted = countUploadedPhotosForStep(next, stationId, run, step.id);
    next = withWorkflowEvent(next, {
      type: 'photo.uploaded',
      stationId,
      pointLabel: point?.label ?? '',
      objectName: object?.name ?? '',
      photoCount: counted.count,
      photoIds: counted.photoIds,
    }, now);
  }
  return next;
}
