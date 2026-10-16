import type { GardenDocument } from '../../model';
import type { AddPointWorkflowContext } from '../addPoint/context';
import { countExistingBaselinePoints } from '../addPoint/baselinePoints';

export type GuardEnv = {
  doc?: GardenDocument;
};

export type GuardFn = (ctx: AddPointWorkflowContext, env: GuardEnv) => boolean;

/** Predicates keyed by transition id from add-point.net.yaml */
export const TRANSITION_GUARDS: Record<string, GuardFn> = {
  choose_layer: () => true,
  list_fix_options: (_ctx, env) => {
    const n = env.doc ? countExistingBaselinePoints(env.doc) : 0;
    return n >= 2;
  },
  pick_fix_option: (ctx) => Boolean(ctx.fixOptionId),
  detect_two_solutions: (ctx) => Boolean(ctx.twoSolutions && !ctx.sideResolved),
  side_choice: () => true,
  take_measurements: (ctx) =>
    Boolean(ctx.fixOptionId) && (!ctx.twoSolutions || ctx.sideResolved === true),
  adjust: (ctx) =>
    Boolean(ctx.tapeLengthM && ctx.tapeLengthM > 0) ||
    Boolean(ctx.pendingPhotoId) ||
    Boolean(ctx.draftPointId),
  raise_baseline_warning: (ctx, env) => {
    if (ctx.layerRule === 'baseline') return false;
    if (!ctx.baselineWarning) return false;
    return Boolean(env.doc);
  },
  keep_green: (ctx) => ctx.strength === 'green',
  accept_amber: (ctx) => ctx.strength === 'amber',
  redo_red: (ctx) => ctx.strength === 'red',
  add_measurement_grey: (ctx) => ctx.strength === 'grey' || ctx.strength == null,
};

export function guardPasses(
  transitionId: string,
  ctx: AddPointWorkflowContext,
  env: GuardEnv = {},
): boolean {
  const fn = TRANSITION_GUARDS[transitionId];
  if (!fn) return true;
  return fn(ctx, env);
}
