/** Workflow: establish baseline (toolbox setBaseline via UI form; this opens the mode). */

import type { GardenDocument } from '../model';
import { setBaseline } from '../model';
import { applyTransition } from '../toolbox';

export interface EstablishBaselineResult {
  ok: boolean;
  doc: GardenDocument;
  reason?: string;
}

export function beginEstablishBaselineWorkflow(doc: GardenDocument): EstablishBaselineResult {
  const { doc: next, result } = applyTransition(doc, 'establish_baseline');
  if (!result.ok) return { ok: false, doc, reason: result.reason };
  return { ok: true, doc: next };
}

export function saveBaselineLengthWorkflow(
  doc: GardenDocument,
  lengthM: number,
  offsetAMm: number,
  offsetBMm: number,
  isHouseEdge = true,
): EstablishBaselineResult {
  if (!(lengthM > 0)) {
    return { ok: false, doc, reason: 'Baseline length must be a positive number in metres.' };
  }
  let next = doc;
  if (doc.session.mode !== 'BASELINE') {
    const opened = applyTransition(doc, 'establish_baseline');
    if (!opened.result.ok) return { ok: false, doc, reason: opened.result.reason };
    next = opened.doc;
  }
  next = setBaseline(next, lengthM, {
    offsetAMm,
    offsetBMm,
    isHouseEdge,
  });
  return { ok: true, doc: next };
}
