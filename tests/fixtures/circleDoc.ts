/**
 * A synthetic circle-test garden for tests and the iPhone (Playwright) checks: 4 base points near
 * the middle of a 12 m circle, a calibration photo, and `edges` edge photos with every base point
 * tapped (exact bearings, so every point solves). Thumbnails are tall labelled SVGs so a list of
 * photos needs scrolling on an iPhone.
 */
import { emptyDocument, type GardenDocument, type Photo } from '../../src/model';
import { upsertBasePoint } from '../../src/baseGrid';
import { projectU, sightingsFromPhoto } from '../../src/solver/controlCluster';
import { confirmSetupWorkflow, emptyProgress, startWorkflow } from '../../src/workflows/guided/engine';

export const FIX_FX = 2690;
const W = 4032;
const H = 3024;
const START = '2026-10-28T09:00:00.000Z';
const BASE = [
  { id: 'BAS01', x: 0, y: 0 },
  { id: 'BAS02', x: 4.5, y: 0 },
  { id: 'BAS03', x: 0, y: 4.5 },
  { id: 'BAS04', x: 4, y: 5 },
  { id: 'BAS05', x: 2.2, y: 2.4 },
];
const CENTRE = { x: 2.2, y: 2.4 };
const R = 6;

function thumb(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="hsl(${hue},45%,70%)"/><text x="200" y="165" font-size="54" text-anchor="middle" font-family="Arial">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function at(min: number): string {
  return new Date(Date.parse(START) + min * 60_000).toISOString();
}

function photo(id: string, addPointId: string, min: number, label: string, hue: number, extra: Partial<Photo> = {}): Photo {
  return {
    id,
    setupId: 's',
    addPointId,
    width: W,
    height: H,
    clicks: [],
    thumbnailDataUrl: thumb(label, hue),
    originalFile: { fileName: `${id}.jpg`, capturedAt: at(min), receivedAt: at(min), uploadStatus: 'verified', fullWidth: W, fullHeight: H, previewScaleX: 1, previewScaleY: 1 } as never,
    ...extra,
  } as Photo;
}

export function buildCircleDoc(edges = 5): GardenDocument {
  let d = emptyDocument('circle-fixture');
  d = upsertBasePoint(d, { id: 'BAS01' }, START);
  for (const b of BASE.slice(1)) d = upsertBasePoint(d, { id: b.id, from: 'BAS01', northM: b.y, eastM: b.x, diagonalM: Math.hypot(b.x, b.y) }, START);
  let progress = startWorkflow(emptyProgress(), 'circle-field-test', START).progress;
  progress = confirmSetupWorkflow(progress, undefined, START).progress;
  const run = progress.runs['circle-field-test']!;
  progress = { ...progress, runs: { ...progress.runs, 'circle-field-test': { ...run, currentStepId: 'edge-photos' } } };
  const stations = [
    { id: 'CAL', kind: 'OCC', label: 'Calibration', x: 0, y: -4 },
    { id: 'EDGEPTS', kind: 'OCC', label: 'Edge points', x: CENTRE.x, y: CENTRE.y },
  ];
  const photos: Photo[] = [];
  // Calibration: band code 247 mm at 4 m (the Set-up default).
  photos.push(photo('cal1', 'CAL', 1, 'Calibration', 200, {
    measureTaps: [{ pointId: 'SLEEVE-TOP', px: 2000, py: 1300 }, { pointId: 'SLEEVE-BOTTOM', px: 2000, py: 1500 }],
    measureDetection: { method: 'auto', confidence: 0.95, codeLengthFullPx: (FIX_FX * 0.247) / 4 } as never,
  }));
  const ids = new Set(BASE.map((b) => b.id));
  for (let i = 0; i < edges; i++) {
    const a = (2 * Math.PI * i) / 12;
    // Pegs a few mm off the true circle, so the fit has residuals.
    const r = R + [0.008, -0.012, 0.005, -0.006, 0.01, -0.003, 0.007, -0.009, 0.004, -0.005, 0.006, -0.002][i % 12]!;
    const c = { x: CENTRE.x + r * Math.cos(a), y: CENTRE.y + r * Math.sin(a) };
    const yaw = Math.atan2(CENTRE.y - c.y, CENTRE.x - c.x);
    const clicks = BASE.map((b) => ({ pointId: b.id, px: W / 2 - projectU({ ...c, yaw }, b, FIX_FX), py: H / 2 }));
    const p = photo(`edge${i + 1}`, 'EDGEPTS', 10 + i, `EDG${String(i + 1).padStart(2, '0')}`, (i * 47) % 360, { clicks, tapsSavedAt: at(10 + i) });
    // Self-check the bearing sign against the app's own reader.
    const back = sightingsFromPhoto(p, ids, FIX_FX).sightings[0]!.u;
    if (Math.abs(back - projectU({ ...c, yaw }, BASE[0]!, FIX_FX)) > 1e-3) {
      p.clicks = BASE.map((b) => ({ pointId: b.id, px: W / 2 + projectU({ ...c, yaw }, b, FIX_FX), py: H / 2 }));
    }
    photos.push(p);
  }
  return { ...d, points: [...d.points, ...(stations as never[])], photos: [...d.photos, ...photos], workflowProgress: progress } as GardenDocument;
}
