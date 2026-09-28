/** Workflow: Stage 2 field loop — coach lives in coach.ts; this calls the toolbox. */

import type { GardenDocument } from '../model';
import { applyTransition, createEmptyGarden } from '../toolbox';

export interface Stage2StartResult {
  ok: boolean;
  doc: GardenDocument;
  showChecklist: boolean;
  reason?: string;
}

/**
 * Start the live-garden survey workflow: empty/clean garden → HOUSE_BASELINE.
 */
export function startStage2FieldWorkflow(current: GardenDocument): Stage2StartResult {
  const base =
    current.session.mode === 'START' && current.points.length === 0
      ? current
      : createEmptyGarden('Stage 2 garden');

  const { doc, result } = applyTransition(base, 'start_house');
  if (!result.ok) {
    return {
      ok: false,
      doc: current,
      showChecklist: true,
      reason: result.reason ?? 'Could not start Stage 2.',
    };
  }
  return { ok: true, doc, showChecklist: true };
}
