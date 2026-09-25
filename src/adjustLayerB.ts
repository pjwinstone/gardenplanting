/** Layer B: per-photo pose + optional shared-(x,y) for yaw set. Full BA later. */

import type { GardenDocument, Observation, Point, Photo } from './model';
import {
  poseDeterminacy,
  raysFromPhoto,
  resectPose,
  subtendedAngleDeg,
  rodFillsStrong,
} from './photoGeometry';

export interface LayerBResult {
  points: Point[];
  photos: Photo[];
  observations: Observation[];
  summary: string;
  residualMm: number;
  ok: boolean;
}

export function runLayerB(doc: GardenDocument, layerAPoints: Point[]): LayerBResult {
  const points = layerAPoints.map((p) => ({ ...p }));
  const photos = doc.photos.map((p) => ({
    ...p,
    clicks: p.clicks.map((c) => ({ ...c })),
  }));
  const observations: Observation[] = [];
  let residualMm = 0;
  let weakCount = 0;

  // Group yaw-only photos by occupyPointId (shared x,y).
  const occupyGroups = new Map<string, Photo[]>();
  for (const ph of photos) {
    if (!ph.occupyPointId) continue;
    const list = occupyGroups.get(ph.occupyPointId) ?? [];
    list.push(ph);
    occupyGroups.set(ph.occupyPointId, list);
  }

  for (const ph of photos) {
    const det = poseDeterminacy(ph, points);
    if (!det.ok) {
      observations.push({
        id: `pose-${ph.id}`,
        kind: 'residual',
        photoId: ph.id,
        note: det.reason,
      });
      continue;
    }

    const rays = raysFromPhoto(ph);
    const pose = resectPose(points, rays);
    if (!pose) {
      observations.push({
        id: `pose-fail-${ph.id}`,
        kind: 'residual',
        photoId: ph.id,
        note: 'Could not resect pose from clicks.',
      });
      continue;
    }
    ph.pose = pose;

    const rodDeg = subtendedAngleDeg(ph, 'A1', 'A2');
    if (rodDeg != null) {
      const strong = rodFillsStrong(ph);
      if (!strong) {
        weakCount += 1;
        observations.push({
          id: `rod-subtend-${ph.id}`,
          kind: 'residual',
          photoId: ph.id,
          value: rodDeg,
          unit: 'deg',
          note: `Rod subtends ${rodDeg.toFixed(0)}° — ${rodDeg < 15 ? 'weak (too small in frame)' : 'wide'}.`,
        });
      } else {
        observations.push({
          id: `rod-subtend-${ph.id}`,
          kind: 'residual',
          photoId: ph.id,
          value: rodDeg,
          unit: 'deg',
          note: `Rod subtends ${rodDeg.toFixed(0)}° — strong.`,
        });
      }
    }
  }

  // Assign occupy coordinates from (averaged) photo poses.
  for (const [occId, group] of occupyGroups) {
    const poses = group.map((g) => g.pose).filter((p): p is NonNullable<typeof p> => !!p);
    if (!poses.length) {
      observations.push({
        id: `occ-weak-${occId}`,
        kind: 'residual',
        pointIds: [occId],
        note: `Occupied ${occId} is weak — no usable pose yet.`,
      });
      weakCount += 1;
      continue;
    }
    const x = poses.reduce((s, p) => s + p.x, 0) / poses.length;
    const y = poses.reduce((s, p) => s + p.y, 0) / poses.length;
    const pt = points.find((p) => p.id === occId);
    if (pt) {
      // Compare to planted truth if present for residual language.
      if (pt.x != null && pt.y != null) {
        const errMm = Math.hypot(pt.x - x, pt.y - y) * 1000;
        residualMm = Math.max(residualMm, errMm);
        const weak = group.some((g) => !rodFillsStrong(g));
        observations.push({
          id: `occ-res-${occId}`,
          kind: 'residual',
          pointIds: [occId],
          value: errMm,
          unit: 'mm',
          note: weak
            ? `Occupied ${occId} is weak — rod was too small in the frame.`
            : `Occupied ${occId} residual ${errMm.toFixed(0)} mm.`,
        });
        if (weak) weakCount += 1;
      }
      pt.x = x;
      pt.y = y;
    } else {
      points.push({ id: occId, kind: 'OCC', x, y, label: occId });
    }

    // Shared (x,y) for yaw set — yaw may differ per photo.
    for (const g of group) {
      if (g.pose) {
        g.pose = { ...g.pose, x, y };
      }
    }
  }

  // Tie photo: report friendliness.
  const tie = photos.find((ph) => {
    const ids = new Set(ph.clicks.map((c) => c.pointId));
    return (
      [...ids].filter((id) => id.startsWith('HSE')).length >= 2 &&
      ids.has('A1') &&
      ids.has('A2')
    );
  });
  if (tie) {
    const deg = subtendedAngleDeg(tie, 'A1', 'A2');
    observations.push({
      id: 'tie-note',
      kind: 'residual',
      photoId: tie.id,
      note:
        deg != null
          ? `I see rod A ends and house corners. Good tie. Rod subtends ${deg.toFixed(0)}° — ${rodFillsStrong(tie) ? 'strong' : 'usable'}.`
          : 'I see rod A ends and house corners. Good tie.',
    });
  }

  const summary =
    weakCount > 0
      ? `Layer B: poses estimated; ${weakCount} weak occupy/photo warning(s).`
      : 'Layer B: per-photo poses estimated; yaw sets share (x,y).';

  return {
    points,
    photos,
    observations,
    summary,
    residualMm,
    ok: true,
  };
}
