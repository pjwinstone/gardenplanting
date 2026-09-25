/** Photo geometry helpers — clicks, subtended angles, underdetermined checks. */

import type { Photo, PhotoClick, Point } from './model';

export interface PixelRay {
  pointId: string;
  /** Angle from photo centre in radians (approx pinhole, fx ≈ width). */
  bearingRad: number;
  px: number;
  py: number;
}

export function clickByPoint(photo: Photo, pointId: string): PhotoClick | undefined {
  return photo.clicks.find((c) => c.pointId === pointId);
}

/** Approximate horizontal bearing of a click relative to the optical axis. */
export function clickBearing(photo: Photo, click: PhotoClick): number {
  const cx = photo.width / 2;
  const fx = photo.width * 0.9; // rough focal length in px
  return Math.atan2(click.px - cx, fx);
}

export function raysFromPhoto(photo: Photo): PixelRay[] {
  return photo.clicks.map((c) => ({
    pointId: c.pointId,
    bearingRad: clickBearing(photo, c),
    px: c.px,
    py: c.py,
  }));
}

/** Subtended angle between two clicked marks, degrees. */
export function subtendedAngleDeg(photo: Photo, idA: string, idB: string): number | null {
  const a = clickByPoint(photo, idA);
  const b = clickByPoint(photo, idB);
  if (!a || !b) return null;
  const ba = clickBearing(photo, a);
  const bb = clickBearing(photo, b);
  return (Math.abs(ba - bb) * 180) / Math.PI;
}

export function rodFillsStrong(photo: Photo, a = 'A1', b = 'A2'): boolean {
  const deg = subtendedAngleDeg(photo, a, b);
  if (deg == null) return false;
  return deg >= 15 && deg <= 30;
}

/**
 * Unique pose needs house or second rod or a third known mark in the frame
 * (or across shared-C yaw set). If underdetermined, say so.
 */
export function poseDeterminacy(
  photo: Photo,
  knownPoints: Point[],
): { ok: boolean; reason: string } {
  const known = new Set(
    knownPoints.filter((p) => p.x != null && p.y != null).map((p) => p.id),
  );
  const clickedKnown = photo.clicks.filter((c) => known.has(c.pointId));
  if (clickedKnown.length >= 3) {
    return { ok: true, reason: 'Three or more known marks in frame — pose is determined.' };
  }
  const hasHouse = clickedKnown.some((c) => c.pointId.startsWith('HSE'));
  const hasRodA = known.has('A1') && known.has('A2') &&
    photo.clicks.some((c) => c.pointId === 'A1') &&
    photo.clicks.some((c) => c.pointId === 'A2');
  const hasRodB = known.has('B1') && known.has('B2') &&
    photo.clicks.some((c) => c.pointId === 'B1') &&
    photo.clicks.some((c) => c.pointId === 'B2');

  if (hasRodA && hasHouse) {
    return { ok: true, reason: 'House corner + rod A ends — unique pose.' };
  }
  if (hasRodA && hasRodB) {
    return { ok: true, reason: 'Both rods in frame — unique pose.' };
  }
  if (clickedKnown.length >= 2 && (hasRodA || hasRodB)) {
    return { ok: true, reason: 'Rod plus another known mark — pose usable.' };
  }
  return {
    ok: false,
    reason:
      'Underdetermined pose: need house or second rod or a third known mark in the frame. I will not invent coordinates.',
  };
}

/** Simple 2D resection from known points + bearings (distance-primary friendly). */
export function resectPose(
  known: Point[],
  rays: PixelRay[],
): { x: number; y: number; yawRad: number } | null {
  const usable = rays
    .map((r) => {
      const p = known.find((k) => k.id === r.pointId);
      if (!p || p.x == null || p.y == null) return null;
      return { x: p.x, y: p.y, bearing: r.bearingRad, id: r.pointId };
    })
    .filter((v): v is { x: number; y: number; bearing: number; id: string } => v != null);

  if (usable.length < 2) return null;

  // Prefer rod length as primary distance scale when A1+A2 present.
  const a1 = usable.find((u) => u.id === 'A1');
  const a2 = usable.find((u) => u.id === 'A2');
  if (a1 && a2) {
    const rodDx = a2.x - a1.x;
    const rodDy = a2.y - a1.y;
    const rodLen = Math.hypot(rodDx, rodDy) || 4;
    const pixelAngle = a2.bearing - a1.bearing;
    // Distance from camera to rod midpoint ≈ (L/2) / tan(θ/2)
    const half = Math.abs(pixelAngle) / 2;
    const dist = half > 1e-4 ? rodLen / 2 / Math.tan(half) : 8;
    const midX = (a1.x + a2.x) / 2;
    const midY = (a1.y + a2.y) / 2;
    const rodYaw = Math.atan2(rodDy, rodDx);
    // Camera sits roughly south of the rod for synthetic demo (looking toward +Y rod from house).
    const approach = rodYaw - Math.PI / 2;
    const yawRad = (a1.bearing + a2.bearing) / 2;
    const x = midX - dist * Math.cos(approach);
    const y = midY - dist * Math.sin(approach);
    return { x, y, yawRad };
  }

  // Fallback: average of known points pulled back along mean bearing.
  const cx = usable.reduce((s, u) => s + u.x, 0) / usable.length;
  const cy = usable.reduce((s, u) => s + u.y, 0) / usable.length;
  const meanBearing = usable.reduce((s, u) => s + u.bearing, 0) / usable.length;
  return { x: cx - 3 * Math.sin(meanBearing), y: cy - 3 * Math.cos(meanBearing), yawRad: meanBearing };
}
