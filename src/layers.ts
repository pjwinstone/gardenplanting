/** Layers + named objects (one level). Sticky + Point target. */

import type {
  Baseline,
  GardenDocument,
  GardenObject,
  GeometryType,
  LayerDef,
  PhotoClick,
  Point,
  PointKind,
} from './model';
import { fitCircle, fitRectangle, fitTriangleOutline } from './geometryFit';
import { placeholderThumb } from './model';
import {
  photoHasBaselineEnds,
  stationFromBaselineSighting,
} from './photoGeometry';

export type { GeometryType, LayerDef, GardenObject };

export const DEFAULT_LAYERS: LayerDef[] = [
  { id: 'walkway', name: 'Walkway', colour: '#6b8f71' },
  { id: 'structure', name: 'Structure', colour: '#3d3428' },
  { id: 'plants', name: 'Plants', colour: '#2f5d3a' },
  { id: 'survey', name: 'Survey', colour: '#1a5f7a' },
];

export const DEFAULT_LAYER_ID = 'walkway';
export const DEFAULT_GEOMETRY: GeometryType = 'circle';

export function ensureDefaultLayers(doc: GardenDocument): GardenDocument {
  if (doc.layers?.length) {
    return { ...doc, objects: doc.objects ?? [] };
  }
  return { ...doc, layers: DEFAULT_LAYERS.map((l) => ({ ...l })), objects: doc.objects ?? [] };
}

export function stickyLayer(doc: GardenDocument): LayerDef {
  const d = ensureDefaultLayers(doc);
  const id = d.session.stickyLayerId ?? DEFAULT_LAYER_ID;
  return d.layers.find((l) => l.id === id) ?? d.layers[0]!;
}

export function stickyObject(doc: GardenDocument): GardenObject | undefined {
  const id = doc.session.stickyObjectId;
  if (!id) return undefined;
  return (doc.objects ?? []).find((o) => o.id === id);
}

export function stickyGeometry(doc: GardenDocument): GeometryType {
  return doc.session.stickyGeometryType ?? DEFAULT_GEOMETRY;
}

export function objectsOnLayer(doc: GardenDocument, layerId: string): GardenObject[] {
  return (doc.objects ?? []).filter((o) => o.layerId === layerId);
}

/** Baselines sorted by trust (high first) for selectors and draw order. */
export function baselinesByTrust(doc: GardenDocument): Baseline[] {
  return [...doc.baselines].sort((a, b) => (b.trust ?? 50) - (a.trust ?? 50));
}

export function preferredBaseline(doc: GardenDocument): Baseline | undefined {
  if (doc.session.currentBaselineId) {
    const cur = doc.baselines.find((b) => b.id === doc.session.currentBaselineId);
    if (cur) return cur;
  }
  return baselinesByTrust(doc)[0];
}

export function setStickyPanel(
  doc: GardenDocument,
  partial: {
    stickyLayerId?: string;
    stickyObjectId?: string | null;
    stickyObjectName?: string;
    stickyGeometryType?: GeometryType;
    currentBaselineId?: string;
  },
): GardenDocument {
  const withLayers = ensureDefaultLayers(doc);
  const session = { ...withLayers.session };
  if (partial.stickyLayerId != null) session.stickyLayerId = partial.stickyLayerId;
  if (partial.stickyObjectId === null) session.stickyObjectId = undefined;
  else if (partial.stickyObjectId != null) session.stickyObjectId = partial.stickyObjectId;
  if (partial.stickyObjectName != null) session.stickyObjectName = partial.stickyObjectName;
  if (partial.stickyGeometryType != null) session.stickyGeometryType = partial.stickyGeometryType;
  if (partial.currentBaselineId != null) {
    session.currentBaselineId = partial.currentBaselineId;
    const bl = withLayers.baselines.find((b) => b.id === partial.currentBaselineId);
    if (bl) session.activeBaselineEnds = { a: bl.a, b: bl.b };
  }
  return { ...withLayers, session };
}

export function setBaselineTrust(
  doc: GardenDocument,
  baselineId: string,
  trust: number,
): GardenDocument {
  const clamped = Math.max(0, Math.min(100, Math.round(trust)));
  return {
    ...doc,
    baselines: doc.baselines.map((b) =>
      b.id === baselineId ? { ...b, trust: clamped } : b,
    ),
    session: {
      ...doc.session,
      lastAction: `Baseline ${baselineId} trust → ${clamped}`,
    },
  };
}

export function createObject(
  doc: GardenDocument,
  opts: { layerId: string; name: string; geometryType: GeometryType },
): { doc: GardenDocument; object: GardenObject } {
  const withLayers = ensureDefaultLayers(doc);
  const id = `obj-${Date.now().toString(36)}`;
  const object: GardenObject = {
    id,
    layerId: opts.layerId,
    name: opts.name.trim() || 'Untitled',
    geometryType: opts.geometryType,
    measuredPointIds: [],
    selectedPointIds: [],
  };
  const next: GardenDocument = {
    ...withLayers,
    objects: [...(withLayers.objects ?? []), object],
    session: {
      ...withLayers.session,
      stickyLayerId: opts.layerId,
      stickyObjectId: id,
      stickyObjectName: object.name,
      stickyGeometryType: opts.geometryType,
      lastAction: `Item “${object.name}” on ${opts.layerId}`,
    },
  };
  return { doc: next, object };
}

/** Create a user layer (UI: + Layer). */
export function createLayer(
  doc: GardenDocument,
  opts: { name?: string; colour?: string } = {},
): { doc: GardenDocument; layer: LayerDef } {
  const withLayers = ensureDefaultLayers(doc);
  const id = `layer-${Date.now().toString(36)}`;
  const layer: LayerDef = {
    id,
    name: opts.name?.trim() || `Layer ${withLayers.layers.length + 1}`,
    colour: opts.colour ?? '#6b8f71',
  };
  const next: GardenDocument = {
    ...withLayers,
    layers: [...withLayers.layers, layer],
    session: {
      ...withLayers.session,
      stickyLayerId: id,
      stickyObjectId: undefined,
      stickyObjectName: undefined,
      lastAction: `Layer “${layer.name}”`,
    },
  };
  return { doc: next, layer };
}

/** Active baseline ends (plan-picked). Falls back to preferred baseline. */
export function activeBaselineEnds(doc: GardenDocument): { a?: string; b?: string } {
  const ends = doc.session.activeBaselineEnds;
  if (ends?.a || ends?.b) return { a: ends.a, b: ends.b };
  const bl = preferredBaseline(doc);
  if (bl) return { a: bl.a, b: bl.b };
  return {};
}

export function activeBaselineLabel(doc: GardenDocument): string {
  const bl = preferredBaseline(doc);
  if (bl) {
    const trust = bl.trust ?? 50;
    const used = bl.usedForMeasurementCount ?? 0;
    return `${bl.a}–${bl.b} (trust ${trust}${used ? `, used ×${used}` : ''})`;
  }
  const { a, b } = activeBaselineEnds(doc);
  if (a && b) return `${a}–${b}`;
  if (a) return `${a} (pick second end)`;
  return 'none — establish or tap two points';
}

/** Click a plan point: inspect measurement, or (shift path) set baseline — default inspect. */
export function pickActiveBaselineEnd(doc: GardenDocument, pointId: string): GardenDocument {
  const ends = { ...(doc.session.activeBaselineEnds ?? {}) };
  if (!ends.a || (ends.a && ends.b)) {
    ends.a = pointId;
    ends.b = undefined;
  } else if (ends.a === pointId) {
    return doc;
  } else {
    ends.b = pointId;
  }

  let currentBaselineId = doc.session.currentBaselineId;
  if (ends.a && ends.b) {
    const match = doc.baselines.find(
      (b) =>
        (b.a === ends.a && b.b === ends.b) || (b.a === ends.b && b.b === ends.a),
    );
    if (match) currentBaselineId = match.id;
  }

  return {
    ...doc,
    session: {
      ...doc.session,
      activeBaselineEnds: ends,
      currentBaselineId,
      lastAction:
        ends.a && ends.b
          ? `Active baseline ${ends.a}–${ends.b} (Adjust can still refit later)`
          : `Active baseline end A = ${ends.a} — tap another point for B`,
    },
  };
}

/**
 * Add photo / + Point measurement: place or update a point on the sticky object
 * using the chosen baseline; bump baseline use + trust slightly.
 */
export function addPhotoMeasurement(
  doc: GardenDocument,
  opts: {
    label?: string;
    thumbnailDataUrl?: string;
    width?: number;
    height?: number;
  } = {},
): { doc: GardenDocument; point: Point; reason?: string } {
  let next = ensureDefaultLayers(doc);
  const layerId = next.session.stickyLayerId ?? DEFAULT_LAYER_ID;
  const geometryType = stickyGeometry(next);
  const objectName =
    next.session.stickyObjectName?.trim() || stickyObject(next)?.name || 'Path';

  let obj = stickyObject(next);
  if (!obj) {
    const created = createObject(next, {
      layerId,
      name: objectName,
      geometryType,
    });
    next = created.doc;
    obj = created.object;
  } else if (obj.name !== objectName || obj.geometryType !== geometryType || obj.layerId !== layerId) {
    // Sync sticky name/geometry/layer onto the object
    next = {
      ...next,
      objects: (next.objects ?? []).map((o) =>
        o.id === obj!.id
          ? { ...o, name: objectName, geometryType, layerId }
          : o,
      ),
    };
    obj = (next.objects ?? []).find((o) => o.id === obj!.id)!;
  }

  const bl = preferredBaseline(next);
  if (!bl && !activeBaselineEnds(next).a) {
    return {
      doc: next,
      point: { id: '', kind: 'OCC' },
      reason: 'Choose a baseline first (or establish one).',
    };
  }

  const n = obj.measuredPointIds.length + 1;
  const id = `P${String(n).padStart(2, '0')}-${obj.id.slice(-4).toUpperCase()}`;
  const kind: PointKind = 'OCC';
  const coords = estimateNextPointCoords(next, obj);
  const photoId = `ph-${Date.now().toString(36)}`;
  const setupId = next.session.currentSetupId ?? next.setups[0]?.id ?? 'setup-1';
  if (!next.setups.length) {
    next = {
      ...next,
      setups: [
        {
          id: setupId,
          startedAt: new Date().toISOString(),
          liveRodIds: bl ? [bl.a, bl.b] : [],
          closed: false,
        },
      ],
      session: { ...next.session, currentSetupId: setupId },
    };
  }

  const point: Point = {
    id,
    kind,
    x: coords.x,
    y: coords.y,
    label: opts.label?.trim() || `${obj.name} ${n}`,
    layerId,
    objectId: obj.id,
    measuredWithBaselineId: bl?.id,
    photoIds: [photoId],
  };

  const hasRealThumb = Boolean(opts.thumbnailDataUrl?.startsWith('data:image/'));
  const photo = {
    id: photoId,
    setupId,
    addPointId: id,
    width: opts.width && opts.width > 0 ? opts.width : 1200,
    height: opts.height && opts.height > 0 ? opts.height : 900,
    clicks: [] as PhotoClick[],
    sightedBaselineId: bl?.id,
    estimate: { x: coords.x, y: coords.y },
    thumbnailDataUrl: hasRealThumb ? opts.thumbnailDataUrl! : placeholderThumb('#1a5f7a'),
    note: hasRealThumb
      ? `Provisional ${id} off baseline ${bl ? `${bl.a}–${bl.b}` : '(ends)'} — mark A/B on photo`
      : `Provisional ${id} off baseline ${bl ? `${bl.a}–${bl.b}` : '(ends)'}`,
  };

  const objects = (next.objects ?? []).map((o) => {
    if (o.id !== obj!.id) return o;
    const measuredPointIds = [...o.measuredPointIds, id];
    const selectedPointIds = [...o.selectedPointIds, id];
    const updated: GardenObject = {
      ...o,
      name: objectName,
      geometryType,
      layerId,
      measuredPointIds,
      selectedPointIds,
    };
    return refitObject(next, updated, [...next.points, point]);
  });

  const baselines = next.baselines.map((b) => {
    if (!bl || b.id !== bl.id) return b;
    const used = (b.usedForMeasurementCount ?? 0) + 1;
    const trust = Math.min(100, (b.trust ?? 50) + 2);
    return { ...b, usedForMeasurementCount: used, trust };
  });

  next = {
    ...next,
    points: [...next.points, point],
    photos: [...next.photos, photo],
    objects,
    baselines,
    session: {
      ...next.session,
      mode: 'ADD_POINT',
      stickyLayerId: layerId,
      stickyObjectId: obj.id,
      stickyObjectName: objectName,
      stickyGeometryType: geometryType,
      currentAddPointId: id,
      currentBaselineId: bl?.id ?? next.session.currentBaselineId,
      lastAction: `+ Point → ${id} on ${layerId}/${objectName} (${geometryType})`,
      geometryOk: true,
      lastResidualMm: objects.find((o) => o.id === obj!.id)?.residualMm,
      inspectingPointId: undefined,
      selectedPhotoId: photoId,
    },
  };
  return { doc: next, point };
}

/** @deprecated alias — prefer addPhotoMeasurement */
export function appendAddPoint(
  doc: GardenDocument,
  opts: { label?: string; thumbnailDataUrl?: string } = {},
): { doc: GardenDocument; point: Point; reason?: string } {
  return addPhotoMeasurement(doc, opts);
}

/**
 * Remove a measured point and its photos from the garden.
 * Refuses if the point is a baseline end (would orphan control).
 */
export function deletePointMeasurement(
  doc: GardenDocument,
  pointId: string,
): { doc: GardenDocument; reason?: string } {
  let next = ensureDefaultLayers(doc);
  const point = next.points.find((p) => p.id === pointId);
  if (!point) {
    return { doc: next, reason: `Point ${pointId} is not in the garden.` };
  }

  const usedAsBaselineEnd = next.baselines.some((b) => b.a === pointId || b.b === pointId);
  if (usedAsBaselineEnd) {
    return {
      doc: next,
      reason: `Cannot delete ${pointId} — it is a baseline end. Change the baseline first.`,
    };
  }

  const active = next.session.activeBaselineEnds;
  if (active?.a === pointId || active?.b === pointId) {
    return {
      doc: next,
      reason: `Cannot delete ${pointId} — it is an active baseline end.`,
    };
  }

  const photoIdSet = new Set(point.photoIds ?? []);
  const remainingPoints = next.points.filter((p) => p.id !== pointId);
  const remainingPhotos = next.photos.filter(
    (ph) => !photoIdSet.has(ph.id) && ph.addPointId !== pointId,
  );
  const remainingObs = next.observations.filter(
    (o) => o.photoId == null || !photoIdSet.has(o.photoId),
  ).filter((o) => !(o.pointIds ?? []).includes(pointId));

  const objects = (next.objects ?? []).map((o) => {
    if (!o.measuredPointIds.includes(pointId) && !o.selectedPointIds.includes(pointId)) {
      return o;
    }
    const updated = {
      ...o,
      measuredPointIds: o.measuredPointIds.filter((id) => id !== pointId),
      selectedPointIds: o.selectedPointIds.filter((id) => id !== pointId),
    };
    return refitObject(next, updated, remainingPoints);
  });

  next = {
    ...next,
    points: remainingPoints,
    photos: remainingPhotos,
    observations: remainingObs,
    objects,
    session: {
      ...next.session,
      inspectingPointId: undefined,
      currentAddPointId:
        next.session.currentAddPointId === pointId ? undefined : next.session.currentAddPointId,
      lastAction: `Deleted point ${pointId}`,
      mode: 'MENU',
    },
  };
  return { doc: next };
}

/** Attach a real photo thumbnail to an existing measured point (inspect / + Photo path). */
export function appendPhotoToPoint(
  doc: GardenDocument,
  pointId: string,
  opts: {
    thumbnailDataUrl: string;
    yawOnly?: boolean;
    width?: number;
    height?: number;
  },
): { doc: GardenDocument; reason?: string } {
  let next = ensureDefaultLayers(doc);
  const point = next.points.find((p) => p.id === pointId);
  if (!point) {
    return { doc: next, reason: `Point ${pointId} is not in the garden.` };
  }
  if (!opts.thumbnailDataUrl.startsWith('data:image/')) {
    return { doc: next, reason: 'Photo capture did not produce an image.' };
  }

  const photoId = `ph-${Date.now().toString(36)}`;
  const setupId = next.session.currentSetupId ?? next.setups[0]?.id ?? 'setup-1';
  const yawOnly = Boolean(opts.yawOnly);
  const priorIds = point.photoIds ?? [];
  const estimate = estimatePhotoContribution(point, priorIds.length);
  const bl = preferredBaseline(next);
  const photo = {
    id: photoId,
    setupId,
    addPointId: pointId,
    yawOnly,
    width: opts.width && opts.width > 0 ? opts.width : 1200,
    height: opts.height && opts.height > 0 ? opts.height : 900,
    clicks: [] as PhotoClick[],
    sightedBaselineId: bl?.id ?? point.measuredWithBaselineId,
    estimate,
    thumbnailDataUrl: opts.thumbnailDataUrl,
    note: yawOnly
      ? `+ Photo (yaw) for ${pointId} — mark A/B on photo`
      : `Photo for ${pointId} — mark A/B on photo`,
  };

  const photoIds = [...priorIds, photoId];
  const photos = [...next.photos, photo];
  const avg = averageEstimateFromPhotos(photos, photoIds, point);

  next = {
    ...next,
    photos,
    points: next.points.map((p) =>
      p.id === pointId
        ? { ...p, photoIds, x: avg.x, y: avg.y }
        : p,
    ),
    session: {
      ...next.session,
      inspectingPointId: pointId,
      currentAddPointId: pointId,
      selectedPhotoId: photoId,
      mode: yawOnly ? 'ADD_POINT_EXTRA_YAW' : next.session.mode,
      lastAction: yawOnly ? `+ Photo (yaw) → ${pointId}` : `Photo added to ${pointId}`,
    },
  };
  return { doc: next };
}

/**
 * Persist mark clicks on a photo. When both baseline ends are confirmed, place the
 * linked OCC point as the **camera station** (phone position). A third “target”
 * click is stored but does not invent world coords (needs distance / 2nd sighting).
 */
export function applyPhotoMarks(
  doc: GardenDocument,
  photoId: string,
  clicks: PhotoClick[],
  opts: { sightedBaselineId?: string; side?: 1 | -1 } = {},
): {
  doc: GardenDocument;
  reason?: string;
  stationApplied?: boolean;
  message: string;
} {
  let next = ensureDefaultLayers(doc);
  const photo = next.photos.find((p) => p.id === photoId);
  if (!photo) {
    return { doc: next, reason: 'Photo not found.', message: 'Photo not found.' };
  }

  const bl =
    next.baselines.find((b) => b.id === (opts.sightedBaselineId ?? photo.sightedBaselineId)) ??
    preferredBaseline(next);
  if (!bl) {
    return {
      doc: next,
      reason: 'No baseline to assign marks to.',
      message: 'Establish a baseline before marking ends on the photo.',
    };
  }

  // Normalize role aliases A/B → real end ids; keep TARGET / other ids as-is.
  const normalized = clicks.map((c) => {
    const role = c.pointId.trim().toUpperCase();
    if (role === 'A' || role === 'END-A' || role === 'BL-A') {
      return { ...c, pointId: bl.a };
    }
    if (role === 'B' || role === 'END-B' || role === 'BL-B') {
      return { ...c, pointId: bl.b };
    }
    return c;
  });

  // One click per mark id (last wins).
  const byId = new Map<string, PhotoClick>();
  for (const c of normalized) byId.set(c.pointId, c);
  const nextClicks = [...byId.values()];

  const hasTarget = nextClicks.some(
    (c) => c.pointId !== bl.a && c.pointId !== bl.b,
  );

  let stationApplied = false;
  let message = `Saved ${nextClicks.length} mark(s) on photo (baseline ${bl.a}–${bl.b}).`;
  let pose: { x: number; y: number; yawRad: number } | undefined;
  let estimate = photo.estimate;

  const draftPhoto = { ...photo, clicks: nextClicks, sightedBaselineId: bl.id };
  if (photoHasBaselineEnds(draftPhoto, bl.a, bl.b)) {
    const side = opts.side ?? guessStationSide(next, bl);
    const station = stationFromBaselineSighting(draftPhoto, next.points, bl.a, bl.b, side);
    if (station) {
      pose = station;
      estimate = { x: station.x, y: station.y };
      stationApplied = true;
      message = `Station from baseline ${bl.a}–${bl.b} — point is the camera position.`;
      if (hasTarget) {
        message +=
          ' Extra mark saved; a separate object point needs a second sighting or a tape distance.';
      }
    } else {
      message =
        'A and B marked, but could not solve station (check baseline ends have coordinates).';
    }
  } else {
    message = `Saved marks — tap both baseline ends (${bl.a} and ${bl.b}) to place the camera station.`;
    if (hasTarget) {
      message +=
        ' A third mark alone cannot place a far target from one photo.';
    }
  }

  const pointId = photo.addPointId;
  const updatedPhotos = next.photos.map((p) =>
    p.id === photoId
      ? {
          ...p,
          clicks: nextClicks,
          sightedBaselineId: bl.id,
          estimate,
          pose,
          note: stationApplied
            ? `Station via ${bl.a}–${bl.b} sighting`
            : (p.note ?? `Marks on ${photoId}`),
        }
      : p,
  );

  let updatedPoints = next.points;
  if (pointId) {
    updatedPoints = next.points.map((p) => {
      if (p.id !== pointId) return p;
      if (!stationApplied || !estimate) {
        return { ...p, measuredWithBaselineId: bl.id };
      }
      const avg = averageEstimateFromPhotos(updatedPhotos, p.photoIds ?? [], p);
      return {
        ...p,
        x: avg.x,
        y: avg.y,
        measuredWithBaselineId: bl.id,
      };
    });
  }

  next = {
    ...next,
    photos: updatedPhotos,
    points: updatedPoints,
    session: {
      ...next.session,
      selectedPhotoId: photoId,
      currentBaselineId: bl.id,
      lastAction: message,
    },
  };

  return { doc: next, stationApplied, message };
}

/** Prefer the side already used by OCC points for this baseline / layer. */
function guessStationSide(doc: GardenDocument, bl: Baseline): 1 | -1 {
  const a = doc.points.find((p) => p.id === bl.a);
  const b = doc.points.find((p) => p.id === bl.b);
  if (a?.x == null || a.y == null || b?.x == null || b.y == null) return 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  let pos = 0;
  let neg = 0;
  for (const p of doc.points) {
    if (p.kind !== 'OCC' && p.kind !== 'BED' && p.kind !== 'TRK') continue;
    if (p.x == null || p.y == null) continue;
    const d = (p.x - a.x) * nx + (p.y - a.y) * ny;
    if (d > 0.2) pos += 1;
    else if (d < -0.2) neg += 1;
  }
  if (neg > pos) return -1;
  return 1;
}

/** Remove one photo from a point; re-average remaining estimates onto the point. */
export function deletePhotoFromPoint(
  doc: GardenDocument,
  pointId: string,
  photoId: string,
): { doc: GardenDocument; reason?: string } {
  let next = ensureDefaultLayers(doc);
  const point = next.points.find((p) => p.id === pointId);
  if (!point) {
    return { doc: next, reason: `Point ${pointId} is not in the garden.` };
  }
  const photoIds = (point.photoIds ?? []).filter((id) => id !== photoId);
  if (photoIds.length === (point.photoIds ?? []).length) {
    return { doc: next, reason: 'Photo is not on this point.' };
  }
  if (!photoIds.length) {
    return {
      doc: next,
      reason: 'Keep at least one photo, or delete the point.',
    };
  }

  const photos = next.photos.filter((ph) => ph.id !== photoId);
  const avg = averageEstimateFromPhotos(photos, photoIds, point);
  const nextSelected =
    next.session.selectedPhotoId === photoId
      ? photoIds[photoIds.length - 1]
      : next.session.selectedPhotoId;

  next = {
    ...next,
    photos,
    points: next.points.map((p) =>
      p.id === pointId ? { ...p, photoIds, x: avg.x, y: avg.y } : p,
    ),
    session: {
      ...next.session,
      inspectingPointId: pointId,
      selectedPhotoId: nextSelected,
      lastAction: `Deleted photo ${photoId} from ${pointId}`,
    },
  };
  return { doc: next };
}

/** Small per-photo scatter until real resection writes clicks (metres). */
export function estimatePhotoContribution(
  point: Point,
  index: number,
): { x: number; y: number } {
  const baseX = point.x ?? 0;
  const baseY = point.y ?? 0;
  if (index <= 0) return { x: baseX, y: baseY };
  const angle = index * 1.75;
  const r = 0.06 + index * 0.035;
  return { x: baseX + r * Math.cos(angle), y: baseY + r * Math.sin(angle) };
}

export function photoEstimateAt(
  photo: { estimate?: { x: number; y: number }; id: string },
  point: Point,
  index: number,
): { x: number; y: number } {
  if (photo.estimate && Number.isFinite(photo.estimate.x) && Number.isFinite(photo.estimate.y)) {
    return photo.estimate;
  }
  return estimatePhotoContribution(point, index);
}

export function averageEstimateFromPhotos(
  photos: { id: string; estimate?: { x: number; y: number } }[],
  photoIds: string[],
  point: Point,
): { x: number; y: number } {
  const estimates = photoIds
    .map((id, i) => {
      const ph = photos.find((p) => p.id === id);
      return ph ? photoEstimateAt(ph, point, i) : null;
    })
    .filter((e): e is { x: number; y: number } => !!e);
  if (!estimates.length) {
    return { x: point.x ?? 0, y: point.y ?? 0 };
  }
  const x = estimates.reduce((s, e) => s + e.x, 0) / estimates.length;
  const y = estimates.reduce((s, e) => s + e.y, 0) / estimates.length;
  return { x, y };
}

/**
 * Delete an item (GardenObject) and cascade its measured points/photos.
 * Model still uses `objects` internally; UI calls this “Item”.
 */
export function deleteObjectMeasurement(
  doc: GardenDocument,
  objectId: string,
): { doc: GardenDocument; reason?: string } {
  let next = ensureDefaultLayers(doc);
  const obj = (next.objects ?? []).find((o) => o.id === objectId);
  if (!obj) {
    return { doc: next, reason: 'Item is not in the garden.' };
  }

  for (const pid of [...obj.measuredPointIds]) {
    const result = deletePointMeasurement(next, pid);
    if (result.reason && next.points.some((p) => p.id === pid)) {
      return { doc: next, reason: result.reason };
    }
    next = result.doc;
  }

  const wasSticky = next.session.stickyObjectId === objectId;
  next = {
    ...next,
    objects: (next.objects ?? []).filter((o) => o.id !== objectId),
    session: {
      ...next.session,
      stickyObjectId: wasSticky ? undefined : next.session.stickyObjectId,
      stickyObjectName: wasSticky ? undefined : next.session.stickyObjectName,
      inspectingPointId: undefined,
      currentAddPointId:
        next.session.currentAddPointId &&
        !(obj.measuredPointIds.includes(next.session.currentAddPointId))
          ? next.session.currentAddPointId
          : undefined,
      lastAction: `Deleted item “${obj.name}”`,
      // Leave ADD_POINT so the floating dialog can stay open in a neutral add state.
      mode: 'ADD_POINT',
    },
  };
  return { doc: next };
}

/** Delete a layer and cascade its items (and their points). Keep ≥1 layer. */
export function deleteLayerMeasurement(
  doc: GardenDocument,
  layerId: string,
): { doc: GardenDocument; reason?: string } {
  let next = ensureDefaultLayers(doc);
  if (next.layers.length <= 1) {
    return { doc: next, reason: 'Keep at least one layer.' };
  }
  if (!next.layers.some((l) => l.id === layerId)) {
    return { doc: next, reason: 'Layer is not in the garden.' };
  }

  const items = objectsOnLayer(next, layerId);
  for (const item of items) {
    const result = deleteObjectMeasurement(next, item.id);
    if (result.reason) {
      return { doc: next, reason: result.reason };
    }
    next = result.doc;
  }

  const remaining = next.layers.filter((l) => l.id !== layerId);
  const fallback = remaining[0]!;
  const wasSticky = next.session.stickyLayerId === layerId;
  next = {
    ...next,
    layers: remaining,
    session: {
      ...next.session,
      stickyLayerId: wasSticky ? fallback.id : next.session.stickyLayerId,
      stickyObjectId: wasSticky ? undefined : next.session.stickyObjectId,
      stickyObjectName: wasSticky ? undefined : next.session.stickyObjectName,
      inspectingPointId: undefined,
      currentAddPointId: wasSticky ? undefined : next.session.currentAddPointId,
      lastAction: `Deleted layer “${layerId}”`,
      mode: 'ADD_POINT',
    },
  };
  return { doc: next };
}

type BaselineFrame = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  len: number;
  /** Unit along A→B. */
  ux: number;
  uy: number;
  /** Unit left-normal of A→B (points on +side of the directed segment). */
  nx: number;
  ny: number;
};

function baselineFrameFromEnds(doc: GardenDocument): BaselineFrame | null {
  const ends = activeBaselineEnds(doc);
  const a = ends.a ? doc.points.find((p) => p.id === ends.a) : undefined;
  const b = ends.b ? doc.points.find((p) => p.id === ends.b) : undefined;
  if (a?.x == null || a.y == null || b?.x == null || b.y == null) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return null;
  const ux = dx / len;
  const uy = dy / len;
  // Left normal when walking A→B.
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y, len, ux, uy, nx: -uy, ny: ux };
}

/** Signed distance to the infinite A–B line (metres); + = left of A→B. */
function signedDistToBaseline(x: number, y: number, f: BaselineFrame): number {
  return (x - f.ax) * f.nx + (y - f.ay) * f.ny;
}

function sideSign(x: number, y: number, f: BaselineFrame): 1 | -1 | 0 {
  const d = signedDistToBaseline(x, y, f);
  if (Math.abs(d) < 0.05) return 0; // on / nearly on the line
  return d > 0 ? 1 : -1;
}

/** Majority side of points vs baseline; ties → 0. */
function majoritySide(points: Point[], f: BaselineFrame): 1 | -1 | 0 {
  let pos = 0;
  let neg = 0;
  for (const p of points) {
    if (p.x == null || p.y == null) continue;
    const s = sideSign(p.x, p.y, f);
    if (s > 0) pos += 1;
    else if (s < 0) neg += 1;
  }
  if (pos === neg) return 0;
  return pos > neg ? 1 : -1;
}

/**
 * Provisional OCC placement for + Point / camera-first until photo clicks resect.
 * Never sits on the baseline segment: always a clear perpendicular offset on a
 * consistent side (item majority → layer mates → last point → default left of A→B).
 */
export function estimateNextPointCoords(
  doc: GardenDocument,
  obj: GardenObject,
): { x: number; y: number } {
  const frame = baselineFrameFromEnds(doc);
  const measured = obj.measuredPointIds
    .map((id) => doc.points.find((p) => p.id === id))
    .filter((p): p is Point => !!p && p.x != null && p.y != null);

  const layerId = obj.layerId;
  const layerMates = doc.points.filter(
    (p) =>
      p.layerId === layerId &&
      p.x != null &&
      p.y != null &&
      (p.kind === 'OCC' || p.kind === 'BED' || p.kind === 'TRK') &&
      !obj.measuredPointIds.includes(p.id),
  );

  const minOff = frame ? Math.max(1.5, frame.len * 0.2) : 2.5;
  const step = frame ? Math.max(0.8, frame.len * 0.12) : 1.0;

  let side: 1 | -1 = 1;
  if (frame) {
    const fromItem = majoritySide(measured, frame);
    const fromLayer = majoritySide(layerMates, frame);
    const last = measured[measured.length - 1];
    const fromLast =
      last?.x != null && last.y != null ? sideSign(last.x, last.y, frame) : 0;
    if (fromItem !== 0) side = fromItem;
    else if (fromLast !== 0) side = fromLast;
    else if (fromLayer !== 0) side = fromLayer;
  }

  let x: number;
  let y: number;

  if (frame && measured.length) {
    const last = measured[measured.length - 1]!;
    const along = (last.x! - frame.ax) * frame.ux + (last.y! - frame.ay) * frame.uy;
    const nextAlong = along + step;
    x = frame.ax + frame.ux * nextAlong + frame.nx * side * minOff;
    y = frame.ay + frame.uy * nextAlong + frame.ny * side * minOff;
  } else if (frame) {
    const mx = (frame.ax + frame.bx) / 2;
    const my = (frame.ay + frame.by) / 2;
    x = mx + frame.nx * side * minOff;
    y = my + frame.ny * side * minOff;
  } else if (measured.length) {
    const last = measured[measured.length - 1]!;
    x = last.x! + step;
    y = last.y! + minOff;
  } else {
    const ends = activeBaselineEnds(doc);
    const a = ends.a ? doc.points.find((p) => p.id === ends.a) : undefined;
    if (a?.x != null && a.y != null) {
      x = a.x + 1.5;
      y = a.y + minOff;
    } else {
      x = 2;
      y = minOff;
    }
  }

  // Final guard: never leave a provisional OCC on/near the baseline segment.
  if (frame) {
    const dist = signedDistToBaseline(x, y, frame);
    if (Math.abs(dist) < minOff * 0.85) {
      const along = (x - frame.ax) * frame.ux + (y - frame.ay) * frame.uy;
      const useSide: 1 | -1 = dist === 0 ? side : dist > 0 ? 1 : -1;
      x = frame.ax + frame.ux * along + frame.nx * useSide * minOff;
      y = frame.ay + frame.uy * along + frame.ny * useSide * minOff;
    }
  }

  return { x, y };
}

export function refitObject(
  doc: GardenDocument,
  obj: GardenObject,
  points: Point[] = doc.points,
): GardenObject {
  const selected = obj.selectedPointIds.length ? obj.selectedPointIds : obj.measuredPointIds;
  const pts = selected
    .map((id) => points.find((p) => p.id === id))
    .filter((p): p is Point => !!p && p.x != null && p.y != null)
    .map((p) => ({ id: p.id, x: p.x!, y: p.y! }));

  if (obj.geometryType === 'circle' && pts.length >= 3) {
    const fit = fitCircle(pts);
    if (fit) {
      return {
        ...obj,
        solvedCircle: fit.circle,
        solvedRectangle: undefined,
        solvedPolygonIds: undefined,
        residualMm: fit.residualMm,
      };
    }
  }
  if (obj.geometryType === 'square' && pts.length >= 2) {
    const fit = fitRectangle(pts);
    if (fit) {
      return {
        ...obj,
        solvedRectangle: fit.rect,
        solvedCircle: undefined,
        solvedPolygonIds: undefined,
        residualMm: fit.residualMm,
      };
    }
  }
  if (obj.geometryType === 'triangle' && pts.length >= 3) {
    const fit = fitTriangleOutline(pts);
    if (fit) {
      return {
        ...obj,
        solvedPolygonIds: fit.ids,
        solvedCircle: undefined,
        solvedRectangle: undefined,
        residualMm: fit.residualMm,
      };
    }
  }
  if (obj.geometryType === 'irregular_polygon' && pts.length >= 2) {
    return {
      ...obj,
      solvedPolygonIds: pts.map((p) => p.id),
      solvedCircle: undefined,
      solvedRectangle: undefined,
      residualMm: undefined,
    };
  }
  return {
    ...obj,
    solvedCircle: undefined,
    solvedRectangle: undefined,
    solvedPolygonIds: undefined,
    residualMm: undefined,
  };
}

export function updatePointMeasurement(
  doc: GardenDocument,
  pointId: string,
  partial: {
    layerId?: string;
    objectId?: string;
    objectName?: string;
    geometryType?: GeometryType;
    measuredWithBaselineId?: string;
  },
): GardenDocument {
  let next = ensureDefaultLayers(doc);
  const point = next.points.find((p) => p.id === pointId);
  if (!point) return next;

  const layerId = partial.layerId ?? point.layerId ?? DEFAULT_LAYER_ID;
  let objectId = partial.objectId ?? point.objectId;
  const geometryType = partial.geometryType ?? stickyGeometry(next);
  const objectName = partial.objectName?.trim();

  if (!objectId && objectName) {
    const created = createObject(next, { layerId, name: objectName, geometryType });
    next = created.doc;
    objectId = created.object.id;
  }

  next = {
    ...next,
    points: next.points.map((p) =>
      p.id === pointId
        ? {
            ...p,
            layerId,
            objectId,
            measuredWithBaselineId:
              partial.measuredWithBaselineId ?? p.measuredWithBaselineId,
          }
        : p,
    ),
    objects: (next.objects ?? []).map((o) => {
      if (objectId && o.id === objectId) {
        let measuredPointIds = o.measuredPointIds.includes(pointId)
          ? o.measuredPointIds
          : [...o.measuredPointIds, pointId];
        let selectedPointIds = o.selectedPointIds.includes(pointId)
          ? o.selectedPointIds
          : [...o.selectedPointIds, pointId];
        const updated: GardenObject = {
          ...o,
          name: objectName ?? o.name,
          geometryType: partial.geometryType ?? o.geometryType,
          layerId,
          measuredPointIds,
          selectedPointIds,
        };
        return refitObject(next, updated, next.points);
      }
      // Remove from other objects if moved
      if (objectId && o.measuredPointIds.includes(pointId) && o.id !== objectId) {
        return {
          ...o,
          measuredPointIds: o.measuredPointIds.filter((id) => id !== pointId),
          selectedPointIds: o.selectedPointIds.filter((id) => id !== pointId),
        };
      }
      return o;
    }),
    session: {
      ...next.session,
      stickyLayerId: layerId,
      stickyObjectId: objectId,
      stickyObjectName: objectName ?? next.session.stickyObjectName,
      stickyGeometryType: partial.geometryType ?? next.session.stickyGeometryType,
      currentBaselineId:
        partial.measuredWithBaselineId ?? next.session.currentBaselineId,
      lastAction: `Updated measurement for ${pointId}`,
    },
  };
  return next;
}

export function stickyChipLabel(doc: GardenDocument): string {
  const layer = stickyLayer(doc);
  const obj = stickyObject(doc);
  const geo = stickyGeometry(doc);
  if (!obj) return `${layer.name} / ${doc.session.stickyObjectName ?? 'new'} (${geo})`;
  return `${layer.name} / ${obj.name} (${geo})`;
}
