/**
 * This garden's marker set: survey point → sleeve ID. One source with the printed sleeves:
 * CIRCLE_SLEEVES in scripts/markerSleeve.ts. The whole-photo scan only accepts these IDs
 * (docs/marker-detection.md).
 */
import { CIRCLE_SLEEVES } from '../../../scripts/markerSleeve';

export const GARDEN_MARKERS: Readonly<Record<string, string>> = Object.fromEntries(
  CIRCLE_SLEEVES.map((s) => [s.point, s.id]),
);

export const GARDEN_MARKER_IDS: string[] = Object.values(GARDEN_MARKERS);

/** Point name for a sleeve ID, if it is one of ours. */
export function pointForMarkerId(id: string): string | undefined {
  const want = id.trim().toUpperCase();
  return Object.keys(GARDEN_MARKERS).find((p) => GARDEN_MARKERS[p] === want);
}
