# Garden circle validation — specification

Saved verbatim from the Geometry & Maths Advisor (/workspace/petri/review/garden-circle-advice.md). The implementation is `src/solver/circleCheck.ts`; the guided steps are in `src/workflows/guided/definitions.ts` (circle field test, revision 4).

## Advice (verbatim)

FIT: preferably in the main adjust. Unknowns cx, cy, R. Each edge point gets an on-circle pseudo-observation, sigma 10-20 mm. sigma_D = 2 sigma_R. Fallback: Kasa initial fit, then 3-5 Gauss-Newton steps on |p-c|-R, weighted by radial variance n^T Sigma n.
N/SPREAD: N >= 8, max angular gap <= 60 deg, coverage >= 270 deg (ideally 360). If residual RMS > 2x the expected value or chi2 fails, flag "not a circle".
SCALE: scale comes from the BAS tape, not fx. Diameter is a validation, not the calibration. Optionally solve fx with D_tape: accept only if sigma_fx < 0.5% and |corr(fx, R)| < 0.9.
TAPE: >= 3 diameters about 60 deg apart, max chord each time, same edge (inside/outside) as the clicks. Use the mean; sigma_tape = spread/sqrt3 + 5 mm.
PASS: Delta = D_fit - D_tape, sigma_Delta = sqrt(sigma_D^2 + sigma_tape^2).
- Green: <= 1.96 sigma_Delta AND <= cap.
- Amber: 1.96-3.29 sigma_Delta or <= 1.5x cap.
- Red: otherwise.
- Caps: 60 mm (baseline class), 100 mm (plantable class).
- chi2 must pass. If sigma_D > cap, the result is inconclusive.
- Report |Delta| and sigma_D.
WEAK GEOMETRY:
- Cameras on >= 3 sides, with an intersection angle >= 30 deg at every edge point.
- Baseline >= D/2, circle within ~2 baseline lengths, baseline roughly tangential.
- Check for the danger circle in resection.
- Every edge point needs >= 2 rays.

## Implementation notes (not part of the advice)

- **Clicks and the taped edge.** Every edge cane is clicked at its centre (the sleeve axis, at mid-code height), and the taped edge is taken to run through the cane centres. Plant each cane with its axis on the edge you taped (inside or outside, as recorded in "Tape the diameter"). No inside/outside offset is applied.
- **Fit weighting.** The fit uses the full joint covariance Σ_pp of all edge points from the main adjust, cross-covariances included (`jointCofactor`, scaled by σ̂₀² when the adjust scaled its covariances): W = (J Σ_pp Jᵀ + σ²I)⁻¹, with J the radial unit vectors and σ = 15 mm on-circle pseudo-observations.
- **Network solvability** (replaces "a baseline end in every photo"): the adjust is full rank (converged, joint cofactor exists, no point unset for rank); each camera position's 95% error ellipse semi-major is within the camera-position class (200 mm); each edge point has ≥ 2 rays and an intersection angle ≥ 30°. At least two camera positions are taped to both BAS ends, standing on the circle side of BAS01–BAS02 (a two-tape fix from behind the line is a mirror). Photos with no baseline end are oriented through canes shared with another photo from the same position (turn on the spot, keep one cane from the previous photo in view).
- **Baseline reach.** The 6 m minimum (D/2) stays. When edge points are more than 2 baseline lengths from the baseline middle, the result shows a warning (not a gate) recommending 8–10 m, roughly tangential.
