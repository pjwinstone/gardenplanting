import type { GardenDocument } from '../../model';

/** Baseline-layer points usable as control for fix-option guards (≥2 required). */
export function countExistingBaselinePoints(doc: GardenDocument): number {
  const ends = new Set<string>();
  for (const b of doc.baselines) {
    ends.add(b.a);
    ends.add(b.b);
  }
  for (const p of doc.points) {
    if (p.kind === 'BL') ends.add(p.id);
  }
  return ends.size;
}
