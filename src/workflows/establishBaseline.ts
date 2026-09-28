/** Workflow: establish baseline (toolbox setBaseline via UI form; this opens the mode). */

import type { GardenDocument } from '../model';
import { setBaseline } from '../model';
import { applyTransition } from '../toolbox';

export interface EstablishBaselineResult {
  ok: boolean;
  doc: GardenDocument;
  reason?: string;
}

export interface SaveBaselineOptions {
  offsetAMm?: number;
  offsetBMm?: number;
  isHouseEdge?: boolean;
  kind?: 'tape' | 'laser';
  trust?: number;
  /** Update this baseline in place when present in the document. */
  baselineId?: string;
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
  extras: Omit<SaveBaselineOptions, 'offsetAMm' | 'offsetBMm' | 'isHouseEdge'> = {},
): EstablishBaselineResult {
  if (!(lengthM > 0)) {
    return { ok: false, doc, reason: 'Baseline length must be a positive number in metres.' };
  }
  let next = doc;
  if (doc.session.mode !== 'BASELINE' && doc.session.mode !== 'HOUSE_BASELINE') {
    // Prefer in-place update when editing an existing baseline from later modes.
    if (!(extras.baselineId && doc.baselines.some((b) => b.id === extras.baselineId))) {
      const opened = applyTransition(doc, 'establish_baseline');
      if (!opened.result.ok) {
        // Still allow updating an existing baseline without mode change.
        if (!extras.baselineId) {
          return { ok: false, doc, reason: opened.result.reason };
        }
      } else {
        next = opened.doc;
      }
    }
  }
  next = setBaseline(next, lengthM, {
    offsetAMm,
    offsetBMm,
    isHouseEdge,
    kind: extras.kind,
    trust: extras.trust,
    baselineId: extras.baselineId,
  });
  return { ok: true, doc: next };
}
