# Garden circle validation — specification

Saved verbatim from the Geometry & Maths Advisor (/workspace/petri/review/garden-circle-advice.md). The implementation is `src/solver/circleCheck.ts`; the guided steps are in `src/workflows/guided/definitions.ts` (circle field test, revision 4).

**Revision 6 (no canes).** The camera positions, edge canes and edge sleeves below are replaced by a growing network of base points (BAS01, BAS02, BAS03…) taped on the North/East grid and one photo from each edge point. See *No-cane circle test* at the end. The circle fit and the comparison with the taped diameter are unchanged. Maths: `src/solver/controlCluster.ts`; net: `workflow/field-test.net.yaml` rev 6.

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

## No-cane circle test (rev 6)

Signed off by the Geometry & Maths Advisor (sim10/sim11, `/workspace/petri/sim-control/RESULTS.md`). Everything is calculated on the phone. There is no special circle set: base points are ordinary BAS sleeves from the marker set (BAS01, BAS02, then BAS03–BAS14, which carry the codes the old EDG sleeves had; reprint them from `docs/markers/`).

### Field steps, in plain words

1. **Gather the kit.** Phone, a long tape, BAS sleeves on posts. Edge points need no cane and no sleeve.
2. **Place and tape the baseline** BAS01–BAS02, and the laser check, as before.
3. **Add base points** with the tie form. BAS01 is the grid origin; the grid points north (set by eye or compass). For each new point, start from a point already placed, tape how far **East** and how far **North** it is, then the **diagonal** straight to it as a check. Ties between points already placed are welcome. Every save re-adjusts the whole network, logs the tie on the run, and shows each diagonal's check: red (|w| > 3.29) means re-tape that tie. Tick the step when you have enough.
   *Hint:* spread several base points so each edge point sees 4+ at good angles.
4. **Calibration photo** (focal length), as before. If it is only good to worse than 0.5 %, the result says *calibrate first* and no point can be green.
5. **Mark the edge points** EDG01… round the edge, in order, with a peg or chalk. Never more than 60° between neighbours.
6. **One photo from each edge point,** in order. Stand on the peg, face the middle, phone landscape at 1×, and tap the base points you can see. One photo; no turning, no tape. Under 4 base points the point goes grey. To redo one point, open **Photos** and press *Retake* on that photo: only that photo is replaced and it keeps its EDG number.
7. **Tape the diameter** three times, about 60° apart, as before.
8. **Circle result.** Each edge point gets a colour (with r, MDB and shift under *Measurement strength*), then the circle is fitted and compared with your tape exactly as before.

### What the app does

- **Base-point network** (`adjustGridNetwork`, re-run on every tie save): East and North offsets are distance observations along the grid axes (σ 3–5 mm). The pair from one tie also shares a squareness error (axes set by eye, default σ 1°), modelled as a correlated 2×2 block; the diagonal is a distance observation, blind to squareness, so it checks the two tape readings. Each reading gets r and w; diagonals are flagged red at |w| > 3.29. The N/E grid is the network frame; the grid-to-north rotation and its σ are stored for display only.
- **Session adjustment** (`adjustSession`, via `controlCircleVerdict` from `circleResult.ts`): per photo x, y, yaw (roll and pitch from the photo's gravity sidecar are applied to the clicks first; a photo without one is treated as level and the result says so); one shared focal length from the calibration photo with the step-8 prior (0.3 %); base-point coordinates as weighted priors with the network covariance. Observation: the image x of each sleeve axis, u = −fx·tan(bearing − yaw), σ 1 px.
- **Gates per edge point** (`gateEdgePoints`; numbers in `workflow/tolerances.json`), first match wins:
  - grey: fewer than 4 base points in the photo (`controlMinBasePoints`); or the photo is near a danger circle (normalised condition number of its x, y, yaw block > 200); or r < 0.01 on a row that moves the point;
  - red: any |w| > 3.29;
  - amber: max |w| above k = z(1 − 0.025/n), n = image rows in the photo (≈ 2.69 for 7 rows);
  - reliability shift ∇x = max over rows of ‖(AᵀPA)⁻¹AᵀP eᵢ · MDBᵢ‖ (x, y of the point), MDBᵢ = 4.13 σᵢ/√rᵢ: green ≤ 40 mm, amber 40–60 mm, grey above 60 mm (decision: not checked well enough for the class);
  - step-8 σ_fx > 0.5 %: *calibrate first*, green becomes amber.
  Red and grey points block a pass in the circle result. The measurement-strength lines show r, MDB and ∇x per base point (`strengthLines`), shown on screen under *Measurement strength*.
- **Blunder naming**: the largest |w| over all image rows and control priors in the session names the suspect base point.
- **Circle fit and tape comparison**: `circleVerdict` with the edge points' joint covariance from the session, unchanged, except that the camera-side and ray-intersection gates are switched off (`rayGates: false`) because each edge point is now its own camera position.

### Unit tests (`tests/controlCluster.test.ts`, ported from sim11)

The sims' layout B (seven base points near the middle, a test fixture only), 12 points on a 12 m circle, fx error 0.5 %, 120 runs: 95 % |ΔD| about 36 mm (limit 60), about 97 % of points green, none grey. A 30 mm shift of one base point is flagged and named. A 30 mm diagonal blunder in the tie network goes red. Fewer than 4 base points and a danger-circle photo go grey. σ_fx above 0.5 % never gives green.
