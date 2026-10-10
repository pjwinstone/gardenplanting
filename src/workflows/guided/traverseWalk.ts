/**
 * Walk round the house. The guided engine stays generic: this module folds
 * the traverse entities after a tick, and the chrome calls `nextTraverse`
 * only for this workflow's Next.
 *
 * Gates agreed for this loop: ray r ≥ 0.13, cross-tie tape r ≥ 0.34, tape
 * MDB ≤ 21.3 mm. The older 0.05 / 50 mm figures are not used.
 */

import type { GardenDocument, Photo, Traverse, TraverseLeg, TraverseMisclosure, TraverseSetup } from '../../model';
import { solve } from '../../solver/adjust';
import { closureReport } from '../../solver/closure';
import { sliceTraverseStep, solveTraverseStep, type IncrementalStepReport, type IncrementalTie } from '../../solver/incremental';
import type { SolveInput, SolveResult, SolverDistanceInput, SolverPhotoInput } from '../../solver/types';
import {
  advanceWorkflow,
  applyWorkflowEvent,
  commitWorkflow,
  readProgress,
  setWorkflowEventHook,
} from './engine';
import type { FieldStatus, WorkflowEvent, WorkflowLink, WorkflowRun } from './types';

export const RAY_R_MIN = 0.13;
export const CROSS_TAPE_R_MIN = 0.34;
export const TAPE_MDB_MAX_MM = 21.3;
export const TARGET_MM = 21;
export const NEAR_START_M = 3;

export const GOOD_LEG = 'Good — move to the next corner';
export const LOOP_CLOSES = 'Loop closes within expected error ✓';
export const RAW_GAP_NOTE = 'The raw gap is not a test for a bad reading.';

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
  const ok = settled && !rayFail && !crossFail && !tapeFail;
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
    if (pair?.a && pair.b) return `Add a cross-tie: tape ${pair.a} → ${pair.b}`;
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
  for (const photo of doc.photos) {
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

export function legHeadline(markId: string, semiMajorM: number): string {
  return `${markId} ± ${Math.round(semiMajorM * 1000)} mm (target ± ${TARGET_MM} mm)`;
}

/** Tick anyway cannot complete a step whose gate is blocking. */
export function gatedTickRefusal(doc: GardenDocument, stepId: string): string | null {
  const progress = readProgress(doc);
  if (progress.activeId !== 'house-traverse') return null;
  const run = progress.runs['house-traverse'];
  if (!run?.fieldStatus?.blocked || stepId !== run.currentStepId) return null;
  return run.fieldStatus.line;
}

/** House marks clicked from one camera setup in the revealed prefix. */
export function singleSetupWarning(doc: GardenDocument, throughStep: number): string | null {
  const seen = new Map<string, Set<string>>();
  for (const photo of doc.photos) {
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

/** C1 and C2 stay while the loop is open. Closed loops use the ordinary delete rules. */
export function datumRemovalBlock(doc: GardenDocument, pointId: string): string | null {
  const traverse = doc.houseTraverse;
  if (!traverse || traverse.status === 'closed') return null;
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
  const distances: SolverDistanceInput[] = doc.lines
    .filter((line) => line.lengthM != null)
    .map((line) => ({
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
  for (const photo of doc.photos) {
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
      return { doc: current, notice: CLOSE_HOLD, changed: current !== doc };
    }
  }
  const before = readProgress(current).runs['house-traverse'];
  if (before?.currentStepId === 'closure-review' && before.fieldStatus?.blocked) {
    return { doc: current, notice: before.fieldStatus.line, changed: current !== doc };
  }
  const move = advanceWorkflow(readProgress(current), now);
  let next = move.changed ? commitWorkflow(current, move.progress) : current;
  next = refreshArrived(next, now);
  const arrived = readProgress(next).runs['house-traverse'];
  const notice = arrived?.currentStepId === 'close' ? arrived.fieldStatus?.line : move.notice;
  return { doc: next, notice, link: move.link, changed: next !== doc || move.changed };
}

function nextLeg(doc: GardenDocument, now: string): TraverseMove {
  const traverse = doc.houseTraverse;
  if (!traverse || traverse.observedStep == null || !traverse.newestId) {
    const next = setLive(doc, [], { tone: 'amber', blocked: true, line: LEG_NOT_TAPED });
    return { doc: next, notice: LEG_NOT_TAPED, changed: next !== doc };
  }
  const input = traverseSolveInput(doc);
  let report: IncrementalStepReport | null = null;
  if (input) {
    try {
      report = solveTraverseStep(input, { step: traverse.observedStep, newestId: traverse.newestId });
    } catch {
      report = null;
    }
  }
  if (!input || !report || !report.converged || report.semiMajorM == null) {
    const next = setLive(doc, [LEG_UNSETTLED], { tone: 'red', blocked: true, line: LEG_UNSETTLED });
    return { doc: next, notice: LEG_UNSETTLED, changed: next !== doc };
  }
  const shown = publishLeg(doc, report, input, traverse.observedStep, traverse.closeRequested === true);
  const status = readProgress(shown).runs['house-traverse']?.fieldStatus;
  if (status?.blocked) return { doc: shown, notice: status.line, changed: shown !== doc };
  if (!traverse.closeRequested && !nearStart(shown, input, traverse.observedStep, traverse.newestId)) {
    return { doc: shown, notice: LEG_CHECKED, changed: shown !== doc };
  }
  const ticked = applyPhase(shown, 'leg', now);
  const move = advanceWorkflow(readProgress(ticked), now);
  let next = move.changed ? commitWorkflow(ticked, move.progress) : ticked;
  next = refreshArrived(next, now);
  const arrived = readProgress(next).runs['house-traverse'];
  return { doc: next, notice: arrived?.fieldStatus?.line, link: move.link, changed: true };
}

function refreshArrived(doc: GardenDocument, now: string): GardenDocument {
  const step = readProgress(doc).runs['house-traverse']?.currentStepId;
  if (step === 'close') return arriveClose(doc, now);
  if (step === 'closure-review') return arriveReview(doc, now);
  return doc;
}

function arriveClose(doc: GardenDocument, now: string): GardenDocument {
  const ready = closingReady(doc);
  const start = doc.houseTraverse?.markOrder[0] || 'the start';
  const status: FieldStatus = ready
    ? { tone: 'green', blocked: false, line: 'Good — read the closure.' }
    : { tone: 'amber', blocked: true, line: `Tape to ${start}, then stand there again.` };
  let next = setLive(doc, ready ? [] : [closeSentence(doc)], status);
  if (!ready) return next;
  const traverse = next.houseTraverse;
  if (traverse && traverse.status !== 'closed') {
    next = { ...next, houseTraverse: { ...traverse, status: 'closed', closedAt: now, closeRequested: true } };
  }
  if (readProgress(next).runs['house-traverse']?.steps.close?.status === 'complete') return next;
  next = applyPhase(next, 'close', now);
  return setLive(next, [], status);
}

function arriveReview(doc: GardenDocument, now: string): GardenDocument {
  const built = closureLines(doc, now);
  let next = built.doc;
  if (!built.report) return setLive(next, built.lines, built.status);
  if (readProgress(next).runs['house-traverse']?.steps['closure-review']?.status !== 'complete') {
    next = applyPhase(next, 'closure-review', now);
  }
  return setLive(next, built.lines, built.status);
}

function closureLines(doc: GardenDocument, now: string): { doc: GardenDocument; lines: string[]; report: boolean; status: FieldStatus } {
  const unsettled: FieldStatus = { tone: 'red', blocked: true, line: 'The closure is not settled.', note: RAW_GAP_NOTE };
  const traverse = doc.houseTraverse;
  const input = traverse ? traverseSolveInput(doc) : null;
  if (!traverse || !input) return { doc, lines: ['The closure is not settled.'], report: false, status: unsettled };
  let result;
  try {
    result = solve(input);
  } catch {
    return { doc, lines: ['The closure is not settled.'], report: false, status: unsettled };
  }
  const pairs = closurePairs(doc);
  const startId = traverse.markOrder[0];
  const fromId = [...traverse.markOrder].reverse().find((id) => id !== startId) ?? traverse.markOrder[1];
  const report = result.converged
    ? closureReport(result, { pairs, fromId, startId, axisId: traverse.markOrder[1] })
    : null;
  if (!report) return { doc, lines: ['The closure is not settled.'], report: false, status: unsettled };
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
  const lines = [
    `Along ${along.toFixed(1)} mm (1σ ${(report.sigmaAlongM * 1000).toFixed(1)} mm). Across ${across.toFixed(1)} mm (1σ ${(report.sigmaAcrossM * 1000).toFixed(1)} mm). Azimuth ${az.toFixed(3)}° (1σ ${((report.sigmaAzimuthRad * 180) / Math.PI).toFixed(3)}°).`,
    `χ² ${report.chi2.toFixed(2)} against ${report.chi2Limit95.toFixed(2)} at rank ${report.rank}: ${report.chi2Pass ? 'pass' : 'fail'}.`,
    `Flags: position χ² ${report.positionPass ? 'pass' : 'fail'}, azimuth ${report.azimuthPass ? 'pass' : 'fail'}.`,
    'The raw misclosure is not a blunder test.',
  ];
  return { doc: { ...doc, traverseMisclosure: stored }, lines, report: true, status: closureStatus(report, result) };
}

function closureStatus(report: { chi2Pass: boolean; positionPass: boolean; azimuthPass: boolean }, result: SolveResult): FieldStatus {
  const closes = report.chi2Pass && report.positionPass && report.azimuthPass;
  if (closes) return { tone: 'green', blocked: false, line: LOOP_CLOSES, note: RAW_GAP_NOTE };
  const suspect = flaggedDistance(result);
  const line = suspect
    ? `Loop doesn't close — likely blunder at ${suspect.at} (re-tape ${suspect.tape})`
    : "Loop doesn't close — the checks failed.";
  return { tone: 'red', blocked: true, line, note: RAW_GAP_NOTE };
}

function flaggedDistance(result: SolveResult): { at: string; tape: string } | null {
  const rows = result.observations
    .filter((row) => row.used && row.flagged && row.kind === 'distance' && row.pointIds.length >= 2 && row.standardised != null)
    .sort((a, b) => Math.abs(b.standardised ?? 0) - Math.abs(a.standardised ?? 0));
  const hit = rows[0];
  if (!hit) return null;
  const [a, b] = hit.pointIds;
  return { at: `${a}–${b}`, tape: `${a} → ${b}` };
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

function stepLines(doc: GardenDocument, report: IncrementalStepReport, gate: LegGate, step: number): string[] {
  const lines = [
    `${report.newestId} 1σ ellipse ${((report.semiMajorM ?? 0) * 1000).toFixed(1)} mm.`,
    `Tape MDB ${report.tieMdbMm == null ? '—' : report.tieMdbMm.toFixed(1)} mm. Ray MDB ${report.tieRayMdbMrad == null ? '—' : report.tieRayMdbMrad.toFixed(1)} mrad.`,
    `Ray r ${fmt(gate.rayR)}. Cross-tie r ${fmt(gate.crossR)}.`,
    `fx σ ${report.fxSigma == null ? '—' : `${(report.fxSigma * 100).toFixed(3)}%`}.`,
  ];
  if (!gate.ok) lines.push(CROSS_TIE_PROMPT);
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
  return doc.photos.some((photo) => photo.closing === true || photo.role === 'close');
}

function tapeTouchesStart(doc: GardenDocument): boolean {
  const origin = doc.houseTraverse?.markOrder[0];
  if (!origin) return false;
  return doc.lines.some((line) => line.lengthM != null && line.role === 'leg' && (sameMark(line.a, origin) || sameMark(line.b, origin)));
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
): GardenDocument {
  const ties = tiesForNextLeg(report.ties, input, closing);
  const gate = classifyGate(ties, input.distances ?? [], true);
  return setLive(doc, stepLines(doc, report, gate, step), legStatus(doc, report, ties, input, gate.ok, closing));
}

function legStatus(
  doc: GardenDocument,
  report: IncrementalStepReport,
  ties: IncrementalTie[],
  input: SolveInput,
  gateOk: boolean,
  closing: boolean,
): FieldStatus {
  const headline = legHeadline(report.newestId, report.semiMajorM ?? 0);
  const accuracyMm = (report.semiMajorM ?? 0) * 1000;
  const shared = { headline, accuracyMm, targetMm: TARGET_MM };
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

function setLive(doc: GardenDocument, lines: string[], status?: FieldStatus): GardenDocument {
  const progress = readProgress(doc);
  const id = progress.activeId;
  const run = id ? progress.runs[id] : undefined;
  if (!id || !run) return doc;
  const sameLines = (run.liveLines ?? []).join('\n') === lines.join('\n');
  const sameStatus = JSON.stringify(run.fieldStatus ?? null) === JSON.stringify(status ?? null);
  if (sameLines && sameStatus) return doc;
  const nextRun: WorkflowRun = { ...run, liveLines: lines.length ? lines : undefined, fieldStatus: status };
  return commitWorkflow(doc, { ...progress, runs: { ...progress.runs, [id]: nextRun } });
}

function foldTraverse(doc: GardenDocument, event: WorkflowEvent, now: string): GardenDocument {
  if (readProgress(doc).activeId !== 'house-traverse') return doc;
  if (event.type === 'baseline.saved' && event.kind === 'tape') return ensureTraverse(doc, event, now);
  if (event.type === 'traverse.observe') return observe(doc, event);
  if (event.type === 'traverse.close') return requestClose(doc);
  return doc;
}

function ensureTraverse(doc: GardenDocument, event: Extract<WorkflowEvent, { type: 'baseline.saved' }>, now: string): GardenDocument {
  if (doc.houseTraverse) return doc;
  const a = event.endAId || event.endA;
  const b = event.endBId || event.endB;
  if (!a || !b) return doc;
  const traverse: Traverse = {
    id: `traverse-${now}`,
    phoneId: 'ph1',
    lens: '1x',
    markOrder: [a, b],
    status: 'open',
  };
  return { ...doc, houseTraverse: traverse };
}

function requestClose(doc: GardenDocument): GardenDocument {
  const traverse = doc.houseTraverse;
  if (!traverse || traverse.closeRequested) return doc;
  return { ...doc, houseTraverse: { ...traverse, closeRequested: true } };
}

function observe(doc: GardenDocument, event: Extract<WorkflowEvent, { type: 'traverse.observe' }>): GardenDocument {
  const traverse = doc.houseTraverse;
  if (!traverse || traverse.status === 'closed') return doc;
  const markOrder = traverse.markOrder.includes(event.newestId)
    ? traverse.markOrder
    : [...traverse.markOrder, event.newestId];
  let next: GardenDocument = {
    ...doc,
    houseTraverse: { ...traverse, markOrder, observedStep: event.step, newestId: event.newestId },
  };
  next = recordLeg(next, event.step, event.newestId);
  const input = traverseSolveInput(next);
  if (!input) return setLive(next, [LEG_UNSETTLED], { tone: 'red', blocked: true, line: LEG_UNSETTLED });
  let report: IncrementalStepReport;
  try {
    report = solveTraverseStep(input, { step: event.step, newestId: event.newestId });
  } catch {
    return setLive(next, [LEG_UNSETTLED], { tone: 'red', blocked: true, line: LEG_UNSETTLED });
  }
  if (!report.converged || report.semiMajorM == null) {
    return setLive(next, [LEG_UNSETTLED], { tone: 'red', blocked: true, line: LEG_UNSETTLED });
  }
  return publishLeg(next, report, input, event.step, next.houseTraverse?.closeRequested === true);
}

function recordLeg(doc: GardenDocument, step: number, newestId: string): GardenDocument {
  const traverse = doc.houseTraverse;
  if (!traverse) return doc;
  const tapes = doc.lines.filter((line) => line.step === step && (line.role === 'leg' || line.role === 'cross') && line.lengthM != null);
  const photos = doc.photos.filter((photo) => photo.step === step);
  const legTape = tapes.find((line) => line.role === 'leg' && (line.a === newestId || line.b === newestId));
  const previous = traverse.markOrder.filter((id) => id !== newestId);
  const from = legTape ? (legTape.a === newestId ? legTape.b : legTape.a) : (previous[previous.length - 1] ?? traverse.markOrder[0]);
  const setups = setupsFor(photos, step);
  const hasCross = tapes.some((line) => line.role === 'cross');
  const hasPhotos = photos.some((photo) => photo.role === 'leg' || photo.role === 'occupy' || photo.role === 'close' || photo.closing);
  const tieKind: TraverseLeg['tieKind'] = hasCross && hasPhotos ? 'both' : hasCross ? 'crossTies' : 'photos';
  const leg: TraverseLeg = {
    id: `leg-${step}`,
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
    traverseLegs: [...(doc.traverseLegs ?? []).filter((item) => item.step !== step), leg],
    traverseSetups: [...(doc.traverseSetups ?? []).filter((item) => item.step !== step), ...setups],
  };
}

function setupsFor(photos: Photo[], step: number): TraverseSetup[] {
  const setups: TraverseSetup[] = [];
  const seen = new Set<string>();
  for (const photo of photos) {
    const stationId = photo.stationId ?? photo.addPointId;
    if (!stationId) continue;
    const id = photo.cameraSetupId ?? `${stationId}|${photo.closing || photo.role === 'close' ? 'close' : 'open'}`;
    if (seen.has(id)) continue;
    seen.add(id);
    setups.push({ id, stationId, step });
  }
  return setups;
}

setWorkflowEventHook(foldTraverse);
