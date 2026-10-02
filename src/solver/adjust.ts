/**
 * One weighted least-squares adjustment.
 * Datum: origin fixed at (0, 0), axis point's y fixed at 0, axis x free.
 * The baseline length is a distance observation. Trust is not a weight.
 */

import {
  BUBBLE_TILT_RAD,
  GAP_SIGMA_FACTOR,
  LM_STEP_M,
  MDB_FACTOR,
  MIN_RAY_RANGE_M,
  PLANTABLE_CLASS_M,
  RAY_CROSS_WARN_DEG,
  SANITY_SEMI_MAJOR_M,
  STATION_CLASS_M,
  TRI_ANGLE_WARN_MAX_DEG,
  TRI_ANGLE_WARN_MIN_DEG,
  REDUNDANCY_ZERO,
  ZERO_REDUNDANCY_SHIFT_M,
  W_CRITICAL,
  W_ISOLATION_RATIO,
  Z_95,
} from './constants';
import {
  arcStation,
  bothOnBaseline,
  closestOnLineOfCentres,
  crossingAngle,
  dangerAssessment,
  distanceSigma,
  gardenSide,
  horizontalDistance,
  wholeGardenReflection,
  hypot2,
  intersectionAngle,
  intersectCircles,
  intersectRays,
  resectFromMarks,
  type Xy,
} from './geometry';
import { invertSpd, scaledEigen, solveEquilibrated, zeros } from './linalg';
import {
  bearingSigma,
  levelledBearing,
  levelledBearingScaleDerivative,
  predictedBearing,
  tiltBearingSigma,
  wrap,
} from './bearing';
import { ellipseFrom2x2, varianceFactorTest } from './stats';
import type {
  EarlyWarning,
  FixMethod,
  SolveInput,
  SolveObservation,
  SolvePoint,
  SolveResult,
  SolverDistanceInput,
  SolverPhotoInput,
  UnsetCode,
  WithheldCheck,
} from './types';

interface Param {
  owner: string;
  kind: 'x' | 'y' | 'yaw' | 'fx';
  photoId?: string;
}

interface DistPrep {
  raw: SolverDistanceInput;
  horizontalM: number;
  sigma: number;
}

interface BearingPrep {
  photo: SolverPhotoInput;
  pointId: string;
  px: number;
  py: number;
  bearing: number;
  sigma: number;
  levelled: boolean;
  /** 1σ tilt added in quadrature when a bubble stands in for gravity. */
  tiltSigmaRad: number;
}

interface PointState {
  id: string;
  x?: number;
  y?: number;
  held: boolean;
  weak?: boolean;
  method?: FixMethod;
  unsetCode?: UnsetCode;
  candidates?: Xy[];
  thetaRad?: number;
  branchChoice?: boolean;
  /** Side came from the garden-sign fallback, not from bearings, rays, or a branch. */
  sidedByGardenSign?: boolean;
  earlyWarning?: EarlyWarning;
  dangerRatio?: number;
  dangerKind?: 'circle' | 'line';
  markCount?: number;
  levelled?: boolean;
}

interface ObsFn {
  id: string;
  kind: 'distance' | 'bearing' | 'angle' | 'focal';
  sigma: number;
  pointIds: string[];
  residual: (x: number[]) => number;
  jacobian: (x: number[]) => number[];
  predict?: (x: number[]) => number;
  /** False once a later rejection has removed an endpoint. */
  live?: () => boolean;
}

export function solve(input: SolveInput): SolveResult {
  const dropped: string[] = [];
  const inseparable: string[] = [];
  let current = input;
  let result = solveOnce(current);
  if (input.dropBlunders) {
    for (let n = 0; n < 3; n++) {
      const ranked = result.observations
        .filter((o) => o.used && o.standardised != null && o.kind !== 'focal')
        .sort((a, b) => Math.abs(b.standardised ?? 0) - Math.abs(a.standardised ?? 0));
      const worst = ranked.find((o) => o.flagged);
      if (!worst?.standardised) break;
      const next = ranked.find((o) => o.id !== worst.id);
      const ratio = next?.standardised
        ? Math.abs(worst.standardised) / Math.abs(next.standardised)
        : Infinity;
      if (next && ratio < W_ISOLATION_RATIO) {
        for (const o of [worst, next, ...ranked.filter((q) => q.flagged)]) {
          if (!inseparable.includes(o.id)) inseparable.push(o.id);
        }
        break;
      }
      const previous = result;
      dropped.push(worst.id);
      const datumDropped = worst.id.startsWith('datum:');
      current = {
        ...current,
        datum: datumDropped ? { ...current.datum, observeLength: false } : current.datum,
        distances: (current.distances ?? []).filter((d) => d.id !== worst.id),
        angles: (current.angles ?? []).filter((d) => d.id !== worst.id),
        photos: (current.photos ?? []).map((p) =>
          p.id === worst.id
            ? { ...p, clicks: [] }
            : {
                ...p,
                clicks: p.clicks.filter((c) => `${p.id}:${c.pointId}` !== worst.id),
              },
        ),
      };
      result = solveOnce(current);
      if (result.varianceTest === 'high') {
        for (const o of ranked.filter((q) => q.flagged)) {
          if (!inseparable.includes(o.id)) inseparable.push(o.id);
        }
        dropped.pop();
        result = previous;
        break;
      }
    }
  }
  result.droppedObservationIds = dropped;
  result.inseparableObservationIds = inseparable;
  return result;
}

function solveOnce(input: SolveInput): SolveResult {
  const gardenSign = input.datum.gardenSign ?? 1;
  const originId = input.datum.originId;
  const axisId = input.datum.axisPointId;
  const scaleFixed = input.datum.fixScale === true;
  const pointInputs = new Map((input.points ?? []).map((p) => [p.id, p]));
  for (const id of [originId, axisId]) {
    if (!pointInputs.has(id)) pointInputs.set(id, { id });
  }
  for (const photo of input.photos ?? []) {
    if (!pointInputs.has(photo.stationId)) pointInputs.set(photo.stationId, { id: photo.stationId });
    for (const click of photo.clicks) {
      if (!pointInputs.has(click.pointId)) pointInputs.set(click.pointId, { id: click.pointId });
    }
  }
  for (const distance of input.distances ?? []) {
    if (!pointInputs.has(distance.a)) pointInputs.set(distance.a, { id: distance.a });
    if (!pointInputs.has(distance.b)) pointInputs.set(distance.b, { id: distance.b });
  }
  for (const angle of input.angles ?? []) {
    for (const id of [angle.at, angle.from, angle.to]) {
      if (!pointInputs.has(id)) pointInputs.set(id, { id });
    }
  }

  const offsets = new Map<string, Xy>();
  for (const p of pointInputs.values()) {
    if (p.markOffsetM) offsets.set(p.id, { x: p.markOffsetM.x, y: p.markOffsetM.y });
  }

  const held = new Map<string, Xy>();
  for (const p of pointInputs.values()) {
    if (p.id === originId || p.id === axisId) continue;
    if (p.held) held.set(p.id, { x: p.held.x, y: p.held.y });
  }

  const distances = prepareDistances(input);
  const bearings = prepareBearings(input.photos ?? []);

  const state = new Map<string, PointState>();
  const ensure = (id: string): PointState => {
    let s = state.get(id);
    if (!s) {
      s = { id, held: held.has(id) };
      state.set(id, s);
    }
    return s;
  };
  for (const id of pointInputs.keys()) ensure(id);

  const origin = ensure(originId);
  origin.x = 0;
  origin.y = 0;
  origin.held = true;
  origin.method = 'datum';
  const axis = ensure(axisId);
  axis.x = input.datum.lengthM;
  axis.y = 0;
  axis.method = 'datum';

  const xyOf = (id: string): Xy | null => {
    if (id === originId) return { x: 0, y: 0 };
    if (held.has(id)) return held.get(id)!;
    const s = state.get(id);
    if (!s || s.x == null || s.y == null) return null;
    return { x: s.x, y: id === axisId ? 0 : s.y };
  };
  const markOf = (id: string): Xy | null => {
    const f = xyOf(id);
    if (!f) return null;
    const o = offsets.get(id);
    return o ? { x: f.x + o.x, y: f.y + o.y } : f;
  };
  const known = (id: string) => xyOf(id) != null;

  // --- distance intersections ---
  const branch = new Map((input.branchChoices ?? []).map((b) => [b.id, b.candidateIndex]));
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const id of pointInputs.keys()) {
      if (known(id)) continue;
      const touches = distances.filter((d) => d.raw.a === id || d.raw.b === id);
      const toKnown = touches.filter((d) => known(d.raw.a === id ? d.raw.b : d.raw.a));
      if (toKnown.length < 2) {
        ensure(id).unsetCode = touches.length === 0 ? 'no-observation' : toKnown.length === 0 ? 'hanging' : 'one-distance';
        continue;
      }
      const placed = placeFromDistances(id, toKnown, distances, xyOf, markOf, offsets, {
        originId,
        axisId,
        origin: { x: 0, y: 0 },
        axis: { x: axis.x ?? input.datum.lengthM, y: 0 },
        gardenSign,
        bearings,
        branch: branch.get(id),
        sidedByGardenSign: (pid: string) =>
          pid === originId || pid === axisId || state.get(pid)?.sidedByGardenSign === true,
      });
      const s = ensure(id);
      if (placed.point) {
        s.x = placed.point.x;
        s.y = placed.point.y;
        s.method = placed.branch ? 'branch' : 'distances';
        s.branchChoice = placed.branch;
        s.sidedByGardenSign = placed.fromGardenSign === true;
        s.weak = placed.weak;
        s.unsetCode = undefined;
        s.candidates = undefined;
        progressed = true;
      } else {
        s.unsetCode = placed.code;
        s.candidates = placed.candidates;
      }
    }
  }

  // --- stations from photos ---
  const photosByStation = new Map<string, SolverPhotoInput[]>();
  for (const photo of input.photos ?? []) {
    const list = photosByStation.get(photo.stationId) ?? [];
    list.push(photo);
    photosByStation.set(photo.stationId, list);
  }
  for (const [stationId, photos] of photosByStation) {
    const s = ensure(stationId);
    const photoBearings = bearings.filter((b) => photos.some((p) => p.id === b.photo.id));
    const knownMarks = uniqueMarks(photoBearings.filter((b) => known(b.pointId) && b.pointId !== stationId));
    s.markCount = knownMarks.length;
    s.levelled = photos.every((p) => photoLevelled(p));

    if (held.has(stationId)) {
      s.x = held.get(stationId)!.x;
      s.y = held.get(stationId)!.y;
      s.method = s.method ?? 'datum';
      continue;
    }
    const tapes = distances.filter(
      (d) =>
        (d.raw.a === stationId && known(d.raw.b)) || (d.raw.b === stationId && known(d.raw.a)),
    );
    const ends = [originId, axisId];
    const tapeTo = (id: string) => tapes.find((d) => d.raw.a === id || d.raw.b === id);
    const bothEnds = ends.every((id) => tapeTo(id));
    if (s.x != null && s.y != null && (s.method === 'distances' || s.method === 'branch')) {
      // Tapes to both baseline ends already fixed this station. The side is
      // the branch choice or the bearing order, not the garden sign.
      if (bothEnds) {
        const side = sideFromBaselineTapes(
          stationId,
          tapeTo,
          markOf,
          photoBearings,
          knownMarks,
          xyOf,
          branch.get(stationId),
          { x: 0, y: 0 },
          { x: axis.x ?? input.datum.lengthM, y: 0 },
          gardenSign,
          originId,
          axisId,
        );
        applyStationSide(s, side, knownMarks.length);
      }
      classifyControl(s, knownMarks, xyOf);
      continue;
    }
    if (knownMarks.length >= 2 && bothEnds) {
      const side = sideFromBaselineTapes(
        stationId,
        tapeTo,
        markOf,
        photoBearings,
        knownMarks,
        xyOf,
        branch.get(stationId),
        { x: 0, y: 0 },
        { x: axis.x ?? input.datum.lengthM, y: 0 },
        gardenSign,
        originId,
        axisId,
      );
      applyStationSide(s, side, knownMarks.length);
      if (side.point && !side.conflict) classifyControl(s, knownMarks, xyOf);
      continue;
    }

    if (knownMarks.length === 2 && tapes.length === 1 && !bothEnds) {
      const [idA, idB] = knownMarks;
      const brA = photoBearings.find((b) => b.pointId === idA);
      const brB = photoBearings.find((b) => b.pointId === idB);
      const tape = tapes[0];
      const other = tape.raw.a === stationId ? tape.raw.b : tape.raw.a;
      const to = other === idA ? 'a' : other === idB ? 'b' : 'mid';
      if (brA && brB && xyOf(idA) && xyOf(idB)) {
        const arc = arcStation({
          a: xyOf(idA)!,
          b: xyOf(idB)!,
          bearingA: brA.bearing,
          bearingB: brB.bearing,
          tape: { to, lengthM: tape.horizontalM },
        });
        s.thetaRad = arc.thetaRad;
        s.candidates = arc.candidates;
        const choice = branch.get(stationId);
        if (arc.unique && arc.candidates[0] && !arc.midpointTape) {
          s.x = arc.candidates[0].x;
          s.y = arc.candidates[0].y;
          s.method = 'distances';
          s.unsetCode = undefined;
        } else if (choice != null && arc.candidates[choice]) {
          s.x = arc.candidates[choice].x;
          s.y = arc.candidates[choice].y;
          s.method = 'branch';
          s.branchChoice = true;
          s.unsetCode = undefined;
        } else {
          s.unsetCode = arc.code === 'flat-angle' ? 'flat-angle' : arc.candidates.length > 1 ? 'two-candidates' : 'miss';
          s.x = undefined;
          s.y = undefined;
        }
      }
      continue;
    }

    if (knownMarks.length >= 3) {
      const aimed = knownMarks.map((id) => {
        const p = xyOf(id)!;
        const b = photoBearings.find((br) => br.pointId === id)!;
        return { x: p.x, y: p.y, bearing: b.bearing };
      });
      const resect = resectFromMarks(aimed);
      if (!resect.start) {
        s.unsetCode = resect.failure === 'flat-angle' ? 'flat-angle' : 'danger';
        continue;
      }
      s.x = resect.start.position.x;
      s.y = resect.start.position.y;
      s.method = 'resection';
      s.dangerRatio = resect.start.danger.ratio;
      s.dangerKind = resect.start.danger.kind;
      if (resect.start.danger.warn) s.earlyWarning = 'danger';
      s.unsetCode = undefined;
      classifyControl(s, knownMarks, xyOf);
      continue;
    }

    if (knownMarks.length === 2 && tapes.length === 0) {
      const [idA, idB] = knownMarks;
      const brA = photoBearings.find((b) => b.pointId === idA);
      const brB = photoBearings.find((b) => b.pointId === idB);
      if (brA && brB && xyOf(idA) && xyOf(idB)) {
        const arc = arcStation({
          a: xyOf(idA)!,
          b: xyOf(idB)!,
          bearingA: brA.bearing,
          bearingB: brB.bearing,
        });
        s.thetaRad = arc.thetaRad;
        s.unsetCode = arc.code === 'flat-angle' ? 'flat-angle' : 'arc-only';
        s.x = undefined;
        s.y = undefined;
      }
      continue;
    }
  }

  // --- rays to marks seen from two solved stations ---
  const clickIds = new Set(bearings.map((b) => b.pointId));
  for (const id of clickIds) {
    if (known(id)) continue;
    const sightings = bearings.filter((b) => b.pointId === id && known(b.photo.stationId));
    const stations = [...new Set(sightings.map((b) => b.photo.stationId))];
    if (stations.length < 2) continue;
    const s1 = stations[0];
    const s2 = stations[1];
    const b1 = sightings.find((b) => b.photo.stationId === s1)!;
    const b2 = sightings.find((b) => b.photo.stationId === s2)!;
    const yaw1 = initialYaw(s1, bearings, xyOf, input, b1.photo.id);
    const yaw2 = initialYaw(s2, bearings, xyOf, input, b2.photo.id);
    if (yaw1 == null || yaw2 == null) continue;
    const az1 = wrap(yaw1 + b1.bearing);
    const az2 = wrap(yaw2 + b2.bearing);
    const cross = (crossingAngle(az1, az2) * 180) / Math.PI;
    const hit = intersectRays(xyOf(s1)!, az1, xyOf(s2)!, az2);
    const s = ensure(id);
    if (!hit || cross < 1) {
      s.unsetCode = 'parallel-rays';
      continue;
    }
    if (hit.behind) {
      s.unsetCode = 'behind-camera';
      s.x = undefined;
      s.y = undefined;
      continue;
    }
    s.x = hit.point.x;
    s.y = hit.point.y;
    s.method = 'rays';
    s.sidedByGardenSign = false;
    s.unsetCode = undefined;
    if (cross < RAY_CROSS_WARN_DEG) s.earlyWarning = 'shallow-rays';
  }

  // A pure y-mirror has the same tape cost. Tests start there to see whether
  // every garden-sign point, including those chained by a later tape, is counted.
  if (input.reflectSeed) {
    for (const s of state.values()) {
      if (s.id === originId || s.id === axisId || held.has(s.id)) continue;
      if (s.y != null) s.y = -s.y;
    }
  }

  // --- parameters ---
  let free = new Set<string>();
  for (const s of state.values()) {
    if (s.id === originId || held.has(s.id)) continue;
    if (scaleFixed && s.id === axisId) continue;
    if (s.x == null || s.y == null) continue;
    free.add(s.id);
  }

  let built = assemble(input, free, state, held, distances, bearings, offsets, originId, axisId);
  let adjusted = runLm(built);

  const rankTrim = () => {
    for (let drop = 0; drop < 5 && adjusted.rankDeficient; drop++) {
      const victim = worstNullPoint(adjusted.nullVector, built.params, originId, axisId);
      if (!victim) break;
      free.delete(victim);
      const s = state.get(victim);
      if (s && !held.has(victim)) {
        s.x = undefined;
        s.y = undefined;
        s.unsetCode = 'rank';
        s.method = undefined;
      }
      built = assemble(input, free, state, held, distances, bearings, offsets, originId, axisId);
      adjusted = runLm(built);
    }
  };
  const writeSolved = () => {
    for (const s of state.values()) {
      if (s.id === originId) continue;
      if (held.has(s.id)) {
        s.x = held.get(s.id)!.x;
        s.y = held.get(s.id)!.y;
        continue;
      }
      if (!free.has(s.id)) continue;
      const x = paramValue(built, adjusted.x, s.id, 'x');
      const y = s.id === axisId ? 0 : paramValue(built, adjusted.x, s.id, 'y');
      if (x == null || y == null) continue;
      s.x = x;
      s.y = y;
    }
  };
  const markDiverged = () => {
    for (const s of state.values()) {
      if (!free.has(s.id)) continue;
      s.x = undefined;
      s.y = undefined;
      s.unsetCode = 'diverged';
    }
  };

  rankTrim();
  writeSolved();

  const behindResolves = input.behindCameraResolves ?? 4;
  if (!adjusted.converged) {
    markDiverged();
  } else {
    // A rejection removes the point from the free set. Rebuild without its
    // observations and solve again, or finishStats reads a coordinate that is gone.
    // The check also runs after the last re-solve, including the 4th, and that
    // last pass does not solve again.
    for (let pass = 0; pass < behindResolves && adjusted.converged; pass++) {
      const victims = rejectBehindCamera(bearings, built, adjusted, state, free, held, originId, axisId);
      if (victims.length === 0) break;
      built = assemble(input, free, state, held, distances, bearings, offsets, originId, axisId);
      adjusted = runLm(built);
      rankTrim();
      writeSolved();
      if (!adjusted.converged) markDiverged();
    }
    if (adjusted.converged) {
      rejectBehindCamera(bearings, built, adjusted, state, free, held, originId, axisId);
    }
  }

  const stats = finishStats(built, adjusted);
  const withheld = withheldChecks(input, distances, built, adjusted, offsets, originId, axisId, state, held);

  // Intersection-angle warnings on distance-fixed points.
  for (const s of state.values()) {
    if (s.method !== 'distances' && s.method !== 'both-tapes') continue;
    if (s.x == null || s.y == null) continue;
    const touches = distances.filter((d) => !d.raw.withheld && (d.raw.a === s.id || d.raw.b === s.id));
    if (touches.length < 2) continue;
    const aId = touches[0].raw.a === s.id ? touches[0].raw.b : touches[0].raw.a;
    const bId = touches[1].raw.a === s.id ? touches[1].raw.b : touches[1].raw.a;
    const a = xyOfUpdated(aId, state, held, originId, axisId);
    const b = xyOfUpdated(bId, state, held, originId, axisId);
    if (!a || !b) continue;
    const phi = (intersectionAngle({ x: s.x, y: s.y }, a, b) * 180) / Math.PI;
    if (phi < TRI_ANGLE_WARN_MIN_DEG) s.earlyWarning = s.earlyWarning ?? 'shallow-intersection';
    if (phi > TRI_ANGLE_WARN_MAX_DEG) s.earlyWarning = s.earlyWarning ?? 'straight-intersection';
  }

  const dof = stats.observations.filter((o) => o.used).length - built.params.length;
  const vPv = stats.vPv;
  const test = varianceFactorTest(vPv, Math.max(0, dof));
  const sigma0 = dof > 0 ? Math.sqrt(Math.max(0, vPv / dof)) : null;
  const covarianceScaled = test.result === 'high' && sigma0 != null && sigma0 > 0;
  const qScale = covarianceScaled && sigma0 != null ? sigma0 * sigma0 : 1;
  const points = publishPoints(
    state,
    built,
    adjusted,
    withheld,
    originId,
    axisId,
    free,
    held,
    bearings,
    test.result === 'high',
    qScale,
    scaleFixed,
  );

  return {
    points,
    observations: stats.observations,
    withheld,
    sigma0,
    vPv: stats.observations.some((o) => o.used) ? vPv : null,
    degreesOfFreedom: Math.max(0, dof),
    unknownCount: built.params.length,
    observationCount: stats.observations.filter((o) => o.used).length,
    varianceTest: test.result,
    covarianceScaled,
    converged: adjusted.converged,
    droppedObservationIds: [],
    inseparableObservationIds: [],
    skippedPhotos: [],
    reflected: wholeGardenReflection({
      axisX: state.get(axisId)?.x ?? input.datum.lengthM,
      gardenSign,
      points: [...state.values()]
        .filter((s) => s.id !== originId && s.id !== axisId && !held.has(s.id) && s.x != null && s.y != null)
        .map((s) => ({ x: s.x as number, y: s.y as number, fromGardenSign: s.sidedByGardenSign === true })),
    }),
    jointCofactor: (pointIds: string[]) => jointCofactorOf(pointIds, built, adjusted, state, held, originId, axisId),
    datum: { originId, axisPointId: axisId, gardenSign },
  };
}

function jointCofactorOf(
  pointIds: string[],
  built: Built,
  adjusted: LmResult,
  state: Map<string, PointState>,
  held: Map<string, Xy>,
  originId: string,
  axisId: string,
): number[][] | null {
  const q = adjusted.q;
  if (!q) return null;
  const slots: (number | null)[] = [];
  for (const id of pointIds) {
    const s = state.get(id);
    const solved = id === originId || held.has(id) || (s?.x != null && s?.y != null);
    if (!solved) return null;
    slots.push(built.index.get(`${id}:x`) ?? null);
    if (id !== axisId) slots.push(built.index.get(`${id}:y`) ?? null);
  }
  const n = slots.length;
  const c = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const ia = slots[a];
      const ib = slots[b];
      if (ia == null || ib == null) continue;
      c[a][b] = q[ia][ib];
    }
  }
  return c;
}

interface SidePick {
  point: Xy | null;
  branch: boolean;
  conflict: boolean;
  fromGardenSign: boolean;
}

function applyStationSide(s: PointState, side: SidePick, knownMarks: number): void {
  if (side.conflict) {
    s.x = undefined;
    s.y = undefined;
    s.method = undefined;
    s.branchChoice = true;
    s.sidedByGardenSign = false;
    s.unsetCode = 'branch-conflict';
    return;
  }
  if (side.branch && side.point) {
    s.x = side.point.x;
    s.y = side.point.y;
    s.method = 'branch';
    s.branchChoice = true;
    s.sidedByGardenSign = false;
    s.unsetCode = undefined;
    return;
  }
  if (side.point && knownMarks >= 2) {
    s.x = side.point.x;
    s.y = side.point.y;
    if (s.method !== 'branch') s.method = 'both-tapes';
    s.sidedByGardenSign = false;
    s.unsetCode = undefined;
    return;
  }
  if (!side.point && knownMarks >= 2) {
    s.x = undefined;
    s.y = undefined;
    s.method = undefined;
    s.branchChoice = undefined;
    s.sidedByGardenSign = false;
    s.unsetCode = 'mirror';
    return;
  }
  if (s.method === 'distances' && knownMarks >= 2) s.method = 'both-tapes';
}

function prepareDistances(input: SolveInput): DistPrep[] {
  const list: DistPrep[] = [];
  for (const raw of input.distances ?? []) {
    const horizontalM = horizontalDistance(raw.slopeM, raw.deltaHM ?? 0, raw.faceOffsetM ?? 0);
    if (horizontalM == null) continue;
    const sigma = distanceSigma({
      lengthM: horizontalM,
      sigmaM: raw.sigmaM,
      aM: raw.aM,
      bPerM: raw.bPerM,
      instrument: raw.instrument,
    });
    list.push({ raw, horizontalM, sigma });
  }
  // The datum length is its own observation, even when another instrument
  // has measured the same pair. Skipping it would pin B on that other tape.
  if (!input.datum.fixScale && input.datum.observeLength !== false) {
    const horizontalM = input.datum.lengthM;
    const sigma = distanceSigma({
      lengthM: horizontalM,
      sigmaM: input.datum.sigmaM,
      aM: input.datum.aM,
      bPerM: input.datum.bPerM,
      instrument: input.datum.instrument ?? 'tape',
    });
    list.push({
      raw: {
        id: `datum:${input.datum.originId}-${input.datum.axisPointId}`,
        a: input.datum.originId,
        b: input.datum.axisPointId,
        slopeM: horizontalM,
        sigmaM: sigma,
        instrument: input.datum.instrument ?? 'tape',
      },
      horizontalM,
      sigma,
    });
  }
  return list;
}

function prepareBearings(photos: SolverPhotoInput[]): BearingPrep[] {
  const out: BearingPrep[] = [];
  for (const photo of photos) {
    const fx = photo.fxOverWidth * photo.width;
    const fy = photo.fyOverHeight != null ? photo.fyOverHeight * photo.height : fx;
    const cx = photo.cx ?? photo.width / 2;
    const cy = photo.cy ?? photo.height / 2;
    const levelled = photo.gravity != null;
    for (const click of photo.clicks) {
      const bearing = levelledBearing({
        px: click.px,
        py: click.py,
        cx,
        cy,
        fx,
        fy,
        gravity: photo.gravity,
      });
      const tiltSigmaRad =
        photo.gravity || photo.bearingSigmaRad != null
          ? 0
          : photo.bubbleEnforced
            ? (photo.bubbleTiltSigmaRad ?? BUBBLE_TILT_RAD)
            : 0;
      const base = photo.bearingSigmaRad ?? bearingSigma({ sigmaPx: photo.sigmaPx ?? 2, fx });
      const tilt =
        tiltSigmaRad > 0
          ? tiltBearingSigma({ tiltSigmaRad, px: click.px, py: click.py, cx, cy, fx })
          : 0;
      out.push({
        photo,
        pointId: click.pointId,
        px: click.px,
        py: click.py,
        bearing,
        sigma: Math.hypot(base, tilt),
        levelled,
        tiltSigmaRad,
      });
    }
  }
  return out;
}

function photoLevelled(photo: SolverPhotoInput): boolean {
  return photo.gravity != null || photo.bubbleEnforced === true;
}

function uniqueMarks(bearings: BearingPrep[]): string[] {
  const ids: string[] = [];
  for (const b of bearings) if (!ids.includes(b.pointId)) ids.push(b.pointId);
  return ids;
}

function classifyControl(s: PointState, marks: string[], xyOf: (id: string) => Xy | null): void {
  if (s.x == null || s.y == null) return;
  s.markCount = marks.length;
  const pts: Xy[] = [];
  for (const id of marks) {
    const p = xyOf(id);
    if (p) pts.push(p);
  }
  if (pts.length < 3) return;
  // The first three clicks are not special. Keep the best-conditioned triple.
  let best: ReturnType<typeof dangerAssessment> | null = null;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      for (let k = j + 1; k < pts.length; k++) {
        const danger = dangerAssessment({ x: s.x, y: s.y }, [pts[i], pts[j], pts[k]]);
        if (!best || danger.ratio > best.ratio) best = danger;
      }
    }
  }
  if (!best) return;
  s.dangerRatio = best.ratio;
  s.dangerKind = best.kind;
  if (best.warn) s.earlyWarning = 'danger';
  else if (s.earlyWarning === 'danger') s.earlyWarning = undefined;
}

function placeFromDistances(
  id: string,
  toKnown: DistPrep[],
  all: DistPrep[],
  xyOf: (id: string) => Xy | null,
  markOf: (id: string) => Xy | null,
  offsets: Map<string, Xy>,
  ctx: {
    originId: string;
    axisId: string;
    origin: Xy;
    axis: Xy;
    gardenSign: 1 | -1;
    bearings: BearingPrep[];
    branch?: 0 | 1;
    /** Datum ends count. A ray or bearing parent does not. */
    sidedByGardenSign?: (id: string) => boolean;
  },
): { point?: Xy; weak?: boolean; branch?: boolean; fromGardenSign?: boolean; code: UnsetCode; candidates?: Xy[] } {
  const d0 = toKnown[0];
  const d1 = toKnown[1];
  const k0 = d0.raw.a === id ? d0.raw.b : d0.raw.a;
  const k1 = d1.raw.a === id ? d1.raw.b : d1.raw.a;
  const c0 = markOf(k0);
  const c1 = markOf(k1);
  if (!c0 || !c1) return { code: 'one-distance' };
  let hits = intersectCircles(c0, d0.horizontalM, c1, d1.horizontalM);
  let weak = false;
  if (hits.length === 0) {
    const close = closestOnLineOfCentres(c0, d0.horizontalM, c1, d1.horizontalM);
    const gapLimit = GAP_SIGMA_FACTOR * Math.hypot(d0.sigma, d1.sigma);
    if (!close || close.gapM > gapLimit) return { code: 'miss' };
    hits = [close.point];
    weak = true;
  }
  if (hits.length === 1) return { point: featureFromMark(hits[0], id, offsets), weak, code: 'one-distance' };

  const extras = all.filter((d) => {
    if (d.raw.withheld) return false;
    const other = d.raw.a === id ? d.raw.b : d.raw.b === id ? d.raw.a : null;
    return other && other !== k0 && other !== k1 && xyOf(other);
  });
  if (extras.length > 0) {
    const extra = extras[0];
    const other = extra.raw.a === id ? extra.raw.b : extra.raw.a;
    const c = markOf(other)!;
    hits.sort(
      (p, q) =>
        Math.abs(hypot2(p, c) - extra.horizontalM) - Math.abs(hypot2(q, c) - extra.horizontalM),
    );
    // The extra tape only picks a side. The point is still a garden-sign
    // placement when every parent is the datum or was itself placed that way.
    const inherit = ctx.sidedByGardenSign;
    const fromGardenSign =
      inherit != null && inherit(k0) && inherit(k1) && inherit(other);
    return { point: featureFromMark(hits[0], id, offsets), weak, fromGardenSign, code: 'one-distance' };
  }

  const datumPair =
    (k0 === ctx.originId && k1 === ctx.axisId) || (k0 === ctx.axisId && k1 === ctx.originId);
  if (datumPair) {
    const originMark = markOf(ctx.originId);
    const axisMark = markOf(ctx.axisId);
    const rOrigin = k0 === ctx.originId ? d0.horizontalM : d1.horizontalM;
    const rAxis = k0 === ctx.axisId ? d0.horizontalM : d1.horizontalM;
    if (originMark && axisMark) {
      const ordered = intersectCircles(originMark, rOrigin, axisMark, rAxis);
      if (ordered.length === 2) hits = ordered;
    }
  }

  const own = ctx.bearings.filter((b) => b.photo.stationId === id);
  const ownMarks = uniqueMarks(own.filter((b) => xyOf(b.pointId) && b.pointId !== id));
  const onBaseline = bothOnBaseline(c0, c1, ctx.origin, ctx.axis);
  const side = chooseSide(hits, own, ownMarks, xyOf, ctx.branch, ctx.origin, ctx.axis, ctx.gardenSign, onBaseline);
  if (side.conflict) return { code: 'branch-conflict', candidates: hits };
  if (side.point) {
    return {
      point: featureFromMark(side.point, id, offsets),
      weak,
      branch: side.branch,
      fromGardenSign: side.fromGardenSign,
      code: side.branch ? 'mirror' : 'one-distance',
    };
  }
  return { code: 'mirror', candidates: hits };
}

function featureFromMark(mark: Xy, id: string, offsets: Map<string, Xy>): Xy {
  const o = offsets.get(id);
  return o ? { x: mark.x - o.x, y: mark.y - o.y } : mark;
}

/** Bearing-difference agreement, radians. The other mirror is several times this on a baseline. */
const SIDE_MATCH_RAD = (10 * Math.PI) / 180;

/**
 * Candidate 0 is the first circle intersection. For tapes to the datum ends
 * that order is origin then axis, so index 0 is +Y when the axis runs +X
 * (BAS01 at the origin, BAS02 on +X: the peg side of that sheet is index 1).
 * An explicit branch is used when the station's own bearings agree, or when
 * there are none. A contradiction is `branch-conflict` and the station is not
 * seeded. The garden sign is only the distance-only fallback.
 */
function chooseSide(
  hits: Xy[],
  ownBearings: BearingPrep[],
  markIds: string[],
  xyOf: (id: string) => Xy | null,
  branch: 0 | 1 | undefined,
  origin: Xy,
  axis: Xy,
  gardenSign: 1 | -1,
  allowGardenSign: boolean,
): SidePick {
  const empty: SidePick = { point: null, branch: false, conflict: false, fromGardenSign: false };
  if (hits.length === 1) return { ...empty, point: hits[0] };
  if (branch != null && hits[branch]) {
    if (markIds.length >= 2) {
      const byBearing = pickByBearings(hits, markIds, ownBearings, xyOf);
      const chosen = hits[branch];
      if (!byBearing || Math.hypot(byBearing.x - chosen.x, byBearing.y - chosen.y) > 1e-3) {
        return { point: null, branch: true, conflict: true, fromGardenSign: false };
      }
    }
    return { point: hits[branch], branch: true, conflict: false, fromGardenSign: false };
  }
  if (markIds.length >= 2) {
    return { point: pickByBearings(hits, markIds, ownBearings, xyOf), branch: false, conflict: false, fromGardenSign: false };
  }
  if (!allowGardenSign) return empty;
  return { point: gardenSide(origin, axis, hits, gardenSign), branch: false, conflict: false, fromGardenSign: true };
}

function sideFromBaselineTapes(
  stationId: string,
  tapeTo: (id: string) => DistPrep | undefined,
  markOf: (id: string) => Xy | null,
  photoBearings: BearingPrep[],
  knownMarks: string[],
  xyOf: (id: string) => Xy | null,
  branch: 0 | 1 | undefined,
  origin: Xy,
  axis: Xy,
  gardenSign: 1 | -1,
  originId: string,
  axisId: string,
): SidePick {
  const da = tapeTo(originId);
  const db = tapeTo(axisId);
  const originMark = markOf(originId);
  const axisMark = markOf(axisId);
  if (!da || !db || !originMark || !axisMark) {
    return { point: null, branch: false, conflict: false, fromGardenSign: false };
  }
  const hits = intersectCircles(originMark, da.horizontalM, axisMark, db.horizontalM);
  void stationId;
  return chooseSide(hits, photoBearings, knownMarks, xyOf, branch, origin, axis, gardenSign, true);
}

function pickByBearings(
  hits: Xy[],
  markIds: string[],
  bearings: BearingPrep[],
  xyOf: (id: string) => Xy | null,
): Xy | null {
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];
  const byPhoto = new Map<string, BearingPrep[]>();
  for (const b of bearings) {
    if (!markIds.includes(b.pointId) || !xyOf(b.pointId)) continue;
    const list = byPhoto.get(b.photo.id) ?? [];
    list.push(b);
    byPhoto.set(b.photo.id, list);
  }
  let best: Xy | null = null;
  let bestCost = Infinity;
  for (const hit of hits) {
    let cost = 0;
    let n = 0;
    for (const list of byPhoto.values()) {
      if (list.length < 2) continue;
      const b0 = list[0];
      const b1 = list[1];
      const p0 = xyOf(b0.pointId)!;
      const p1 = xyOf(b1.pointId)!;
      const az0 = Math.atan2(p0.y - hit.y, p0.x - hit.x);
      const az1 = Math.atan2(p1.y - hit.y, p1.x - hit.x);
      cost += Math.abs(wrap(wrap(az1 - az0) - wrap(b1.bearing - b0.bearing)));
      n++;
    }
    if (n === 0) continue;
    const mean = cost / n;
    if (mean < bestCost) {
      bestCost = mean;
      best = hit;
    }
  }
  return bestCost < SIDE_MATCH_RAD ? best : null;
}

function initialYaw(
  stationId: string,
  bearings: BearingPrep[],
  xyOf: (id: string) => Xy | null,
  input: SolveInput,
  photoId?: string,
): number | null {
  const heldYaw = (input.photos ?? []).find(
    (p) => p.stationId === stationId && p.yawHeldRad != null && (photoId == null || p.id === photoId),
  );
  if (heldYaw?.yawHeldRad != null) return heldYaw.yawHeldRad;
  const station = xyOf(stationId);
  if (!station) return null;
  const own = bearings.filter(
    (b) => b.photo.stationId === stationId && (photoId == null || b.photo.id === photoId) && xyOf(b.pointId),
  );
  if (own.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const b of own) {
    const m = xyOf(b.pointId)!;
    const yaw = wrap(Math.atan2(m.y - station.y, m.x - station.x) - b.bearing);
    x += Math.cos(yaw);
    y += Math.sin(yaw);
  }
  return Math.atan2(y, x);
}

interface Built {
  params: Param[];
  index: Map<string, number>;
  x0: number[];
  obs: ObsFn[];
  unused: SolveObservation[];
}

function assemble(
  input: SolveInput,
  free: Set<string>,
  state: Map<string, PointState>,
  held: Map<string, Xy>,
  distances: DistPrep[],
  bearings: BearingPrep[],
  offsets: Map<string, Xy>,
  originId: string,
  axisId: string,
): Built {
  const params: Param[] = [];
  for (const id of free) {
    params.push({ owner: id, kind: 'x' });
    if (id !== axisId) params.push({ owner: id, kind: 'y' });
  }
  const yawPhotos = new Set<string>();
  for (const photo of input.photos ?? []) {
    if (photo.yawHeldRad != null) continue;
    if (!free.has(photo.stationId) && !held.has(photo.stationId) && photo.stationId !== originId) continue;
    if (photo.stationId !== originId && !held.has(photo.stationId) && !free.has(photo.stationId)) continue;
    const key = photo.id;
    if (yawPhotos.has(key)) continue;
    // A yaw is estimable when the station position exists.
    if (stationKnown(photo.stationId, free, held, originId)) {
      params.push({ owner: photo.stationId, kind: 'yaw', photoId: photo.id });
      yawPhotos.add(key);
    }
  }
  const ready = (id: string) =>
    id === originId ||
    held.has(id) ||
    free.has(id) ||
    (state.get(id)?.x != null && state.get(id)?.y != null);
  const fxSeen = new Set<string>();
  for (const b of bearings) {
    const rel = b.photo.fxRelativeUncertainty;
    if (rel == null || !(rel > 0) || fxSeen.has(b.photo.id)) continue;
    if (!ready(b.photo.stationId) || !ready(b.pointId)) continue;
    params.push({ owner: b.photo.stationId, kind: 'fx', photoId: b.photo.id });
    fxSeen.add(b.photo.id);
  }
  const index = new Map<string, number>();
  params.forEach((p, i) => index.set(paramKey(p), i));
  const x0 = params.map((p) => {
    if (p.kind === 'fx') return 0;
    if (p.kind === 'yaw') {
      return (
        initialYaw(
          p.owner,
          bearings,
          (id) => xyOfState(id, state, held, originId, axisId),
          input,
          p.photoId,
        ) ?? 0
      );
    }
    const s = state.get(p.owner);
    return p.kind === 'x' ? (s?.x ?? 0) : (s?.y ?? 0);
  });

  const coord = (x: number[], id: string): Xy | null => {
    if (id === originId) return { x: 0, y: 0 };
    if (held.has(id)) return held.get(id)!;
    if (!free.has(id)) {
      const s = state.get(id);
      if (s?.x == null || s.y == null) return null;
      return { x: s.x, y: id === axisId ? 0 : s.y };
    }
    const ix = index.get(`${id}:x`);
    const iy = id === axisId ? null : index.get(`${id}:y`);
    if (ix == null) return null;
    return { x: x[ix], y: id === axisId ? 0 : iy == null ? 0 : x[iy] };
  };
  const mark = (x: number[], id: string): Xy | null => {
    const f = coord(x, id);
    if (!f) return null;
    const o = offsets.get(id);
    return o ? { x: f.x + o.x, y: f.y + o.y } : f;
  };

  const obs: ObsFn[] = [];
  const unused: SolveObservation[] = [];
  for (const d of distances) {
    if (d.raw.withheld) continue;
    const usable = coord(x0, d.raw.a) && coord(x0, d.raw.b);
    if (!usable) {
      unused.push(unusedObs(d.raw.id, 'distance', d.sigma, [d.raw.a, d.raw.b]));
      continue;
    }
    obs.push({
      id: d.raw.id,
      kind: 'distance',
      sigma: d.sigma,
      pointIds: [d.raw.a, d.raw.b],
      live: () => coord(x0, d.raw.a) != null && coord(x0, d.raw.b) != null,
      residual: (x) => {
        const a = mark(x, d.raw.a)!;
        const b = mark(x, d.raw.b)!;
        return d.horizontalM - Math.hypot(b.x - a.x, b.y - a.y);
      },
      jacobian: (x) => {
        const a = mark(x, d.raw.a)!;
        const b = mark(x, d.raw.b)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const L = Math.hypot(dx, dy) || 1e-9;
        const j = Array<number>(params.length).fill(0);
        add(j, index, d.raw.a, dx / L, dy / L, axisId);
        add(j, index, d.raw.b, -dx / L, -dy / L, axisId);
        return j;
      },
      predict: (x) => {
        const a = mark(x, d.raw.a)!;
        const b = mark(x, d.raw.b)!;
        return Math.hypot(b.x - a.x, b.y - a.y);
      },
    });
  }

  for (const b of bearings) {
    const stationOk = coord(x0, b.photo.stationId);
    const markOk = coord(x0, b.pointId);
    if (!stationOk || !markOk) {
      unused.push(unusedObs(`${b.photo.id}:${b.pointId}`, 'bearing', b.sigma, [b.photo.stationId, b.pointId]));
      continue;
    }
    // Refresh σ with range when the caller did not override it.
    let sigma = b.sigma;
    if (b.photo.bearingSigmaRad == null) {
      const range = hypot2(stationOk, markOk);
      const fx = b.photo.fxOverWidth * b.photo.width;
      const cx = b.photo.cx ?? b.photo.width / 2;
      const cy = b.photo.cy ?? b.photo.height / 2;
      const base = bearingSigma({
        sigmaPx: b.photo.sigmaPx ?? 2,
        fx,
        sigmaCentringM: b.photo.sigmaCentringM,
        rangeM: range,
      });
      const tilt =
        b.tiltSigmaRad > 0
          ? tiltBearingSigma({ tiltSigmaRad: b.tiltSigmaRad, px: b.px, py: b.py, cx, cy, fx })
          : 0;
      sigma = Math.hypot(base, tilt);
    }
    const yawIndex = b.photo.yawHeldRad != null ? null : index.get(`yaw:${b.photo.id}`);
    const fxIndex = index.get(`fx:${b.photo.id}`);
    obs.push({
      id: `${b.photo.id}:${b.pointId}`,
      kind: 'bearing',
      sigma,
      pointIds: [b.photo.stationId, b.pointId],
      live: () => coord(x0, b.photo.stationId) != null && coord(x0, b.pointId) != null,
      residual: (x) => {
        const c = coord(x, b.photo.stationId)!;
        const m = mark(x, b.pointId)!;
        const yaw = b.photo.yawHeldRad != null ? b.photo.yawHeldRad : yawIndex == null ? 0 : x[yawIndex];
        const scale = fxIndex == null ? 0 : x[fxIndex];
        return wrap(observedBearing(b, scale) - predictedBearing(m.x, m.y, c.x, c.y, yaw));
      },
      jacobian: (x) => {
        const c = coord(x, b.photo.stationId)!;
        const m = mark(x, b.pointId)!;
        const dx = m.x - c.x;
        const dy = m.y - c.y;
        const r2 = dx * dx + dy * dy || 1e-12;
        const j = Array<number>(params.length).fill(0);
        add(j, index, b.photo.stationId, -dy / r2, dx / r2, axisId);
        add(j, index, b.pointId, dy / r2, -dx / r2, axisId);
        if (yawIndex != null) j[yawIndex] = 1;
        if (fxIndex != null) j[fxIndex] = observedBearingScaleDerivative(b, x[fxIndex]);
        return j;
      },
    });
  }

  for (const photo of input.photos ?? []) {
    const fxIndex = index.get(`fx:${photo.id}`);
    if (fxIndex == null || photo.fxRelativeUncertainty == null) continue;
    obs.push({
      id: `fx:${photo.id}`,
      kind: 'focal',
      sigma: photo.fxRelativeUncertainty,
      pointIds: [photo.stationId],
      live: () => coord(x0, photo.stationId) != null,
      residual: (x) => -x[fxIndex],
      jacobian: () => {
        const j = Array<number>(params.length).fill(0);
        j[fxIndex] = -1;
        return j;
      },
    });
  }

  for (const ang of input.angles ?? []) {
    if (!coord(x0, ang.at) || !coord(x0, ang.from) || !coord(x0, ang.to)) {
      unused.push(unusedObs(ang.id, 'angle', ang.sigmaRad, [ang.at, ang.from, ang.to]));
      continue;
    }
    obs.push({
      id: ang.id,
      kind: 'angle',
      sigma: ang.sigmaRad,
      pointIds: [ang.at, ang.from, ang.to],
      live: () => coord(x0, ang.at) != null && coord(x0, ang.from) != null && coord(x0, ang.to) != null,
      residual: (x) => wrap(ang.radians - angleAt(coord(x, ang.at)!, coord(x, ang.from)!, coord(x, ang.to)!)),
      jacobian: (x) => {
        const v = coord(x, ang.at)!;
        const f = coord(x, ang.from)!;
        const t = coord(x, ang.to)!;
        const j = Array<number>(params.length).fill(0);
        // pred = az(to) − az(from). v = obs − pred, so J = −∂az(to) + ∂az(from).
        const accumAz = (p: Xy, owner: string, scale: number) => {
          const dx = p.x - v.x;
          const dy = p.y - v.y;
          const r2 = dx * dx + dy * dy || 1e-12;
          add(j, index, owner, scale * (-dy / r2), scale * (dx / r2), axisId);
          add(j, index, ang.at, scale * (dy / r2), scale * (-dx / r2), axisId);
        };
        accumAz(t, ang.to, -1);
        accumAz(f, ang.from, 1);
        return j;
      },
    });
  }

  return { params, index, x0, obs, unused };
}

function paramKey(p: Param): string {
  if (p.kind === 'yaw') return `yaw:${p.photoId}`;
  if (p.kind === 'fx') return `fx:${p.photoId}`;
  return `${p.owner}:${p.kind}`;
}

function observedBearing(b: BearingPrep, scale: number): number {
  const photo = b.photo;
  const fx0 = photo.fxOverWidth * photo.width;
  const fy0 = photo.fyOverHeight != null ? photo.fyOverHeight * photo.height : fx0;
  const cx = photo.cx ?? photo.width / 2;
  const cy = photo.cy ?? photo.height / 2;
  return levelledBearing({
    px: b.px,
    py: b.py,
    cx,
    cy,
    fx: fx0 * (1 + scale),
    fy: fy0 * (1 + scale),
    gravity: photo.gravity,
  });
}

function observedBearingScaleDerivative(b: BearingPrep, scale: number): number {
  const photo = b.photo;
  const fx0 = photo.fxOverWidth * photo.width;
  const fy0 = photo.fyOverHeight != null ? photo.fyOverHeight * photo.height : fx0;
  return levelledBearingScaleDerivative({
    px: b.px,
    py: b.py,
    cx: photo.cx ?? photo.width / 2,
    cy: photo.cy ?? photo.height / 2,
    fx: fx0 * (1 + scale),
    fy: fy0 * (1 + scale),
    fx0,
    fy0,
    gravity: photo.gravity,
  });
}

function add(j: number[], index: Map<string, number>, id: string, dx: number, dy: number, axisId: string): void {
  const ix = index.get(`${id}:x`);
  const iy = index.get(`${id}:y`);
  if (ix != null) j[ix] += dx;
  if (iy != null) j[iy] += dy;
  void axisId;
}

function stationKnown(id: string, free: Set<string>, held: Map<string, Xy>, originId: string): boolean {
  return id === originId || held.has(id) || free.has(id);
}

function angleAt(v: Xy, f: Xy, t: Xy): number {
  return wrap(Math.atan2(t.y - v.y, t.x - v.x) - Math.atan2(f.y - v.y, f.x - v.x));
}

function unusedObs(id: string, kind: SolveObservation['kind'], sigma: number, pointIds: string[]): SolveObservation {
  return {
    id,
    kind,
    residual: 0,
    sigma,
    redundancy: 0,
    standardised: null,
    mdb: null,
    flagged: false,
    used: false,
    pointIds,
  };
}

interface LmResult {
  x: number[];
  rankDeficient: boolean;
  nullVector: number[] | null;
  q: number[][] | null;
  converged: boolean;
}

function runLm(built: Built): LmResult {
  const n = built.params.length;
  const x = built.x0.slice();
  if (n === 0 || built.obs.length === 0) {
    return { x, rankDeficient: false, nullVector: null, q: n === 0 ? [] : null, converged: true };
  }
  let lambda = 1e-3;
  let cost = costOf(built, x);
  let converged = false;
  for (let iter = 0; iter < 40; iter++) {
    const { N, g } = normal(built, x);
    const decrement = gnDecrement(N, g);
    if (decrement != null && decrement >= 0 && decrement <= 1e-10 * Math.max(1, cost)) {
      converged = true;
      break;
    }
    const damped = N.map((row) => row.slice());
    for (let i = 0; i < n; i++) damped[i][i] += lambda * Math.max(N[i][i], 1e-8);
    const rhs = g.map((v) => -v);
    const step = solveEquilibrated(damped, rhs);
    if (!step) {
      lambda *= 10;
      if (lambda > 1e12) break;
      continue;
    }
    const trial = x.map((v, i) => v + step[i]);
    const next = costOf(built, trial);
    const pos = maxPositionStep(built.params, step);
    if (next <= cost) {
      for (let i = 0; i < n; i++) x[i] = trial[i];
      const improvement = cost - next;
      cost = next;
      lambda = Math.max(1e-8, lambda * 0.3);
      if (pos < LM_STEP_M && improvement < 1e-12) {
        converged = true;
        break;
      }
    } else {
      lambda *= 4;
      if (lambda > 1e12) break;
    }
  }
  const { N } = normal(built, x);
  const q = invertSpd(N);
  if (!q) {
    return { x, rankDeficient: true, nullVector: nullVectorOf(N), q: null, converged };
  }
  return { x, rankDeficient: false, nullVector: null, q, converged };
}

/** Predicted cost drop gᵀ N⁻¹ g. Null when N has no inverse. */
function gnDecrement(N: number[][], g: number[]): number | null {
  const delta = solveEquilibrated(N, g);
  if (!delta) return null;
  let s = 0;
  for (let i = 0; i < g.length; i++) s += delta[i] * g[i];
  return s;
}

function costOf(built: Built, x: number[]): number {
  let s = 0;
  for (const o of built.obs) {
    const v = o.residual(x);
    s += (v * v) / (o.sigma * o.sigma);
  }
  return s;
}

function normal(built: Built, x: number[]): { N: number[][]; g: number[] } {
  const n = built.params.length;
  const N = zeros(n, n);
  const g = Array<number>(n).fill(0);
  for (const o of built.obs) {
    const v = o.residual(x);
    const j = o.jacobian(x);
    const p = 1 / (o.sigma * o.sigma);
    for (let a = 0; a < n; a++) {
      g[a] += j[a] * p * v;
      for (let b = 0; b < n; b++) N[a][b] += j[a] * p * j[b];
    }
  }
  return { N, g };
}

function maxPositionStep(params: Param[], step: number[]): number {
  let m = 0;
  for (let i = 0; i < params.length; i++) {
    if (params[i].kind === 'yaw' || params[i].kind === 'fx') continue;
    m = Math.max(m, Math.abs(step[i]));
  }
  return m;
}

function nullVectorOf(N: number[][]): number[] | null {
  if (N.length === 0) return null;
  const eigen = scaledEigen(N);
  let k = 0;
  for (let i = 1; i < eigen.values.length; i++) if (eigen.values[i] < eigen.values[k]) k = i;
  const max = Math.max(...eigen.values.map((v) => Math.abs(v)));
  if (eigen.values[k] > 1e-10 * max) return null;
  return eigen.vectors.map((row) => row[k]);
}

function worstNullPoint(vec: number[] | null, params: Param[], originId: string, axisId: string): string | null {
  void originId;
  if (!vec) return null;
  const score = new Map<string, number>();
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p.kind === 'yaw' || p.kind === 'fx') continue;
    if (p.owner === axisId && p.kind === 'x' && params.filter((q) => q.owner === axisId).length === 1) {
      // Keep the datum scale unknown unless a free point shares the null space.
    }
    score.set(p.owner, (score.get(p.owner) ?? 0) + vec[i] * vec[i]);
  }
  let best: string | null = null;
  let bestScore = 0;
  for (const [id, s] of score) {
    if (id === axisId) continue;
    if (s > bestScore) {
      bestScore = s;
      best = id;
    }
  }
  return bestScore > 1e-8 ? best : null;
}

function finishStats(built: Built, adjusted: LmResult): { observations: SolveObservation[]; vPv: number } {
  const observations: SolveObservation[] = built.unused.slice();
  let vPv = 0;
  const n = built.params.length;
  const q = adjusted.q;
  for (const o of built.obs) {
    if (o.live && !o.live()) {
      observations.push(unusedObs(o.id, o.kind, o.sigma, o.pointIds));
      continue;
    }
    const v = o.residual(adjusted.x);
    const p = 1 / (o.sigma * o.sigma);
    vPv += v * v * p;
    let r = 0;
    if (q && n > 0) {
      const j = o.jacobian(adjusted.x);
      let h = 0;
      for (let a = 0; a < n; a++) {
        let qj = 0;
        for (let b = 0; b < n; b++) qj += q[a][b] * j[b];
        h += j[a] * qj;
      }
      r = 1 - p * h;
      if (r < 0 && r > -1e-6) r = 0;
    }
    const standardised = r > 1e-8 ? v / (o.sigma * Math.sqrt(r)) : null;
    const mdb = r > 1e-8 ? (MDB_FACTOR * o.sigma) / Math.sqrt(r) : null;
    observations.push({
      id: o.id,
      kind: o.kind,
      residual: v,
      sigma: o.sigma,
      redundancy: r,
      standardised,
      mdb,
      flagged: standardised != null && Math.abs(standardised) > W_CRITICAL,
      used: true,
      pointIds: o.pointIds,
    });
  }
  return { observations, vPv };
}

function rejectBehindCamera(
  bearings: BearingPrep[],
  built: Built,
  adjusted: LmResult,
  state: Map<string, PointState>,
  free: Set<string>,
  held: Map<string, Xy>,
  originId: string,
  axisId: string,
): string[] {
  const victims: string[] = [];
  const place = (id: string): Xy | null => xyOfState(id, state, held, originId, axisId);
  for (const b of bearings) {
    const camera = place(b.photo.stationId);
    const mark = place(b.pointId);
    if (!camera || !mark) continue;
    const yawIndex = built.index.get(`yaw:${b.photo.id}`);
    const yaw = b.photo.yawHeldRad != null ? b.photo.yawHeldRad : yawIndex == null ? 0 : adjusted.x[yawIndex];
    const predicted = predictedBearing(mark.x, mark.y, camera.x, camera.y, yaw);
    const range = hypot2(camera, mark);
    if (Math.abs(predicted) < Math.PI / 2 && range >= MIN_RAY_RANGE_M) continue;
    const victim = free.has(b.pointId) ? b.pointId : free.has(b.photo.stationId) ? b.photo.stationId : null;
    if (!victim || victims.includes(victim)) continue;
    const s = state.get(victim);
    if (!s) continue;
    s.x = undefined;
    s.y = undefined;
    s.unsetCode = 'behind-camera';
    s.method = undefined;
    free.delete(victim);
    victims.push(victim);
  }
  return victims;
}

function parameterGain(
  j: number[],
  q: number[][],
  sigma: number,
  index: Map<string, number>,
  id: string,
): number {
  const p = 1 / (sigma * sigma);
  const n = j.length;
  let hx = 0;
  let hy = 0;
  const ix = index.get(`${id}:x`);
  const iy = index.get(`${id}:y`);
  for (let col = 0; col < n; col++) {
    const jp = j[col] * p;
    if (ix != null) hx += q[ix][col] * jp;
    if (iy != null) hy += q[iy][col] * jp;
  }
  return Math.hypot(hx, hy);
}

function withheldChecks(
  input: SolveInput,
  distances: DistPrep[],
  built: Built,
  adjusted: LmResult,
  offsets: Map<string, Xy>,
  originId: string,
  axisId: string,
  state: Map<string, PointState>,
  held: Map<string, Xy>,
): WithheldCheck[] {
  if (!adjusted.q) return [];
  const out: WithheldCheck[] = [];
  for (const d of distances) {
    if (!d.raw.withheld) continue;
    const aKnown = pointSolved(d.raw.a, built, state, held, originId);
    const bKnown = pointSolved(d.raw.b, built, state, held, originId);
    if (!aKnown || !bKnown) continue;
    const a = featureAt(d.raw.a, adjusted.x, built, state, held, originId, axisId);
    const b = featureAt(d.raw.b, adjusted.x, built, state, held, originId, axisId);
    if (!a || !b) continue;
    const oa = offsets.get(d.raw.a) ?? { x: 0, y: 0 };
    const ob = offsets.get(d.raw.b) ?? { x: 0, y: 0 };
    const ax = a.x + oa.x;
    const ay = a.y + oa.y;
    const bx = b.x + ob.x;
    const by = b.y + ob.y;
    const dx = bx - ax;
    const dy = by - ay;
    const predicted = Math.hypot(dx, dy);
    const L = predicted || 1e-9;
    const g = Array<number>(built.params.length).fill(0);
    add(g, built.index, d.raw.a, -dx / L, -dy / L, axisId);
    add(g, built.index, d.raw.b, dx / L, dy / L, axisId);
    let variance = 0;
    for (let i = 0; i < g.length; i++) {
      let qg = 0;
      for (let k = 0; k < g.length; k++) qg += adjusted.q[i][k] * g[k];
      variance += g[i] * qg;
    }
    if (variance < 0) variance = 0;
    const limit = Z_95 * Math.sqrt(variance + d.sigma * d.sigma);
    const miss = d.horizontalM - predicted;
    out.push({
      id: d.raw.id,
      observedM: d.horizontalM,
      predictedM: predicted,
      missM: miss,
      sigmaCheckM: d.sigma,
      predictedVarianceM2: variance,
      limitM: limit,
      pass: Math.abs(miss) <= limit + 1e-12,
      pointIds: [d.raw.a, d.raw.b],
    });
  }
  void input;
  return out;
}

function pointSolved(
  id: string,
  built: Built,
  state: Map<string, PointState>,
  held: Map<string, Xy>,
  originId: string,
): boolean {
  if (id === originId || held.has(id)) return true;
  return built.params.some((p) => p.owner === id && p.kind !== 'yaw') || (state.get(id)?.x != null && state.get(id)?.y != null);
}

function featureAt(
  id: string,
  x: number[],
  built: Built,
  state: Map<string, PointState>,
  held: Map<string, Xy>,
  originId: string,
  axisId: string,
): Xy | null {
  if (id === originId) return { x: 0, y: 0 };
  if (held.has(id)) return held.get(id)!;
  const ix = built.index.get(`${id}:x`);
  if (ix != null) {
    const iy = built.index.get(`${id}:y`);
    return { x: x[ix], y: id === axisId ? 0 : iy == null ? 0 : x[iy] };
  }
  const s = state.get(id);
  if (s?.x == null || s.y == null) return null;
  return { x: s.x, y: id === axisId ? 0 : s.y };
}

function paramValue(built: Built, x: number[], id: string, kind: 'x' | 'y'): number | null {
  const i = built.index.get(`${id}:${kind}`);
  return i == null ? null : x[i];
}

function xyOfState(
  id: string,
  state: Map<string, PointState>,
  held: Map<string, Xy>,
  originId: string,
  axisId: string,
): Xy | null {
  if (id === originId) return { x: 0, y: 0 };
  if (held.has(id)) return held.get(id)!;
  const s = state.get(id);
  if (!s || s.x == null || s.y == null) return null;
  return { x: s.x, y: id === axisId ? 0 : s.y };
}

function xyOfUpdated(
  id: string,
  state: Map<string, PointState>,
  held: Map<string, Xy>,
  originId: string,
  axisId: string,
): Xy | null {
  return xyOfState(id, state, held, originId, axisId);
}

function marginalQ(
  id: string,
  built: Built,
  q: number[][] | null,
  axisId: string,
): [number, number, number] | null {
  if (!q) return null;
  const ix = built.index.get(`${id}:x`);
  const iy = built.index.get(`${id}:y`);
  if (ix == null && iy == null) return null;
  if (id === axisId || iy == null) {
    if (ix == null) return null;
    return [q[ix][ix], 0, 0];
  }
  if (ix == null) return [0, 0, q[iy][iy]];
  return [q[ix][ix], q[ix][iy], q[iy][iy]];
}

function publishPoints(
  state: Map<string, PointState>,
  built: Built,
  adjusted: LmResult,
  withheld: WithheldCheck[],
  originId: string,
  axisId: string,
  free: Set<string>,
  held: Map<string, Xy>,
  bearings: BearingPrep[],
  varianceHigh: boolean,
  qScale: number,
  scaleFixed: boolean,
): SolvePoint[] {
  const points: SolvePoint[] = [];
  for (const s of state.values()) {
    if (s.id === originId) {
      points.push({
        id: s.id,
        status: 'checked',
        x: 0,
        y: 0,
        datumRole: 'origin',
        method: 'datum',
        plantable: false,
        plantableBlock: 'datum',
      });
      continue;
    }
    const isHeldControl = (held.has(s.id) && !free.has(s.id)) || (scaleFixed && s.id === axisId);
    if (isHeldControl) {
      const h = held.get(s.id);
      points.push({
        id: s.id,
        status: 'checked',
        x: h ? h.x : (s.x ?? 0),
        y: h ? h.y : 0,
        datumRole: s.id === axisId ? 'axis' : undefined,
        method: 'datum',
        plantable: false,
        plantableBlock: 'datum',
      });
      continue;
    }
    const have = s.x != null && s.y != null && (free.has(s.id) || s.id === axisId);
    if (!have || s.x == null || s.y == null) {
      const separation =
        s.candidates && s.candidates.length === 2 ? hypot2(s.candidates[0], s.candidates[1]) : undefined;
      points.push({
        id: s.id,
        status: 'unset',
        unsetCode: s.unsetCode ?? 'no-observation',
        candidates: s.candidates,
        candidateSeparationM: separation,
        thetaRad: s.thetaRad,
        earlyWarning: s.earlyWarning,
        dangerRatio: s.dangerRatio,
        dangerKind: s.dangerKind,
        markCount: s.markCount,
      });
      continue;
    }

    const qPrior = marginalQ(s.id, built, adjusted.q, axisId);
    let ellPrior = qPrior ? ellipseFrom2x2(qPrior[0], qPrior[1], qPrior[2]) : null;
    const gate = checkedGate(s, built, adjusted, bearings, s.id === axisId);
    let status: SolvePoint['status'] = gate.ok ? 'checked' : 'unchecked';
    let varianceHold = false;
    if (varianceHigh && status === 'checked') {
      status = 'unchecked';
      varianceHold = true;
    }

    let x: number | undefined = s.x;
    let y: number | undefined = s.y;
    let rejected: SolvePoint['rejected'];
    let unsetCode = s.unsetCode;
    const dangerOver =
      s.earlyWarning === 'danger' &&
      ellPrior != null &&
      ellPrior.major95M > STATION_CLASS_M &&
      (s.method === 'resection' || s.dangerKind != null);
    const sanityOver = ellPrior != null && ellPrior.major95M > SANITY_SEMI_MAJOR_M;
    if (dangerOver || sanityOver) {
      rejected = {
        x: s.x,
        y: s.y,
        semiMajor95M: ellPrior?.major95M,
        dangerRatio: s.dangerRatio,
      };
      x = undefined;
      y = undefined;
      status = 'unset';
      unsetCode = dangerOver ? 'danger' : 'sanity';
      ellPrior = null;
    }

    const q =
      qPrior && ellPrior && qScale !== 1
        ? ([qPrior[0] * qScale, qPrior[1] * qScale, qPrior[2] * qScale] as [number, number, number])
        : qPrior;
    const ell = q && ellPrior ? ellipseFrom2x2(q[0], q[1], q[2]) : ellPrior;
    const stationBlock = stationClassBlock(s, ell?.major95M, status, bearings);
    const meetsStationClass =
      stationBlock == null && status === 'checked' && (s.method === 'resection' || s.method === 'both-tapes');
    const plant = plantableBlock(s, status, ell?.major95M, withheld, s.id === axisId, varianceHold);

    points.push({
      id: s.id,
      status,
      x,
      y,
      datumRole: s.id === axisId ? 'axis' : undefined,
      semiMajor95M: ell ? ell.major95M : undefined,
      semiMinor95M: ell ? ell.minor95M : undefined,
      majorAzimuthRad: ell ? ell.azimuthRad : undefined,
      q: q ?? undefined,
      unsetCode: status === 'unset' ? unsetCode : undefined,
      earlyWarning: s.earlyWarning,
      weak: s.weak,
      branchChoice: s.branchChoice,
      method: s.method,
      rejected,
      meetsStationClass,
      stationClassBlock:
        s.method === 'resection' || s.method === 'both-tapes' || s.method === 'branch'
          ? (stationBlock ?? undefined)
          : undefined,
      plantable: plant == null,
      plantableBlock: plant ?? undefined,
      uncheckedObservationId: status === 'unchecked' ? gate.observationId : undefined,
      varianceHold: varianceHold || undefined,
      candidates: s.candidates,
      thetaRad: s.thetaRad,
      dangerRatio: s.dangerRatio,
      dangerKind: s.dangerKind,
      markCount: s.markCount,
    });
  }
  return points;
}

function checkedGate(
  s: PointState,
  built: Built,
  adjusted: LmResult,
  bearings: BearingPrep[],
  isAxis: boolean,
): { ok: boolean; observationId?: string } {
  if (s.branchChoice) return { ok: false };
  if (!adjusted.q) return { ok: false };
  const classTol = s.method === 'resection' || s.method === 'both-tapes' ? STATION_CLASS_M : PLANTABLE_CLASS_M;
  let blocked: string | undefined;
  let saw = false;
  for (const o of built.obs) {
    if (o.kind === 'focal' || (o.live && !o.live())) continue;
    const j = o.jacobian(adjusted.x);
    const gain = parameterGain(j, adjusted.q, o.sigma, built.index, s.id);
    if (!(gain > 1e-8)) continue;
    saw = true;
    const obs = redundancyOf(o, j, adjusted);
    const photo = bearings.find((b) => `${b.photo.id}:${b.pointId}` === o.id)?.photo;
    const fxMissing =
      o.kind === 'bearing' &&
      photo != null &&
      photo.fxRelativeUncertainty == null &&
      photo.bearingSigmaRad == null &&
      s.method !== 'distances' &&
      s.method !== 'both-tapes' &&
      s.method !== 'datum';
    if (fxMissing) {
      blocked = blocked ?? o.id;
      continue;
    }
    // r ≈ 0 makes an MDB unbounded. Block only when a 1σ shift is real.
    if (obs < REDUNDANCY_ZERO) {
      if (gain * o.sigma > ZERO_REDUNDANCY_SHIFT_M) blocked = blocked ?? o.id;
      continue;
    }
    const move = gain * ((MDB_FACTOR * o.sigma) / Math.sqrt(obs));
    if (move > classTol) blocked = blocked ?? o.id;
  }
  if (!saw && !isAxis) return { ok: false };
  if (blocked) return { ok: false, observationId: blocked };
  return { ok: true };
}

function redundancyOf(o: ObsFn, j: number[], adjusted: LmResult): number {
  const q = adjusted.q;
  if (!q) return 0;
  const n = j.length;
  const p = 1 / (o.sigma * o.sigma);
  let h = 0;
  for (let a = 0; a < n; a++) {
    let qj = 0;
    for (let b = 0; b < n; b++) qj += q[a][b] * j[b];
    h += j[a] * qj;
  }
  let r = 1 - p * h;
  if (r < 0 && r > -1e-6) r = 0;
  return r;
}

function stationClassBlock(
  s: PointState,
  semiMajor95M: number | undefined,
  status: SolvePoint['status'],
  bearings: BearingPrep[],
): SolvePoint['stationClassBlock'] | null {
  if (s.method !== 'resection' && s.method !== 'both-tapes' && s.method !== 'branch') return null;
  if (s.method === 'branch' || s.branchChoice) return 'branch';
  if (status === 'unset') return s.earlyWarning === 'danger' ? 'danger' : 'ambiguous';
  if (s.method === 'resection' && !s.levelled) return 'level';
  if (s.method === 'resection') {
    const rays = bearings.filter((b) => b.photo.stationId === s.id);
    const fxCarried = rays.length > 0 && rays.every((b) => (b.photo.fxRelativeUncertainty ?? 0) > 0 || b.photo.bearingSigmaRad != null);
    if (!fxCarried) return 'fx';
  }
  if (semiMajor95M == null || semiMajor95M > STATION_CLASS_M) return 'ellipse';
  if (status !== 'checked') return 'unchecked';
  return null;
}

function plantableBlock(
  s: PointState,
  status: SolvePoint['status'],
  semiMajor95M: number | undefined,
  withheld: WithheldCheck[],
  isAxis: boolean,
  varianceHold: boolean,
): SolvePoint['plantableBlock'] | null {
  if (s.method === 'datum' || isAxis) return 'datum';
  if (varianceHold) return 'variance';
  if (status === 'unset') return 'unset';
  if (status !== 'checked') return 'unchecked';
  if (semiMajor95M == null || semiMajor95M > PLANTABLE_CLASS_M) return 'ellipse';
  const checks = withheld.filter((w) => w.pointIds.includes(s.id));
  if (checks.length === 0) return 'no-withheld';
  if (checks.some((w) => !w.pass)) return 'withheld-fail';
  return null;
}

