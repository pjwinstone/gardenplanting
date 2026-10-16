import type { GardenDocument } from '../../model';
import { addPhotoMeasurement } from '../../layers';
import { addPointNet } from '../petri/loadNet';
import { enabledTransitions, fireTransition, newPetriRun } from '../petri/engine';
import { clearPetriRun, readPetriRun, writePetriRun } from '../petri/persist';
import type { PetriRunState, PetriTransition } from '../petri/types';
import {
  emptyAddPointContext,
  type AddPointWorkflowContext,
} from './context';
import { computeMeasurementStrength } from './strength';
import { commitAddPointDraft } from './commit';

function ctxFromRun(run: PetriRunState): AddPointWorkflowContext {
  return { ...emptyAddPointContext(), ...(run.context as AddPointWorkflowContext) };
}

let run: PetriRunState = readPetriRun() ?? newPetriRun(addPointNet);
let ctx: AddPointWorkflowContext = ctxFromRun(run);

function persist(): void {
  run = { ...run, context: { ...ctx } };
  writePetriRun(run);
}

export function resetPetriAddPointSession(): void {
  ctx = emptyAddPointContext();
  run = newPetriRun(addPointNet);
  clearPetriRun();
  writePetriRun(run);
}

export function getAddPointPetriRun(): PetriRunState {
  return run;
}

export function getAddPointWorkflowContext(): AddPointWorkflowContext {
  return ctx;
}

export function patchAddPointWorkflowContext(
  partial: Partial<AddPointWorkflowContext>,
): void {
  ctx = { ...ctx, ...partial };
  persist();
}

export function currentUserTransition(): PetriTransition | undefined {
  const users = enabledTransitions(addPointNet, run.marking, ctx, 'user');
  return users[0];
}

function afterTransition(
  doc: GardenDocument,
  transitionId: string,
): { doc: GardenDocument; error?: string } {
  if (transitionId === 'compute_strength') {
    const result = computeMeasurementStrength(doc, ctx);
    ctx = {
      ...ctx,
      strength: result.strength,
      residualMm: result.residualMm,
      toleranceMm: result.toleranceMm,
      strengthDetail: result.detail,
    };
    persist();
    return { doc };
  }
  if (transitionId === 'commit_to_garden') {
    const committed = commitAddPointDraft(doc, ctx);
    ctx = emptyAddPointContext();
    run = newPetriRun(addPointNet);
    writePetriRun(run);
    return { doc: committed.doc };
  }
  if (transitionId === 'redo_red') {
    ctx = {
      ...ctx,
      pendingPhotoId: undefined,
      tapeLengthM: undefined,
      strength: undefined,
      residualMm: undefined,
      acceptedAmber: false,
      amberNote: undefined,
    };
    persist();
  }
  if (transitionId === 'add_more_grey') {
    ctx = {
      ...ctx,
      strength: undefined,
      acceptedAmber: false,
      amberNote: undefined,
    };
    persist();
  }
  return { doc };
}

function syncAppTransitions(doc: GardenDocument): GardenDocument {
  let nextDoc = doc;
  for (;;) {
    const apps = enabledTransitions(addPointNet, run.marking, ctx, 'app');
    if (!apps.length) break;
    const t = apps[0]!;
    const fired = fireTransition(run, addPointNet, t.id, ctx);
    if (fired.error) break;
    run = fired.run;
    persist();
    const hook = afterTransition(nextDoc, t.id);
    nextDoc = hook.doc;
  }
  return nextDoc;
}

export function fireAddPointUserTransition(
  doc: GardenDocument,
  transitionId: string,
): { doc: GardenDocument; run: PetriRunState; error?: string } {
  const fired = fireTransition(run, addPointNet, transitionId, ctx);
  if (fired.error) return { doc, run, error: fired.error };
  run = fired.run;
  persist();
  let nextDoc = afterTransition(doc, transitionId).doc;
  nextDoc = syncAppTransitions(nextDoc);
  return { doc: nextDoc, run };
}

export function attachDraftFromPhoto(
  doc: GardenDocument,
  opts: { thumbnailDataUrl?: string; width?: number; height?: number },
): { doc: GardenDocument; error?: string } {
  const result = addPhotoMeasurement(doc, opts);
  if (result.reason) return { doc: result.doc, error: result.reason };
  ctx = {
    ...ctx,
    draftPointId: result.point.id,
    pendingPhotoId: result.point.photoIds?.[0],
  };
  persist();
  return { doc: result.doc };
}

export function recordTapeMeasurement(lengthM: number): void {
  ctx = { ...ctx, tapeLengthM: lengthM };
  persist();
}

export function acceptAmberWithNote(note: string): void {
  ctx = { ...ctx, acceptedAmber: true, amberNote: note.trim() };
  persist();
}
