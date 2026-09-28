/** Workflow: measure / grow house polygon corners. */

import type { GardenDocument } from '../model';
import { addHouseCorner, closeHouse, type CloseHouseResult } from '../model';
import { applyTransition } from '../toolbox';

export function beginMeasureHouseWorkflow(doc: GardenDocument): {
  ok: boolean;
  doc: GardenDocument;
  reason?: string;
} {
  const { doc: next, result } = applyTransition(doc, 'measure_house_edges');
  if (!result.ok) return { ok: false, doc, reason: result.reason };
  return { ok: true, doc: next };
}

export function addHouseCornerWorkflow(
  doc: GardenDocument,
  edgeLengthM?: number,
  offsetMm = 0,
): GardenDocument {
  return addHouseCorner(doc, edgeLengthM, offsetMm);
}

export function closeHouseWorkflow(doc: GardenDocument): CloseHouseResult {
  const gated = applyTransition(doc, 'close_house');
  if (!gated.result.ok) {
    return {
      doc,
      gapMm: NaN,
      warn: true,
      note: gated.result.reason ?? 'Close house refused.',
    };
  }
  return closeHouse(gated.doc);
}
