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
| Distances | `σ² = a² + (b L)²`. Tape: `a` about 3–5 mm and `b` about 0.5–1 mm/m, or a flat **20 mm** if that split is not used. Laser: about **5 mm**, plus about **50 mm** when the spot hits the front of a roll (a known offset, not part of σ). Slope reduced to horizontal. |
| Trilateration | Not “within 50 mm”. At σ = 20 mm and a 40° intersection the 95% semi-major is **101 mm** (about 25% of points miss 50 mm). Pass: Monte Carlo errors sit inside the predicted ellipse about 95% of the time (NEES ≈ 2), and a point is accepted only when that semi-major is inside its class. Early-refuse under 20° and near 180°. Two tapes alone are **unchecked**. |
| Photo station | 95% semi-major **≤ 200 mm** only if `fx/width` is calibrated to **≤ 1%**, rays are gravity-levelled (or a bubble is enforced and σ is widened), and control has depth or 4+ marks. A 10% focal error moves the 7 m / 20° station by **±1.98 m**, so “fx within 10%” is not a pass. Two marks and no tape: **no coordinate**. Two marks plus one tape: **two candidates**, usually about 20 m apart (a midpoint tape always). A unique station needs tapes to **both** ends (bearings then check it), a third mark, or an explicit branch choice labelled unchecked. No symmetry test on `β_A + β_B`. |
| Bearing | Opposite sign to 0.7.25: `β = atan2(cx − px, fx)`, then levelled with gravity and `py`. Check, when the solver exists: camera at the origin facing +X, point `(10, 1)`, bearing positive. |
| House corner | One taped edge stays unfixed. No 90° turn. A second constraint with nothing spare is unchecked. |
| Close | Wall lengths alone have **no misclosure**. A traverse misclosure exists only when angles are measured. Then test `mᵀ Q_m⁻¹ m ≤ 5.99` and show 2.45 times the semi-major of the propagated `Q_m`. For the demo shed that is **93 mm** with tapes only (σ = 20 mm) and **144 mm** with 0.2° angles. No fixed 120 mm gate. A flat 50 mm gate false-alarms on **35%** of correct distance-only sheds at σ = 20 mm. |
| Plantable point | 95% semi-major **≤ 100 mm**, at least one spare observation, and a withheld **distance** inside `1.96 √(gᵀ Q_xx g + σ_check²)` (1D factor; `gᵀ Q_xx g` is the predicted length’s variance). A 200 mm station does not yield a 100 mm point unless a tape also ties that station. |
| Blunders | `σ̂₀² = vᵀPv / (n − u)` with `n − u = n − rank`, two-sided `χ²`. Flag `|w_i| > 3.29`. Redundancy `r_i ≲ 0.1` labelled unchecked. |
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

**Goal:** the phone recognises a rod or post from any side and emits the same kind of observation Phase 1 already adjusts. Design: [MARKER_VISION_DESIGN.md](MARKER_VISION_DESIGN.md). The mark is an **A4 portrait sleeve** rolled onto the stick: horizontal bands, about **64 mm** diameter if the full sheet width wraps with 10 mm overlap. The stored point is the **axis at the ground**, with the sleeve height recorded, the rod plumbed, and the sleeve a tight fit on the stick. There is no flat tag.

Stages are in order. A later stage does not start by weakening an earlier bar.

### (a) Detect one marker in one photo

**Prove:** a printed A4 ring, photographed in Safari at 1×, returns the right ID or no ID. It does not return a neighbour’s ID. The user taps the column; the decoder searches that window and fits the edges robustly, rather than hunting the frame. The centreline repeats to about **1 px** on a clean frame. That is pixel noise only. The bearing also carries `sigmaCentringM`: **10 mm** with a 1° bubble and a tight sleeve, **20 mm** if the rod is only known to about 2°. Lean plus a loose sleeve is 8–24 mm and is not a published bearing. A 1% focal error at 20° off-centre is about 16 mm at 5 m, several times the pixel term.

**Accuracy:** a wrong ID is a failure even if the pixel is perfect. The clock is a four-black sync; the payload is CRC-6 on `x⁶ + x⁴ + x³ + 1`, and a run longer than 3 modules is a reject. A 13 mm band is about **8 px** at 5 m on a full-resolution 1× still and about **3 px** at 15 m, so ID at 15 m is not the bar. The bar is ID at **2 m and 5 m**, and a reject (not a guess) at long range. Bearing may still be kept at 8–15 m when both silhouette edges are found.

**Validate:** one printed sheet whose 100 mm ruler and 52 mm sync measure true, including after it has been wet. Photos at 2 m and 5 m, plus a tilt, a leaf across one band, and sun on the sleeve. The tap is the seed. Zero wrong IDs on that set. ID `0x00` is not an issued code.

### (b) Detections are rays

**Prove:** the centreline becomes a levelled bearing `β = atan2(−x_level, z_level)` in the Phase 1 solver, with `σ_px` from the fit and `sigmaCentringM` in the centring term. That ray points at the axis at sleeve height and carries no radial offset. Sleeve ends enter as levelled elevations (`d = H / (tan e_top − tan e_bot)`, each end at `d ± R` for the near or far rim), not as `fx · H / h_px` and not as a raw pixel height (that check is biased about 1–2% by elevation, and more when the camera is pitched). One `fx` per phone and 1× lens is solved in the adjustment, with a checkerboard prior or the taped-rod calibration (geometry note §3.5). EXIF only checks that the photo is 1×. A per-photo `fx` cannot carry a calibration. Do not also publish a range derived from that same photo. There is no AprilTag. A height range may pick between the two station candidates only when it is to a sleeve **other than the taped mark**, the two predicted ranges differ by **at least 6σ**, and the observation lies within 2.5σ of the chosen one. Otherwise leave the station unset or ask, and label any pick **unchecked**. A point that lands behind the camera is not published (PR #3 B3).

**Accuracy:** same station class as Phase 1. **95% semi-major ≤ 200 mm** only when `fx` is known to about **1%** and the rays are levelled. A 10% focal error remains about **±1.98 m** on the 7 m / 20° case and must still fail that class. A plantable point stays at **100 mm** with a spare observation; a 200 mm station still needs a tape if you would plant from the new point.

**Validate:** synthetic frames with 2 px noise through `solve()`, plus one real photo whose detections are compared with hand clicks on the same marks. Ellipse coverage about 95%, NEES ≈ 2, with `fx` noise included.

### (c) Several photos, one network

**Prove:** the same marker ID on two photos is the same point. The adjust is still the Phase 1 least squares; the new part is data association. A marker in only one photo does not invent a range.

**Accuracy:** a withheld tape across the network meets `|miss| ≤ 1.96 √(gᵀ Q g + σ_check²)`. Swapping two rod IDs fails a `w` test or is rejected before it enters.

**Validate:** three photos of a known baseline and two rods, IDs linking them, no hand clicks in the solve. One deliberate ID swap must not publish a checked point.

### (d) Optional 3D

**Prove:** only if (a)–(c) meet their bars. Full rays, not just the horizontal bearing, and a bundle that can carry a height. The plan view can stay 2D.

**Accuracy:** a height σ stated from the same pixel and `fx` budget, or the stage is deferred. Not a planting requirement.

**Validate:** a peg of known height, or an explicit decision to stop at the 2D network.

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

6. **Offset direction.** `offsetMm` has no direction, so the brick arris is not actually solved. A laser on the front of a roll is not the stick centre. For the A4 sleeve the stick is about **64 mm** across, so the radius is about **32 mm**, not a generic 50 mm. The planting point is the axis at the ground; a lean moves it by `h_s sin λ`. A sleeve that sits off the stick moves the silhouette by the same kind of amount.
   **Recommendation:** store the axis at ground level, record the sleeve-centre height, plumb the rod to about **1°**, and glue the sleeve so it cannot shift on the stick (play under about 2 mm). A photo centreline (mean of the levelled edge azimuths) has **no** radial offset, and it carries `sigmaCentringM` of **10 mm** in that case, **20 mm** if the rod is only known to about 2°. The 1–3.5 mm pixel row is not this term; lean plus a loose sleeve is 8–24 mm. A tape or laser to the paper is reduced to horizontal, then `+radius`. Still add the radius when the spot is off the centreline; retake only past about half a radius. A wall mark still needs millimetres plus a direction (inward normal or a bearing). Laser σ in the solve is about **5 mm**, not the 2 mm constant in the code. Store the radius with the stick, and the offset on the observation, when the schema bumps.

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
   **Recommendation:** the cylindrical sleeve is the only per-stick mark. Print it on **A4 portrait**, laser or pigment on matte synthetic paper, and glue it to the stick (about **64 mm** diameter with a 10 mm overlap). No AprilTag, in the garden or as a calibration card. Focal length is the checkerboard prior, or the taped-rod calibration, solved as one `fx` per phone and lens.

18. **How far the code must read.** On a 12 MP 1× frame a 13 mm band is about 8 px at 5 m and about 3 px at 15 m. The whole 297 mm sleeve is only about 60 px tall at 15 m. The clock is the four-black sync, not a black-black start that also appears in the data.
   **Recommendation:** automatic ID at **2 m and 5 m**, seeded by a tap. At 8 m, accept the ID only when the sync, the run lengths and the CRC all pass; otherwise keep the bearing and reject the code. At 15 m, bearing only. Detect on a full-resolution 1× still, not the 1920-wide preview.

19. **Wrong ID versus a miss.** Correcting a single glare-flipped band can turn rod A into rod B. A checksum with distance 3 will miss some two-band errors.
   **Recommendation:** CRC-6 on `x⁶ + x⁴ + x³ + 1` (distance 4 over the 12-bit word). Reject, do not correct. A failed read falls back to the hand click that seeded the search. The run limit leaves **28** issued IDs, enough for rods, the house and a short fence, not for every bed and path peg. Those are named at the station. If the long-range set passes about 24, add a five-black sync as a second bank (56 IDs) instead of a shorter module.

20. **Hand clicks.** Markers will miss in sun, leaves, and blur.
   **Recommendation:** keep the tap. A photo with no accepted code is still a photo you can mark by hand.
