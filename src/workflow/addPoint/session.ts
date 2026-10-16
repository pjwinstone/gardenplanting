import type { GardenDocument } from '../../model';
import { addPhotoMeasurement } from '../../layers';
import { tokensAt } from '../petri/engine';
import { addPointNet } from '../petri/loadNet';
import { enabledTransitions, fireTransition, newPetriRun, transitionEnabled } from '../petri/engine';
import { clearPetriRun, readPetriRun, writePetriRun } from '../petri/persist';
import type { PetriRunState, PetriTransition } from '../petri/types';
import {
  emptyAddPointContext,
  type AddPointWorkflowContext,
  type FixOptionId,
} from './context';
import { listFixOptionsForLayer } from './fixOptions';
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

const STRENGTH_USER_IDS = new Set(['accept_amber', 'redo_red', 'add_measurement_grey']);

export function currentUserTransition(doc: GardenDocument): PetriTransition | undefined {
  const env = { doc };
  const users = enabledTransitions(addPointNet, run.marking, ctx, 'user', env);
  if (users.length) return users[0];
  if (tokensAt(run.marking, 'strength') > 0) {
    for (const id of STRENGTH_USER_IDS) {
      const t = addPointNet.transitions.find((x) => x.id === id);
      if (t && transitionEnabled(t, run.marking, ctx, env)) return t;
    }
  }
  return undefined;
}

function afterTransition(
  doc: GardenDocument,
  transitionId: string,
): { doc: GardenDocument; error?: string } {
  if (transitionId === 'list_fix_options' && ctx.layerRule) {
    ctx = { ...ctx, fixOptions: listFixOptionsForLayer(ctx.layerRule) };
    persist();
  }
  if (transitionId === 'adjust') {
    const result = computeMeasurementStrength(doc, ctx);
    ctx = {
      ...ctx,
      strength: result.strength,
      residualMm: result.residualMm,
      toleranceMm: result.toleranceMm,
      strengthDetail: result.detail,
    };
    persist();
  }
  if (transitionId === 'keep_green' || transitionId === 'accept_amber') {
    const committed = commitAddPointDraft(doc, ctx);
    ctx = emptyAddPointContext();
    run = newPetriRun(addPointNet);
    writePetriRun(run);
    return { doc: committed.doc };
  }
  if (transitionId === 'redo_red') {
    ctx = {
      ...ctx,
      strength: undefined,
      residualMm: undefined,
      acceptedAmber: false,
      amberNote: undefined,
    };
    persist();
  }
  if (transitionId === 'add_measurement_grey') {
    ctx = {
      ...ctx,
      strength: undefined,
      acceptedAmber: false,
      amberNote: undefined,
    };
    persist();
  }
  if (transitionId === 'side_choice') {
    ctx = { ...ctx, sideResolved: true };
    persist();
  }
  return { doc };
}

function syncAppTransitions(doc: GardenDocument): GardenDocument {
  const env = { doc };
  let nextDoc = doc;
  for (;;) {
    const apps = enabledTransitions(addPointNet, run.marking, ctx, 'app', env);
    if (!apps.length) break;
    const t = apps[0]!;
    const fired = fireTransition(run, addPointNet, t.id, ctx, env);
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
  const env = { doc };
  const fired = fireTransition(run, addPointNet, transitionId, ctx, env);
  if (fired.error) return { doc, run, error: fired.error };
  run = fired.run;
  persist();
  let nextDoc = afterTransition(doc, transitionId).doc;
  nextDoc = syncAppTransitions(nextDoc);
  return { doc: nextDoc, run };
}

export function selectFixOption(optionId: FixOptionId): void {
  const choice = ctx.fixOptions?.find((o) => o.id === optionId);
  ctx = {
    ...ctx,
    fixOptionId: optionId,
    twoSolutions: choice?.twoSolutions ?? false,
    sideResolved: choice?.twoSolutions ? false : true,
  };
  persist();
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
