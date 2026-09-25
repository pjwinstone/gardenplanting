/** Garden Survey document model — points, lines, polygons, observations, photos, setups. */

export type SessionMode =
  | 'START'
  | 'HOUSE_BASELINE'
  | 'PLACE_ROD_A'
  | 'PHOTO_TIE_HOUSE_ROD'
  | 'OCCUPY'
  | 'OCCUPY_EXTRA_YAW'
  | 'LEAPFROG'
  | 'RODS_MOVED'
  | 'FENCE_TAG'
  | 'ADJUST'
  | 'REVIEW';

export type PointKind = 'HSE' | 'FNC' | 'POL' | 'ROD' | 'OCC' | 'TRK' | 'BED';

export interface Point {
  id: string;
  kind: PointKind;
  x?: number;
  y?: number;
  label?: string;
  fixed?: boolean;
}

export type LineKind = 'tape' | 'laser' | 'rod' | 'straight';

export interface Line {
  id: string;
  a: string;
  b: string;
  lengthM?: number;
  sigmaM?: number;
  kind: LineKind;
}

export interface Polygon {
  id: string;
  pointIds: string[];
  label?: string;
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

export interface Photo {
  id: string;
  setupId: string;
  occupyPointId?: string;
  yawOnly?: boolean;
  thumbnailDataUrl?: string;
  width: number;
  height: number;
  clicks: PhotoClick[];
  exifDateTimeOriginal?: string;
  note?: string;
  /** Estimated camera pose after adjust (metres, radians). */
  pose?: { x: number; y: number; yawRad: number };
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
  currentOccupyId?: string;
  currentSetupId?: string;
}

export interface GardenDocument {
  version: 1;
  name: string;
  createdAt: string;
  points: Point[];
  lines: Line[];
  polygons: Polygon[];
  observations: Observation[];
  photos: Photo[];
  setups: Setup[];
  session: SessionState;
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

export function emptyDocument(name = 'Untitled garden'): GardenDocument {
  const now = new Date().toISOString();
  return {
    version: 1,
    name,
    createdAt: now,
    points: [],
    lines: [],
    polygons: [],
    observations: [],
    photos: [],
    setups: [],
    session: {
      mode: 'START',
      speakSteps: false,
      geometryOk: false,
    },
  };
}

/** Tiny placeholder PNG (1×1) as data URL for synthetic thumbnails. */
export function placeholderThumb(colour = '#6b8f71'): string {
  // Minimal SVG data URL used as a stand-in thumbnail.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="${colour}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Synthetic house + rod A + two occupy photos with canned clicks.
 * House: 8×6 m rectangle. Rod A: 4.000 m, 6 m out from back wall.
 * Truth coordinates are planted so Layer A/B can recover a plan.
 */
export function syntheticDocument(): GardenDocument {
  const now = new Date().toISOString();
  const setupId = 'setup-1';
  const doc = emptyDocument('Synthetic demo garden');
  doc.createdAt = now;

  // House corners: HSE01 SW, HSE02 SE, HSE03 NE, HSE04 NW (metres).
  doc.points = [
    { id: 'HSE01', kind: 'HSE', x: 0, y: 0, label: 'House SW', fixed: true },
    { id: 'HSE02', kind: 'HSE', x: 8, y: 0, label: 'House SE', fixed: true },
    { id: 'HSE03', kind: 'HSE', x: 8, y: 6, label: 'House NE', fixed: true },
    { id: 'HSE04', kind: 'HSE', x: 0, y: 6, label: 'House NW', fixed: true },
    // Rod A ends — truth positions; Layer A will constrain length; Layer B ties pose.
    { id: 'A1', kind: 'ROD', x: 3, y: 12, label: 'Rod A near' },
    { id: 'A2', kind: 'ROD', x: 7, y: 12, label: 'Rod A far' },
    { id: 'A0', kind: 'ROD', x: 5, y: 12, label: 'Rod A mid' },
    // Occupied points (camera stations).
    { id: 'BED01P1', kind: 'OCC', x: 4, y: 9, label: 'Bed occupy 1' },
    { id: 'BED02P1', kind: 'OCC', x: 5.5, y: 10.5, label: 'Bed occupy 2' },
    // Fence tags for print demo (no coords yet).
    { id: 'FNC01', kind: 'FNC', label: 'Fence post 1' },
    { id: 'FNC02', kind: 'FNC', label: 'Fence post 2' },
    { id: 'FNC03', kind: 'FNC', label: 'Fence post 3' },
    { id: 'FNC04', kind: 'FNC', label: 'Fence post 4' },
  ];

  doc.lines = [
    { id: 'L-HSE-back', a: 'HSE01', b: 'HSE02', lengthM: 8.0, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-HSE-side', a: 'HSE01', b: 'HSE04', lengthM: 6.0, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-HSE-diag', a: 'HSE01', b: 'HSE03', lengthM: 10.0, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-HSE-front', a: 'HSE04', b: 'HSE03', lengthM: 8.0, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-HSE-side2', a: 'HSE02', b: 'HSE03', lengthM: 6.0, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-HSE-straight-back', a: 'HSE01', b: 'HSE02', kind: 'straight' },
    { id: 'L-HSE-straight-side', a: 'HSE01', b: 'HSE04', kind: 'straight' },
    { id: 'L-ROD-A', a: 'A1', b: 'A2', lengthM: ROD_LENGTH_M, sigmaM: SIGMA.rodLengthM, kind: 'rod' },
    { id: 'L-ROD-A-mid', a: 'A1', b: 'A0', lengthM: ROD_MID_M, sigmaM: SIGMA.rodLengthM, kind: 'rod' },
  ];

  doc.polygons = [
    { id: 'house', pointIds: ['HSE01', 'HSE02', 'HSE03', 'HSE04'], label: 'House' },
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

  // Photo geometry: 1200×900 frame. Canned clicks match a plausible perspective.
  // Tie photo: HSE01, HSE02, A1, A2 in frame.
  doc.photos = [
    {
      id: 'photo-tie-1',
      setupId,
      width: 1200,
      height: 900,
      thumbnailDataUrl: placeholderThumb('#4a6b52'),
      exifDateTimeOriginal: now,
      note: 'House corners + both ends of rod A',
      clicks: [
        { pointId: 'HSE01', px: 180, py: 720 },
        { pointId: 'HSE02', px: 980, py: 710 },
        { pointId: 'A1', px: 420, py: 280 },
        { pointId: 'A2', px: 780, py: 270 },
      ],
    },
    {
      id: 'photo-occ-1',
      setupId,
      occupyPointId: 'BED01P1',
      width: 1200,
      height: 900,
      thumbnailDataUrl: placeholderThumb('#7a9e7e'),
      exifDateTimeOriginal: now,
      note: 'Occupy BED01P1 — rod A live',
      clicks: [
        { pointId: 'A1', px: 350, py: 400 },
        { pointId: 'A2', px: 850, py: 390 },
        { pointId: 'HSE02', px: 200, py: 650 },
      ],
    },
    {
      id: 'photo-occ-2',
      setupId,
      occupyPointId: 'BED02P1',
      width: 1200,
      height: 900,
      thumbnailDataUrl: placeholderThumb('#8fb894'),
      exifDateTimeOriginal: now,
      note: 'Occupy BED02P1 — rod A live',
      clicks: [
        { pointId: 'A1', px: 300, py: 450 },
        { pointId: 'A2', px: 700, py: 420 },
        { pointId: 'HSE03', px: 950, py: 600 },
      ],
    },
  ];

  doc.session = {
    mode: 'OCCUPY',
    speakSteps: false,
    geometryOk: true,
    lastAction: 'Loaded synthetic house + rod A + two occupy photos',
    currentSetupId: setupId,
    currentOccupyId: 'BED02P1',
  };

  return doc;
}

export function hasLiveControl(doc: GardenDocument): boolean {
  const setup = currentSetup(doc);
  if (!setup || setup.closed) return false;
  return setup.liveRodIds.length > 0;
}

export function currentSetup(doc: GardenDocument): Setup | undefined {
  const id = doc.session.currentSetupId;
  if (id) return doc.setups.find((s) => s.id === id);
  return doc.setups.find((s) => !s.closed);
}

export function houseRectangleClosed(doc: GardenDocument): boolean {
  const ids = ['HSE01', 'HSE02', 'HSE03', 'HSE04'];
  const pts = ids.map((id) => doc.points.find((p) => p.id === id));
  if (pts.some((p) => !p || p.x === undefined || p.y === undefined)) {
    // Also accept if we have enough tape lengths to close (synthetic / entered).
    const tapes = doc.lines.filter(
      (l) =>
        l.kind === 'tape' ||
        l.kind === 'laser',
    );
    const houseTapes = tapes.filter(
      (l) => l.a.startsWith('HSE') && l.b.startsWith('HSE') && l.lengthM != null,
    );
    return houseTapes.length >= 3;
  }
  return true;
}

export function rodAPlaced(doc: GardenDocument): boolean {
  const a1 = doc.points.find((p) => p.id === 'A1');
  const a2 = doc.points.find((p) => p.id === 'A2');
  const rodLine = doc.lines.find((l) => l.id === 'L-ROD-A' || (l.kind === 'rod' && l.a === 'A1' && l.b === 'A2'));
  return Boolean(a1 && a2 && rodLine?.lengthM === ROD_LENGTH_M);
}

export function tiePhotoReady(doc: GardenDocument): boolean {
  return doc.photos.some((ph) => {
    const ids = new Set(ph.clicks.map((c) => c.pointId));
    const houseCorners = [...ids].filter((id) => id.startsWith('HSE')).length;
    return houseCorners >= 2 && ids.has('A1') && ids.has('A2');
  });
}

/** Enter house corner lengths + straights so the rectangle can close (Layer A). */
export function applyHouseBaseline(
  doc: GardenDocument,
  backM: number,
  sideM: number,
  diagM: number,
): GardenDocument {
  const L = backM;
  const W = sideM;
  const points = doc.points.filter((p) => !p.id.startsWith('HSE'));
  points.push(
    { id: 'HSE01', kind: 'HSE', x: 0, y: 0, label: 'House SW', fixed: true },
    { id: 'HSE02', kind: 'HSE', x: L, y: 0, label: 'House SE', fixed: true },
    { id: 'HSE03', kind: 'HSE', x: L, y: W, label: 'House NE', fixed: true },
    { id: 'HSE04', kind: 'HSE', x: 0, y: W, label: 'House NW', fixed: true },
  );

  const lines = doc.lines.filter((l) => !(l.a.startsWith('HSE') && l.b.startsWith('HSE')));
  lines.push(
    { id: 'L-HSE-back', a: 'HSE01', b: 'HSE02', lengthM: L, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-HSE-side', a: 'HSE01', b: 'HSE04', lengthM: W, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-HSE-diag', a: 'HSE01', b: 'HSE03', lengthM: diagM, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-HSE-front', a: 'HSE04', b: 'HSE03', lengthM: L, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-HSE-side2', a: 'HSE02', b: 'HSE03', lengthM: W, sigmaM: SIGMA.tapeM, kind: 'tape' },
    { id: 'L-HSE-straight-back', a: 'HSE01', b: 'HSE02', kind: 'straight' },
    { id: 'L-HSE-straight-side', a: 'HSE01', b: 'HSE04', kind: 'straight' },
  );

  const polygons = doc.polygons.filter((p) => p.id !== 'house');
  polygons.push({ id: 'house', pointIds: ['HSE01', 'HSE02', 'HSE03', 'HSE04'], label: 'House' });

  return {
    ...doc,
    points,
    lines,
    polygons,
    session: {
      ...doc.session,
      lastAction: `House tapes entered (back ${L} m, side ${W} m, diagonal ${diagM} m)`,
      geometryOk: houseRectangleClosed({ ...doc, points, lines, polygons }),
    },
  };
}

/** Declare rod A (4.000 m) in view of the house — used when leaving PLACE_ROD_A / Rod A ready. */
export function declareRodA(doc: GardenDocument): GardenDocument {
  const h2 = doc.points.find((p) => p.id === 'HSE02');
  const h3 = doc.points.find((p) => p.id === 'HSE03');
  const houseDepth = h3?.y ?? 6;
  const houseWidth = h2?.x ?? 8;
  const y = houseDepth + 6;
  const x1 = Math.max(0, houseWidth / 2 - 2);
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

  return {
    ...doc,
    points,
    lines,
    session: {
      ...doc.session,
      lastAction: 'Rod A declared at 4.000 m with toilet-roll belts on both ends',
    },
  };
}

/** Canned four-mark tie photo (milestone / field when clicks are recorded). */
export function applyCannedTiePhoto(doc: GardenDocument): GardenDocument {
  if (tiePhotoReady(doc)) return doc;
  const setup = currentSetup(doc);
  const setupId = setup?.id ?? doc.session.currentSetupId ?? 'setup-1';
  const now = new Date().toISOString();
  const photo: Photo = {
    id: `photo-tie-${Date.now()}`,
    setupId,
    width: 1200,
    height: 900,
    thumbnailDataUrl: placeholderThumb('#4a6b52'),
    exifDateTimeOriginal: now,
    note: 'House corners + both ends of rod A',
    clicks: [
      { pointId: 'HSE01', px: 180, py: 720 },
      { pointId: 'HSE02', px: 980, py: 710 },
      { pointId: 'A1', px: 420, py: 280 },
      { pointId: 'A2', px: 780, py: 270 },
    ],
  };
  return {
    ...doc,
    photos: [...doc.photos, photo],
    session: {
      ...doc.session,
      lastAction: 'Tie photo recorded — two house corners and both ends of rod A',
    },
  };
}

/** Confirm A and B were photographed together (leapfrog gate before Rods moved). */
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
