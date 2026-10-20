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

/**
 * Edge points of the garden circle, in order (EDG01…). Since rev 6 an edge point carries no
 * sleeve (you stand on it for one photo), so the names are generated, not read from the marker set.
 */
export function edgePointsFor(_doc?: Pick<GardenDocument, 'markerSet'> | null, count = 12): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => `EDG${String(i + 1).padStart(2, '0')}`);
}

/** Base points BAS01, BAS02, BAS03… in the marker set: the growing control network. */
export function basePointsFor(doc?: Pick<GardenDocument, 'markerSet'> | null): string[] {
  return markerSetFor(doc).map((m) => m.point).filter((p) => /^BAS\d+$/.test(p));
}

/** Point name for a sleeve ID, if it is one of ours. */
export function pointForMarkerId(id: string, doc?: Pick<GardenDocument, 'markerSet'> | null): string | undefined {
  const want = id.trim().toUpperCase();
  return markerSetFor(doc).find((m) => m.id.trim().toUpperCase() === want)?.point;
}
