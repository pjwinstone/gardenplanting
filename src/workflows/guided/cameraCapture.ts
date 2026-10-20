/**
 * Roller row "Take photos" / "Retake" for a camera position step: go straight to the camera
 * for that camera position, with no layer / point-type chooser. Photos attach to a camera
 * position point whose label is the step's camera position name, so photoOnStation() matches
 * them and the step ticks itself once the originals are verified on OneDrive.
 */

import type { GardenDocument, Point } from '../../model';
import { nameMatchesStation, readProgress } from './engine';
import { defaultFieldTestSetup } from './fieldTestMeta';
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
export function checkCameraPositionPhoto(opts: {
  width?: number;
  height?: number;
  zoom?: number;
  /** Device-frame gravity at the shutter (native camera). Upright portrait is |y| > |x|. */
  gravity?: { x: number; y: number; z: number };
}): CaptureCheck {
  const { width, height, zoom, gravity } = opts;
  const heldUpright = gravity != null && Math.abs(gravity.y) > 0.5 && Math.abs(gravity.y) > Math.abs(gravity.x);
  const orientation =
    heldUpright ? 'portrait' : width && height ? (width >= height ? 'landscape' : 'portrait') : 'unknown';
  if (orientation === 'portrait') {
    return { ok: false, orientation, zoom, message: 'Turn the phone sideways. Camera position photos must be landscape. Take it again.' };
  }
  if (zoom != null && Math.abs(zoom - 1) > 0.01) {
    return { ok: false, orientation, zoom, message: `Use 1× (the main lens). This photo was at ${zoom.toFixed(1)}×. Take it again.` };
  }
  const zoomText = zoom != null ? `${zoom.toFixed(1)}×` : 'zoom not reported';
  return { ok: true, orientation, zoom, message: `${orientation === 'unknown' ? 'Orientation unknown' : 'Landscape'}, ${zoomText}.` };
}

/**
 * One-line hint for the shutter screen and the message bar. Calibration names the taped
 * distance from Set-up; camera positions name their distances to BAS01 / BAS02.
 */
export function cameraPositionHint(doc: GardenDocument, cameraPositionId: string): string {
  const progress = readProgress(doc);
  const run = progress.activeId ? progress.runs[progress.activeId] : undefined;
  const values = run?.setup?.values ?? defaultFieldTestSetup();
  if (nameMatchesStation('Calibration', cameraPositionId)) {
    const d = values.calibration_distance_m.toFixed(1);
    return `Calibration: landscape, 1×. Phone ${d} m (taped) from the calibration cane. Cane in the middle, whole sleeve in view. Tap the sleeve, then the shutter.`;
  }
  if (nameMatchesStation('Edge points', cameraPositionId)) {
    return 'Edge point: stand on the peg, face the base points, landscape, 1×. One photo per edge point, every base point you can see in the frame.';
  }
  const key = cameraPositionId.trim().toLowerCase().replace(/\s+/g, '_') as keyof typeof values.camera_positions;
  const pos = values.camera_positions[key];
  const where = pos ? ` ${pos.to_bas01.toFixed(2)} m to BAS01, ${pos.to_bas02.toFixed(2)} m to BAS02.` : '';
  return `Camera position ${cameraPositionId}: landscape, 1×.${where} Both baseline canes in view. Tap a cane, then the shutter.`;
}
