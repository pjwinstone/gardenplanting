import type { AddPointWorkflowContext } from '../addPoint/context';

export type GuardName = string;

export type GuardFn = (ctx: AddPointWorkflowContext) => boolean;

export const GUARDS: Record<GuardName, GuardFn> = {
  always: () => true,
  has_layer_rule: (ctx) => Boolean(ctx.layerRule),
  needs_side_choice: (ctx) =>
    ctx.fixOption === 'free_point' || ctx.fixOption === 'camera_station',
  side_not_required: (ctx) => ctx.fixOption === 'baseline_end',
  has_side_or_skipped: (ctx) =>
    ctx.fixOption === 'baseline_end' ||
    ctx.side != null ||
    Boolean(ctx.sideAnchorPointId),
  has_measurement: (ctx) =>
    Boolean(ctx.tapeLengthM != null && ctx.tapeLengthM > 0) ||
    Boolean(ctx.pendingPhotoId) ||
    Boolean(ctx.draftPointId),
  strength_is_green: (ctx) => ctx.strength === 'green',
  strength_is_amber: (ctx) => ctx.strength === 'amber',
  strength_is_red: (ctx) => ctx.strength === 'red',
  strength_is_grey: (ctx) => ctx.strength === 'grey' || ctx.strength == null,
  ready_to_commit: (ctx) =>
    Boolean(ctx.draftPointId) && (ctx.strength === 'green' || Boolean(ctx.acceptedAmber)),
};

export function guardPasses(name: string | undefined, ctx: AddPointWorkflowContext): boolean {
  if (!name) return true;
  const fn = GUARDS[name];
  if (!fn) return false;
  return fn(ctx);
}
