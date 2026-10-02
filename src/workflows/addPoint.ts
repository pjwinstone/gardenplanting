/** Workflow: Add point / Add photo on sticky layer+object. */

import type { GardenDocument, Point } from '../model';
import { addPhotoMeasurement, ensureDefaultLayers } from '../layers';
import { canTransition, applyTransition } from '../toolbox';

export function workflowAddPoint(
  doc: GardenDocument,
  opts: { thumbnailDataUrl?: string; width?: number; height?: number } = {},
): { ok: true; doc: GardenDocument; point: Point } | { ok: false; reason: string; doc: GardenDocument } {
  let next = ensureDefaultLayers(doc);
  if (next.session.mode !== 'ADD_POINT' && next.session.mode !== 'ADD_POINT_EXTRA_YAW') {
    const gate = canTransition(next, 'add_point');
    if (!gate.ok) {
      return { ok: false, reason: gate.reason ?? 'Cannot Add point yet.', doc: next };
    }
    const applied = applyTransition(next, 'add_point');
    if (!applied.result.ok) {
      return {
        ok: false,
        reason: applied.result.reason ?? 'Cannot Add point yet.',
        doc: applied.doc,
      };
    }
    next = applied.doc;
  }
  const result = addPhotoMeasurement(next, {
    thumbnailDataUrl: opts.thumbnailDataUrl,
    width: opts.width,
    height: opts.height,
  });
  if (result.reason) {
    return { ok: false, reason: result.reason, doc: result.doc };
  }
  return { ok: true, doc: result.doc, point: result.point };
}
