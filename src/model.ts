/** Garden Planting document model — points, baselines, layers/objects, photos, setups. */

import { migratePreviewPixels } from './photoOriginal';

export type SessionMode =
  | 'MENU'
  | 'START'
  | 'BASELINE'
  | 'PHOTO_TIE_BASELINE'
  | 'HOUSE_EDGES'
  | 'ADD_POINT'
  | 'ADD_POINT_EXTRA_YAW'
  | 'LEAPFROG'
  | 'RODS_MOVED'
  | 'FENCE_TAG'
  | 'ADJUST'
  | 'REVIEW'
  /** @deprecated legacy — normalised on load helpers */
  | 'HOUSE_BASELINE'
  | 'PLACE_ROD_A'
  | 'PHOTO_TIE_HOUSE_ROD'
  | 'OCCUPY'
  | 'OCCUPY_EXTRA_YAW';

export type PointKind = 'HSE' | 'FNC' | 'POL' | 'ROD' | 'OCC' | 'TRK' | 'BED' | 'BL';

export type GeometryType = 'square' | 'circle' | 'triangle' | 'irregular_polygon' | 'line' | 'point';

export const GEOMETRY_CHOICES: { id: GeometryType; label: string }[] = [
  { id: 'square', label: 'Square' },
  { id: 'circle', label: 'Circle' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'irregular_polygon', label: 'Irregular polygon' },
];

export interface LayerDef {
  id: string;
  name: string;
  colour?: string;
}

export interface SolvedCircle {
  cx: number;
  cy: number;
  r: number;
}

export interface SolvedRectangle {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Named thing on a layer (one level under layer). */
export interface GardenObject {
  id: string;
  layerId: string;
  name: string;
  geometryType: GeometryType;
  measuredPointIds: string[];
  selectedPointIds: string[];
  solvedCircle?: SolvedCircle;
  solvedRectangle?: SolvedRectangle;
  /** Ordered vertex ids for triangle / irregular polygon fuzzy outline. */
  solvedPolygonIds?: string[];
  residualMm?: number;
}

export interface Point {
  id: string;
  kind: PointKind;
  x?: number;
  y?: number;
  label?: string;
  fixed?: boolean;
  /**
   * Mark offset toward the true feature (mm). E.g. post/roll radius so the solved
   * point is the brick arris, not the roll centre.
   */
  offsetMm?: number;
  layerId?: string;
  objectId?: string;
  /** Baseline id used when this point was measured. */
  measuredWithBaselineId?: string;
  /** Photo ids attached to this measurement. */
  photoIds?: string[];
}

export type LineKind = 'tape' | 'laser' | 'rod' | 'straight' | 'baseline';

export interface Line {
  id: string;
  a: string;
  b: string;
  lengthM?: number;
  sigmaM?: number;
  kind: LineKind;
}

/** Known-length control between two marks. Default field use: one house edge. */
export interface Baseline {
  id: string;
  a: string;
  b: string;
  lengthM: number;
  sigmaM?: number;
  kind: 'tape' | 'laser';
  /** True when B1–B2 is also a house polygon edge. */
  isHouseEdge?: boolean;
  label?: string;
  /**
   * Trust / z-order priority (higher = preferred for new measurements and draw order).
   * Defaults to 50; bumped when used successfully.
   */
  trust?: number;
  /** How many + Point measurements have used this baseline. */
  usedForMeasurementCount?: number;
}

export interface Polygon {
  id: string;
  pointIds: string[];
  label?: string;
  layerId?: string;
  /** User closed the ring (Close house). */
  closed?: boolean;
}

export type ObservationKind = 'distance' | 'angle' | 'residual';

export interface Observation {
  id: string;
  kind: ObservationKind;
  pointIds?: string[];
  value?: number;
  sigma?: number;
  unit?: string;
  note?: string;
  photoId?: string;
}

export interface PhotoClick {
  pointId: string;
  px: number;
  py: number;
}

/** OneDrive upload state for the original camera file. The bytes live in IndexedDB, not here. */
export type PhotoUploadStatus = 'queued' | 'uploading' | 'verified' | 'failed';

/**
 * Pointer to the original camera file in `/Garden Survey/photos/`.
 * Absent on older documents. The thumbnail stays a separate display preview.
 */
export interface PhotoOriginalFile {
  fileName: string;
  size: number;
  quickXorHash: string;
  sha256?: string;
  contentType?: string;
  /** Wall clock when the app received the file. */
  receivedAt?: string;
  /** EXIF DateTimeOriginal + SubSec + offset, when present. */
  capturedAt?: string;
  provenance?: 'camera-path' | 'library' | 'unknown';
  calibrationKey?: string;
  fullWidth?: number;
  fullHeight?: number;
  previewWidth?: number;
  previewHeight?: number;
  previewScaleX?: number;
  previewScaleY?: number;
  /** full = previewPx / scale, from the pixel edge. Centre index is full − 0.5. */
  clickMap?: 'p/scale';
  /** Clicks are upright (orientation applied). */
  clickSpace?: 'upright';
  /** 7a4e268 published this. Cleared when the row is relabelled `p/scale`. */
  pixelCentre?: '+0.5';
  /** Single scale published by 7a4e268. Copied to both axes on load. */
  previewScale?: number;
  /** Present after a +0.5 row was relabelled. Stored clicks were not moved. */
  clickMapMigratedFrom?: '+0.5';
  /** Set when the failure will not succeed on Retry (hash mismatch or name still taken). */
  uploadPermanent?: boolean;
  /** Missing lens data, or capture time outside the station setup. */
  usabilityNote?: string;
  uploadStatus?: PhotoUploadStatus;
  uploadError?: string;
}

export interface Photo {
  id: string;
  setupId: string;
  addPointId?: string;
  yawOnly?: boolean;
  thumbnailDataUrl?: string;
  width: number;
  height: number;
  clicks: PhotoClick[];
  /** Baseline whose ends were marked in this frame (sighting). */
  sightedBaselineId?: string;
  exifDateTimeOriginal?: string;
  /** Original camera file (full resolution). Optional so older garden.json still loads. */
  originalFile?: PhotoOriginalFile;
  note?: string;
  /** Estimated camera pose after adjust (metres, radians). */
  pose?: { x: number; y: number; yawRad: number };
  /**
   * Per-photo contribution to the add-point station (metres).
   * Combined point (x,y) is the average of these estimates when present.
   */
  estimate?: { x: number; y: number };
}

export interface Setup {
  id: string;
  startedAt: string;
  endedAt?: string;
  liveRodIds: string[];
  closed?: boolean;
  /** True once A and B have been photographed together in this setup leapfrog. */
  abPhotographedTogether?: boolean;
}

export interface SessionState {
  mode: SessionMode;
  speakSteps: boolean;
  lastResidualMm?: number;
  lastAction?: string;
  geometryOk?: boolean;
  currentAddPointId?: string;
  currentSetupId?: string;
  currentBaselineId?: string;
  /** Sticky + Point target (default layer: walkway). */
  stickyLayerId?: string;
  stickyObjectId?: string;
  /** Sticky object name for create / rename in + Point panel. */
  stickyObjectName?: string;
  stickyGeometryType?: GeometryType;
  /** Plan-picked active baseline ends — not eternally sacred; Adjust can refit. */
  activeBaselineEnds?: { a?: string; b?: string };
  /** Point open in the measurement inspector (click on plan). */
  inspectingPointId?: string;
  /** Photo selected in the + Point / inspect dialog (for − Photo). */
  selectedPhotoId?: string;
}

/** Where the OneDrive photos manifest lives, relative to the garden folder. */
export interface PhotosManifestLink {
  /** e.g. `photos/manifest.json` — next to garden-v1.json, not inside it. */
  path: string;
}

export interface GardenDocument {
  version: 1;
  name: string;
  createdAt: string;
  points: Point[];
  lines: Line[];
  polygons: Polygon[];
  baselines: Baseline[];
  observations: Observation[];
  photos: Photo[];
  setups: Setup[];
  layers: LayerDef[];
  objects: GardenObject[];
  session: SessionState;
  /**
   * Optional pointer to the photos manifest. Older documents omit it;
   * readers that don't know the field ignore it.
   */
  photosManifest?: PhotosManifestLink;
}

export const SIGMA = {
  tapeM: 0.02,
  laserM: 0.002,
  rodLengthM: 0.005,
  clickPx: 2,
  angleDeg: 0.2,
} as const;

export const ROD_LENGTH_M = 4.0;
export const ROD_MID_M = 2.0;

/** Warn when closing the house if first–last vertex gap exceeds this (mm). */
export const HOUSE_CLOSE_WARN_MM = 50;

export function emptyDocument(name = 'Untitled garden'): GardenDocument {
  const now = new Date().toISOString();
  return {
    version: 1,
    name,
    createdAt: now,
    points: [],
    lines: [],
    polygons: [],
    baselines: [],
    observations: [],
    photos: [],
    setups: [],
    layers: [
      { id: 'walkway', name: 'Walkway', colour: '#6b8f71' },
      { id: 'structure', name: 'Structure', colour: '#3d3428' },
      { id: 'plants', name: 'Plants', colour: '#2f5d3a' },
      { id: 'survey', name: 'Survey', colour: '#1a5f7a' },
    ],
    objects: [],
    session: {
      mode: 'START',
      speakSteps: false,
      geometryOk: false,
      stickyLayerId: 'walkway',
      stickyGeometryType: 'circle',
      stickyObjectName: 'Path',
    },
  };
}

/** Ensure older garden.json without baselines/new modes still loads. */
export function normalizeDocument(raw: GardenDocument): GardenDocument {
  const doc: GardenDocument = {
    ...emptyDocument(raw.name),
    ...raw,
    baselines: raw.baselines ?? [],
    polygons: raw.polygons ?? [],
    points: raw.points ?? [],
    lines: raw.lines ?? [],
    observations: raw.observations ?? [],
    photos: raw.photos ?? [],
    setups: raw.setups ?? [],
    layers: raw.layers?.length
      ? raw.layers
      : [
          { id: 'walkway', name: 'Walkway', colour: '#6b8f71' },
          { id: 'structure', name: 'Structure', colour: '#3d3428' },
          { id: 'plants', name: 'Plants', colour: '#2f5d3a' },
          { id: 'survey', name: 'Survey', colour: '#1a5f7a' },
        ],
    objects: (raw.objects ?? []).map((o) => {
      const g = (o as { geometryType?: string }).geometryType;
      const geometryType =
        g === 'rectangle' || g === 'free' || g === 'polygon'
          ? (g === 'rectangle' ? 'square' : 'irregular_polygon')
          : ((g as GeometryType | undefined) ?? 'circle');
      return { ...o, geometryType };
    }),
    session: { ...emptyDocument().session, ...raw.session },
  };
  for (const b of doc.baselines) {
    if (b.trust == null) b.trust = 50;
    if (b.usedForMeasurementCount == null) b.usedForMeasurementCount = 0;
  }
  const legacy = doc.session.mode as string;
  if (legacy === 'HOUSE_BASELINE') doc.session.mode = 'BASELINE';
  if (legacy === 'PLACE_ROD_A') doc.session.mode = 'HOUSE_EDGES';
  if (legacy === 'PHOTO_TIE_HOUSE_ROD') doc.session.mode = 'PHOTO_TIE_BASELINE';
  if (legacy === 'OCCUPY') doc.session.mode = 'ADD_POINT';
  if (legacy === 'OCCUPY_EXTRA_YAW') doc.session.mode = 'ADD_POINT_EXTRA_YAW';
  // Migrate occupy* field names from older garden.json
  const sess = doc.session as SessionState & { currentOccupyId?: string };
  if (sess.currentOccupyId && !sess.currentAddPointId) {
    sess.currentAddPointId = sess.currentOccupyId;
    delete sess.currentOccupyId;
  }
  for (const ph of doc.photos) {
    const legacyPh = ph as Photo & { occupyPointId?: string };
    if (legacyPh.occupyPointId && !legacyPh.addPointId) {
      legacyPh.addPointId = legacyPh.occupyPointId;
      delete legacyPh.occupyPointId;
    }
    if (ph.originalFile) {
      const migrated = migratePreviewPixels(ph.originalFile);
      if (migrated && migrated !== ph.originalFile) ph.originalFile = migrated;
    }
  }
  return doc;
}

export function placeholderThumb(colour = '#6b8f71'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="${colour}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Synthetic demo: house-edge baseline + irregular 6-corner shed + rod A + add-point stations.
 * Not a forced rectangle — polygon vertices planted with truth coords.
 */
export function syntheticDocument(): GardenDocument {
  const now = new Date().toISOString();
  const setupId = 'setup-1';
  const doc = emptyDocument('Synthetic shed demo');
  doc.createdAt = now;

  // Irregular shed (metres). Baseline = HSE01–HSE02 (south edge, 7 m).
  doc.points = [
    { id: 'HSE01', kind: 'HSE', x: 0, y: 0, label: 'Shed SW', fixed: true, offsetMm: 0 },
    { id: 'HSE02', kind: 'HSE', x: 7, y: 0, label: 'Shed SE', fixed: true, offsetMm: 0 },
    { id: 'HSE03', kind: 'HSE', x: 7.4, y: 2.2, label: 'Shed E jog', offsetMm: 40 },
    { id: 'HSE04', kind: 'HSE', x: 6.2, y: 5.5, label: 'Shed NE', offsetMm: 0 },
    { id: 'HSE05', kind: 'HSE', x: 1.5, y: 5.8, label: 'Shed NW', offsetMm: 0 },
    { id: 'HSE06', kind: 'HSE', x: -0.3, y: 3.0, label: 'Shed W jog', offsetMm: 35 },
    { id: 'A1', kind: 'ROD', x: 2.5, y: 9, label: 'Rod A near' },
    { id: 'A2', kind: 'ROD', x: 6.5, y: 9, label: 'Rod A far' },
    { id: 'A0', kind: 'ROD', x: 4.5, y: 9, label: 'Rod A mid' },
    { id: 'BED01P1', kind: 'OCC', x: 3.5, y: 7, label: 'Bed point 1' },
    { id: 'BED02P1', kind: 'OCC', x: 5.2, y: 7.8, label: 'Bed point 2' },
    { id: 'FNC01', kind: 'FNC', label: 'Fence post 1' },
    { id: 'FNC02', kind: 'FNC', label: 'Fence post 2' },
    { id: 'FNC03', kind: 'FNC', label: 'Fence post 3' },
    { id: 'FNC04', kind: 'FNC', label: 'Fence post 4' },
  ];

  doc.baselines = [
    {
      id: 'BL-1',
      a: 'HSE01',
      b: 'HSE02',
      lengthM: 7.0,
      sigmaM: SIGMA.tapeM,
      kind: 'tape',
      isHouseEdge: true,
      label: 'House-edge baseline (south)',
      trust: 70,
      usedForMeasurementCount: 2,
    },
  ];

  doc.lines = [
    { id: 'L-BL-1', a: 'HSE01', b: 'HSE02', lengthM: 7.0, sigmaM: SIGMA.tapeM, kind: 'baseline' },
    { id: 'L-HSE-2-3', a: 'HSE02', b: 'HSE03', lengthM: 2.236, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-HSE-3-4', a: 'HSE03', b: 'HSE04', lengthM: 3.509, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-HSE-4-5', a: 'HSE04', b: 'HSE05', lengthM: 4.71, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-HSE-5-6', a: 'HSE05', b: 'HSE06', lengthM: 3.328, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-HSE-6-1', a: 'HSE06', b: 'HSE01', lengthM: 3.015, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-ROD-A', a: 'A1', b: 'A2', lengthM: ROD_LENGTH_M, sigmaM: SIGMA.rodLengthM, kind: 'rod' },
    { id: 'L-ROD-A-mid', a: 'A1', b: 'A0', lengthM: ROD_MID_M, sigmaM: SIGMA.rodLengthM, kind: 'rod' },
  ];

  doc.polygons = [
    {
      id: 'house',
      pointIds: ['HSE01', 'HSE02', 'HSE03', 'HSE04', 'HSE05', 'HSE06'],
      label: 'Shed',
      layerId: 'structure',
      closed: true,
    },
  ];

  doc.setups = [
    {
      id: setupId,
      startedAt: now,
      liveRodIds: ['A'],
      closed: false,
      abPhotographedTogether: false,
    },
  ];

  doc.photos = [
    {
      id: 'photo-tie-1',
      setupId,
      width: 1200,
      height: 900,
      thumbnailDataUrl: placeholderThumb('#4a6b52'),
      exifDateTimeOriginal: now,
      note: 'Both baseline ends + next house mark HSE03',
      clicks: [
        { pointId: 'HSE01', px: 200, py: 700 },
        { pointId: 'HSE02', px: 950, py: 690 },
        { pointId: 'HSE03', px: 1000, py: 420 },
      ],
    },
    {
      id: 'photo-occ-1',
      setupId,
      addPointId: 'BED01P1',
      width: 1200,
      height: 900,
      thumbnailDataUrl: placeholderThumb('#7a9e7e'),
      exifDateTimeOriginal: now,
      note: 'Add point BED01P1 — rod A + baseline',
      clicks: [
        { pointId: 'A1', px: 350, py: 400 },
        { pointId: 'A2', px: 850, py: 390 },
        { pointId: 'HSE02', px: 200, py: 650 },
      ],
    },
    {
      id: 'photo-occ-2',
      setupId,
      addPointId: 'BED02P1',
      width: 1200,
      height: 900,
      thumbnailDataUrl: placeholderThumb('#8fb894'),
      exifDateTimeOriginal: now,
      note: 'Add point BED02P1 — rod A live',
      clicks: [
        { pointId: 'A1', px: 300, py: 450 },
        { pointId: 'A2', px: 700, py: 420 },
        { pointId: 'HSE04', px: 950, py: 600 },
      ],
    },
  ];

  doc.session = {
    mode: 'ADD_POINT',
    speakSteps: false,
    geometryOk: true,
    lastAction: 'Loaded synthetic house-edge baseline + irregular shed + rod A',
    currentSetupId: setupId,
    currentBaselineId: 'BL-1',
    currentAddPointId: 'BED02P1',
    stickyLayerId: 'walkway',
    stickyGeometryType: 'circle',
    stickyObjectName: 'Bed path',
    activeBaselineEnds: { a: 'HSE01', b: 'HSE02' },
  };

  doc.objects = [
    {
      id: 'obj-bed',
      layerId: 'walkway',
      name: 'Bed path',
      geometryType: 'circle',
      measuredPointIds: ['BED01P1', 'BED02P1'],
      selectedPointIds: ['BED01P1', 'BED02P1'],
    },
  ];
  doc.session.stickyObjectId = 'obj-bed';
  doc.points = doc.points.map((p) =>
    p.id === 'BED01P1' || p.id === 'BED02P1'
      ? { ...p, layerId: 'walkway', objectId: 'obj-bed', measuredWithBaselineId: 'BL-1' }
      : p,
  );

  return doc;
}

export function currentSetup(doc: GardenDocument): Setup | undefined {
  const id = doc.session.currentSetupId;
  if (id) return doc.setups.find((s) => s.id === id);
  return doc.setups.find((s) => !s.closed);
}

export function currentBaseline(doc: GardenDocument): Baseline | undefined {
  const id = doc.session.currentBaselineId;
  if (id) return doc.baselines.find((b) => b.id === id);
  return doc.baselines[doc.baselines.length - 1];
}

export function baselineReady(doc: GardenDocument): boolean {
  return doc.baselines.some((b) => b.lengthM > 0);
}

/** Live control = active baseline and/or live rod in the current setup. */
export function hasLiveControl(doc: GardenDocument): boolean {
  if (baselineReady(doc)) return true;
  const setup = currentSetup(doc);
  if (!setup || setup.closed) return false;
  return setup.liveRodIds.length > 0;
}

export function housePolygon(doc: GardenDocument): Polygon | undefined {
  return doc.polygons.find((p) => p.id === 'house');
}

export function houseCornerCount(doc: GardenDocument): number {
  return housePolygon(doc)?.pointIds.length ?? 0;
}

/** @deprecated Prefer baselineReady — kept for older call sites during transition. */
export function houseRectangleClosed(doc: GardenDocument): boolean {
  return baselineReady(doc);
}

export function rodAPlaced(doc: GardenDocument): boolean {
  const a1 = doc.points.find((p) => p.id === 'A1');
  const a2 = doc.points.find((p) => p.id === 'A2');
  const rodLine = doc.lines.find(
    (l) => l.id === 'L-ROD-A' || (l.kind === 'rod' && l.a === 'A1' && l.b === 'A2'),
  );
  return Boolean(a1 && a2 && rodLine?.lengthM === ROD_LENGTH_M);
}

/** v1: photo must include both baseline ends + at least one other target mark. */
export function baselineTieReady(doc: GardenDocument): boolean {
  const bl = currentBaseline(doc);
  if (!bl) return false;
  return doc.photos.some((ph) => {
    const ids = new Set(ph.clicks.map((c) => c.pointId));
    if (!ids.has(bl.a) || !ids.has(bl.b)) return false;
    for (const id of ids) {
      if (id !== bl.a && id !== bl.b) return true;
    }
    return false;
  });
}

/** @deprecated alias */
export function tiePhotoReady(doc: GardenDocument): boolean {
  return baselineTieReady(doc);
}

/**
 * Establish baseline (default: house-edge). Creates/updates B ends as HSE01/HSE02
 * when isHouseEdge, else BL01/BL02.
 *
 * Pass `baselineId` to update an existing baseline in place (preserves other
 * baselines and end point ids).
 */
export function setBaseline(
  doc: GardenDocument,
  lengthM: number,
  opts: {
    offsetAMm?: number;
    offsetBMm?: number;
    isHouseEdge?: boolean;
    kind?: 'tape' | 'laser';
    label?: string;
    trust?: number;
    /** When set and found, update that baseline instead of appending a new one. */
    baselineId?: string;
  } = {},
): GardenDocument {
  if (opts.baselineId) {
    const existing = doc.baselines.find((b) => b.id === opts.baselineId);
    if (existing) {
      return updateBaselineInPlace(doc, existing, lengthM, opts);
    }
  }

  const isHouseEdge = opts.isHouseEdge !== false;
  const aId = isHouseEdge ? 'HSE01' : 'BL01';
  const bId = isHouseEdge ? 'HSE02' : 'BL02';
  const kind = opts.kind ?? 'tape';
  const sigmaM = kind === 'laser' ? SIGMA.laserM : SIGMA.tapeM;
  const id = `BL-${doc.baselines.length + 1}`;

  const points = doc.points.filter((p) => p.id !== aId && p.id !== bId);
  points.push(
    {
      id: aId,
      kind: isHouseEdge ? 'HSE' : 'BL',
      x: 0,
      y: 0,
      label: isHouseEdge ? 'House baseline A' : 'Baseline A',
      fixed: true,
      offsetMm: opts.offsetAMm ?? 0,
    },
    {
      id: bId,
      kind: isHouseEdge ? 'HSE' : 'BL',
      x: lengthM,
      y: 0,
      label: isHouseEdge ? 'House baseline B' : 'Baseline B',
      fixed: true,
      offsetMm: opts.offsetBMm ?? 0,
    },
  );

  const baseline: Baseline = {
    id,
    a: aId,
    b: bId,
    lengthM,
    sigmaM,
    kind,
    isHouseEdge,
    label: opts.label ?? (isHouseEdge ? 'House-edge baseline' : 'Baseline'),
    trust: opts.trust ?? 60,
    usedForMeasurementCount: 0,
  };

  const lines = doc.lines.filter((l) => l.id !== `L-${id}` && !(l.a === aId && l.b === bId));
  lines.push({
    id: `L-${id}`,
    a: aId,
    b: bId,
    lengthM,
    sigmaM,
    kind: 'baseline',
  });

  let polygons = [...doc.polygons];
  if (isHouseEdge) {
    const house = polygons.find((p) => p.id === 'house');
    if (house) {
      const ids = [...new Set([aId, bId, ...house.pointIds.filter((x) => x !== aId && x !== bId)])];
      // Keep A,B as first two vertices when starting.
      polygons = polygons.map((p) =>
        p.id === 'house'
          ? { ...p, pointIds: [aId, bId, ...ids.filter((x) => x !== aId && x !== bId)], layerId: 'structure' }
          : p,
      );
    } else {
      polygons.push({
        id: 'house',
        pointIds: [aId, bId],
        label: 'House',
        layerId: 'structure',
        closed: false,
      });
    }
  }

  const setups =
    doc.setups.length > 0
      ? doc.setups
      : [
          {
            id: `setup-${Date.now()}`,
            startedAt: new Date().toISOString(),
            liveRodIds: [],
            closed: false,
          },
        ];

  return {
    ...doc,
    points,
    lines,
    polygons,
    baselines: [...doc.baselines.filter((b) => b.id !== id), baseline],
    setups,
    session: {
      ...doc.session,
      currentBaselineId: id,
      currentSetupId: doc.session.currentSetupId ?? setups[0]?.id,
      activeBaselineEnds: { a: aId, b: bId },
      lastAction: `Baseline ${aId}–${bId} set at ${lengthM.toFixed(3)} m` +
        (opts.offsetAMm || opts.offsetBMm
          ? ` (offsets ${opts.offsetAMm ?? 0}/${opts.offsetBMm ?? 0} mm)`
          : ''),
      geometryOk: true,
    },
  };
}

/** Update length / offsets / kind / trust on an existing baseline without appending. */
function updateBaselineInPlace(
  doc: GardenDocument,
  existing: Baseline,
  lengthM: number,
  opts: {
    offsetAMm?: number;
    offsetBMm?: number;
    kind?: 'tape' | 'laser';
    trust?: number;
    label?: string;
  },
): GardenDocument {
  const kind = opts.kind ?? existing.kind;
  const sigmaM = kind === 'laser' ? SIGMA.laserM : SIGMA.tapeM;
  const trust = opts.trust ?? existing.trust ?? 50;
  const offsetA = opts.offsetAMm ?? 0;
  const offsetB = opts.offsetBMm ?? 0;

  const aPt = doc.points.find((p) => p.id === existing.a);
  const points = doc.points.map((p) => {
    if (p.id === existing.a) {
      return { ...p, offsetMm: offsetA };
    }
    if (p.id === existing.b) {
      let next = { ...p, offsetMm: offsetB };
      // Keep simple axis layout when still the original fixed house-edge placement.
      if (
        aPt?.fixed &&
        p.fixed &&
        (aPt.x ?? 0) === 0 &&
        (aPt.y ?? 0) === 0 &&
        (p.y ?? 0) === 0 &&
        typeof p.x === 'number'
      ) {
        next = { ...next, x: lengthM };
      }
      return next;
    }
    return p;
  });

  const baselines = doc.baselines.map((b) =>
    b.id === existing.id
      ? {
          ...b,
          lengthM,
          kind,
          sigmaM,
          trust,
          label: opts.label ?? b.label,
        }
      : b,
  );

  const lines = doc.lines.map((l) => {
    if (
      l.id === `L-${existing.id}` ||
      (l.kind === 'baseline' && l.a === existing.a && l.b === existing.b)
    ) {
      return { ...l, lengthM, sigmaM, kind: 'baseline' as const };
    }
    return l;
  });

  return {
    ...doc,
    points,
    lines,
    baselines,
    session: {
      ...doc.session,
      currentBaselineId: existing.id,
      activeBaselineEnds: { a: existing.a, b: existing.b },
      lastAction:
        `Baseline ${existing.a}–${existing.b} updated to ${lengthM.toFixed(3)} m` +
        (offsetA || offsetB ? ` (offsets ${offsetA}/${offsetB} mm)` : ''),
      geometryOk: true,
    },
  };
}

/** Append a house corner and optional tape from the previous vertex. */
export function addHouseCorner(
  doc: GardenDocument,
  edgeLengthM?: number,
  offsetMm = 0,
): GardenDocument {
  const house = housePolygon(doc);
  const n = (house?.pointIds.length ?? 0) + 1;
  const id = `HSE${String(n).padStart(2, '0')}`;
  const prev = house?.pointIds[house.pointIds.length - 1];

  const points = [...doc.points.filter((p) => p.id !== id), {
    id,
    kind: 'HSE' as const,
    label: `House corner ${n}`,
    offsetMm,
  }];

  const lines = [...doc.lines];
  if (prev && edgeLengthM != null && edgeLengthM > 0) {
    lines.push({
      id: `L-HSE-${prev}-${id}`,
      a: prev,
      b: id,
      lengthM: edgeLengthM,
      sigmaM: SIGMA.tapeM,
      kind: 'tape',
    });
  }

  const polygons = doc.polygons.filter((p) => p.id !== 'house');
  const pointIds = [...(house?.pointIds ?? []), id];
  polygons.push({
    id: 'house',
    pointIds,
    label: house?.label ?? 'House',
    layerId: 'structure',
    closed: false,
  });

  return {
    ...doc,
    points,
    lines,
    polygons,
    session: {
      ...doc.session,
      lastAction:
        edgeLengthM != null
          ? `Added ${id} with edge ${edgeLengthM.toFixed(3)} m from ${prev}`
          : `Added ${id} (photo-tie / no tape yet)`,
    },
  };
}

export interface CloseHouseResult {
  doc: GardenDocument;
  gapMm: number;
  warn: boolean;
  note: string;
}

/** Close house polygon; warn if first–last gap > HOUSE_CLOSE_WARN_MM. */
export function closeHouse(doc: GardenDocument): CloseHouseResult {
  const house = housePolygon(doc);
  if (!house || house.pointIds.length < 3) {
    return {
      doc,
      gapMm: NaN,
      warn: true,
      note: 'Need at least three house corners before Close house.',
    };
  }
  const first = doc.points.find((p) => p.id === house.pointIds[0]);
  const last = doc.points.find((p) => p.id === house.pointIds[house.pointIds.length - 1]);
  let gapMm = 0;
  if (
    first?.x != null &&
    first.y != null &&
    last?.x != null &&
    last.y != null
  ) {
    gapMm = Math.hypot(first.x - last.x, first.y - last.y) * 1000;
  }
  const warn = gapMm > HOUSE_CLOSE_WARN_MM;
  const polygons = doc.polygons.map((p) =>
    p.id === 'house' ? { ...p, closed: true } : p,
  );
  const note = warn
    ? `House closed with gap ${gapMm.toFixed(0)} mm — remeasure before you trust the polygon (>${HOUSE_CLOSE_WARN_MM} mm).`
    : gapMm > 0
      ? `House closed. Close gap ${gapMm.toFixed(0)} mm — good enough to proceed.`
      : 'House closed. Coordinates not fixed yet — run Adjust to see the close residual.';

  return {
    doc: {
      ...doc,
      polygons,
      session: {
        ...doc.session,
        lastAction: note,
        lastResidualMm: Number.isFinite(gapMm) ? gapMm : doc.session.lastResidualMm,
        geometryOk: !warn,
      },
    },
    gapMm,
    warn,
    note,
  };
}

export function declareRodA(doc: GardenDocument): GardenDocument {
  const bl = currentBaseline(doc);
  const a = bl ? doc.points.find((p) => p.id === bl.a) : undefined;
  const b = bl ? doc.points.find((p) => p.id === bl.b) : undefined;
  const midX = ((a?.x ?? 0) + (b?.x ?? ROD_LENGTH_M)) / 2;
  const y = Math.max(a?.y ?? 0, b?.y ?? 0) + 6;
  const x1 = midX - ROD_LENGTH_M / 2;
  const x2 = x1 + ROD_LENGTH_M;

  const points = doc.points.filter((p) => p.id !== 'A1' && p.id !== 'A2' && p.id !== 'A0');
  points.push(
    { id: 'A1', kind: 'ROD', x: x1, y, label: 'Rod A near' },
    { id: 'A2', kind: 'ROD', x: x2, y, label: 'Rod A far' },
    { id: 'A0', kind: 'ROD', x: (x1 + x2) / 2, y, label: 'Rod A mid' },
  );

  const lines = doc.lines.filter((l) => l.id !== 'L-ROD-A' && l.id !== 'L-ROD-A-mid');
  lines.push(
    { id: 'L-ROD-A', a: 'A1', b: 'A2', lengthM: ROD_LENGTH_M, sigmaM: SIGMA.rodLengthM, kind: 'rod' },
    { id: 'L-ROD-A-mid', a: 'A1', b: 'A0', lengthM: ROD_MID_M, sigmaM: SIGMA.rodLengthM, kind: 'rod' },
  );

  const setups = doc.setups.map((s) => {
    if (s.id === doc.session.currentSetupId || (!doc.session.currentSetupId && !s.closed)) {
      return { ...s, liveRodIds: uniqueRods(s.liveRodIds, ['A']) };
    }
    return s;
  });

  return {
    ...doc,
    points,
    lines,
    setups: setups.length ? setups : doc.setups,
    session: {
      ...doc.session,
      lastAction: 'Rod A declared at 4.000 m with toilet-roll belts on both ends',
    },
  };
}

/** Canned baseline tie: both ends + next house mark. */
export function applyCannedBaselineTie(doc: GardenDocument): GardenDocument {
  if (baselineTieReady(doc)) return doc;
  const bl = currentBaseline(doc);
  if (!bl) return doc;
  const house = housePolygon(doc);
  const target =
    house?.pointIds.find((id) => id !== bl.a && id !== bl.b) ??
    doc.points.find((p) => p.kind === 'HSE' && p.id !== bl.a && p.id !== bl.b)?.id;

  let next = doc;
  let targetId = target;
  if (!targetId) {
    next = addHouseCorner(doc);
    targetId = housePolygon(next)?.pointIds.slice(-1)[0];
  }
  if (!targetId) return doc;

  const setup = currentSetup(next);
  const setupId = setup?.id ?? next.session.currentSetupId ?? 'setup-1';
  const now = new Date().toISOString();
  const photo: Photo = {
    id: `photo-tie-${Date.now()}`,
    setupId,
    width: 1200,
    height: 900,
    thumbnailDataUrl: placeholderThumb('#4a6b52'),
    exifDateTimeOriginal: now,
    note: `Baseline ${bl.a}+${bl.b} + target ${targetId}`,
    clicks: [
      { pointId: bl.a, px: 200, py: 700 },
      { pointId: bl.b, px: 950, py: 690 },
      { pointId: targetId, px: 1000, py: 420 },
    ],
  };
  return {
    ...next,
    photos: [...next.photos, photo],
    session: {
      ...next.session,
      lastAction: `Baseline tie recorded — ${bl.a}, ${bl.b}, and ${targetId}`,
    },
  };
}

/** @deprecated */
export function applyCannedTiePhoto(doc: GardenDocument): GardenDocument {
  return applyCannedBaselineTie(doc);
}

/** @deprecated — rectangle house entry removed; use setBaseline. */
export function applyHouseBaseline(
  doc: GardenDocument,
  backM: number,
  _sideM: number,
  _diagM: number,
): GardenDocument {
  return setBaseline(doc, backM, { isHouseEdge: true, offsetAMm: 0, offsetBMm: 0 });
}

export function confirmAbTogether(doc: GardenDocument): GardenDocument {
  const setups = doc.setups.map((s) => {
    if (s.id === doc.session.currentSetupId || (!doc.session.currentSetupId && !s.closed)) {
      return { ...s, abPhotographedTogether: true, liveRodIds: uniqueRods(s.liveRodIds, ['A', 'B']) };
    }
    return s;
  });
  return {
    ...doc,
    setups,
    session: {
      ...doc.session,
      lastAction: 'A and B photographed together — safe to confirm Rods moved',
    },
  };
}

function uniqueRods(existing: string[], add: string[]): string[] {
  return [...new Set([...existing, ...add])];
}
