/**
 * Roller row "Take photos" / "Retake" for a camera position step: go straight to the camera
 * for that camera position, with no layer / point-type chooser. Photos attach to a camera
 * position point whose label is the step's camera position name, so photoOnStation() matches
 * them and the step ticks itself once the originals are verified on OneDrive.
 */

import type { GardenDocument, Point } from '../../model';
import { nameMatchesStation } from './engine';
import type { WorkflowDefinition, WorkflowLink } from './types';

export interface CameraCaptureContext {
  stepId: string;
  /** Camera position name the step listens for, e.g. "Left". */
  cameraPositionId: string;
  minPhotos: number;
}

/** The camera context for a step that ticks on photos, or undefined for any other step. */
export function cameraCaptureContext(def: WorkflowDefinition | undefined, stepId: string): CameraCaptureContext | undefined {
  const step = def?.steps.find((item) => item.id === stepId);
  if (!step || !('on' in step.complete) || step.complete.on !== 'photo.uploaded') return undefined;
  return { stepId: step.id, cameraPositionId: step.complete.stationId, minPhotos: step.complete.minPhotos };
}

export function cameraLink(ctx: CameraCaptureContext): WorkflowLink {
  return { to: 'camera', stepId: ctx.stepId, cameraPositionId: ctx.cameraPositionId };
}

/** Find the camera position point for this name (legacy STN/CAL names count), or add one. */
export function ensureCameraPositionPoint(
  doc: GardenDocument,
  cameraPositionId: string,
): { doc: GardenDocument; pointId: string; created: boolean } {
  const existing = doc.points.find(
    (point) => nameMatchesStation(point.label ?? '', cameraPositionId) || nameMatchesStation(point.id, cameraPositionId),
  );
  if (existing) return { doc, pointId: existing.id, created: false };
  const base = `CAM-${cameraPositionId.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`;
  let id = base;
  for (let n = 2; doc.points.some((point) => point.id === id); n += 1) id = `${base}-${n}`;
  const point: Point = { id, kind: 'OCC', label: cameraPositionId };
  return { doc: { ...doc, points: [...doc.points, point] }, pointId: id, created: true };
}

export interface CaptureCheck {
  ok: boolean;
  orientation: 'landscape' | 'portrait' | 'unknown';
  /** Zoom the camera reported (native shutter), or undefined from the browser. */
  zoom?: number;
  message: string;
}

/**
 * Camera position and calibration photos must be landscape at 1× (main wide lens), so the
 * focal length stays fixed. width/height are the upright image (after EXIF orientation).
 */
export function checkCameraPositionPhoto(opts: { width?: number; height?: number; zoom?: number }): CaptureCheck {
  const { width, height, zoom } = opts;
  const orientation =
    width && height ? (width >= height ? 'landscape' : 'portrait') : 'unknown';
  if (orientation === 'portrait') {
    return { ok: false, orientation, zoom, message: 'Turn the phone sideways. Camera position photos must be landscape. Take it again.' };
  }
  if (zoom != null && Math.abs(zoom - 1) > 0.01) {
    return { ok: false, orientation, zoom, message: `Use 1× (the main lens). This photo was at ${zoom.toFixed(1)}×. Take it again.` };
  }
  const zoomText = zoom != null ? `${zoom.toFixed(1)}×` : 'zoom not reported';
  return { ok: true, orientation, zoom, message: `${orientation === 'unknown' ? 'Orientation unknown' : 'Landscape'}, ${zoomText}.` };
}
