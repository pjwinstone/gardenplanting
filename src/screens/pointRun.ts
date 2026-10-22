/**
 * Add point (rebuild): run state, step guards, base grid, photo point solve, hints and retake.
 * Pure functions on the garden document so they can be tested without the DOM.
 */
import type { BaseGridDoc, GardenDocument, Photo, PointKind } from '../model';
import type { ArchiveJob } from '../photoArchive';
import {
  adjustGridNetwork,
  adjustSession,
  gateEdgePoints,
  POST_SEPARATION_DEFAULT_M,
  sightingsFromPhoto,
  subCovariance,
  type EdgeGate,
  type GridDiagonalWarning,
  type GridNetworkResult,
} from '../solver/controlCluster';
import { calibrationFx } from '../workflows/guided/circleResult';
import { readProgress } from '../workflows/guided/engine';
import { fireStep, hasTokens, pointNet, rowsFor, t, unfireFrom, type Branch, type FiredStep, type NetStep } from './stepNet';

export type PointType = 'base' | 'photo';
export type PhotoLayer = 'boundary' | 'path' | 'structure' | 'bed';
export const PHOTO_LAYERS: PhotoLayer[] = ['boundary', 'path', 'structure', 'bed'];
const LAYER_KIND: Record<PhotoLayer, PointKind> = { boundary: 'FNC', path: 'TRK', structure: 'HSE', bed: 'BED' };

export interface PointRun {
  version: 1;
  startedAt: string;
  /** Roller row the user is on. Only scroll and Next/Back change it. */
  current: string;
  fired: FiredStep[];
  type?: PointType;
  from?: string;
  northM?: number;
  eastM?: number;
  diagonalM?: number;
  twoSleeve?: boolean;
  separationM?: number;
  layer?: PhotoLayer;
  /** Photo point id (made on the first photo). */
  pointId?: string;
  /** Photos of this run, in slot order. A retake replaces a slot in place. */
  photoIds: string[];
  /** Slot the next photo fills (after a Retake), else appended. */
  retakeSlot?: number;
  dismissedHints: string[];
}

export function newPointRun(now = new Date().toISOString()): PointRun {
  return { version: 1, startedAt: now, current: 'choose_type', fired: [], photoIds: [], dismissedHints: [] };
}

export function rows(run: PointRun): NetStep[] {
  return rowsFor(pointNet, run.type as Branch | undefined);
}

export function isDone(run: PointRun, stepId: string): boolean {
  return run.fired.some((f) => f.id === stepId);
}

/** First row not done (gets the small "next" marker). */
export function nextNeeded(run: PointRun): string | undefined {
  return rows(run).find((s) => !isDone(run, s.id))?.id;
}

// ---------------------------------------------------------------- base grid

export interface BaseGridView {
  ids: string[];
  ties: BaseGridDoc['ties'];
  postSeparation: Record<string, number>;
}

/** Base grid = the garden's base points, plus any tied in the circle test run (same BAS ids). */
export function baseGridOf(doc: GardenDocument): BaseGridView {
  const grid = doc.baseGrid ?? { points: [], ties: [] };
  const circle = readProgress(doc).runs['circle-field-test'];
  const ties = [...grid.ties];
  for (const tie of circle?.baseTies ?? []) if (!ties.some((x) => x.from === tie.from && x.to === tie.to)) ties.push(tie);
  const ids = new Set<string>(grid.points.map((p) => p.id));
  if (ties.length) ids.add('BAS01');
  for (const tie of ties) {
    ids.add(tie.from);
    ids.add(tie.to);
  }
  const postSeparation: Record<string, number> = { ...(circle?.basePostSeparationM ?? {}) };
  for (const p of grid.points) if (p.postSeparationM) postSeparation[p.id] = p.postSeparationM;
  return { ids: [...ids].sort(), ties, postSeparation };
}

export function nextBaseId(doc: GardenDocument): string {
  const ids = baseGridOf(doc).ids;
  if (!ids.length) return 'BAS01';
  const n = Math.max(...ids.map((id) => Number(id.replace(/\D/g, '')) || 0)) + 1;
  return `BAS${String(n).padStart(2, '0')}`;
}

export function isFirstBasePoint(doc: GardenDocument): boolean {
  return baseGridOf(doc).ids.length === 0;
}

export function networkOf(ties: BaseGridDoc['ties']): GridNetworkResult | undefined {
  if (!ties.length) return undefined;
  try {
    return adjustGridNetwork('BAS01', ties);
  } catch {
    return undefined;
  }
}

/**
 * Diagonal check on the new tie, within the whole base grid. A warning only: it never blocks
 * Next or Save. `warning` carries the text and the factor on the point's uncertainty.
 */
export function diagonalCheck(doc: GardenDocument, run: PointRun): { expectedM: number; diffMm: number; red: boolean; warning?: GridDiagonalWarning } | undefined {
  if (run.northM == null || run.eastM == null || run.diagonalM == null || !run.from) return undefined;
  const expectedM = Math.hypot(run.northM, run.eastM);
  const to = nextBaseId(doc);
  const net = networkOf([...baseGridOf(doc).ties, { id: 'new', from: run.from, to, northM: run.northM, eastM: run.eastM, diagonalM: run.diagonalM, savedAt: '' }]);
  const warning = net?.warnings.find((w) => w.point === to);
  const diffMm = Math.round((run.diagonalM - expectedM) * 1000);
  return { expectedM, diffMm, red: !!warning, warning };
}

/** Per base point: the diagonal warning, if any (for the list highlight). */
export function baseWarnings(doc: GardenDocument): Record<string, GridDiagonalWarning> {
  const net = networkOf(baseGridOf(doc).ties);
  const out: Record<string, GridDiagonalWarning> = {};
  for (const w of net?.warnings ?? []) out[w.point] = w;
  return out;
}

// ---------------------------------------------------------------- guards

/** Why Next is disabled on this step (wording from the net), or null when it may go on. */
export function stepReason(doc: GardenDocument, run: PointRun, stepId: string, solve?: PhotoPointSolve): string | null {
  const step = pointNet.steps.find((s) => s.id === stepId);
  if (!step) return null;
  const r = step.reasons;
  const first = isFirstBasePoint(doc);
  switch (stepId) {
    case 'choose_type':
      return run.type ? null : r.no_type;
    case 'from_point':
      return first || run.from ? null : r.no_from;
    case 'offsets':
      return first || (run.northM != null && run.eastM != null) ? null : r.no_offsets;
    case 'diagonal': {
      // Always give an answer: a missing or failing diagonal is a warning, never a block.
      void first;
      return null;
    }
    case 'post': {
      if (!run.twoSleeve) return null;
      const s = run.separationM ?? POST_SEPARATION_DEFAULT_M;
      return s >= 0.3 && s <= 3 ? null : r.bad_separation;
    }
    case 'layer':
      return run.layer ? null : r.no_layer;
    case 'photos': {
      const live = livePhotos(doc, run);
      if (!live.length) return r.no_photos;
      return live.some((p) => p.autoSleeves === undefined && !p.clicks.length) ? r.uploading : null;
    }
    case 'solve':
      return solve && solve.cls !== 'none' ? null : r.not_solved;
    default:
      return null;
  }
}

/** Next: fire the current step (if its guard passes) and move to the following row. */
export function goNext(doc: GardenDocument, run: PointRun, solve?: PhotoPointSolve): { run: PointRun; reason?: string } {
  const reason = stepReason(doc, run, run.current, solve);
  if (reason) return { run, reason };
  if (!hasTokens(pointNet, unfireFrom(run.fired, run.current), run.current)) return { run, reason: t(pointNet, 'at_first_step') };
  const fired = fireStep(pointNet, run.fired, run.current, run.current === 'choose_type' ? run.type : undefined);
  const list = rows({ ...run, fired });
  const at = list.findIndex((s) => s.id === run.current);
  const next = list[at + 1]?.id ?? run.current;
  return { run: { ...run, fired, current: next } };
}

export function goBack(run: PointRun): PointRun {
  const list = rows(run);
  const at = list.findIndex((s) => s.id === run.current);
  return at > 0 ? { ...run, current: list[at - 1]!.id } : run;
}

/** Scroll settle: the user picked a row. Nothing else moves the roller. */
export function goTo(run: PointRun, stepId: string): PointRun {
  return rows(run).some((s) => s.id === stepId) ? { ...run, current: stepId } : run;
}

/** An input on a step changed: that step and later ones are no longer done. */
export function edit(run: PointRun, stepId: string, patch: Partial<PointRun>): PointRun {
  const next = { ...run, ...patch, fired: unfireFrom(run.fired, stepId) };
  if (stepId === 'choose_type' && patch.type && patch.type !== run.type) next.fired = [];
  return next;
}

// ---------------------------------------------------------------- saving

export function saveBasePoint(doc: GardenDocument, run: PointRun, now = new Date().toISOString()): { doc: GardenDocument; id: string } {
  const id = nextBaseId(doc);
  const grid: BaseGridDoc = doc.baseGrid ?? { points: [], ties: [] };
  const first = isFirstBasePoint(doc);
  const sep = run.twoSleeve ? run.separationM ?? POST_SEPARATION_DEFAULT_M : undefined;
  const points = [...grid.points.filter((p) => p.id !== id), { id, savedAt: now, ...(sep ? { postSeparationM: sep } : {}) }];
  const ties = first
    ? grid.ties
    : [...grid.ties, { id: `tie-${id}`, from: run.from!, to: id, northM: run.northM, eastM: run.eastM, diagonalM: run.diagonalM, savedAt: now }];
  const net = networkOf(ties);
  const xy = id === 'BAS01' ? { x: 0, y: 0 } : net?.points[id];
  const point = { id, kind: 'BL' as const, layerId: 'base', fixed: true, label: id, ...(xy ? { x: xy.x, y: xy.y } : {}) };
  const others = doc.points.filter((p) => p.id !== id);
  return { doc: { ...doc, baseGrid: { ...grid, points, ties }, points: [...others, point], updatedAt: now }, id };
}

export function newPhotoPointId(doc: GardenDocument, layer: PhotoLayer): string {
  const prefix = LAYER_KIND[layer];
  const n = doc.points.filter((p) => p.id.startsWith(prefix)).map((p) => Number(p.id.slice(prefix.length)) || 0);
  return `${prefix}${String((n.length ? Math.max(...n) : 0) + 1).padStart(2, '0')}`;
}

/** Make the photo point (no position yet) so photos can attach to it. */
export function ensurePhotoPoint(doc: GardenDocument, run: PointRun): { doc: GardenDocument; run: PointRun } {
  if (run.pointId && doc.points.some((p) => p.id === run.pointId)) return { doc, run };
  const layer = run.layer ?? 'boundary';
  const id = newPhotoPointId(doc, layer);
  return {
    doc: { ...doc, points: [...doc.points, { id, kind: LAYER_KIND[layer], layerId: layer, label: id, photoIds: [] }] },
    run: { ...run, pointId: id },
  };
}

/** A new photo landed: it fills the retake slot, or goes on the end. */
export function addRunPhoto(run: PointRun, photoId: string): PointRun {
  const ids = [...run.photoIds];
  if (run.retakeSlot != null && run.retakeSlot <= ids.length) ids.splice(run.retakeSlot, 0, photoId);
  else ids.push(photoId);
  return { ...unfireAfterPhotos(run), photoIds: ids, retakeSlot: undefined };
}

function unfireAfterPhotos(run: PointRun): PointRun {
  return isDone(run, 'photos') ? { ...run, fired: unfireFrom(run.fired, 'photos') } : run;
}

export function livePhotos(doc: GardenDocument, run: PointRun): Photo[] {
  return run.photoIds.map((id) => doc.photos.find((p) => p.id === id)).filter((p): p is Photo => !!p && !p.supersededAt);
}

/**
 * Retake one photo: it is superseded (kept on record) and queued for photos/archive/ by the
 * existing archive rules; the slot waits for the new photo. The roller does not move.
 */
export function retakePhoto(doc: GardenDocument, run: PointRun, photoId: string, now = new Date().toISOString()): { doc: GardenDocument; run: PointRun } {
  const slot = run.photoIds.indexOf(photoId);
  if (slot < 0) return { doc, run };
  return { doc: supersede(doc, [photoId], run.startedAt, now), run: { ...unfireAfterPhotos(run), photoIds: run.photoIds.filter((id) => id !== photoId), retakeSlot: slot } };
}

export function supersede(doc: GardenDocument, photoIds: string[], runStartedAt: string, now: string): GardenDocument {
  const jobs: ArchiveJob[] = [];
  const photos = doc.photos.map((p) => {
    if (!photoIds.includes(p.id) || p.supersededAt) return p;
    if (p.originalFile?.fileName) jobs.push({ photoId: p.id, fileName: p.originalFile.fileName, stepId: 'add-point', runStartedAt, supersededAt: now, reason: 'retake' });
    return { ...p, supersededAt: now };
  });
  const prior = doc.screenArchive ?? { pending: [], log: [] };
  return { ...doc, photos, screenArchive: { pending: [...prior.pending.filter((j) => !photoIds.includes(j.photoId)), ...jobs], log: prior.log } };
}

/** Cancel: an unsaved photo point and its photos go (photos to the archive). */
export function cancelRun(doc: GardenDocument, run: PointRun, now = new Date().toISOString()): GardenDocument {
  if (!run.pointId || isDone(run, 'save_photo')) return doc;
  const next = supersede(doc, run.photoIds, run.startedAt, now);
  return { ...next, points: next.points.filter((p) => p.id !== run.pointId) };
}

// ---------------------------------------------------------------- photo point solve

export interface PhotoPointSolve {
  cls: EdgeGate['cls'] | 'none';
  /** Why there is no result, or the gate's first reason. */
  message: string;
  seen: string[];
  x?: number;
  y?: number;
  ellipse95Mm?: number;
  twoPointFix?: boolean;
  /** Per photo, the base points it saw. */
  perPhoto: string[][];
}

export function photoPointSolve(doc: GardenDocument, run: PointRun): PhotoPointSolve {
  const photos = livePhotos(doc, run);
  const grid = baseGridOf(doc);
  const known = new Set(grid.ids);
  const perPhoto = photos.map((p) => [...new Set(p.clicks.map((c) => c.pointId).filter((id) => known.has(id)))]);
  const seen = [...new Set(perPhoto.flat())].sort();
  const none = (message: string): PhotoPointSolve => ({ cls: 'none', message, seen, perPhoto });
  if (!photos.length) return none(t(pointNet, 'seen_none'));
  const net = networkOf(grid.ties);
  if (!net || grid.ids.length < 3) return none(t(pointNet, 'needs_grid'));
  const circle = readProgress(doc).runs['circle-field-test'];
  const fx = circle ? calibrationFx(doc, circle) : undefined;
  if (!fx) return none(t(pointNet, 'needs_fx'));
  if (!seen.length) return none(t(pointNet, 'seen_none'));
  const ids = [...net.order];
  const control = [{ id: 'BAS01', x: 0, y: 0 }, ...ids.map((id) => ({ id, ...net.points[id]! }))].map((c) => ({ ...c, postSeparationM: grid.postSeparation[c.id] }));
  const sub = subCovariance(net, ids);
  const n = 2 * control.length;
  const cov = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i < 2 || j < 2 ? (i === j ? 1e-8 : 0) : sub[i - 2]![j - 2]!)));
  const tapped = new Set([...known, ...photos.flatMap((p) => p.clicks.map((c) => c.pointId))]);
  const edge = photos.map((p, i) => ({ pointId: `${run.pointId ?? 'P'}#${i + 1}`, sightings: sightingsFromPhoto(p, tapped, fx.fx).sightings }));
  const usable = edge.filter((e) => {
    const tied = e.sightings.filter((s) => known.has(s.id));
    return tied.length >= 3 || (tied.length === 2 && tied.every((s) => s.dyPx != null));
  });
  if (!usable.length) return none(seen.length <= 2 ? t(pointNet, 'two_seen_generic') : t(pointNet, 'seen_none'));
  const centre = control.reduce((s, c) => ({ x: s.x + c.x / control.length, y: s.y + c.y / control.length }), { x: 0, y: 0 });
  try {
    const input = { control, controlCovariance: cov, photos: usable, fx0: fx.fx, calibrationSigmaRel: fx.sigmaRel, searchCentre: centre, searchRadiusM: 30 };
    const res = adjustSession(input);
    const gates = gateEdgePoints(input, res);
    // A point pushed out of tolerance only by a base point's diagonal-warning scaling is amber, not red.
    if (net.warnings.some((w) => w.factor > 1) && gates.some((g) => g.cls === 'red')) {
      const raw = subCovariance({ ...net, covariance: net.covarianceUnscaled }, ids);
      const rawCov = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i < 2 || j < 2 ? (i === j ? 1e-8 : 0) : raw[i - 2]![j - 2]!)));
      const rawInput = { ...input, controlCovariance: rawCov };
      const rawGates = gateEdgePoints(rawInput, adjustSession(rawInput));
      gates.forEach((g, i) => { if (g.cls === 'red' && rawGates[i]?.cls !== 'red') g.cls = 'amber'; });
    }
    // One spot, several photos: weighted mean of the photo positions; best gate wins.
    const order = ['green', 'amber', 'red', 'grey'] as const;
    const best = [...gates].sort((a, b) => order.indexOf(a.cls) - order.indexOf(b.cls))[0]!;
    let sw = 0, sx = 0, sy = 0;
    res.photos.forEach((p) => {
      const w = 1 / Math.max(1e-6, p.cov[0]![0]! + p.cov[1]![1]!);
      sw += w; sx += w * p.x; sy += w * p.y;
    });
    return { cls: best.cls, message: best.reasons[0] ?? '', seen, x: sx / sw, y: sy / sw, ellipse95Mm: Math.round(best.ellipse95M * 1000), twoPointFix: best.twoPointFix, perPhoto };
  } catch (err) {
    return none((err as Error).message);
  }
}

export function savePhotoPoint(doc: GardenDocument, run: PointRun, solve: PhotoPointSolve): GardenDocument {
  if (!run.pointId) return doc;
  const photoIds = livePhotos(doc, run).map((p) => p.id);
  return {
    ...doc,
    points: doc.points.map((p) => (p.id === run.pointId ? { ...p, photoIds, ...(solve.x != null ? { x: solve.x, y: solve.y } : {}) } : p)),
    updatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- hints (advisory only)

export interface Hint {
  id: string;
  text: string;
}

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Gentle tips. Never a step and never blocks Next; each can be dismissed for this run. */
export function hintsFor(doc: GardenDocument, run: PointRun, solve?: PhotoPointSolve): Hint[] {
  const out: Hint[] = [];
  const grid = baseGridOf(doc);
  if (grid.ids.length < 3) out.push({ id: 'fewer_than_3', text: t(pointNet, 'fewer_than_3', { n: grid.ids.length }) });
  if (run.type === 'photo' && solve && solve.seen.length === 2) {
    const net = networkOf(grid.ties);
    const [a, b] = solve.seen;
    const pa = a === 'BAS01' ? { x: 0, y: 0 } : net?.points[a!];
    const pb = b === 'BAS01' ? { x: 0, y: 0 } : net?.points[b!];
    if (pa && pb) {
      // A third point off the line between the two seen ones: perpendicular, grid directions.
      const ang = Math.atan2(pb.x - pa.x, pb.y - pa.y) + Math.PI / 2;
      const dir = DIRS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8]!;
      out.push({ id: 'two_seen', text: t(pointNet, 'two_seen', { list: `${a}, ${b}`, dir: `grid ${dir} or ${DIRS[(DIRS.indexOf(dir) + 4) % 8]}` }) });
    } else out.push({ id: 'two_seen', text: t(pointNet, 'two_seen_generic') });
  }
  if (run.type === 'photo' && solve?.message && /danger|line/i.test(solve.message)) out.push({ id: 'bad_geometry', text: t(pointNet, 'bad_geometry') });
  return out.filter((h) => !run.dismissedHints.includes(h.id));
}
