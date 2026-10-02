/** Public types for the phase-1 adjustment. Coordinates are feature positions in metres. */

import type { VarianceTest } from './stats';

export type PointStatus = 'unset' | 'unchecked' | 'checked';

export type UnsetCode =
  | 'one-distance'
  | 'hanging'
  | 'mirror'
  | 'rank'
  | 'arc-only'
  | 'two-candidates'
  | 'flat-angle'
  | 'danger'
  | 'miss'
  | 'no-observation'
  | 'parallel-rays'
  | 'behind-camera'
  | 'diverged'
  | 'sanity';

export type EarlyWarning =
  | 'shallow-intersection'
  | 'straight-intersection'
  | 'shallow-rays'
  | 'danger';

export type FixMethod = 'datum' | 'distances' | 'resection' | 'both-tapes' | 'rays' | 'branch';

export interface SolverPointInput {
  id: string;
  /** Already in the frame. Not estimated. The datum origin and axis point ignore this. */
  held?: { x: number; y: number };
  /** Mark centre minus feature, metres, constant in the frame. v1 JSON does not set this. */
  markOffsetM?: { x: number; y: number };
}

export interface SolverDistanceInput {
  id: string;
  a: string;
  b: string;
  /** Slope distance, metres. */
  slopeM: number;
  deltaHM?: number;
  /**
   * Added to the slope before horizontal reduction.
   * Positive when a laser spot is on the near face of a roll (the reading is short of the centre).
   */
  faceOffsetM?: number;
  sigmaM?: number;
  /** σ² = a² + (b L)² when both are set. b is dimensionless (0.001 = 1 mm/m). */
  aM?: number;
  bPerM?: number;
  instrument?: 'tape' | 'laser' | 'rod';
  withheld?: boolean;
}

export interface SolverAngleInput {
  id: string;
  at: string;
  from: string;
  to: string;
  /** Signed angle from (at→from) to (at→to), counter-clockwise, radians. */
  radians: number;
  sigmaRad: number;
}

export interface SolverClick {
  pointId: string;
  px: number;
  py: number;
}

export interface SolverPhotoInput {
  id: string;
  /** Pole position. Shared by yaw-only extras. Created if it is not already a point. */
  stationId: string;
  width: number;
  height: number;
  /** Calibrated fx / width. One constant per phone and 1× lens. */
  fxOverWidth: number;
  fyOverHeight?: number;
  cx?: number;
  cy?: number;
  clicks: SolverClick[];
  /** Camera frame, y down, z forward. Level phone ≈ (0, +1, 0). */
  gravity?: { x: number; y: number; z: number };
  /** Set when a bubble was required because gravity was refused. */
  bubbleEnforced?: boolean;
  /**
   * 1σ residual tilt (pitch and roll), radians, when a bubble stands in for
   * gravity. Each ray then grows by about ε·v/fx and δ·u·v/(fx²+u²).
   * Omitted with a bubble uses 0.5°.
   */
  bubbleTiltSigmaRad?: number;
  sigmaPx?: number;
  sigmaCentringM?: number;
  /** Replaces the pixel formula for every ray in this photo. */
  bearingSigmaRad?: number;
  /**
   * Relative 1σ of fx, e.g. 0.01. When set, fx is a parameter with this prior
   * and every ray from the photo carries it into the ellipses. Omitted means
   * fx is treated as exact (the caller already folded it into bearing σ, or
   * the rays must not check a point).
   */
  fxRelativeUncertainty?: number;
  /** Hold yaw (radians). The station position may still be free. */
  yawHeldRad?: number;
}

export interface SolverDatumInput {
  originId: string;
  axisPointId: string;
  lengthM: number;
  sigmaM?: number;
  aM?: number;
  bPerM?: number;
  instrument?: 'tape' | 'laser' | 'rod';
  /** +1 puts the garden on the left of origin→axis. Default +1. */
  gardenSign?: 1 | -1;
  /** Default true. The tape is a normal distance, not a pin on the axis point. */
  observeLength?: boolean;
  /**
   * Eliminate B_x as well: B is held at (length, 0) and the tape is not an
   * observation. Use this instead of a tiny σ when a test needs a fixed base.
   */
  fixScale?: boolean;
}

export interface SolverBranchChoice {
  /** Station or free-point id. */
  id: string;
  candidateIndex: 0 | 1;
}

export interface SolveInput {
  points?: SolverPointInput[];
  datum: SolverDatumInput;
  distances?: SolverDistanceInput[];
  angles?: SolverAngleInput[];
  photos?: SolverPhotoInput[];
  branchChoices?: SolverBranchChoice[];
  /**
   * Drop one observation and re-solve, up to three times, only when its |w|
   * stands clear of the next residual, flagged or not, and the variance test then passes.
   */
  dropBlunders?: boolean;
}

export interface SolvePoint {
  id: string;
  status: PointStatus;
  x?: number;
  y?: number;
  datumRole?: 'origin' | 'axis';
  semiMajor95M?: number;
  semiMinor95M?: number;
  majorAzimuthRad?: number;
  /** Marginal (qxx, qxy, qyy) in metres². */
  q?: [number, number, number];
  unsetCode?: UnsetCode;
  earlyWarning?: EarlyWarning;
  weak?: boolean;
  branchChoice?: boolean;
  method?: FixMethod;
  rejected?: { x: number; y: number; semiMajor95M?: number; dangerRatio?: number };
  meetsStationClass?: boolean;
  stationClassBlock?:
    | 'fx'
    | 'level'
    | 'ellipse'
    | 'ambiguous'
    | 'branch'
    | 'danger'
    | 'unchecked';
  plantable?: boolean;
  plantableBlock?:
    | 'unchecked'
    | 'ellipse'
    | 'no-withheld'
    | 'withheld-fail'
    | 'datum'
    | 'unset'
    | 'variance';
  /** Observation that keeps this point unchecked, when there is one. */
  uncheckedObservationId?: string;
  /** Variance factor is high, so checked and plantable are withheld. */
  varianceHold?: boolean;
  candidates?: { x: number; y: number }[];
  candidateSeparationM?: number;
  thetaRad?: number;
  dangerRatio?: number;
  dangerKind?: 'circle' | 'line';
  markCount?: number;
}

export interface SolveObservation {
  id: string;
  kind: 'distance' | 'bearing' | 'angle' | 'focal';
  /** Observed minus computed. Metres or radians. Meaningless when used is false. */
  residual: number;
  sigma: number;
  redundancy: number;
  standardised: number | null;
  mdb: number | null;
  flagged: boolean;
  used: boolean;
  pointIds: string[];
}

export interface WithheldCheck {
  id: string;
  observedM: number;
  predictedM: number;
  missM: number;
  sigmaCheckM: number;
  predictedVarianceM2: number;
  /** 1.96 √(gᵀ Q g + σ²). */
  limitM: number;
  pass: boolean;
  pointIds: [string, string];
}

export interface SolveResult {
  points: SolvePoint[];
  observations: SolveObservation[];
  withheld: WithheldCheck[];
  /** σ̂₀. Null when there is no redundancy. */
  sigma0: number | null;
  /** vᵀ P v. Null when nothing was adjusted. */
  vPv: number | null;
  degreesOfFreedom: number;
  unknownCount: number;
  observationCount: number;
  varianceTest: VarianceTest;
  /** True when a high variance factor scaled the published covariances by σ̂₀². */
  covarianceScaled: boolean;
  /** Levenberg–Marquardt reached the 0.1 mm step. False means coordinates were not published. */
  converged: boolean;
  droppedObservationIds: string[];
  /** Flagged observations that were not isolated enough to drop. */
  inseparableObservationIds: string[];
  /** Photos the document adapter refused to resect. */
  skippedPhotos: { id: string; code: 'no-fx' }[];
  datum: { originId: string; axisPointId: string; gardenSign: 1 | -1 };
}
