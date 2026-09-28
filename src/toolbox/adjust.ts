/** Toolbox: adjust / Layer A+B — pure capability, no coach copy. */

import type { GardenDocument } from '../model';
import { runLayerA } from '../adjustLayerA';
import { runLayerB } from '../adjustLayerB';
import { applyTransition } from '../modes';

export interface AdjustResult {
  ok: boolean;
  doc: GardenDocument;
  reason?: string;
  /** Plain residual notes for the caller (workflow/UI) to pass to coach speech. */
  residualNotes: string[];
}

/**
 * Gate Adjust, run Layer A then Layer B, return updated document.
 * Does not speak or write coach text.
 */
export function runAdjust(doc: GardenDocument): AdjustResult {
  const gate = applyTransition(doc, 'adjust');
  if (!gate.result.ok) {
    return {
      ok: false,
      doc,
      reason: gate.result.reason ?? 'Adjust refused.',
      residualNotes: [],
    };
  }

  let next = gate.doc;
  const a = runLayerA(next);
  const b = runLayerB({ ...next, points: a.points }, a.points);
  const observations = [...a.observations, ...b.observations];
  const residualNotes = observations
    .filter((o) => o.note)
    .slice(0, 3)
    .map((o) => o.note!);

  next = {
    ...next,
    points: b.points,
    photos: b.photos,
    observations,
    session: {
      ...next.session,
      mode: 'ADJUST',
      lastAction: 'Adjust (Layer A then Layer B)',
      lastResidualMm:
        a.residualMm > 0 ? a.residualMm : Math.min(b.residualMm, 50),
      geometryOk: a.ok && b.ok,
    },
  };

  return { ok: true, doc: next, residualNotes };
}
