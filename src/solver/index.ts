/**
 * Phase-1 geometry prototype.
 *
 * Assumptions the geometry note left open, so they are named here rather than
 * folded into a formula:
 * - The global variance-factor test is two-sided at 5%.
 * - A subtended angle under 1° is treated as θ → 0 and publishes no station.
 * - Two distance circles that miss by more than 0.2 m do not get a weak point.
 * - With no gravity vector, a bubble counts as levelled only when bearing σ
 *   is at least 0.5°.
 * - "Depth" means the nearest control mark is at most 75% of the farthest.
 * - A station trilaterated by tapes to both baseline ends does not need the
 *   1% focal-length rule: fx does not set that coordinate. The rule still
 *   applies to a resected station.
 * - House Q_m holds the first wall's azimuth (the datum) and puts angle noise
 *   on the other n−1 turning angles. That is what reproduces 93 mm and 144 mm.
 * - v1 offsetMm is not applied. A constant frame offset is used only when the
 *   caller supplies markOffsetM.
 */

export { ELLIPSE_95, CHI2_2_95, W_CRITICAL, MDB_FACTOR, Z_95 } from './constants';
export { solve } from './adjust';
export { solveGardenDocument } from './document';
export { levelledBearing, predictedBearing, clickBearingUnlevelled, bearingSigma } from './bearing';
export {
  arcStation,
  resectThree,
  trilaterationEllipse,
  isoscelesRange,
  horizontalDistance,
  distanceSigma,
  dangerAssessment,
  intersectRays,
} from './geometry';
export { houseTolerance, openTraverse, traverseGeometry, misclosureChi2 } from './house';
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
} from './types';
