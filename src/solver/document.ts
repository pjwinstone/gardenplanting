/**
 * Read a schema-v1 garden document. Stored x,y are not observations.
 * offsetMm has no direction in v1, so it is not applied.
 * A photo with no fx/width is not resected.
 */

import type { GardenDocument, Line } from '../model';
import { solve } from './adjust';
import type { SolveInput, SolveResult, SolverDistanceInput } from './types';

export function solveGardenDocument(doc: GardenDocument, extra?: Partial<SolveInput>): SolveResult {
  const baselines = doc.baselines?.length
    ? doc.baselines
    : doc.lines
        .filter((l) => l.kind === 'baseline' && l.lengthM != null)
        .map((l) => ({
          id: l.id,
          a: l.a,
          b: l.b,
          lengthM: l.lengthM ?? 0,
          sigmaM: l.sigmaM,
          trust: 50,
          kind: 'tape' as const,
        }));
  if (baselines.length === 0) {
    throw new Error('No baseline to choose as the datum.');
  }
  const datumBl = [...baselines].sort((a, b) => (b.trust ?? 50) - (a.trust ?? 50))[0];
  const covered = new Set(
    baselines.map((b) => [b.a, b.b].sort().join('|')),
  );
  const distances: SolverDistanceInput[] = [];
  for (const line of doc.lines ?? []) {
    if (line.lengthM == null) continue;
    if (covered.has(pairKey(line))) continue;
    if (line.kind === 'baseline') continue;
    distances.push({
      id: line.id,
      a: line.a,
      b: line.b,
      slopeM: line.lengthM,
      sigmaM: line.sigmaM,
      instrument: line.kind === 'laser' ? 'laser' : line.kind === 'rod' ? 'rod' : 'tape',
    });
  }
  const skippedPhotos: { id: string; code: 'no-fx' }[] = [];
  const photos = [];
  for (const photo of doc.photos ?? []) {
    const fx = (photo as { fxOverWidth?: number }).fxOverWidth;
    if (fx == null) {
      skippedPhotos.push({ id: photo.id, code: 'no-fx' });
      continue;
    }
    const gravity = (photo as { gravity?: { x: number; y: number; z: number } }).gravity;
    photos.push({
      id: photo.id,
      stationId: photo.addPointId ?? `station:${photo.id}`,
      width: photo.width,
      height: photo.height,
      fxOverWidth: fx,
      clicks: photo.clicks.map((c) => ({ pointId: c.pointId, px: c.px, py: c.py })),
      gravity,
      yawHeldRad: undefined,
    });
  }
  const result = solve({
    points: (doc.points ?? []).map((p) => ({ id: p.id })),
    datum: {
      originId: datumBl.a,
      axisPointId: datumBl.b,
      lengthM: datumBl.lengthM,
      sigmaM: datumBl.sigmaM,
      instrument: datumBl.kind === 'laser' ? 'laser' : 'tape',
      gardenSign: 1,
    },
    distances,
    photos,
    ...extra,
  });
  result.skippedPhotos = skippedPhotos;
  return result;
}

function pairKey(line: Line): string {
  return [line.a, line.b].sort().join('|');
}
