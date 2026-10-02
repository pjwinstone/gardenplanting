/**
 * Numerical constants from docs/GEOMETRY_DESIGN.md.
 * Where the note names a test but not a threshold, the choice is recorded
 * on SOLVER_ASSUMPTIONS in index.ts so it can be reviewed rather than buried.
 */

/** √χ²(2, 0.95). 95% error-ellipse factor on the 1σ semi-major. */
export const ELLIPSE_95 = Math.sqrt(5.991464547107979);

/** χ²(2, 0.95). Accept a 2D misclosure when mᵀ Q⁻¹ m is at most this. */
export const CHI2_2_95 = 5.991464547107979;

/** Two-sided 0.1% normal critical value for the standardised residual. */
export const W_CRITICAL = 3.29;

/** MDB factor: 3.29 + 0.84, α = 0.1%, β = 80%. */
export const MDB_FACTOR = 4.13;

/** 1D 95% factor for a withheld distance. */
export const Z_95 = 1.96;

/** A determining observation at or below this redundancy leaves the point unchecked. */
export const UNCHECKED_REDUNDANCY = 0.1;

/** Photo-station class: 95% semi-major. */
export const STATION_CLASS_M = 0.2;

/** Plantable-point class: 95% semi-major. */
export const PLANTABLE_CLASS_M = 0.1;

/** Focal length must be known to this relative 1σ before a resected station can pass. */
export const FX_RELATIVE_MAX = 0.01;

/** Warn when |ρ − R| / R is below this (finite circumradius only). */
export const DANGER_RATIO_WARN = 0.2;

/** Trilateration early warning, degrees. The ellipse still decides. */
export const TRI_ANGLE_WARN_MIN_DEG = 20;

/** Trilateration early warning near a straight line, degrees. */
export const TRI_ANGLE_WARN_MAX_DEG = 160;

/** Ray crossing early warning, degrees. */
export const RAY_CROSS_WARN_DEG = 25;

/** Below this subtended angle a two-mark photo has no usable range. */
export const THETA_REJECT_RAD = (1 * Math.PI) / 180;

/** Step length that ends Levenberg–Marquardt, metres. */
export const LM_STEP_M = 0.0001;

/** Upper-tail significance for the global variance-factor test. 'low' is not a failure. */
export const VARIANCE_TEST_ALPHA = 0.05;

/** |w| must be at least this many times the next flagged residual before one observation is dropped. */
export const W_ISOLATION_RATIO = 2;

/** Circle gap above 3 √(σ₀² + σ₁²) is a miss, not a weak point. About 85 mm at 20 mm tapes. */
export const GAP_SIGMA_FACTOR = 3;

/** A published mark must sit at least this far in front of every camera that sees it. */
export const MIN_RAY_RANGE_M = 0.5;

/** Do not publish a coordinate whose a-priori 95% semi-major exceeds this. */
export const SANITY_SEMI_MAJOR_M = 5;

/** Default 1σ tilt when a bubble is enforced and the caller does not give a tilt σ. */
export const BUBBLE_TILT_RAD = (0.5 * Math.PI) / 180;

/** Default instrument figures when an observation does not carry its own σ. */
export const DEFAULT_SIGMA = {
  tapeM: 0.02,
  laserM: 0.005,
  rodM: 0.005,
  clickPx: 2,
} as const;
