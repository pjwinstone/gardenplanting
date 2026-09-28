/** Workflow: milestone synthetic demo — uses toolbox adjust. */

import type { GardenDocument } from '../model';
import { createSyntheticGarden, runAdjust } from '../toolbox';

export interface MilestoneResult {
  ok: boolean;
  doc: GardenDocument;
  residualNotes: string[];
  reason?: string;
}

/** Load synthetic garden only (caller may speak coach). */
export function loadSyntheticWorkflow(): GardenDocument {
  return createSyntheticGarden();
}

/** Synthetic garden → Adjust in one step. */
export function runMilestoneDemoWorkflow(): MilestoneResult {
  const seeded = createSyntheticGarden();
  const adjusted = runAdjust(seeded);
  if (!adjusted.ok) {
    return {
      ok: false,
      doc: seeded,
      residualNotes: [],
      reason: adjusted.reason,
    };
  }
  return {
    ok: true,
    doc: adjusted.doc,
    residualNotes: adjusted.residualNotes,
  };
}
