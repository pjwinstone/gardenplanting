/**
 * Circle result step (rev 6): base-point network from the run's N/E ties, one photo per edge
 * point, session adjustment and per-point gates, then the circle fit and the comparison with the
 * taped diameter (docs/garden-circle.md). All on the phone.
 */

import type { GardenDocument, Photo } from '../../model';
import type { CircleVerdict } from '../../solver/circleCheck';
import {
  adjustGridNetwork,
  controlCircleVerdict,
  sightingsFromPhoto,
  subCovariance,
  type EdgeGate,
  type EdgePhoto,
  type GridNetworkResult,
} from '../../solver/controlCluster';
import { baseGridOf, baseNetworkForDoc } from '../../baseGrid';
import { linkedPhotosForStep } from './engine';
import { migrateFieldTestSetup } from './fieldTestMeta';
import { edgePointsFor } from './markerSet';
import { sleeveHeightPx } from './photoTaps';
import type { BaseTie, WorkflowRun } from './types';

export const TAPE_DIAMETER_STEP_ID = 'tape-diameter';
export const CIRCLE_RESULT_STEP_ID = 'circle-result';
export const EDGE_PHOTOS_STEP_ID = 'edge-photos';
export const EDGE_PHOTOS_STATION = 'Edge points';
export const CALIBRATION_STATION = 'Calibration';

/** Pixel σ of the calibration code length: auto-detected edges vs hand taps (per edge, full-res px). */
const CAL_EDGE_SIGMA_AUTO_PX = 0.5;
const CAL_EDGE_SIGMA_MANUAL_PX = 2;
/** Taped calibration distance σ, m. */
const CAL_DISTANCE_SIGMA_M = 0.005;

function ms(v?: string): number | undefined {
  if (!v) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

/**
 * Which edge point each photo stands on. Photos are taken round the circle in order; each new
 * photo takes the lowest-numbered edge point with no current photo, so a per-photo Retake (which
 * frees that photo's point) is replaced in place. Returns photoId → EDGnn for current photos.
 */
export function edgePhotoAssignments(photos: Photo[], names: string[]): Map<string, string> {
  type Ev = { t: number; k: 0 | 1; i: number; id: string };
  const evs: Ev[] = [];
  photos.forEach((p, i) => {
    const t = ms(p.originalFile?.capturedAt) ?? ms(p.exifDateTimeOriginal) ?? ms(p.originalFile?.receivedAt) ?? Number.MAX_SAFE_INTEGER;
    evs.push({ t, k: 1, i, id: p.id });
    const s = ms(p.supersededAt);
    if (s !== undefined) evs.push({ t: s, k: 0, i, id: p.id });
  });
  // Supersede before an arrival at the same instant; ties keep document order.
  evs.sort((a, b) => a.t - b.t || a.k - b.k || a.i - b.i);
  const slot = new Map<string, number>();
  const used = new Set<number>();
  for (const e of evs) {
    if (e.k === 0) {
      const n = slot.get(e.id);
      if (n !== undefined) used.delete(n);
      slot.delete(e.id);
    } else {
      let n = 0;
      while (used.has(n)) n += 1;
      if (n >= names.length) continue;
      used.add(n);
      slot.set(e.id, n);
    }
  }
  const out = new Map<string, string>();
  for (const [id, n] of slot) out.set(id, names[n]);
  return out;
}

export function edgeAssignmentsFor(doc: GardenDocument | null | undefined, run: WorkflowRun): Map<string, string> {
  if (!doc) return new Map();
  const values = migrateFieldTestSetup(run.setup?.values);
  return edgePhotoAssignments(linkedPhotosForStep(doc, EDGE_PHOTOS_STATION, run, EDGE_PHOTOS_STEP_ID), edgePointsFor(doc, values.edge_points));
}

/** Focal length from the step-8 calibration photo, full-resolution px, and its relative σ. */
export function calibrationFx(doc: GardenDocument, run: WorkflowRun): { fx: number; sigmaRel: number; method: 'auto' | 'manual' } | undefined {
  const values = migrateFieldTestSetup(run.setup?.values);
  const photo = linkedPhotosForStep(doc, CALIBRATION_STATION, run, 'camera-calibration').filter((p) => !p.supersededAt && p.measureTaps?.length).at(-1);
  if (!photo) return undefined;
  const h = sleeveHeightPx(photo.measureTaps!, photo.originalFile?.previewScaleY, photo.measureDetection);
  if (!h?.fullPx) return undefined;
  const d = values.calibration_distance_m;
  const fx = (h.fullPx * d) / (h.mm / 1000);
  const method = photo.measureDetection?.method === 'auto' ? 'auto' : 'manual';
  const edge = method === 'auto' ? CAL_EDGE_SIGMA_AUTO_PX : CAL_EDGE_SIGMA_MANUAL_PX;
  const sigmaRel = Math.hypot((Math.SQRT2 * edge) / h.fullPx, CAL_DISTANCE_SIGMA_M / d);
  return { fx, sigmaRel, method };
}

export function baseNetworkForRun(run: WorkflowRun): GridNetworkResult | undefined {
  const ties: BaseTie[] = run.baseTies ?? [];
  if (!ties.length) return undefined;
  try {
    return adjustGridNetwork('BAS01', ties);
  } catch {
    return undefined;
  }
}

export interface CircleResultDetail {
  verdict: CircleVerdict;
  gates: EdgeGate[];
  network?: GridNetworkResult;
  fx?: { fx: number; sigmaRel: number; method: 'auto' | 'manual' };
  /** Photos not levelled because they carry no gravity sidecar. */
  unlevelled: number;
}

export function circleResultDetailForRun(doc: GardenDocument | null | undefined, run: WorkflowRun): CircleResultDetail {
  const values = migrateFieldTestSetup(run.setup?.values);
  const needs = (headline: string, guidance: string[]): CircleResultDetail => ({ verdict: { state: 'needs-data', headline, guidance }, gates: [], unlevelled: 0 });
  if (!doc) return needs('No garden open.', []);
  // One base grid for the whole garden (Add point > Base point), plus older ties on this run.
  const grid = baseGridOf(doc, run);
  const network = baseNetworkForDoc(doc, run);
  if (!network) return needs('No base points yet.', ['Add base points with Add point > Base point (at least 3; 4 or more in view is better).']);
  const red = network.diagonals.filter((o) => o.flag === 'red');
  const fx = calibrationFx(doc, run);
  if (!fx) return { ...needs('No focal length yet.', ['Take and mark the calibration photo (step: Calibration photo).']), network };
  const ids = [...network.order];
  const postSep = (id: string) => grid.postSeparation[id] ?? values.post_separation_m;
  const control = [{ id: 'BAS01', x: 0, y: 0 }, ...ids.map((id) => ({ id, ...network.points[id] }))].map((c) => ({ ...c, postSeparationM: postSep(c.id) }));
  const sub = subCovariance(network, ids);
  // BAS01 is the datum: a tiny σ keeps the prior block positive definite.
  const n = 2 * control.length;
  const cov = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i < 2 || j < 2 ? (i === j ? 1e-8 : 0) : sub[i - 2][j - 2])));
  const known = new Set(control.map((c) => c.id));
  const assign = edgeAssignmentsFor(doc, run);
  const stepPhotos = linkedPhotosForStep(doc, EDGE_PHOTOS_STATION, run, EDGE_PHOTOS_STEP_ID).filter((p) => !p.supersededAt && assign.has(p.id));
  const tapped = new Set([...known, ...stepPhotos.flatMap((p) => p.clicks.map((c) => c.pointId)).filter((id) => /^BAS\d+$/.test(id))]);
  let unlevelled = 0;
  const misaligned: string[] = [];
  const photos: EdgePhoto[] = stepPhotos
    .map((p) => {
      const s = sightingsFromPhoto(p, tapped, fx.fx);
      if (!s.levelled) unlevelled += 1;
      for (const id of s.misaligned) misaligned.push(`${assign.get(p.id)} ${id}`);
      return { pointId: assign.get(p.id)!, sightings: s.sightings };
    })
    .sort((a, b) => a.pointId.localeCompare(b.pointId));
  // 3+ tied base points, or exactly 2 that are both two-sleeve posts (the 2-point fix).
  const usable = photos.filter((p) => {
    const tied = p.sightings.filter((x) => known.has(x.id));
    return tied.length >= 3 || (tied.length === 2 && tied.every((x) => x.dyPx != null));
  });
  if (usable.length < 3) {
    return { ...needs(`${usable.length} edge photo${usable.length === 1 ? '' : 's'} with 3 or more base points tapped (or 2 two-sleeve posts). The circle needs at least 8.`, ['Take one photo from each edge point and tap the base points in it.']), network, fx, unlevelled };
  }
  const centre = control.reduce((s, c) => ({ x: s.x + c.x / control.length, y: s.y + c.y / control.length }), { x: 0, y: 0 });
  try {
    const runWith = (controlCovariance: number[][]) => controlCircleVerdict(
      {
        control,
        controlCovariance,
        photos: usable,
        fx0: fx.fx,
        calibrationSigmaRel: fx.sigmaRel,
        searchCentre: centre,
        searchRadiusM: values.circle_diameter_m + 6,
      },
      {
        tapes: run.circleTape ? { diametersM: run.circleTape.diametersM, edge: run.circleTape.edge } : undefined,
        capM: values.tolerances_mm.circle_diameter_baseline / 1000,
        plantableCapM: values.tolerances_mm.circle_diameter_plantable / 1000,
        plannedPoints: values.edge_points,
      },
    );
    const out = runWith(cov);
    const verdict = { ...out.verdict };
    // Diagonal-warning scaling may push the result out of tolerance: that is amber, not red.
    if (verdict.state === 'red' && network.warnings.some((w) => w.factor > 1)) {
      const raw = subCovariance({ ...network, covariance: network.covarianceUnscaled }, ids);
      const rawCov = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i < 2 || j < 2 ? (i === j ? 1e-8 : 0) : raw[i - 2][j - 2])));
      if (runWith(rawCov).verdict.state !== 'red') verdict.state = 'amber';
    }
    const extra: string[] = [];
    if (network.warnings.length) extra.push(...network.warnings.map((w) => `${w.point}: ${w.text}.`));
    const skipped = photos.length - usable.length;
    if (skipped) extra.push(`${skipped} edge photo${skipped === 1 ? '' : 's'} left out: fewer than 3 tied base points tapped (and not 2 two-sleeve posts).`);
    if (misaligned.length) extra.push(`Two-sleeve post not used (top and bottom sleeve not one above the other): ${misaligned.join(', ')}. Check the taps, or plumb the post.`);
    const twoPoint = out.gates.filter((g) => g.twoPointFix).map((g) => g.pointId);
    if (twoPoint.length) extra.push(`2-point fix (unchecked) on ${twoPoint.join(', ')}: only 2 two-sleeve posts in view; amber at best.`);
    if (out.gates.some((g) => g.calibrateFirst)) {
      extra.push(`Calibrate first: the focal length is known to ±${(fx.sigmaRel * 100).toFixed(2)} % (needs 0.5 %). Retake the calibration photo; let the app find the sleeve edges.`);
      if (verdict.state === 'green') verdict.state = 'amber';
    }
    if (red.length && verdict.state === 'green') verdict.state = 'amber';
    verdict.guidance = [...extra, ...verdict.guidance];
    return { verdict, gates: out.gates, network, fx, unlevelled };
  } catch (err) {
    return { ...needs(`The edge photos do not solve yet: ${(err as Error).message}`, ['Check each edge photo has 4 or more base points tapped.']), network, fx, unlevelled };
  }
}

export function circleResultForRun(doc: GardenDocument | null | undefined, run: WorkflowRun): CircleVerdict {
  return circleResultDetailForRun(doc, run).verdict;
}
