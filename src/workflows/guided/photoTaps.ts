/**
 * The tap screen shown after a guided photo. What to tap comes from the step's `photoTaps`
 * (definitions.ts): the calibration photo asks for the top and bottom edge of the sleeve; a camera
 * position photo asks for the named canes in view. There is no shared A / B / Target default here.
 * Pure functions only, so tests can walk every photo step without a DOM.
 */

import type { GardenDocument, Photo, PhotoClick } from '../../model';
import { workflowById } from './definitions';
import { nameMatchesStation, readProgress } from './engine';
import type { PhotoTapTarget, StepPhotoTaps, WorkflowDefinition, WorkflowStep } from './types';

export interface PhotoTapPlan {
  photoId: string;
  stepId: string;
  stepTitle: string;
  cameraPositionId: string;
  use: StepPhotoTaps['use'];
  /** 1-based photo number within the step, e.g. 2 for "Photo 2 of 2". */
  photoNumber: number;
  photoCount: number;
  targets: PhotoTapTarget[];
}

export interface PhotoTapDraft {
  plan: PhotoTapPlan;
  /** Taps placed so far, in preview pixels. pointId is the target id. */
  taps: PhotoClick[];
  /** Targets passed with "Not in view". */
  skipped: string[];
}

function stationOf(step: WorkflowStep): string | undefined {
  return 'on' in step.complete && step.complete.on === 'photo.uploaded' ? step.complete.stationId : undefined;
}

/** The photo step of the active run whose camera position this photo belongs to. */
export function photoStepFor(doc: GardenDocument, photo: Photo): { def: WorkflowDefinition; step: WorkflowStep } | undefined {
  const progress = readProgress(doc);
  const def = progress.activeId ? workflowById(progress.activeId) : undefined;
  if (!def) return undefined;
  const point = doc.points.find((item) => item.id === photo.addPointId)
    ?? doc.points.find((item) => (item.photoIds ?? []).includes(photo.id));
  if (!point) return undefined;
  for (const step of def.steps) {
    const station = stationOf(step);
    if (!station || !step.photoTaps) continue;
    if (nameMatchesStation(point.label ?? '', station) || nameMatchesStation(point.id, station)) return { def, step };
  }
  return undefined;
}

function timeMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Which photo of the step this is: photos on the same camera position point in this run, in the
 * order taken. A photo with no time yet (just taken) counts as this run.
 */
export function photoNumberInStep(doc: GardenDocument, photo: Photo, runStartedAt?: string): number {
  const start = timeMs(runStartedAt);
  const point = photo.addPointId;
  const same = doc.photos.filter((item) => {
    if (point ? item.addPointId !== point : item.id !== photo.id) return false;
    if (item.id === photo.id || start === undefined) return true;
    const at = timeMs(item.originalFile?.capturedAt) ?? timeMs(item.exifDateTimeOriginal) ?? timeMs(item.originalFile?.receivedAt);
    return at === undefined || at >= start;
  });
  const index = same.findIndex((item) => item.id === photo.id);
  return (index < 0 ? same.length : index) + 1;
}

/** Tap plan for a guided photo, or undefined when the photo is not on a guided photo step. */
export function photoTapPlan(doc: GardenDocument, photoId: string): PhotoTapPlan | undefined {
  const photo = doc.photos.find((item) => item.id === photoId);
  if (!photo) return undefined;
  const found = photoStepFor(doc, photo);
  if (!found?.step.photoTaps) return undefined;
  const { def, step } = found;
  const taps = step.photoTaps!;
  const progress = readProgress(doc);
  const run = progress.runs[def.id];
  const n = photoNumberInStep(doc, photo, run?.startedAt);
  const photoCount = 'on' in step.complete && step.complete.on === 'photo.uploaded' ? step.complete.minPhotos : taps.photos.length;
  const list = taps.photos[Math.min(n, taps.photos.length) - 1] ?? [];
  return {
    photoId,
    stepId: step.id,
    stepTitle: step.title,
    cameraPositionId: stationOf(step) ?? '',
    use: taps.use,
    photoNumber: Math.min(n, Math.max(photoCount, 1)),
    photoCount: Math.max(photoCount, 1),
    targets: list.map((target) => ({ ...target })),
  };
}

export function startTapDraft(plan: PhotoTapPlan, existing: PhotoClick[] = []): PhotoTapDraft {
  const ids = new Set(plan.targets.map((target) => target.id));
  return { plan, taps: existing.filter((tap) => ids.has(tap.pointId)).map((tap) => ({ ...tap })), skipped: [] };
}

/** The next target to tap, or undefined when every target is tapped or passed. */
export function nextTapTarget(draft: PhotoTapDraft): PhotoTapTarget | undefined {
  return draft.plan.targets.find(
    (target) => !draft.taps.some((tap) => tap.pointId === target.id) && !draft.skipped.includes(target.id),
  );
}

export function placeTap(draft: PhotoTapDraft, px: number, py: number): PhotoTapDraft {
  const target = nextTapTarget(draft);
  if (!target || !Number.isFinite(px) || !Number.isFinite(py)) return draft;
  return { ...draft, taps: [...draft.taps, { pointId: target.id, px, py }] };
}

/** "Not in view": only optional targets can be passed. */
export function skipTap(draft: PhotoTapDraft): PhotoTapDraft {
  const target = nextTapTarget(draft);
  if (!target?.optional) return draft;
  return { ...draft, skipped: [...draft.skipped, target.id] };
}

/** Undo the last tap or pass, in the order of the target list. */
export function undoTap(draft: PhotoTapDraft): PhotoTapDraft {
  for (let i = draft.plan.targets.length - 1; i >= 0; i -= 1) {
    const id = draft.plan.targets[i].id;
    if (draft.taps.some((tap) => tap.pointId === id)) return { ...draft, taps: draft.taps.filter((tap) => tap.pointId !== id) };
    if (draft.skipped.includes(id)) return { ...draft, skipped: draft.skipped.filter((item) => item !== id) };
  }
  return draft;
}

export function tapDraftComplete(draft: PhotoTapDraft): boolean {
  return draft.plan.targets.every(
    (target) => draft.taps.some((tap) => tap.pointId === target.id) || (target.optional && draft.skipped.includes(target.id)),
  );
}

export function canSaveTaps(draft: PhotoTapDraft): boolean {
  return draft.plan.targets.every((target) => target.optional || draft.taps.some((tap) => tap.pointId === target.id));
}

/** Text and buttons for the one compact bar at the bottom of the tap screen. */
export interface TapBarView {
  title: string;
  prompt: string;
  /** "Not in view" when the next target is optional. */
  secondary?: 'Not in view';
  primary: 'Save';
  primaryEnabled: boolean;
  canUndo: boolean;
}

export function tapBarView(draft: PhotoTapDraft): TapBarView {
  const { plan } = draft;
  const next = nextTapTarget(draft);
  const position = next ? plan.targets.indexOf(next) + 1 : plan.targets.length;
  const photoPart = plan.photoCount > 1 ? ` · photo ${plan.photoNumber} of ${plan.photoCount}` : '';
  const title = `${plan.stepTitle}${photoPart}`;
  const prompt = next
    ? `Tap ${plan.use === 'sleeve-height' ? `the ${next.label}` : next.label} (${position} of ${plan.targets.length})`
    : canSaveTaps(draft)
      ? 'All marked. Tap Save.'
      : 'Mark the baseline ends before Save.';
  return {
    title,
    prompt,
    secondary: next?.optional ? 'Not in view' : undefined,
    primary: 'Save',
    primaryEnabled: canSaveTaps(draft),
    canUndo: draft.taps.length > 0 || draft.skipped.length > 0,
  };
}

/** Sleeve height in preview pixels and, when the preview scale is known, in full-resolution pixels. */
export function sleeveHeightPx(taps: PhotoClick[], scaleY?: number): { previewPx: number; fullPx?: number } | undefined {
  const top = taps.find((tap) => tap.pointId === 'SLEEVE-TOP');
  const bottom = taps.find((tap) => tap.pointId === 'SLEEVE-BOTTOM');
  if (!top || !bottom) return undefined;
  const previewPx = Math.hypot(bottom.px - top.px, bottom.py - top.py);
  const fullPx = scaleY && Number.isFinite(scaleY) && scaleY > 0 ? previewPx * scaleY : undefined;
  return { previewPx, fullPx };
}

/**
 * Save the taps on the photo.
 * - sleeve-height: kept in `photo.measureTaps`, not in `clicks`, so the solver never reads them as bearings.
 * - bearings: tap ids are resolved to the garden's point ids (by id or label) and stored as clicks.
 * Returns the doc and whether both baseline ends were tapped (the caller then places the camera position).
 */
export function saveTapDraft(doc: GardenDocument, draft: PhotoTapDraft): { doc: GardenDocument; clicks: PhotoClick[]; hasBothEnds: boolean; message: string } {
  const photo = doc.photos.find((item) => item.id === draft.plan.photoId);
  if (!photo) return { doc, clicks: [], hasBothEnds: false, message: 'Photo not found.' };
  if (draft.plan.use === 'sleeve-height') {
    const taps = draft.taps.map((tap) => ({ ...tap }));
    const height = sleeveHeightPx(taps, photo.originalFile?.previewScaleY);
    const photos = doc.photos.map((item) => (item.id === photo.id ? { ...item, measureTaps: taps } : item));
    const size = height
      ? height.fullPx != null
        ? `Sleeve is ${Math.round(height.fullPx)} px tall.`
        : `Sleeve is ${Math.round(height.previewPx)} px tall on the preview.`
      : 'Sleeve not marked.';
    return { doc: { ...doc, photos }, clicks: [], hasBothEnds: false, message: `Calibration photo marked. ${size}` };
  }
  const resolve = (name: string): string => {
    const upper = name.trim().toUpperCase();
    const point = doc.points.find((item) => item.id.toUpperCase() === upper)
      ?? doc.points.find((item) => (item.label ?? '').trim().toUpperCase() === upper);
    return point?.id ?? name;
  };
  const clicks = draft.taps.map((tap) => ({ pointId: resolve(tap.pointId), px: tap.px, py: tap.py }));
  const ids = new Set(draft.taps.map((tap) => tap.pointId));
  const hasBothEnds = ids.has('BAS01') && ids.has('BAS02');
  const tapped = draft.taps.length;
  return {
    doc,
    clicks,
    hasBothEnds,
    message: `${tapped} cane${tapped === 1 ? '' : 's'} marked on ${draft.plan.stepTitle}.`,
  };
}

/** Pinch / wheel zoom for the tap screen. Scale 1 = the photo fits the screen. */
export const TAP_ZOOM_MIN = 1;
export const TAP_ZOOM_MAX = 8;

export interface TapView {
  scale: number;
  x: number;
  y: number;
}

export function clampTapZoom(scale: number): number {
  if (!Number.isFinite(scale)) return TAP_ZOOM_MIN;
  return Math.min(TAP_ZOOM_MAX, Math.max(TAP_ZOOM_MIN, scale));
}

/** Zoom about a screen point (cx, cy) so that point stays under the finger. At scale 1 the photo recentres. */
export function zoomTapViewAbout(view: TapView, nextScale: number, cx: number, cy: number): TapView {
  const scale = clampTapZoom(nextScale);
  if (scale === TAP_ZOOM_MIN) return { scale, x: 0, y: 0 };
  const ratio = scale / view.scale;
  return { scale, x: cx - (cx - view.x) * ratio, y: cy - (cy - view.y) * ratio };
}

/** Screen tap → photo pixel, given the photo's on-screen box (after zoom) and its pixel size. */
export function screenToPhotoPx(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  photo: { width: number; height: number },
): { px: number; py: number } | undefined {
  if (box.width < 1 || box.height < 1) return undefined;
  const fx = (clientX - box.left) / box.width;
  const fy = (clientY - box.top) / box.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return undefined;
  return { px: fx * photo.width, py: fy * photo.height };
}
