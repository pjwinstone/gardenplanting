# Garden circle validation — specification

Saved verbatim from the Geometry & Maths Advisor (/workspace/petri/review/garden-circle-advice.md). The implementation is `src/solver/circleCheck.ts`; the guided steps are in `src/workflows/guided/definitions.ts` (circle field test, revision 4).

**Revision 6 (no canes).** The camera positions, edge canes and edge sleeves below are replaced by the **base grid**, a growing network of base points (BAS01, BAS02, BAS03…, any number, wherever suits the garden) taped on the North/East grid, and one photo from each edge point. *Base grid* replaces the word *baseline* in the field test; the advice below keeps its original wording (its "baseline" is BAS01–BAS02, the start of the base grid). Two-sleeve posts (rev 7) are at the end. See *No-cane circle test* at the end. The circle fit and the comparison with the taped diameter are unchanged. Maths: `src/solver/controlCluster.ts`; net: `workflow/field-test.net.yaml` rev 6.

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

1. **Gather the kit.** Phone, a long tape, BAS sleeves on posts (and BASnnB bottom sleeves for any two-sleeve posts). Edge points need no cane and no sleeve.
2. **Start the base grid (BAS01, BAS02)**: place them, tape BAS01–BAS02 both ways, and the laser check, as before (step ids `place-baseline-points`, `tape-baseline`, `laser-check-baseline` are kept so saved runs load).
3. **Grow the base grid** with the tie form (step id `add-base-points`). BAS01 is the grid origin; the grid points north (set by eye or compass). For each new point, start from a point already placed, tape how far **East** and how far **North** it is, then the **diagonal** straight to it as a check. Ties between points already placed are welcome. Every save re-adjusts the whole network, logs the tie on the run, and shows each diagonal's check: red (|w| > 3.29) means re-tape that tie. Tick the step when you have enough.
   *Hint:* spread several base points so each edge point sees 4+ at good angles. Where bushes leave only 2 in view, make those two-sleeve posts: type the top-to-bottom distance in *Post sleeves apart* and **Save post** (blank = Set-up default 1.2 m).
4. **Calibration photo** (focal length), as before. If it is only good to worse than 0.5 %, the result says *calibrate first* and no point can be green.
5. **Mark the edge points** EDG01… round the edge, in order, with a peg or chalk. Never more than 60° between neighbours.
6. **One photo from each edge point,** in order. Stand on the peg, face the middle, phone landscape at 1×, and tap the base points you can see (the scan also finds the bottom sleeves of two-sleeve posts). One photo; no turning, no tape. Under 4 base points the point goes grey, unless 3 are in view with a two-sleeve post (checked as normal) or exactly 2 two-sleeve posts (a *2-point fix*, amber at best). To redo one point, open **Photos** and press *Retake* on that photo: only that photo is replaced and it keeps its EDG number.
7. **Tape the diameter** three times, about 60° apart, as before.
8. **Circle result.** Each edge point gets a colour (with r, MDB and shift under *Measurement strength*), then the circle is fitted and compared with your tape exactly as before.

### What the app does

- **Base-point network** (`adjustGridNetwork`, re-run on every tie save): East and North offsets are distance observations along the grid axes (σ 3–5 mm). The pair from one tie also shares a squareness error (axes set by eye, default σ 1°), modelled as a correlated 2×2 block; the diagonal is a distance observation, blind to squareness, so it checks the two tape readings. Each reading gets r and w; diagonals are flagged red at |w| > 3.29. The N/E grid is the network frame; the grid-to-north rotation and its σ are stored for display only.
- **Session adjustment** (`adjustSession`, via `controlCircleVerdict` from `circleResult.ts`): per photo x, y, yaw (roll and pitch from the photo's gravity sidecar are applied to the clicks first; a photo without one is treated as level and the result says so); one shared focal length from the calibration photo with the step-8 prior (0.3 %); base-point coordinates as weighted priors with the network covariance. Observation: the image x of each sleeve axis, u = −fx·tan(bearing − yaw), σ 1 px.
- **Gates per edge point** (`gateEdgePoints`; numbers in `workflow/tolerances.json`), first match wins:
  - 2-point fix: exactly 2 base points, both two-sleeve posts with a range: amber "2-point fix (unchecked)" with its 95 % ellipse; red if a reading has |w| > 3.29; grey "calibrate first" when the step-8 σ_fx > 0.5 %. Never green;
  - grey: fewer than 4 readings, or fewer than 3 base points (`controlMinBasePoints`; a post range counts as a reading); or the photo is near a danger circle (normalised condition number of its x, y, yaw block > 200); or r < 0.01 on a row that moves the point;
  - red: any |w| > 3.29;
  - amber: max |w| above k = z(1 − 0.025/n), n = image rows in the photo (≈ 2.69 for 7 rows);
  - reliability shift ∇x = max over rows of ‖(AᵀPA)⁻¹AᵀP eᵢ · MDBᵢ‖ (x, y of the point), MDBᵢ = 4.13 σᵢ/√rᵢ: green ≤ 40 mm, amber 40–60 mm, grey above 60 mm (decision: not checked well enough for the class);
  - step-8 σ_fx > 0.5 %: *calibrate first*, green becomes amber.
  Red and grey points block a pass in the circle result. The measurement-strength lines show r, MDB and ∇x per base point (`strengthLines`), shown on screen under *Measurement strength*.
- **Blunder naming**: the largest |w| over all image rows and control priors in the session names the suspect base point.
- **Circle fit and tape comparison**: `circleVerdict` with the edge points' joint covariance from the session, unchanged, except that the camera-side and ray-intersection gates are switched off (`rayGates: false`) because each edge point is now its own camera position.

### Unit tests (`tests/controlCluster.test.ts`, ported from sim11)

The sims' layout B (seven base points near the middle, a test fixture only), 12 points on a 12 m circle, fx error 0.5 %, 120 runs: 95 % |ΔD| about 36 mm (limit 60), about 97 % of points green, none grey. A 30 mm shift of one base point is flagged and named. A 30 mm diagonal blunder in the tie network goes red. Fewer than 4 base points and a danger-circle photo go grey. σ_fx above 0.5 % never gives green.

## Two-sleeve posts (rev 7)

Paul's request: in a garden full of bushes and trees a spot often sees only 2 base points. A base point may carry a **top sleeve** (BASnn, as before) and a **bottom sleeve** (BASnnB) on the same plumbed post, a known vertical distance *s* apart, centre to centre. Set-up default 1.2 m (`post_separation_m`); per point with **Save post** in the base-grid form (`run.basePostSeparationM`, logged as `base-post.saved`).

- **Codes.** BAS01B–BAS14B carry 222 24B 271 293 2DD 2E7 46A 48B 4A6 4CC 525 74D 6E9 72B (`POST_BOTTOM_SLEEVES` in `scripts/markerSleeve.ts`; greedy from the unused codebook words with no 4-band burst pair among all 28; 637 is skipped because the scan does not read it upright in the 28-code set). Each base point maps to two codes through its two point names, so stored BASnn clicks keep working. Print `docs/markers/BASnnB.pdf` or `post-bottom-sleeves.pdf`.
- **Scan.** A BASnnB found by the scan is kept only under its own BASnn in the same photo: lower in the photo, axis x within 5 % of their separation + 3 bands. The tap bar never asks for bottom sleeves (`scanOnly` targets); a scanned pin can be moved by hand.
- **Observation.** After levelling with the gravity sidecar, Δy = fx·(tan e_top − tan e_bottom) = fx·s/d, d the horizontal distance; range r = fx·s/Δy. Top and bottom must share a bearing (within 5 % of Δy + 10 px) or the range is dropped and the result says which post. σ(Δy) = √(2·1² px² + (Δy·σ_s/s)² + (Δy·0.2 %)²): 1 px per sleeve centre, σ_s 2 mm, tilt correction 0.2 % (`postSeparationSigmaMm`, `postRangeTiltSigmaRel`). The fx σ is not added to the row: fx is the shared session unknown with its step-8 prior, so its σ propagates (decision).
- **Adjustment.** Range rows go into the same session adjustment as the bearings (`kind: 'range'`), with their own r, w, MDB and reliability shift, and count towards the Bonferroni n.
- **2-point fix.** With exactly 2 tied base points in a photo, both with a range, the seed is `twoPointFix`: the two range circles meet in two mirror points across the line between the posts, and the one whose predicted left/right order of the two sleeves matches the photo is kept. 4 readings (2 bearings + 2 ranges) for x, y, yaw leave nothing useful to check (r ≈ 0), so the gate labels it **2-point fix (unchecked)**: amber at best, never green, and grey *calibrate first* unless the step-8 gate passes. With 3 or more base points the ranges are extra checked readings.
- **Tests** (`tests/twoSleevePost.test.ts`, port of sim S7a): posts at (−5, −10) and (5, −10), 12 m circle, fx error 0.5 %: 9 of 12 points fix, every one amber "2-point fix (unchecked)", never green; 95 % ellipse median ≈ 0.32 m, worst ≈ 0.75 m (RESULTS.md S7a: 305 / 717 mm); the mirror is always rejected by the image order; σ_fx 0.8 % → grey; a third base point makes them checked, not 2-point fixes.

A 2-point fix is good enough to find a point, not to pass the 60 mm circle test on its own: use it for awkward spots and keep 4+ base points in view where you can.
