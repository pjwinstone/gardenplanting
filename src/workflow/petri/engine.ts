import { guardPasses } from './guards';
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
): boolean {
  if (!hasEnoughTokens(marking, t.inputs)) return false;
  return guardPasses(t.guard, ctx);
}

export function enabledTransitions(
  net: PetriNetDoc,
  marking: Marking,
  ctx: AddPointWorkflowContext,
  kind?: 'user' | 'app',
): PetriTransition[] {
  return net.transitions.filter((t) => {
    if (kind && t.kind !== kind) return false;
    return transitionEnabled(t, marking, ctx);
  });
}

export function fireTransition(
  run: PetriRunState,
  net: PetriNetDoc,
  transitionId: string,
  ctx: AddPointWorkflowContext,
  at = new Date().toISOString(),
): { run: PetriRunState; error?: string } {
  const t = net.transitions.find((x) => x.id === transitionId);
  if (!t) return { run, error: `Unknown transition ${transitionId}` };
  if (!transitionEnabled(t, run.marking, ctx)) {
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
    activity: net.activity,
    version: net.version,
    marking: initialMarking(net),
    log: [],
    context: {},
  };
}

/** Fire app transitions in stable net order until none remain enabled. */
export function autoFireAppTransitions(
  run: PetriRunState,
  net: PetriNetDoc,
  ctx: AddPointWorkflowContext,
  at = new Date().toISOString(),
): PetriRunState {
  let current = run;
  for (;;) {
    const apps = enabledTransitions(net, current.marking, ctx, 'app');
    if (!apps.length) break;
    const next = fireTransition(current, net, apps[0]!.id, ctx, at);
    if (next.error) break;
    current = next.run;
  }
  return current;
}
