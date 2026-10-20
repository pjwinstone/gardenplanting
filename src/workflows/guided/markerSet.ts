/**
 * This garden's marker set: survey point ↔ sleeve ID. Lives on the document
 * (doc.markerSet); a document without one uses the printed default set,
 * CIRCLE_SLEEVES in scripts/markerSleeve.ts. The whole-photo scan only accepts
 * these IDs (docs/marker-detection.md).
 */
import type { GardenDocument, MarkerAssignment } from '../../model';
import { CIRCLE_SLEEVES } from '../../../scripts/markerSleeve';

export const DEFAULT_MARKER_SET: readonly MarkerAssignment[] = CIRCLE_SLEEVES.map((s) => ({ point: s.point, id: s.id }));

/** The marker set in use for a document (its own field, else the default). */
export function markerSetFor(doc?: Pick<GardenDocument, 'markerSet'> | null): readonly MarkerAssignment[] {
  const own = doc?.markerSet?.filter((m) => m && typeof m.point === 'string' && typeof m.id === 'string');
  return own && own.length ? own : DEFAULT_MARKER_SET;
}

export function markerMap(doc?: Pick<GardenDocument, 'markerSet'> | null): Record<string, string> {
  return Object.fromEntries(markerSetFor(doc).map((m) => [m.point, m.id.trim().toUpperCase()]));
}

/** Default map, for callers with no document. */
export const GARDEN_MARKERS: Readonly<Record<string, string>> = markerMap(null);

export const GARDEN_MARKER_IDS: string[] = Object.values(GARDEN_MARKERS);

export function markerIdsFor(doc?: Pick<GardenDocument, 'markerSet'> | null): string[] {
  return Object.values(markerMap(doc));
}

/** Edge points of the garden circle, in order (EDG01…). */
export function edgePointsFor(doc?: Pick<GardenDocument, 'markerSet'> | null, count?: number): string[] {
  const edges = markerSetFor(doc).map((m) => m.point).filter((p) => /^EDG\d+$/.test(p));
  return count === undefined ? edges : edges.slice(0, Math.max(0, count));
}

/** Point name for a sleeve ID, if it is one of ours. */
export function pointForMarkerId(id: string, doc?: Pick<GardenDocument, 'markerSet'> | null): string | undefined {
  const want = id.trim().toUpperCase();
  return markerSetFor(doc).find((m) => m.id.trim().toUpperCase() === want)?.point;
}
