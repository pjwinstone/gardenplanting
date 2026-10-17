/**
 * Walk round the house. The guided engine stays generic: this module folds
 * the traverse entities after a tick, and the chrome calls `nextTraverse`
 * only for this workflow's Next.
 *
 * Gates agreed for this loop: ray r ≥ 0.13, cross-tie tape r ≥ 0.34, tape
 * MDB ≤ 21.3 mm. The older 0.05 / 50 mm figures are not used.
 */

import type { GardenDocument, Line, Photo, Traverse, TraverseLeg, TraverseMisclosure, TraverseSetup } from '../../model';
import { housePolygon } from '../../model';
import { stampPhotoFocals } from '../../photoFocal';
import { solve } from '../../solver/adjust';
import { closureReport } from '../../solver/closure';
import { sliceTraverseStep, solveTraverseStep, type IncrementalStepReport, type IncrementalTie } from '../../solver/incremental';
import { ELLIPSE_95, PLANTABLE_CLASS_M, STATION_CLASS_M, W_CRITICAL } from '../../solver/constants';
import type { SolveInput, SolveObservation, SolveResult, SolverDistanceInput, SolverPhotoInput } from '../../solver/types';
import {
  advanceWorkflow,
  applyWorkflowEvent,
  commitWorkflow,
  photoIsUploadFresh,
  readProgress,
  restartWorkflow,
  setWorkflowEventHook,
  setWorkflowStepGate,
  withWorkflowEvent,
} from './engine';
import type { FieldStatus, WorkflowEvent, WorkflowLink, WorkflowProgress, WorkflowRun } from './types';

export const RAY_R_MIN = 0.13;
export const CROSS_TAPE_R_MIN = 0.34;
export const TAPE_MDB_MAX_MM = 21.3;
export const TARGET_MM = 21;
export const NEAR_START_M = 3;

export const GOOD_LEG = 'Good — move to the next corner';
export const LOOP_CLOSES = 'Loop closes within expected error ✓';
export const RAW_GAP_NOTE = 'The raw gap is not a test for a bad reading.';
export const TAPE_MISTAKE_LINE = `Tape mistakes over ${TARGET_MM} mm would be caught.`;
export const NO_SINGLE_READING = "Loop doesn't close — no single reading stands out. Check the closing tapes and photos.";
const NAME_MARGIN = 1.5;
const RHO_SPLIT = 0.9;

export const CROSS_TIE_PROMPT = 'Add a cross-tie before the next leg.';
export const LEG_NOT_TAPED = 'Tape the new corner before the next leg.';
export const LEG_CHECKED = 'This leg is checked. Tape the next corner, or close when you are back near the start.';
export const LEG_UNSETTLED = 'The leg is not settled.';
export const CLOSE_HOLD = 'Tape back to the start, then re-occupy it.';

export interface LegGate {
  ok: boolean;
  prompt?: string;
  rayR: number | null;
  crossR: number | null;
  tapeMdbMm: number | null;
}

export interface TraverseMove {
  doc: GardenDocument;
  notice?: string;
  link?: WorkflowLink;
  changed: boolean;
}

/** Rays, cross-tie tapes, and tape MDB. A missing ray or cross-tie does not fail on its own. */
export function classifyGate(
  ties: IncrementalTie[],
  distances: { id: string; role?: string }[],
  settled = true,
): LegGate {
  const roleOf = new Map(distances.map((row) => [row.id, row.role]));
  const rays = ties.filter((tie) => tie.kind === 'ray');
  const tapes = ties.filter((tie) => tie.kind === 'tape');
  const cross = tapes.filter((tie) => roleOf.get(tie.id) === 'cross');
  const rayR = rays.length ? Math.min(...rays.map((tie) => tie.redundancy)) : null;
  const crossR = cross.length ? Math.min(...cross.map((tie) => tie.redundancy)) : null;
  const tapeMm = tapes.map((tie) => (tie.mdb == null ? null : tie.mdb * 1000));
  const knownMm = tapeMm.filter((value): value is number => value != null);
  const tapeMdbMm = knownMm.length ? Math.max(...knownMm) : null;
  const rayFail = rayR != null && rayR < RAY_R_MIN;
  const crossFail = crossR != null && crossR < CROSS_TAPE_R_MIN;
  const tapeFail = tapes.length > 0 && (tapeMm.some((value) => value == null) || (tapeMdbMm ?? 0) > TAPE_MDB_MAX_MM);
  const ok = settled && ties.length > 0 && !rayFail && !crossFail && !tapeFail;
  return { ok, prompt: ok ? undefined : CROSS_TIE_PROMPT, rayR, crossR, tapeMdbMm };
}

/** The tape or photo the amber line names. Cross-ties come before rays. */
export function nextAction(
  ties: IncrementalTie[],
  distances: { id: string; a?: string; b?: string; role?: string }[],
  photos: { id: string; stationId?: string }[] = [],
): string {
  const roleOf = new Map(distances.map((row) => [row.id, row.role]));
  const ends = new Map(distances.map((row) => [row.id, row]));
  const tapeFails = (tie: IncrementalTie) => tie.mdb == null || tie.mdb * 1000 > TAPE_MDB_MAX_MM;
  const crossFails = (tie: IncrementalTie) => roleOf.get(tie.id) === 'cross' && (tie.redundancy < CROSS_TAPE_R_MIN || tapeFails(tie));
  const worst = (rows: IncrementalTie[]) => [...rows].sort((a, b) => (b.mdb ?? 0) - (a.mdb ?? 0) || a.redundancy - b.redundancy)[0];
  const cross = worst(ties.filter((tie) => tie.kind === 'tape' && crossFails(tie)));
  const tape = cross ?? worst(ties.filter((tie) => tie.kind === 'tape' && tapeFails(tie)));
  if (tape) {
    const pair = ends.get(tape.id);
    if (pair?.a && pair.b) return `Re-tape ${pair.a} → ${pair.b}`;
  }
  const ray = [...ties.filter((tie) => tie.kind === 'ray' && tie.redundancy < RAY_R_MIN)]
    .sort((a, b) => a.redundancy - b.redundancy)[0];
  if (ray) {
    const cut = ray.id.lastIndexOf(':');
    const pointId = cut >= 0 ? ray.id.slice(cut + 1) : ray.id;
    const photoId = cut >= 0 ? ray.id.slice(0, cut) : '';
    const station = photos.find((photo) => photo.id === photoId)?.stationId ?? 'here';
    return `Add a photo: from ${station} include ${pointId}`;
  }
  return CROSS_TIE_PROMPT;
}

/** Corners and house marks clicked from one camera setup. Datum ends are not listed. */
export function onceSeenMarks(doc: GardenDocument, throughStep: number, datum: string[] = []): string[] {
  const skip = new Set(datum);
  const seen = new Map<string, Set<string>>();
  for (const photo of warningPhotos(doc)) {
    if (photo.step == null || photo.step > throughStep) continue;
    const station = photo.stationId ?? photo.addPointId;
    if (!station) continue;
    const setupId = photo.cameraSetupId ?? `${station}|${photo.closing || photo.role === 'close' ? 'close' : 'open'}`;
    for (const click of photo.clicks) {
      if (!/^[CH]/.test(click.pointId) || unsuffix(click.pointId) || skip.has(click.pointId)) continue;
      const setups = seen.get(click.pointId) ?? new Set<string>();
      setups.add(setupId);
      seen.set(click.pointId, setups);
    }
  }
  return [...seen.entries()].filter(([, setups]) => setups.size === 1).map(([id]) => id).sort();
}

export function blockedLine(markId: string): string {
  return `Blocked: ${markId} is only seen from one setup — photograph it from here`;
}

function classToleranceMm(markId: string): number {
  const metres = markId.startsWith('S') ? STATION_CLASS_M : PLANTABLE_CLASS_M;
  return metres * 1000;
}

/** 95% semi-major against the class tolerance. `semiMajorM` is the 1σ figure. */
export function legHeadline(markId: string, semiMajorM: number): string {
  const mm = Math.round(ELLIPSE_95 * semiMajorM * 1000);
  return `${markId} ± ${mm} mm (95%, target ± ${classToleranceMm(markId)} mm)`;
}

/** Tick anyway cannot complete a step whose gate is blocking. The engine calls the same check. */
export function gatedTickRefusal(doc: GardenDocument, stepId: string): string | null {
  return stepGateImpl(readProgress(doc), stepId, doc);
}

/** House marks clicked from one camera setup in the revealed prefix. */
export function singleSetupWarning(doc: GardenDocument, throughStep: number): string | null {
  const seen = new Map<string, Set<string>>();
  for (const photo of warningPhotos(doc)) {
    if (photo.step == null || photo.step > throughStep) continue;
    const station = photo.stationId ?? photo.addPointId;
    if (!station) continue;
    const setupId = photo.cameraSetupId ?? `${station}|${photo.closing || photo.role === 'close' ? 'close' : 'open'}`;
    for (const click of photo.clicks) {
      if (!click.pointId.startsWith('H')) continue;
      const setups = seen.get(click.pointId) ?? new Set<string>();
      setups.add(setupId);
      seen.set(click.pointId, setups);
    }
  }
  const once = [...seen.entries()].filter(([, setups]) => setups.size === 1).map(([id]) => id).sort();
  if (!once.length) return null;
  return `Re-shoot ${once[0]} from here; you will not see it again.`;
}

/** Datum ends stay while this house run is the one on screen and it matches the walk. */
export function datumRemovalBlock(doc: GardenDocument, pointId: string): string | null {
  const traverse = doc.houseTraverse;
  if (!traverse || traverse.status === 'closed') return null;
  const run = houseRun(doc);
  if (!run || traverse.runId !== run.startedAt) return null;
  const [a, b] = traverse.markOrder;
  if (pointId !== a && pointId !== b) return null;
  return `${pointId} stays until the loop is closed. It is a datum end.`;
}

export function closeSentence(doc: GardenDocument): string {
  const [start, second] = doc.houseTraverse?.markOrder ?? [];
  const a = start || 'the start';
  const b = second || 'the second datum end';
  return `Close the loop: tape to ${a}, then re-occupy ${a} and photograph the last mark and ${b} with the first house mark.`;
}

/** Rebuild the solver input from the garden. Setup centring, shared phone and 1× lens. */
export function traverseSolveInput(doc: GardenDocument): SolveInput | null {
  const traverse = doc.houseTraverse;
  if (!traverse || traverse.markOrder.length < 2) return null;
  const [originId, axisPointId] = traverse.markOrder;
  const baseline = doc.baselines.find((item) =>
    (item.a === originId && item.b === axisPointId) || (item.a === axisPointId && item.b === originId),
  );
  if (!baseline) return null;
  const phoneId = traverse.phoneId || 'ph1';
  const lens = traverse.lens || '1x';
  const distances: SolverDistanceInput[] = runLines(doc).map((line) => ({
    id: line.id,
    a: line.a,
    b: line.b,
    slopeM: line.lengthM as number,
    sigmaM: line.sigmaM,
    step: line.step,
    role: line.role,
    instrument: line.kind === 'laser' ? 'laser' : line.kind === 'rod' ? 'rod' : 'tape',
  }));
  const photos: SolverPhotoInput[] = [];
  for (const photo of runPhotos(doc)) {
    if (photo.fxOverWidth == null) continue;
    const stationId = photo.stationId ?? photo.addPointId;
    if (!stationId) continue;
    photos.push(photoInput(photo, stationId, phoneId, lens));
  }
  return {
    cameraCentring: 'setup',
    datum: {
      originId,
      axisPointId,
      lengthM: baseline.lengthM,
      sigmaM: baseline.sigmaM,
      instrument: baseline.kind,
    },
    points: doc.points.map((point) => ({ id: point.id })),
    distances,
    photos,
  };
}

function photoInput(photo: Photo, stationId: string, phoneId: string, lens: string): SolverPhotoInput {
  return {
    id: photo.id,
    stationId,
    width: photo.width,
    height: photo.height,
    fxOverWidth: photo.fxOverWidth as number,
    clicks: photo.clicks.map((click) => ({ pointId: click.pointId, px: click.px, py: click.py })),
    gravity: photo.gravity ?? { x: 0, y: 1, z: 0 },
    sigmaPx: photo.sigmaPx,
    sigmaCentringM: photo.sigmaCentringM,
    fxRelativeUncertainty: photo.fxRelativeUncertainty,
    phoneId: photo.phoneId ?? phoneId,
    lens: photo.lens ?? lens,
    cameraSetupId: photo.cameraSetupId,
    step: photo.step,
    role: photo.role,
    closing: photo.closing,
  };
}

/** The newest corner and the two datum ends, while this house run is active. */
export function walkMarkIds(doc: GardenDocument): string[] | null {
  const traverse = doc.houseTraverse;
  const run = houseRun(doc);
  if (!traverse || !run || traverse.runId !== run.startedAt || traverse.markOrder.length < 2) return null;
  const ids = traverse.markOrder.slice(0, 2);
  const newest = traverse.newestId
    ?? [...(housePolygon(doc)?.pointIds ?? [])].reverse().find((id) => !ids.includes(id));
  if (newest && !ids.includes(newest)) ids.push(newest);
  return ids;
}

export function nextTraverse(doc: GardenDocument, now = new Date().toISOString()): TraverseMove {
  const progress = readProgress(doc);
  const run = progress.activeId === 'house-traverse' ? progress.runs['house-traverse'] : undefined;
  if (!run || run.finishedAt) return { doc, notice: 'Start a workflow first.', changed: false };
  if (run.currentStepId === 'leg') return nextLeg(doc, now);
  let current = doc;
  if (run.currentStepId === 'close' && run.steps.close?.status !== 'complete') {
    current = arriveClose(doc, now);
    const closed = readProgress(current).runs['house-traverse'];
    if (closed?.steps.close?.status !== 'complete') {
      const waiting = closeView(current);
      return { doc: current, notice: waiting.status?.line ?? CLOSE_HOLD, changed: current !== doc };
    }
  }
  const before = readProgress(current).runs['house-traverse'];
  if (before?.currentStepId === 'closure-review') {
    const review = reviewView(current);
    if (review.status?.blocked) {
      return { doc: current, notice: review.status.line, changed: current !== doc };
    }
  }
  const move = advanceWorkflow(readProgress(current), now, current);
  let next = move.changed ? commitWorkflow(current, move.progress) : current;
  next = refreshArrived(next, now);
  const arrived = readProgress(next).runs['house-traverse'];
  const arrivedView = walkView(next);
  const notice = arrived?.currentStepId === 'close' || arrived?.currentStepId === 'closure-review'
    ? arrivedView.status?.line
    : move.notice;
  return { doc: next, notice, link: move.link, changed: next !== doc || move.changed };
}

function nextLeg(doc: GardenDocument, now: string): TraverseMove {
  const view = computeLeg(doc);
  if (!view?.status || view.status.blocked) {
    return { doc, notice: view?.status?.line ?? LEG_NOT_TAPED, changed: false };
  }
  const traverse = doc.houseTraverse;
  const input = traverseSolveInput(doc);
  if (
    traverse?.observedStep != null
    && traverse.newestId
    && input
    && !traverse.closeRequested
    && !nearStart(doc, input, traverse.observedStep, traverse.newestId)
  ) {
    return { doc, notice: LEG_CHECKED, changed: false };
  }
  const ticked = applyPhase(doc, 'leg', now);
  const move = advanceWorkflow(readProgress(ticked), now, ticked);
  let next = move.changed ? commitWorkflow(ticked, move.progress) : ticked;
  next = refreshArrived(next, now);
  return { doc: next, notice: walkView(next).status?.line, link: move.link, changed: true };
}

function refreshArrived(doc: GardenDocument, now: string): GardenDocument {
  const step = readProgress(doc).runs['house-traverse']?.currentStepId;
  if (step === 'close') return arriveClose(doc, now);
  if (step === 'closure-review') return arriveReview(doc, now);
  return doc;
}

function arriveClose(doc: GardenDocument, now: string): GardenDocument {
  if (!closingReady(doc)) return doc;
  let next = doc;
  const traverse = next.houseTraverse;
  if (traverse && traverse.status !== 'closed') {
    next = { ...next, houseTraverse: { ...traverse, status: 'closed', closedAt: now, closeRequested: true } };
  }
  if (readProgress(next).runs['house-traverse']?.steps.close?.status === 'complete') return next;
  return applyPhase(next, 'close', now);
}

function arriveReview(doc: GardenDocument, now: string): GardenDocument {
  const built = reviewView(doc);
  if (!built.misclosure || built.status?.blocked) return doc;
  if (readProgress(doc).runs['house-traverse']?.steps['closure-review']?.status === 'complete') return doc;
  return applyPhase(doc, 'closure-review', now);
}

function closureLines(doc: GardenDocument, now: string): { lines: string[]; report: boolean; status: FieldStatus; misclosure?: TraverseMisclosure } {
  const unsettled: FieldStatus = { tone: 'red', blocked: true, line: 'The closure is not settled.', note: RAW_GAP_NOTE };
  const traverse = doc.houseTraverse;
  const input = traverse ? traverseSolveInput(doc) : null;
  if (!traverse || !input) return { lines: ['The closure is not settled.'], report: false, status: unsettled };
  let result;
  try {
    result = solve(input);
  } catch {
    return { lines: ['The closure is not settled.'], report: false, status: unsettled };
  }
  const pairs = closurePairs(doc);
  const startId = traverse.markOrder[0];
  const fromId = [...traverse.markOrder].reverse().find((id) => id !== startId) ?? traverse.markOrder[1];
  const report = result.converged
    ? closureReport(result, { pairs, fromId, startId, axisId: traverse.markOrder[1] })
    : null;
  if (!report) return { lines: ['The closure is not settled.'], report: false, status: unsettled };
  const stored: TraverseMisclosure = {
    w: { x: report.positionM.x, y: report.positionM.y },
    qW: report.qW,
    alongM: report.alongM,
    acrossM: report.acrossM,
    azimuthRad: report.azimuthRad,
    chi2: report.chi2,
    rank: report.rank,
    pass: report.chi2Pass,
    positionPass: report.positionPass,
    azimuthPass: report.azimuthPass,
    rawMisclosureM: report.rawMisclosureM,
    rawMisclosureIsBlunderTest: false,
    computedAt: now,
  };
  const along = report.alongM * 1000;
  const across = report.acrossM * 1000;
  const az = (report.azimuthRad * 180) / Math.PI;
  const sigma = result.sigma0 == null ? '—' : result.sigma0.toFixed(2);
  const vPv = result.vPv == null ? '—' : result.vPv.toFixed(2);
  const lines = [
    `Along ${along.toFixed(1)} mm (1σ ${(report.sigmaAlongM * 1000).toFixed(1)} mm). Across ${across.toFixed(1)} mm (1σ ${(report.sigmaAcrossM * 1000).toFixed(1)} mm). Azimuth ${az.toFixed(3)}° (1σ ${((report.sigmaAzimuthRad * 180) / Math.PI).toFixed(3)}°).`,
    `χ² ${report.chi2.toFixed(2)} against ${report.chi2Limit95.toFixed(2)} at rank ${report.rank}: ${report.chi2Pass ? 'pass' : 'fail'}.`,
    `Variance factor ${sigma} (${result.varianceTest}). vPv ${vPv}. dof ${result.degreesOfFreedom}.`,
    `Flags: position χ² ${report.positionPass ? 'pass' : 'fail'}, azimuth ${report.azimuthPass ? 'pass' : 'fail'}.`,
    'The raw misclosure is not a blunder test.',
  ];
  return { lines, report: true, status: closureVerdict(report, result), misclosure: stored };
}

interface ReadingCandidate {
  label: string;
  prompt: string;
  absW: number;
  memberIds: string[];
}

/** Pass or fail is the closure χ² only. A large w-test or a high variance factor stays amber. */
export function closureVerdict(report: { chi2Pass: boolean }, result: SolveResult): FieldStatus {
  const candidates = readingCandidates(result);
  const top = candidates[0];
  const second = candidates[1];
  const isolated = !!top
    && top.absW > W_CRITICAL
    && (!second || top.absW >= second.absW * NAME_MARGIN)
    && (!second || !readingsTied(result, top, second));
  const large = candidates.filter((item) => item.absW > W_CRITICAL);
  const dirty = large.length > 0 || result.varianceTest === 'high';
  if (report.chi2Pass && !dirty) {
    return { tone: 'green', blocked: false, line: LOOP_CLOSES, note: RAW_GAP_NOTE };
  }
  const prefix = report.chi2Pass ? 'Suspect reading — ' : "Loop doesn't close — ";
  let line: string;
  if (isolated && top) line = `${prefix}likely blunder at ${top.label} (${top.prompt})`;
  else if (large.length > 0) line = `${prefix}may be ${listed(contested(candidates))}.`;
  else if (report.chi2Pass) line = 'The readings don\'t agree. Check the closing tapes and photos.';
  else line = NO_SINGLE_READING;
  return {
    tone: report.chi2Pass ? 'amber' : 'red',
    blocked: true,
    line,
    note: RAW_GAP_NOTE,
  };
}

function readingCandidates(result: SolveResult): ReadingCandidate[] {
  const rows = result.observations.filter((row) =>
    row.used && row.standardised != null && (row.kind === 'distance' || row.kind === 'bearing'));
  const consumed = new Set<string>();
  const out: ReadingCandidate[] = [];
  const byPhoto = new Map<string, SolveObservation[]>();
  for (const row of rows) {
    if (row.kind !== 'bearing') continue;
    const cut = row.id.lastIndexOf(':');
    const photoId = cut >= 0 ? row.id.slice(0, cut) : row.id;
    const list = byPhoto.get(photoId) ?? [];
    list.push(row);
    byPhoto.set(photoId, list);
  }
  for (const [photoId, rays] of byPhoto) {
    if (rays.length < 2 || !photoRaysTied(result, rays)) continue;
    const strongest = [...rays].sort((a, b) => Math.abs(b.standardised ?? 0) - Math.abs(a.standardised ?? 0))[0];
    out.push({
      label: `photo ${photoId}`,
      prompt: `re-shoot ${photoId}`,
      absW: Math.abs(strongest.standardised ?? 0),
      memberIds: rays.map((ray) => ray.id),
    });
    for (const ray of rays) consumed.add(ray.id);
  }
  for (const row of rows) {
    if (consumed.has(row.id)) continue;
    out.push(singleReading(row));
  }
  out.sort((a, b) => b.absW - a.absW || a.label.localeCompare(b.label));
  return out;
}

function singleReading(row: SolveObservation): ReadingCandidate {
  const absW = Math.abs(row.standardised ?? 0);
  if (row.kind === 'distance' && row.pointIds.length >= 2) {
    const [a, b] = row.pointIds;
    return { label: `${a}–${b}`, prompt: `re-tape ${a} → ${b}`, absW, memberIds: [row.id] };
  }
  const cut = row.id.lastIndexOf(':');
  const photoId = cut >= 0 ? row.id.slice(0, cut) : row.id;
  const pointId = cut >= 0 ? row.id.slice(cut + 1) : row.id;
  return { label: `${pointId} on ${photoId}`, prompt: `re-shoot ${photoId}`, absW, memberIds: [row.id] };
}

function photoRaysTied(result: SolveResult, rays: SolveObservation[]): boolean {
  for (let i = 0; i < rays.length; i++) {
    for (let j = i + 1; j < rays.length; j++) {
      const rho = result.residualCorrelation(rays[i].id, rays[j].id);
      if (rho != null && Math.abs(rho) >= RHO_SPLIT) return true;
    }
  }
  return false;
}

function readingsTied(result: SolveResult, a: ReadingCandidate, b: ReadingCandidate): boolean {
  let saw = false;
  for (const left of a.memberIds) {
    for (const right of b.memberIds) {
      const rho = result.residualCorrelation(left, right);
      if (rho == null) continue;
      saw = true;
      if (Math.abs(rho) >= RHO_SPLIT) return true;
    }
  }
  return !saw;
}

function contested(candidates: ReadingCandidate[]): ReadingCandidate[] {
  const large = candidates.filter((item) => item.absW > W_CRITICAL);
  if (large.length >= 2) return large;
  if (large.length === 1 && candidates.length >= 2) return [candidates[0], candidates[1]];
  return large;
}

function listed(candidates: ReadingCandidate[]): string {
  const labels = candidates.map((item) => item.label);
  if (labels.length <= 1) return labels[0] ?? 'the closing tapes and photos';
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`;
}

function closurePairs(doc: GardenDocument): { id: string; duplicateId: string }[] {
  const ids = new Set(doc.points.map((point) => point.id));
  const pairs: { id: string; duplicateId: string }[] = [];
  for (const point of doc.points) {
    const plain = unsuffix(point.id);
    if (!plain || !ids.has(plain)) continue;
    pairs.push({ id: plain, duplicateId: point.id });
  }
  pairs.sort((a, b) => a.id.localeCompare(b.id));
  return pairs;
}

function unsuffix(id: string): string | null {
  if (id.endsWith("'") || id.endsWith('′')) return id.slice(0, -1);
  return null;
}

function stepLines(doc: GardenDocument, report: IncrementalStepReport, gate: LegGate, step: number, heldForClosure = false): string[] {
  const lines = [
    `${report.newestId} 1σ ellipse ${((report.semiMajorM ?? 0) * 1000).toFixed(1)} mm.`,
    `Tape MDB ${report.tieMdbMm == null ? '—' : report.tieMdbMm.toFixed(1)} mm. Ray MDB ${report.tieRayMdbMrad == null ? '—' : report.tieRayMdbMrad.toFixed(1)} mrad.`,
    `Ray r ${fmt(gate.rayR)}. Cross-tie r ${fmt(gate.crossR)}.`,
    `fx σ ${report.fxSigma == null ? '—' : `${(report.fxSigma * 100).toFixed(3)}%`}.`,
  ];
  if (!gate.ok && !heldForClosure) lines.push(CROSS_TIE_PROMPT);
  const warning = singleSetupWarning(doc, step);
  if (warning) lines.push(warning);
  return lines;
}

function fmt(value: number | null): string {
  return value == null ? '—' : value.toFixed(3);
}

/**
 * A requested close is judged on the open-chain ties. Tapes and rays that
 * land on a duplicate mark (C1′) are the closure observations. The closure
 * review tests those. They are not another leg's cross-tie.
 */
function tiesForNextLeg(ties: IncrementalTie[], input: SolveInput, closing: boolean): IncrementalTie[] {
  if (!closing) return ties;
  return ties.filter((tie) => !tieLandsOnDuplicate(tie, input));
}

function tieLandsOnDuplicate(tie: IncrementalTie, input: SolveInput): boolean {
  const distance = (input.distances ?? []).find((item) => item.id === tie.id);
  if (distance) return isDuplicateMark(distance.a) || isDuplicateMark(distance.b);
  const pointId = tie.id.slice(tie.id.lastIndexOf(':') + 1);
  if (isDuplicateMark(pointId)) return true;
  const photoId = tie.id.slice(0, tie.id.lastIndexOf(':'));
  const photo = (input.photos ?? []).find((item) => item.id === photoId);
  return !!photo && isDuplicateMark(photo.stationId);
}

function isDuplicateMark(id: string): boolean {
  return unsuffix(id) != null;
}

function nearStart(doc: GardenDocument, input: SolveInput, step: number, newestId: string): boolean {
  const origin = doc.houseTraverse?.markOrder[0];
  if (!origin) return false;
  try {
    const result = solve(sliceTraverseStep(input, step));
    const newest = result.points.find((point) => point.id === newestId);
    const start = result.points.find((point) => point.id === origin);
    if (!newest || newest.x == null || newest.y == null) return false;
    return Math.hypot(newest.x - (start?.x ?? 0), newest.y - (start?.y ?? 0)) <= NEAR_START_M;
  } catch {
    return false;
  }
}

function closingReady(doc: GardenDocument): boolean {
  return hasClosingPhoto(doc) && tapeTouchesStart(doc);
}

function hasClosingPhoto(doc: GardenDocument): boolean {
  return runPhotos(doc).some((photo) => photo.closing === true || photo.role === 'close');
}

function tapeTouchesStart(doc: GardenDocument): boolean {
  const origin = doc.houseTraverse?.markOrder[0];
  if (!origin) return false;
  return runLines(doc).some((line) => line.role === 'leg' && (sameMark(line.a, origin) || sameMark(line.b, origin)));
}

function sameMark(id: string, origin: string): boolean {
  return id === origin || id === `${origin}'` || id === `${origin}′`;
}

function applyPhase(doc: GardenDocument, phase: 'datum' | 'leg' | 'close' | 'closure-review' | 'adjust', now: string): GardenDocument {
  const applied = applyWorkflowEvent(readProgress(doc), { type: 'traverse.phase', phase }, now);
  return commitWorkflow(doc, applied);
}

function publishLeg(
  doc: GardenDocument,
  report: IncrementalStepReport,
  input: SolveInput,
  step: number,
  closing: boolean,
): WalkView {
  const ties = tiesForNextLeg(report.ties, input, closing);
  const gate = classifyGate(ties, input.distances ?? [], true);
  // Closure tapes and rays are judged by the closure χ², not as another leg.
  const heldForClosure = closing && report.ties.length > 0 && ties.length === 0;
  const gateOk = gate.ok || heldForClosure;
  return {
    lines: stepLines(doc, report, gate, step, heldForClosure),
    status: legStatus(doc, report, ties, input, gateOk, closing),
  };
}

function legStatus(
  doc: GardenDocument,
  report: IncrementalStepReport,
  ties: IncrementalTie[],
  input: SolveInput,
  gateOk: boolean,
  closing: boolean,
): FieldStatus {
  const semi = report.semiMajorM ?? 0;
  const headline = legHeadline(report.newestId, semi);
  const shared = {
    headline,
    accuracyMm: ELLIPSE_95 * semi * 1000,
    targetMm: classToleranceMm(report.newestId),
    note: TAPE_MISTAKE_LINE,
  };
  const once = onceSeenMarks(doc, report.step, (doc.houseTraverse?.markOrder ?? []).slice(0, 2));
  const named = once.includes(report.newestId) ? report.newestId : once[0];
  if (named && !closing) return { ...shared, tone: 'red', blocked: true, line: blockedLine(named) };
  if (!gateOk) {
    return {
      ...shared,
      tone: 'amber',
      blocked: true,
      line: nextAction(ties, input.distances ?? [], input.photos ?? []),
    };
  }
  return { ...shared, tone: 'green', blocked: false, line: GOOD_LEG };
}

function houseRun(doc: GardenDocument): WorkflowRun | undefined {
  const progress = readProgress(doc);
  if (progress.activeId !== 'house-traverse') return undefined;
  const run = progress.runs['house-traverse'];
  if (!run || run.finishedAt) return undefined;
  return run;
}

function consumedIds(run: WorkflowRun): Set<string> {
  const taken = new Set<string>();
  for (const state of Object.values(run.steps)) {
    for (const photoId of state.consumedPhotoIds ?? []) taken.add(photoId);
  }
  return taken;
}

/** Tapes saved for this run, after it started, with a step. */
function runLines(doc: GardenDocument): Line[] {
  const traverse = doc.houseTraverse;
  const run = houseRun(doc);
  if (!traverse?.runId || !run || traverse.runId !== run.startedAt) return [];
  const start = Date.parse(traverse.startedAt || run.startedAt);
  if (!Number.isFinite(start)) return [];
  return doc.lines.filter((line) => {
    if (line.lengthM == null || line.step == null || line.runId !== traverse.runId) return false;
    const at = Date.parse(line.recordedAt ?? '');
    return Number.isFinite(at) && at >= start;
  });
}

/** Photos for this run: tagged, after the start, upload-checked, and not already consumed. */
function runPhotos(doc: GardenDocument): Photo[] {
  const traverse = doc.houseTraverse;
  const run = houseRun(doc);
  if (!traverse?.runId || !run || traverse.runId !== run.startedAt) return [];
  const taken = consumedIds(run);
  return doc.photos.filter((photo) => {
    if (photo.runId !== traverse.runId || photo.step == null) return false;
    if (photo.fxOverWidth == null) return false;
    if (!photo.stationId && !photo.addPointId) return false;
    return photoIsUploadFresh(photo, run.startedAt, taken);
  });
}

export interface WalkView {
  status?: FieldStatus;
  lines: string[];
  /** In memory for the closure screen. Not written onto the garden. */
  misclosure?: TraverseMisclosure;
}

/** The outdoor status. Derived from this run's tapes and photos, not stored. */
export function walkView(doc: GardenDocument): WalkView {
  const run = houseRun(doc);
  if (!run) return { lines: [] };
  if (run.currentStepId === 'leg') return computeLeg(doc) ?? { lines: [], status: { tone: 'amber', blocked: true, line: LEG_NOT_TAPED } };
  if (run.currentStepId === 'close') return closeView(doc);
  if (run.currentStepId === 'closure-review') return reviewView(doc);
  return { lines: [] };
}

function computeLeg(doc: GardenDocument): WalkView | null {
  const traverse = doc.houseTraverse;
  if (!traverse || traverse.observedStep == null || !traverse.newestId) return null;
  const input = traverseSolveInput(doc);
  if (!input) return { lines: [LEG_UNSETTLED], status: { tone: 'red', blocked: true, line: LEG_UNSETTLED } };
  let report: IncrementalStepReport;
  try {
    report = solveTraverseStep(input, { step: traverse.observedStep, newestId: traverse.newestId });
  } catch {
    return { lines: [LEG_UNSETTLED], status: { tone: 'red', blocked: true, line: LEG_UNSETTLED } };
  }
  if (!report.converged || report.semiMajorM == null) {
    return { lines: [LEG_UNSETTLED], status: { tone: 'red', blocked: true, line: LEG_UNSETTLED } };
  }
  return publishLeg(doc, report, input, traverse.observedStep, traverse.closeRequested === true);
}

function closeView(doc: GardenDocument): WalkView {
  const start = doc.houseTraverse?.markOrder[0] || 'the start';
  if (!closingReady(doc)) {
    return {
      lines: [closeSentence(doc)],
      status: { tone: 'amber', blocked: true, line: `Tape to ${start}, then stand there again.` },
    };
  }
  return { lines: [], status: { tone: 'green', blocked: false, line: 'Good — read the closure.' } };
}

function reviewView(doc: GardenDocument): WalkView {
  const built = closureLines(doc, new Date().toISOString());
  return { lines: built.lines, status: built.status, misclosure: built.misclosure };
}

function isBaselinePair(doc: GardenDocument, a: string, b: string): boolean {
  if (!a || !b) return false;
  return doc.baselines.some((item) =>
    (item.a === a && item.b === b) || (item.a === b && item.b === a));
}

function foldTraverse(doc: GardenDocument, event: WorkflowEvent, now: string): GardenDocument {
  if (readProgress(doc).activeId !== 'house-traverse') return doc;
  if (event.type === 'baseline.saved' && event.kind === 'tape') return ensureTraverse(doc, event);
  if (event.type === 'traverse.observe') return observe(doc, event);
  if (event.type === 'traverse.close') return requestClose(doc);
  if (event.type === 'tape.entered') {
    const a = event.endAId || event.endA;
    const b = event.endBId || event.endB;
    if (isBaselinePair(doc, a, b)) return doc;
    return saveWalkTape(doc, { a, b, lengthM: event.lengthM }, now);
  }
  if (event.type === 'photo.uploaded') return noteVerifiedPhotos(doc, event.photoIds);
  return doc;
}

function ensureTraverse(doc: GardenDocument, event: Extract<WorkflowEvent, { type: 'baseline.saved' }>): GardenDocument {
  const run = houseRun(doc);
  if (!run) return doc;
  if (doc.houseTraverse?.runId === run.startedAt) return doc;
  const a = event.endAId || event.endA;
  const b = event.endBId || event.endB;
  if (!a || !b) return doc;
  const archived = doc.houseTraverse ? [...(doc.pastTraverses ?? []), doc.houseTraverse] : doc.pastTraverses;
  const traverse: Traverse = {
    id: `traverse-${run.startedAt}`,
    runId: run.startedAt,
    startedAt: run.startedAt,
    phoneId: 'ph1',
    lens: '1x',
    markOrder: [a, b],
    status: 'open',
  };
  return {
    ...doc,
    houseTraverse: traverse,
    pastTraverses: archived,
    traverseLegs: [],
    traverseSetups: [],
    traverseMisclosure: undefined,
  };
}

function requestClose(doc: GardenDocument): GardenDocument {
  const traverse = doc.houseTraverse;
  if (!traverse || traverse.closeRequested) return doc;
  return { ...doc, houseTraverse: { ...traverse, closeRequested: true } };
}

function observe(doc: GardenDocument, event: Extract<WorkflowEvent, { type: 'traverse.observe' }>): GardenDocument {
  const traverse = doc.houseTraverse;
  const run = houseRun(doc);
  if (!traverse || !run || traverse.runId !== run.startedAt || traverse.status === 'closed') return doc;
  const markOrder = traverse.markOrder.includes(event.newestId)
    ? traverse.markOrder
    : [...traverse.markOrder, event.newestId];
  const next: GardenDocument = {
    ...doc,
    houseTraverse: { ...traverse, markOrder, observedStep: event.step, newestId: event.newestId },
  };
  return recordLeg(next, event.step, event.newestId);
}

function recordLeg(doc: GardenDocument, step: number, newestId: string): GardenDocument {
  const traverse = doc.houseTraverse;
  if (!traverse) return doc;
  const tapes = runLines(doc).filter((line) => line.step === step && (line.role === 'leg' || line.role === 'cross'));
  const photos = runPhotos(doc).filter((photo) => photo.step === step);
  const legTape = tapes.find((line) => line.role === 'leg' && (line.a === newestId || line.b === newestId));
  const previous = traverse.markOrder.filter((id) => id !== newestId);
  const from = legTape ? (legTape.a === newestId ? legTape.b : legTape.a) : (previous[previous.length - 1] ?? traverse.markOrder[0]);
  const setups = setupsFor(photos, step, traverse);
  const hasCross = tapes.some((line) => line.role === 'cross');
  const hasPhotos = photos.some((photo) => photo.role === 'leg' || photo.role === 'occupy' || photo.role === 'close' || photo.closing);
  const tieKind: TraverseLeg['tieKind'] = hasCross && hasPhotos ? 'both' : hasCross ? 'crossTies' : 'photos';
  const leg: TraverseLeg = {
    id: `leg-${step}`,
    runId: traverse.runId,
    startedAt: traverse.startedAt,
    from,
    to: newestId,
    step,
    tapeIds: tapes.map((line) => line.id),
    tieKind,
    setupIds: setups.map((setup) => setup.id),
    stationIds: [...new Set(setups.map((setup) => setup.stationId))],
  };
  return {
    ...doc,
    traverseLegs: [...(doc.traverseLegs ?? []).filter((item) => item.runId === traverse.runId && item.step !== step), leg],
    traverseSetups: [...(doc.traverseSetups ?? []).filter((item) => item.runId === traverse.runId && item.step !== step), ...setups],
  };
}

function setupsFor(photos: Photo[], step: number, traverse: Traverse): TraverseSetup[] {
  const setups: TraverseSetup[] = [];
  const seen = new Set<string>();
  for (const photo of photos) {
    const stationId = photo.stationId ?? photo.addPointId;
    if (!stationId) continue;
    const id = photo.cameraSetupId ?? `${stationId}|${photo.closing || photo.role === 'close' ? 'close' : 'open'}`;
    if (seen.has(id)) continue;
    seen.add(id);
    setups.push({ id, stationId, step, runId: traverse.runId, startedAt: traverse.startedAt });
  }
  return setups;
}

function warningPhotos(doc: GardenDocument): Photo[] {
  const run = houseRun(doc);
  if (run && doc.houseTraverse?.runId === run.startedAt) return runPhotos(doc);
  return doc.photos;
}

export interface WalkTapeInput {
  a: string;
  b: string;
  lengthM: number;
  sigmaM?: number;
  role?: Line['role'];
  id?: string;
  step?: number;
  newestId?: string;
}

/** Tag a tape for the active walk and re-check the leg. No-op outside Leg or Close. */
export function saveWalkTape(doc: GardenDocument, tape: WalkTapeInput, now = new Date().toISOString()): GardenDocument {
  const run = houseRun(doc);
  if (!run || (run.currentStepId !== 'leg' && run.currentStepId !== 'close')) return doc;
  const traverse = doc.houseTraverse;
  if (!traverse?.runId || traverse.runId !== run.startedAt || traverse.status === 'closed') return doc;
  if (isBaselinePair(doc, tape.a, tape.b)) return doc;
  const role = tape.role ?? ((traverse.markOrder.includes(tape.a) && traverse.markOrder.includes(tape.b)) ? 'cross' : 'leg');
  const fresh = role === 'leg' ? [tape.b, tape.a].find((id) => id && !traverse.markOrder.includes(id)) : undefined;
  if (tape.step == null && role === 'leg' && fresh && traverse.observedStep != null) {
    const view = computeLeg(doc);
    if (!view?.status || view.status.line === LEG_UNSETTLED) {
      return {
        ...doc,
        session: {
          ...doc.session,
          lastAction: 'This corner is not settled. Stay on it before you tape the next one.',
        },
      };
    }
  }
  const step = tape.step ?? (
    role === 'cross' || !fresh
      ? (traverse.observedStep ?? 0)
      : (traverse.observedStep == null ? 0 : traverse.observedStep + 1)
  );
  const newestId = tape.newestId ?? fresh ?? traverse.newestId;
  const id = tape.id ?? `tape-${tape.a}-${tape.b}-${step}`;
  const line: Line = {
    id,
    a: tape.a,
    b: tape.b,
    lengthM: tape.lengthM,
    sigmaM: tape.sigmaM,
    kind: 'tape',
    step,
    role,
    runId: traverse.runId,
    recordedAt: now,
  };
  const lines = doc.lines.some((item) => item.id === id)
    ? doc.lines.map((item) => (item.id === id ? { ...item, ...line } : item))
    : [...doc.lines, line];
  const next = { ...doc, lines };
  if (!newestId) return next;
  return observe(next, { type: 'traverse.observe', step, newestId });
}

/** Stamp a new + Point photo with this run. It counts once the upload is verified. */
export function noteWalkPhoto(doc: GardenDocument, photoId: string): GardenDocument {
  const run = houseRun(doc);
  const traverse = doc.houseTraverse;
  if (!run || !traverse?.runId || traverse.runId !== run.startedAt) return doc;
  if (run.currentStepId !== 'leg' && run.currentStepId !== 'close') return doc;
  const closing = run.currentStepId === 'close' || traverse.closeRequested === true;
  return {
    ...doc,
    photos: doc.photos.map((photo) => (photo.id === photoId ? {
      ...photo,
      runId: traverse.runId,
      step: photo.step ?? traverse.observedStep ?? 0,
      role: photo.role ?? (closing ? 'close' as const : 'leg' as const),
      stationId: photo.stationId ?? photo.addPointId,
      closing: photo.closing ?? (closing ? true : undefined),
    } : photo)),
  };
}

/** Add or replace a walk photo, then re-check when the upload is fresh. */
export function saveWalkPhoto(doc: GardenDocument, photo: Photo): GardenDocument {
  const nextPhotos = doc.photos.some((item) => item.id === photo.id)
    ? doc.photos.map((item) => (item.id === photo.id ? { ...item, ...photo } : item))
    : [...doc.photos, photo];
  return noteVerifiedPhotos({ ...doc, photos: nextPhotos }, [photo.id]);
}

export function noteVerifiedPhotos(doc: GardenDocument, photoIds: string[]): GardenDocument {
  let next = stampPhotoFocals(doc, photoIds);
  for (const photoId of photoIds) {
    next = noteWalkPhoto(next, photoId);
    const photo = next.photos.find((item) => item.id === photoId);
    const traverse = next.houseTraverse;
    const run = houseRun(next);
    if (!photo || !traverse || !run || photo.step == null || !traverse.newestId) continue;
    if (!photoIsUploadFresh(photo, run.startedAt, consumedIds(run))) continue;
    if (traverse.observedStep != null && photo.step < traverse.observedStep) continue;
    next = observe(next, { type: 'traverse.observe', step: photo.step, newestId: traverse.newestId });
  }
  return next;
}

/** The Close the loop control. */
export function closeWalk(doc: GardenDocument, now = new Date().toISOString()): GardenDocument {
  return withWorkflowEvent(doc, { type: 'traverse.close' }, now);
}

/** Drop a walk that belongs to an earlier run, and release the datum lock. */
export function releaseStaleWalk(doc: GardenDocument): GardenDocument {
  const traverse = doc.houseTraverse;
  if (!traverse) return doc;
  const run = houseRun(doc);
  if (run && traverse.runId === run.startedAt) return doc;
  return {
    ...doc,
    pastTraverses: [...(doc.pastTraverses ?? []), traverse],
    houseTraverse: undefined,
    traverseLegs: [],
    traverseSetups: [],
    traverseMisclosure: undefined,
  };
}

/** Start over for this walk: new run, archived walk, datum ends free. */
export function restartHouseWalk(doc: GardenDocument, now = new Date().toISOString()): GardenDocument {
  let progress = readProgress(doc);
  const existing = progress.runs['house-traverse'];
  if (existing && !existing.finishedAt) {
    progress = {
      ...progress,
      runs: {
        ...progress.runs,
        'house-traverse': { ...existing, finishedAt: existing.updatedAt || now },
      },
    };
  }
  const move = restartWorkflow(progress, 'house-traverse', now);
  if (!move.changed) return doc;
  return releaseStaleWalk(commitWorkflow(doc, move.progress));
}

function stepGateImpl(progress: WorkflowProgress, stepId: string, doc: GardenDocument | undefined): string | null {
  if (progress.activeId !== 'house-traverse') return null;
  const run = progress.runs['house-traverse'];
  if (!run || run.finishedAt) return null;
  if (run.steps[stepId]?.status === 'complete') return null;
  if (!doc) return 'This step is not ready.';
  if (stepId === 'datum') return 'Tape the house edge first.';
  if (stepId === 'leg') {
    const view = computeLeg(doc);
    if (!view?.status || view.status.blocked) return view?.status?.line ?? LEG_NOT_TAPED;
    return null;
  }
  if (stepId === 'close') {
    const view = closeView(doc);
    return view.status?.blocked ? view.status.line : null;
  }
  if (stepId === 'closure-review') {
    const view = reviewView(doc);
    if (view.misclosure && !view.status?.blocked) return null;
    return view.status?.line ?? 'The closure is not settled.';
  }
  if (stepId === 'adjust') {
    if (run.steps['closure-review']?.status === 'complete') return null;
    return 'Read the closure before Adjust.';
  }
  return 'This step is not ready.';
}

setWorkflowStepGate(stepGateImpl);
setWorkflowEventHook(foldTraverse);
