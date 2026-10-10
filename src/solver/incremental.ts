/**
 * Incremental traverse solve. Each step is one adjustment of the observations
 * whose `step` is absent or at most that index, so it can run after a new
 * tape or photo without re-walking earlier steps unless the caller asks.
 */

import type { SolverDistanceInput, SolveInput } from './types';
import { solve } from './adjust';
import { ellipseFrom2x2 } from './stats';

export interface IncrementalStepQuery {
  /** Keep distances and photos whose `step` is absent or ≤ this. */
  step: number;
  /** Mark whose ellipse is reported. The last mark of this step. */
  newestId: string;
}

export interface IncrementalTie {
  id: string;
  redundancy: number;
  /** Metres. Null when the tie has no redundancy. */
  mdbM: number | null;
}

export interface IncrementalStepReport {
  step: number;
  newestId: string;
  /** 1σ semi-major, metres. Null when the mark is unset. */
  semiMajorM: number | null;
  semiMinorM: number | null;
  /** Azimuth of the major axis, radians from +X. */
  majorAzimuthRad: number | null;
  /**
   * Minimum redundancy of this step's leg tapes, cross-ties, and leg-station
   * rays. The closing 4-leg loop's minimum is the leg-station ray (about 0.14).
   */
  tieRedundancy: number | null;
  /** Maximum MDB of those ties, metres. Null when one of them is unchecked. */
  tieMdbM: number | null;
  /** A-priori 1σ of the shared scale, or of the only scale. Not a held calibration. */
  fxSigma: number | null;
  degreesOfFreedom: number;
  converged: boolean;
  ties: IncrementalTie[];
}

function isTie(d: SolverDistanceInput): boolean {
  return d.role === 'leg' || d.role === 'cross';
}

/** Observations up to and including `step`. Distances and photos with no step stay. */
export function sliceTraverseStep(input: SolveInput, step: number): SolveInput {
  return {
    ...input,
    distances: (input.distances ?? []).filter((d) => d.step == null || d.step <= step),
    photos: (input.photos ?? []).filter((p) => p.step == null || p.step <= step),
  };
}

/** One adjustment of the prefix through `query.step`. */
export function solveTraverseStep(input: SolveInput, query: IncrementalStepQuery): IncrementalStepReport {
  const sliced = sliceTraverseStep(input, query.step);
  const result = solve(sliced);
  const tieIds = new Set(
    (sliced.distances ?? [])
      .filter((d) => d.step === query.step && isTie(d))
      .map((d) => d.id),
  );
  for (const photo of sliced.photos ?? []) {
    if (photo.step !== query.step || photo.role !== 'leg') continue;
    for (const click of photo.clicks) tieIds.add(`${photo.id}:${click.pointId}`);
  }
  const ties: IncrementalTie[] = result.observations
    .filter((o) => o.used && tieIds.has(o.id))
    .map((o) => ({ id: o.id, redundancy: o.redundancy, mdbM: o.mdb }));
  const newest = result.points.find((p) => p.id === query.newestId);
  const ell = newest?.q ? ellipseFrom2x2(newest.q[0], newest.q[1], newest.q[2]) : null;
  const focal = result.focals.find((f) => f.shared) ?? result.focals[0];
  const finiteMdb = ties.every((t) => t.mdbM != null);
  return {
    step: query.step,
    newestId: query.newestId,
    semiMajorM: ell?.major1M ?? null,
    semiMinorM: ell?.minor1M ?? null,
    majorAzimuthRad: ell ? ell.azimuthRad : null,
    tieRedundancy: ties.length > 0 ? Math.min(...ties.map((t) => t.redundancy)) : null,
    tieMdbM: ties.length > 0 && finiteMdb ? Math.max(...ties.map((t) => t.mdbM ?? 0)) : null,
    fxSigma: focal?.sigma ?? null,
    degreesOfFreedom: result.degreesOfFreedom,
    converged: result.converged,
    ties,
  };
}

/**
 * Solve each prefix in order. Call `solveTraverseStep` instead when only the
 * newest observation has arrived.
 */
export function solveIncremental(input: SolveInput, steps: IncrementalStepQuery[]): IncrementalStepReport[] {
  return steps.map((query) => solveTraverseStep(input, query));
}
