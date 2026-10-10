/**
 * Phase-1 geometry prototype.
 *
 * Choices confirmed by the maths review of PR #3, named here so they stay
 * visible:
 * - The variance-factor test is one-sided, upper tail, at 5%. 'low' is
 *   information only and is not a warning.
 * - A subtended angle under 1° is only a numeric guard for θ → 0.
 * - Two distance circles that miss by more than 3 √(σ₀²+σ₁²) are a miss.
 *   A smaller gap is a weak point.
 * - A bubble with no gravity widens each ray by the tilt σ (default 0.5°):
 *   about ε·v/fx for roll and δ·u·v/(fx²+u²) for pitch.
 * - fx, when a relative σ is supplied, is a parameter with that prior. Photos
 *   that name the same phone and the same resolved lens share one scale and
 *   one prior. The lens is named ('1x', '1×' and '1.0x' match) or read from
 *   EXIF. A missing lens does not join 1×: that photo keeps a private scale
 *   and is flagged. A photo with no phone keeps its own scale. Rays from a
 *   both-tapes station carry it. Depth and "four marks" are not a class.
 * - A point is checked when every observation that moves it has an MDB-sized
 *   shift inside the class. r ≈ 0 is the only redundancy guard (a 1σ shift
 *   above 0.1 mm). A high variance factor withholds checked and plantable,
 *   and scales the published covariance by σ̂₀².
 * - One blunder is dropped only when its |w| is at least twice the next
 *   residual, flagged or not, and the variance test then passes.
 * - ∂β/∂s uses the nominal focal length. The current fx would add a factor (1+s).
 * - A traverse solve sets cameraCentring to 'setup': one 8 mm offset per
 *   station occupation, not a centring term on every ray. The default stays
 *   'ray', so a photo with no setup id is unchanged. Closing is a separate
 *   occupation when the photo sets `closing` or `role: 'close'`.
 * - An arc or a resection uses the best single frame. A second frame that
 *   only adds a mark does not skip an arc-and-tape seed. Two frames that
 *   each see two marks seed the station where the arcs meet.
 * - Photos that share a scale and disagree on the fx prior use the smallest.
 *   A held solve publishes sigmaHeld and marks the scale not calibratable.
 * - closureReport is the duplicate-point misclosure. Raw |w| is not a blunder
 *   test. solveTraverseStep is one adjustment of the observations so far.
 * - A both-tapes station takes its side from the branch choice or from the
 *   bearing order in its own photo. For a tape pair, index 0 is +Y of
 *   origin→axis (BAS01 at the origin, BAS02 on +X, so the peg side is index
 *   1). For one tape and one ray, index 0 is the nearer crossing along the
 *   ray and index 1 is the farther. A branch that contradicts the tape-pair
 *   bearings is unset as branch-conflict. The garden sign is only the
 *   distance-only fallback.
 * - After a behind-camera rejection the normal equations are rebuilt and
 *   solved again, and the check runs once more after the last re-solve.
 * - reflected counts garden-sign fallback points, including a tape chain
 *   that inherited that flag. A garden on -Y is not a false mirror.
 *   jointCofactor returns the a-priori joint covariance.
 * - House Q_m holds the first azimuth and puts angle noise on the other n−1
 *   turnings. All n interior angles also face |Σα−(n−2)π| ≤ 1.96 σ √n.
 * - v1 offsetMm is not applied. A constant frame offset is used only when the
 *   caller supplies markOffsetM.
 * - fixScale eliminates B_x. A 1e-8 m σ is not a substitute for that.
 */

export { ELLIPSE_95, CHI2_2_95, W_CRITICAL, MDB_FACTOR, Z_95 } from './constants';
export { solve } from './adjust';
export { closureReport, closureChi2, duplicateMisclosure } from './closure';
export type { ClosurePair, ClosureRequest, ClosureReport } from './closure';
export { solveIncremental, solveTraverseStep, sliceTraverseStep } from './incremental';
export type { IncrementalStepQuery, IncrementalStepReport, IncrementalTie } from './incremental';
export { solveGardenDocument } from './document';
export { circleTrialVerdict } from './circleTrial';
export type { CircleTrialInput, CircleTrialVerdict } from './circleTrial';
export { levelledBearing, predictedBearing, clickBearingUnlevelled, bearingSigma } from './bearing';
export {
  arcStation,
  resectThree,
  resectFromMarks,
  trilaterationEllipse,
  isoscelesRange,
  horizontalDistance,
  distanceSigma,
  dangerAssessment,
  intersectRays,
  wholeGardenReflection,
} from './geometry';
export { houseTolerance, openTraverse, traverseGeometry, misclosureChi2, angleSumCheck } from './house';
export { fitCircleGeometric, kasaSeed } from './circleFit';
export { chi2Cdf, chi2Ppf, nees2, ellipseFrom2x2 } from './stats';
export type {
  SolveInput,
  SolveResult,
  SolvePoint,
  SolveObservation,
  WithheldCheck,
  SolverPhotoInput,
  SolverDistanceInput,
  SolverDatumInput,
  SolveFocal,
  SolveWarning,
} from './types';
