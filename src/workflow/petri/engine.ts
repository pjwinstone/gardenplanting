import { guardPasses, type GuardEnv } from './guards';
import type { AddPointWorkflowContext } from '../addPoint/context';
import type {
  Marking,
  ObservationLogEntry,
  PetriNetDoc,
  PetriRunState,
  PetriTransition,
} from './types';
import { initialMarking } from './loadNet';

export function cloneMarking(m: Marking): Marking {
  return { ...m };
}

export function tokensAt(marking: Marking, placeId: string): number {
  return marking[placeId] ?? 0;
}

function hasEnoughTokens(marking: Marking, inputs: Record<string, number>): boolean {
  for (const [place, need] of Object.entries(inputs)) {
    if (tokensAt(marking, place) < need) return false;
  }
  return true;
}

export function transitionEnabled(
  t: PetriTransition,
  marking: Marking,
  ctx: AddPointWorkflowContext,
  env: GuardEnv = {},
): boolean {
  if (!hasEnoughTokens(marking, t.inputs)) return false;
  return guardPasses(t.id, ctx, env);
}

export function enabledTransitions(
  net: PetriNetDoc,
  marking: Marking,
  ctx: AddPointWorkflowContext,
  kind?: 'user' | 'app',
  env: GuardEnv = {},
): PetriTransition[] {
  return net.transitions.filter((t) => {
    if (kind && t.kind !== kind) return false;
    return transitionEnabled(t, marking, ctx, env);
  });
}

export function fireTransition(
  run: PetriRunState,
  net: PetriNetDoc,
  transitionId: string,
  ctx: AddPointWorkflowContext,
  env: GuardEnv = {},
  at = new Date().toISOString(),
): { run: PetriRunState; error?: string } {
  const t = net.transitions.find((x) => x.id === transitionId);
  if (!t) return { run, error: `Unknown transition ${transitionId}` };
  if (!transitionEnabled(t, run.marking, ctx, env)) {
    return { run, error: `Transition ${transitionId} is not enabled` };
  }

  const marking = cloneMarking(run.marking);
  for (const [place, need] of Object.entries(t.inputs)) {
    marking[place] = tokensAt(marking, place) - need;
  }
  for (const [place, add] of Object.entries(t.outputs)) {
    marking[place] = tokensAt(marking, place) + add;
  }

  const seq = run.log.length ? run.log[run.log.length - 1]!.seq + 1 : 1;
  const entry: ObservationLogEntry = {
    seq,
    transitionId: t.id,
    at,
    kind: t.kind,
  };

  return {
    run: {
      ...run,
      marking,
      log: [...run.log, entry],
    },
  };
}

export function newPetriRun(net: PetriNetDoc): PetriRunState {
  return {
    activity: net.id,
    version: net.revision,
    marking: initialMarking(net),
    log: [],
    context: {},
  };
}
