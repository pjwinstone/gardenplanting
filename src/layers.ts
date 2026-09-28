/** Layers + named objects (one level). Sticky + Point target. */

import type {
  Baseline,
  GardenDocument,
  GardenObject,
  GeometryType,
  LayerDef,
  Point,
  PointKind,
} from './model';
import { fitCircle, fitRectangle, fitTriangleOutline } from './geometryFit';
import { placeholderThumb } from './model';

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
      lastAction: `Object “${object.name}” on ${opts.layerId}`,
    },
  };
  return { doc: next, object };
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
  opts: { label?: string } = {},
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

  const photo = {
    id: photoId,
    setupId,
    addPointId: id,
    width: 1200,
    height: 900,
    clicks: [],
    thumbnailDataUrl: placeholderThumb('#1a5f7a'),
    note: `Add photo for ${id} via ${bl ? `${bl.a}–${bl.b}` : 'active ends'}`,
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
      lastAction: `Add photo → ${id} on ${layerId}/${objectName} (${geometryType})`,
      geometryOk: true,
      lastResidualMm: objects.find((o) => o.id === obj!.id)?.residualMm,
      inspectingPointId: undefined,
    },
  };
  return { doc: next, point };
}

/** @deprecated alias — prefer addPhotoMeasurement */
export function appendAddPoint(
  doc: GardenDocument,
  opts: { label?: string } = {},
): { doc: GardenDocument; point: Point; reason?: string } {
  return addPhotoMeasurement(doc, opts);
}

function estimateNextPointCoords(
  doc: GardenDocument,
  obj: GardenObject,
): { x: number; y: number } {
  const ends = activeBaselineEnds(doc);
  const a = ends.a ? doc.points.find((p) => p.id === ends.a) : undefined;
  const b = ends.b ? doc.points.find((p) => p.id === ends.b) : undefined;
  const measured = obj.measuredPointIds
    .map((id) => doc.points.find((p) => p.id === id))
    .filter((p): p is Point => !!p && p.x != null && p.y != null);

  if (measured.length) {
    const last = measured[measured.length - 1]!;
    const angle = measured.length * 0.9;
    const r = 0.6 + measured.length * 0.35;
    return { x: last.x! + r * Math.cos(angle), y: last.y! + r * Math.sin(angle) };
  }
  if (a?.x != null && a.y != null && b?.x != null && b.y != null) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: mx - (dy / len) * 2.5, y: my + (dx / len) * 2.5 };
  }
  if (a?.x != null && a.y != null) return { x: a.x + 1.5, y: a.y + 1.5 };
  return { x: 2, y: 3 };
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
