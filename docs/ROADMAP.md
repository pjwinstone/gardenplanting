# Roadmap — Garden Survey toward a planted garden

**Status:** planning note, 2026-10-02. Pass bars follow the maths review on PR #2. Marker stages added after Phase 1. Grounded in [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md). Does not change the survey method in `AGENTS.md`.

The app already coaches a baseline-first field loop, stores a garden JSON, and draws a plan. Coordinates are not yet something to trust at planting scale. **Phase 1 is the geometry prototype** (solver in PR #3, branch `cursor/phase1-geometry-solver-8c5c`; this roadmap does not edit that branch). **Phase 2 replaces hand clicks with coded markers.** Layers, plants, and care do not wait on markers, but automatic rays do wait on the Phase 1 solver.

Existing docs to keep using, not replace:

- Field method: [plan-baseline-then-house.md](plan-baseline-then-house.md), [stage-2-field-checklist.md](stage-2-field-checklist.md)
- Layers / + Point: [plan-layers-objects-add-point.md](plan-layers-objects-add-point.md)
- Solver proposal: [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md). Marker proposal: [MARKER_VISION_DESIGN.md](MARKER_VISION_DESIGN.md).

## Phase 1 — Geometry prototype

**Goal:** one local frame in which a baseline, a house corner, a fence post, and a path point are either **solved with a covariance** or **left blank on purpose**. A fix whose determining observations have redundancy `r_i ≲ 0.1` is drawn and labelled **unchecked**. It is not a point you plant from.

Build it behind the current Adjust entry and the current JSON. Keep the phone UI. Do not start a native app for this phase. The maths review has landed; this table is the bar PR #3 is measured against. Detections in Phase 2 must use that ray model, including focal length inside the covariance (advisor point B2 on PR #3).

### What the prototype must prove

Targets are a **95% error-ellipse semi-major** (about 2.45 times the 1σ semi-major), not one noisy trial “within X mm”.

| Claim | Pass |
|---|---|
| Datum | **A** fixed at `(0, 0)`, **`B_y` fixed at 0**, `B_x` free. The datum tape is an ordinary distance with a residual. Trust chooses which baseline is the datum. Weights come from σ only. |
| Distances | `σ² = a² + (b L)²`. Tape: `a` about 3–5 mm and `b` about 0.5–1 mm/m, or a flat **20 mm** if that split is not used. Laser: about **5 mm**, plus the face offset as a known correction, not part of σ. On the A4 sleeve that offset is the stored radius. Expected **30.2 mm** for a 0.2 mm sheet wrapped tight on a 60 mm dowel (`D` about 60.4 mm). Measure `R` on each sleeve. The older toilet-roll face was about **50 mm**; that figure is not the sleeve. Slope reduced to horizontal, then `+R`. |
| Trilateration | Not “within 50 mm”. At σ = 20 mm and a 40° intersection the 95% semi-major is **101 mm** (about 25% of points miss 50 mm). Pass: Monte Carlo errors sit inside the predicted ellipse about 95% of the time (NEES ≈ 2), and a point is accepted only when that semi-major is inside its class. Early-refuse under 20° and near 180°. Two tapes alone are **unchecked**. |
| Photo station | 95% semi-major **≤ 200 mm** only when `fx` is inside that ellipse, rays are gravity-levelled (or a bubble widens each ray by its tilt σ), and the station is **checked**. Depth and “4+ marks” are not a gate. A 10% focal error moves the 7 m / 20° station by **±1.98 m**, so “fx within 10%” is not a pass. The rod-in-front 0.1° layout is about **180 mm** with `fx` exact and **387 mm** at 1% `fx`. Two marks and no tape: **no coordinate**. Two marks plus one tape: **two candidates**, usually about 20 m apart (a midpoint tape always). A unique station needs tapes to **both** ends (the side is the branch choice or the bearing order, not one garden sign for every station), a third mark, or an explicit branch choice labelled unchecked. No symmetry test on `β_A + β_B`. |
| Bearing | Opposite sign to 0.7.25: `β = atan2(cx − px, fx)`, then levelled with gravity and `py`. Check, when the solver exists: camera at the origin facing +X, point `(10, 1)`, bearing positive. |
| House corner | One taped edge stays unfixed. No 90° turn. A second constraint with nothing spare is unchecked. |
| Close | Wall lengths alone have **no misclosure**. A traverse misclosure exists only when angles are measured. Then test `mᵀ Q_m⁻¹ m ≤ 5.99` and show 2.45 times the semi-major of the propagated `Q_m`. When every interior angle is measured, also `|Σα − (n−2)·180°| ≤ 1.96 σ √n`. For the demo shed that is **93 mm** with tapes only (σ = 20 mm) and **144 mm** with 0.2° angles. No fixed 120 mm gate. A flat 50 mm gate false-alarms on **35%** of correct distance-only sheds at σ = 20 mm. |
| Plantable point | 95% semi-major **≤ 100 mm**, at least one spare observation, and a withheld **distance** inside `1.96 √(gᵀ Q_xx g + σ_check²)` (1D factor; `gᵀ Q_xx g` is the predicted length’s variance). A 200 mm station does not yield a 100 mm point unless a tape also ties that station. |
| Blunders | `σ̂₀² = vᵀPv / (n − u)` with `n − u = n − rank`, one-sided upper-tail `χ²` at 5%. `low` is not a warning. Flag `|w_i| > 3.29`. Drop one residual only when it stands clear of the next residual of any kind and the re-solve passes. A point is unchecked when an MDB shift exceeds the class, or when `r ≈ 0` and a 1σ shift exceeds 0.1 mm. `r ≲ 0.1` alone does not uncheck it. |
| Layers share the frame | A bed vertex and a house vertex are both `points` in metres. A circle fit does not invent a second frame. |
| Honesty | A rank-deficient normal matrix, a danger-circle ellipse over the class, and a baseline that barely subtends an angle produce a sentence and no invented `x,y`. |

### How to validate

1. **Maths review** of [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md) is in (PR #2). Solver code waits on this revision, not on a second method argument.
2. **Synthetic recovery**, in CI, importing the real module: known garden, Gaussian noise at the stated σ. About 95% of trials inside the predicted ellipse, NEES ≈ 2. Include refusals (two marks and no tape, two marks plus one tape left as two candidates, danger circle, `θ → 0`, intersection under 20°). Include the bearing-sign case (point `(10, 1)`, `+5.711°`).
3. **Withheld checks:** a tape that does not enter the solve. Pass when `|miss| ≤ 1.96 √(gᵀ Q_xx g + σ_check²)`.
4. **Field fixture** already specified in [test-case-circle-baseline.md](test-case-circle-baseline.md): real `garden.json` under `fixtures/field-circle-baseline/`. Circle residual and the near baseline end must match the stake notes. Do not invent that file. Radius on an arc shorter than about 90° is reported with `σ_R` and not treated as tight.
5. Coach lines for this phase stay in `coach.ts` and quote the residual, the `w` test, or the unchecked label the solver actually computed.

### Milestone exit

Adjust on the synthetic suite and on one real export meets the table, and the field checklist still runs on the existing PWA. Hand clicks remain valid. Phase 2 may then turn a photo into those same rays without a tap.

## Phase 2 — Markers and photo network

**Goal:** the phone recognises a rod or post from any side and emits the same kind of observation Phase 1 already adjusts. Design: [MARKER_VISION_DESIGN.md](MARKER_VISION_DESIGN.md). The mark is an **A4 portrait sleeve** wrapped tight and glued onto a **60 mm** dowel: horizontal bands, **287 mm** tall, overlap about **16.5 mm**. Expected outside diameter **60.4 mm** and radius **30.2 mm** for a 0.2 mm sheet; measure and store `R` on each sleeve. The stored point is the **axis at the ground**, with the sleeve height recorded and the rod plumbed. There is no flat tag.

Stages are in order. A later stage does not start by weakening an earlier bar.

### (a) Detect one marker in one photo

**Prove:** a printed A4 ring, photographed in Safari at 1×, returns the right ID or no ID. It does not return a neighbour’s ID. The user taps the column (and taps to focus); the decoder searches that window, votes edges across the middle 60% of the stick, and does not hunt the frame. The centreline repeats to about **1 px** on a clean frame. That is pixel noise only. The bearing also carries `sigmaCentringM`: about **8 mm** with the sleeve middle marked at 0.45 m and a 1° bubble, **24 mm** if the rod may be 3° off and the sideways lean is not fitted. A sleeve that is not glued tight to the dowel is not a published bearing. A 1% focal error is 0.05° / 0.18° / 0.26° at 5° / 20° / the edge, against 0.013° of centreline noise.

**Accuracy:** a wrong ID is a failure even if the pixel is perfect. The clock is a four-black sync, the payload is one of **61** words at distance at least 4, and a run longer than 3 modules is a reject. One to three flipped bands cannot become another issued ID. A 13 mm band is about **8 px** at **4.9 m** on a 26 mm-equivalent 12 MP still (7.9 px at 5 m, under the floor) and about **7.3 px** at 5 m on a 24 mm phone, and about **3 px** at 15 m, so ID at 15 m is not the bar. The bar is ID at **2 m and about 4.9 m** on the working camera, and a reject (not a guess) at long range. Read the real image width. Bearing may still be kept at 8–15 m when both silhouette edges are found.

**Validate:** the six tests at the end of this phase. In particular the codebook brute force, the synthetic renderer (wrong IDs 0 in 10⁴), the field set, and the printer check. The tap is the seed. The same ID twice in one photo is a reject.

### (b) Detections are rays

**Prove:** the centreline becomes a levelled bearing `β = atan2(−x_level, z_level)` in the Phase 1 solver, with `σ_px` from the fit and `sigmaCentringM` in the centring term (`bearingSigma` on PR #3). Sideways lean is fitted and extrapolated to the ground; the ray has no radial offset. Sleeve ends enter as levelled elevations of the measured paper height `H`. The diameter is the rim term `d ± R` only. Do not also stretch that length by `H cos α + D sin α`, and do not use `fx · H / h_px`. The merged solver still keeps a separate focal prior on each photo (`fx = fx₀(1+s)`). One shared `fx` per phone and 1× lens, with a checkerboard prior (distortion and focus breathing included) or the taped-rod calibration (geometry note §3.5), is the planned follow-up after the circle field trial, not something already solved. The maths advisor estimates radius σ falls from about 15 mm to about 6.5 mm once that parameter is shared. A 1% gate is not a substitute for that solve. EXIF is an integer and only checks that the photo is 1×. A separate prior on each photo cannot carry a calibration from one frame into the next. Do not also publish a range derived from that same photo. There is no AprilTag. A height range may pick between the two station candidates only when it comes from the **untaped** mark, the two predicted ranges differ by **at least 6σ**, and the observation lies within 2.5σ of the chosen one. Otherwise leave the station unset or ask, and label any pick **unchecked**. A point that lands behind the camera is not published (PR #3 B3).

**Accuracy:** same station class as Phase 1. **95% semi-major ≤ 200 mm** only when `fx` is known to about **1%** and the rays are levelled. A 10% focal error remains about **±1.98 m** on the 7 m / 20° case and must still fail that class. A plantable point stays at **100 mm** with a spare observation; a 200 mm station still needs a tape if you would plant from the new point.

**Validate:** tests 4 and 5 below, plus synthetic frames with 2 px noise through `solve()`. Ellipse coverage about 95%, NEES ≈ 2, with `fx` noise included. Detections on one real photo are compared with hand clicks on the same marks.

### (c) Several photos, one network

**Prove:** the same marker ID on two photos is the same point. The adjust is still the Phase 1 least squares; the new part is data association. A marker in only one photo does not invent a range.

**Accuracy:** a withheld tape across the network meets `|miss| ≤ 1.96 √(gᵀ Q g + σ_check²)`. Swapping two rod IDs fails a `w` test or is rejected before it enters.

**Validate:** three photos of a known baseline and two rods, IDs linking them, no hand clicks in the solve. One deliberate ID swap must not publish a checked point.

### (d) Optional 3D

**Prove:** only if (a)–(c) meet their bars. Full rays, not just the horizontal bearing, and a bundle that can carry a height. The plan view can stay 2D.

**Accuracy:** a height σ stated from the same pixel and `fx` budget, or the stage is deferred. Not a planting requirement.

**Validate:** a peg of known height, or an explicit decision to stop at the 2D network.

### How to validate Phase 2

1. **Codebook.** Brute-force the 61 issued words: minimum distance at least 4, no run longer than 3, the four-black sync occurs only as the sync, and the reverse and the complement of an issued word are not issued. One to three bit flips never land on another issued word.
2. **Synthetic renderer.** Pitch ±25°, lean ±10°, blur 0–4 px, JPEG/HEIC and halos. Wrong IDs **0 in 10⁴**, and a read rate by range. Band positions come from the 1-D projective fit, not from the stack height divided by 19. Bank confusion is not part of this test. It is required only if the unprinted five-black bank is ever used.
3. **Field set.** At least 300 stills: every issued ID, at 2, 5, 8 and 15 m, front, back and side light, a leaf, wet sleeves, confusers (picket, cane, downpipe), and a ground-truth click on each. Zero wrong IDs. The same ID twice in one photo is a reject.
4. **Checkerboard.** When the shared-`fx` follow-up lands: one `fx` per phone and lens, on three different days, including distortion and focus breathing. Compare with a tape-plus-height observation after the rim correction (`d ± R`), not after `H cos α + D sin α`. EXIF is not the reference. The circle field trial is graded with separate priors.
5. **Lean.** Sleeve middle marked at 0.45 m. Compare the solved ground point with a taped ground point at 0°, 2° and 5° of lean. The 1° and 3° centring figures (about 8 mm and 24 mm) are the bound when the sideways lean is not fitted.
6. **Printers.** Five printers, A4 and Letter. Measure `H`, `D` and `R`. Letter fit-to-page at about 94% must fail the 250 mm and 180 mm rulers. Store the measured sizes, not the expected 287 mm, 60.4 mm and 30.2 mm.

## Phase 3 — Layered garden geometry

**Goal:** the same points, drawn and edited as separate kinds of feature.

| Layer | Holds | Geometry |
|---|---|---|
| `boundary` | Fence, railing, boundary | Polyline through `FNC` / boundary points |
| `structure` | House, shed, greenhouse | Polygon. Today’s `polygons` id `house` migrates here when the schema bumps |
| `walkway` | Paths, paving (already the default + Point layer) | Line, polygon, or circle |
| `bed` | Planting beds | Polygon or circle whose vertices are survey points |
| `survey` | Rods, stations, baselines | Control, hidden on the “garden” view |

Rules for this phase:

- One frame from Phase 1. Layers are meaning and draw order, not separate surveys.
- Shared corners are **shared point ids**, not copied coordinates.
- A solved circle is a geometric fit (orthogonal distance), started from an algebraic guess, stored on the item with `σ_R`. It is not an observation. An arc under about 90° does not pin the radius.
- + Point keeps the sticky layer / item behaviour from [plan-layers-objects-add-point.md](plan-layers-objects-add-point.md).

**Exit:** a plan that can show boundary, house, path, and one bed from a single adjust, each with its own residual, toggled by layer.

## Phase 4 — Plant planning

**Goal:** choose and place plants **inside a bed that Phase 3 can draw**.

- A plant is a record on a bed: species name, position in the garden frame (or a clear “unplaced”), spacing radius, sun/shade note, companion notes.
- Spacing is a circle in metres on the plan, using the bed’s solved outline. Overlaps are a warning, not a solver.
- Sun/shade starts as a **user tag** per bed or per plant (full sun / part / shade). No solar model until the outline is trusted.
- Companions start as text (or a small user list) on the plant. No recommendation engine in this phase.
- Species data is **typed by the user** into the garden JSON. No RHS/API dependency yet.

**Exit:** place three plants in a bed, see spacing circles, reload from OneDrive, positions unchanged in the same frame as the bed.

## Phase 5 — Maintenance and horticulture

**Goal:** care as dates and tasks attached to plants and beds, after placements exist.

- Task: title, season or month, optional plant/bed id, done/not done.
- In-app seasonal list (what is due this month) is the first UI. It can live in `garden.json`.
- Reminders that must buzz the phone are **later**: iOS home-screen PWAs are a poor notification host. Prefer “open the list” and, if needed, an “add to calendar” export.
- No watering model, soil sensor, or weather API in this phase.

**Exit:** a bed’s plants show this month’s tasks; completing one survives reload.

## Explicitly later

- Native iOS, ARKit, LiDAR, GPS control (see decisions). A full 3D bundle is Phase 2 stage (d), not a separate product.
- Railway (`TRK`, 184 mm) — draw only once those points exist.
- Multi-user sync, accounts other than one personal OneDrive.

## Decisions for Paul

Each item is unresolved in the repo or is a fork the next phase should not guess. Recommendation is the default if you do not want to spend time on it.

1. **Stay on the PWA for the survey.** The iPhone work is already Safari: camera, thumb menu, Pages. A native app is a second codebase before the coordinates are true.
   **Recommendation:** keep Vite + the home-screen PWA through markers and layers. Detection has to run in Safari.

2. **Do not require LiDAR or ARKit.** GPS on a phone is several metres, which is coarser than a bed. LiDAR is Pro-only and weak across a 20 m garden in sun. The notes you already wrote (tape primary, photo secondary) match the physics.
   **Recommendation:** tape and levelled, calibrated bearings. The maths review agrees nothing in the geometry note forces ARKit. Revisit AR only as an experiment after Phase 1 has a number to beat.

3. **Accuracy bars.** The first draft’s flat 50 mm / 100 mm RMS / 200 mm-with-10%-focal-length set does not match σ = 20 mm or a 10% focal error (±1.98 m on a 7 m baseline at 20°).
   **Recommendation:** use the Phase 1 table. Plantable points at a **100 mm** 95% semi-major, with a spare observation. A withheld tape uses **1.96** on the propagated distance σ, not 2.45. Photo stations at **200 mm** only after `fx` is calibrated to about **1%** (`fx/width` about **0.69–0.75**, not 0.9) and the ray is levelled. Trilateration at a 20 mm tape is about **100 mm** (95%) at a 40° crossing, not 50 mm.

4. **Replace the turn-left chain and the isosceles station** with the revised solver: bearing sign flipped, gravity and `py` in the ray, datum **A and `B_y` only**. Two marks plus one tape stay **two candidates**. A unique station needs tapes to both ends, a third mark, or an explicit branch choice.
   **Recommendation:** yes. Keep collecting clicks and tapes as 0.7.25 does, and store gravity with the photo. Change what Adjust writes into `x,y`. Do not treat a midpoint tape as a fix. The follow-up review’s three blocking items are in the geometry note; camera-axis mapping is still a follow-up (section 9 there).

5. **House close.** Today’s 50 mm check measures the gap between two different corners. A polygon of wall lengths only has no traverse misclosure, because a misclosure needs measured angles.
   **Recommendation:** no fixed millimetre threshold. When angles exist, test `mᵀ Q_m⁻¹ m ≤ 5.99` and show 2.45 times the semi-major of `Q_m`. On the demo shed that is **93 mm** for tapes at 20 mm and **144 mm** once each corner also has a 0.2° angle. A flat 50 mm gate false-alarms on about **35%** of correct distance-only sheds at σ = 20 mm, and a tighter tape does not repair that once angles dominate (116 mm at 95% with 3 mm + 1 mm/m and 0.2°).

6. **Offset direction.** `offsetMm` has no direction, so the brick arris is not actually solved. A laser on the front of a roll is not the stick centre. For the A4 sleeve the sheet is wrapped tight and glued to a **60 mm** dowel. Expected outside diameter **60.4 mm**, expected radius **30.2 mm** (0.2 mm sheet), not a generic 50 mm. The planting point is the axis at the ground; a lean moves it by `h_s sin λ`. A sleeve that is not glued down moves the silhouette off the dowel.
   **Recommendation:** store the axis at ground level. Mark the sleeve middle at **0.45 m** (`h_s sin λ` is 7.9 mm at 1° and 24 mm at 3°). That mark is where the sleeve is tied, not half the paper, so the 287 mm height does not move it. Fit the sideways lean and extrapolate to the ground. Plumb to about **1°**. Glue the sheet tight to the 60 mm dowel (overlap about 16.5 mm). A 63 mm pipe leaves only about 7 mm of overlap and does not snug. A loose sleeve is not a published bearing. A photo centreline (mean of the levelled edge azimuths) has **no** radial offset, and it carries `sigmaCentringM` of about **8 mm** when the sideways lean is fitted, **24 mm** if the rod may be 3° off and it is not. The 1–3.5 mm pixel row is not this term. A tape or laser to the paper is reduced to horizontal, then `+R`. Expected `R` is **30.2 mm**; measure and store `R` on each sleeve and use that. Still add the radius when the spot is off the centreline; retake only past about half a radius (15 mm at the expected `R`). A wall mark still needs millimetres plus a direction. Laser σ in the solve is about **5 mm**, not the 2 mm constant in the code. Store the measured sleeve `H`, `D` and `R`, and the offset on the observation, when the schema bumps.

7. **When to stop special-casing `polygons` id `house`.** The field loop depends on it.
   **Recommendation:** leave it through Phase 1. Fold it into a `structure` item in Phase 3 with a `normalizeDocument` migration.

8. **Layer ids.** `walkway` / `structure` / `plants` / `survey` are already in saved JSON. Product language also wants boundary, paths, and beds.
   **Recommendation:** add `boundary` and `bed`. Keep `walkway` as the path layer id so old files load. Put plant **instances** on the bed in Phase 4, not as a second outline layer.

9. **JSON `objects` vs the word Item.** UI says Item; JSON says `objects`.
   **Recommendation:** leave the key until a version bump. New docs and UI keep saying Item.

10. **Schema version.** Everything is `version: 1` with silent fixes in `normalizeDocument`.
    **Recommendation:** bump to `2` only when offsets, layers, or misclosure change shape. Keep loading v1.

11. **One garden file on personal OneDrive**, last upload wins (PUT, no etag).
    **Recommendation:** stay single-user, no backend. You already pick `garden-v{version}.json` in the Sign in accordion; one active file is enough.

12. **Plan stays 2D.** Camera height (~1 m pole) is not a stored Z. Gravity at the shutter is attitude for levelling the ray, not a height survey. iOS will prompt for motion permission.
   **Recommendation:** stay 2D through plant placement. Request the gravity vector. If it is refused, require a level bubble and widen the angle σ so an unlevelled phone cannot pass the 200 mm station bar. Optional heights are Phase 2 stage (d), after the 2D network passes.

13. **Plant facts.** Spacing, sun, and companions have no source in the repo.
    **Recommendation:** you type them. No catalogue API in Phase 4.

14. **Reminders vs a list.**
    **Recommendation:** in-app seasonal list in Phase 5. Calendar export only if you still want a buzz. No push notifications on the PWA.

15. **Tests in CI.** Deploy currently runs `tsc` and Vite only. The three `npm run test:*` scripts do not call the TypeScript solver, and the circle fixture is an intentional skip.
    **Recommendation:** Phase 1 adds a node test of the real solver and runs it in the Pages workflow: ellipse coverage and NEES, the bearing-sign case, and the refusal cases in the table above. Capture the field circle file when you next do that walk; do not synthesise it.

16. **UI churn vs solver work.** `src/ui.ts` is where almost every 0.7.x commit landed, and you are still editing it.
   **Recommendation:** Phase 1 is the solver in PR #3, not another pass through the dialog. Marker work is Phase 2 and should not land in that PR.

17. **What to print on a rod.** A flat tag is unreadable at a grazing angle, and it disappears as you walk around the stick. The current belt is the same on every rod. Dye ink on copy paper does not survive rain, and a gloss laminate blinds the reader.
   **Recommendation:** the cylindrical sleeve is the only per-stick mark. Print it on **A4 portrait**, laser or pigment on matte synthetic paper, and glue it tight onto a **60 mm** dowel (overlap about **16.5 mm**, height **287 mm**, expected diameter **60.4 mm**). No AprilTag, in the garden or as a calibration card. Focal length is still a separate prior on each photo. One shared `fx` per phone and lens, with the checkerboard or the taped-rod calibration as its prior, is the planned follow-up after the circle field trial.

18. **How far the code must read.** On a 12 MP 1× frame a 13 mm band is about 8 px at **4.9 m** (7.9 px at 5 m) and about 3 px at 15 m. The finished 287 mm sleeve is about 58 px tall at 15 m. The clock is the four-black sync, not a black-black start that also appears in the data.
   **Recommendation:** automatic ID at **2 m and about 4.9 m**, seeded by a tap. At 8 m, accept the ID only when the word is in the issued list; otherwise keep the bearing and reject the code. At 15 m, bearing only. Detect on a full-resolution 1× still, not the 1920-wide preview.

19. **Wrong ID versus a miss.** Correcting a single glare-flipped band can turn rod A into rod B. A checksum with distance 3 will miss some two-band errors.
   **Recommendation:** a stored list of **61** twelve-bit words, minimum distance 4, no run longer than 3. That matches a CRC-6 distance-4 code on one, two and three flipped bands, and it issues 61 IDs rather than the 24 a run-limited CRC keeps once words are also limited to two white bands at either end. Reject anything not in the list. Do not correct a bit. A failed read falls back to the hand click that seeded the search. Beds and paths are named at the station. A five-black second bank is not printed. If it is ever used, both layouts have to be fitted and only a clear winner kept, the synthetic test has to include bank confusion, and the ID stays at 5 m or closer until that test exists. Its 20 bands (260 mm) squeeze the legend strips, and Hamming distance does not separate the banks.

20. **Hand clicks.** Markers will miss in sun, leaves, and blur.
   **Recommendation:** keep the tap. A photo with no accepted code is still a photo you can mark by hand.
