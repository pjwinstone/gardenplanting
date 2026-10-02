# Roadmap — Garden Survey toward a planted garden

**Status:** planning note, 2026-10-02. Pass bars updated after the follow-up maths review on PR #2. Grounded in [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md). Does not change the survey method in `AGENTS.md`.

The app already coaches a baseline-first field loop, stores a garden JSON, and draws a plan. Coordinates are not yet something to trust at planting scale. **Phase 1 is a geometry prototype.** Layers, plants, and care wait until that prototype has passed the checks below.

Existing docs to keep using, not replace:

- Field method: [plan-baseline-then-house.md](plan-baseline-then-house.md), [stage-2-field-checklist.md](stage-2-field-checklist.md)
- Layers / + Point: [plan-layers-objects-add-point.md](plan-layers-objects-add-point.md)
- Solver proposal, revised after that review: [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md)

## Phase 1 — Geometry prototype

**Goal:** one local frame in which a baseline, a house corner, a fence post, and a path point are either **solved with a covariance** or **left blank on purpose**. A fix whose determining observations have redundancy `r_i ≲ 0.1` is drawn and labelled **unchecked**. It is not a point you plant from.

Build it behind the current Adjust entry and the current JSON. Keep the phone UI. Do not start a native app for this phase. The maths review has already landed; this table is the revised bar.

### What the prototype must prove

Targets are a **95% error-ellipse semi-major** (about 2.45 times the 1σ semi-major), not one noisy trial “within X mm”.

| Claim | Pass |
|---|---|
| Datum | **A** fixed at `(0, 0)`, **`B_y` fixed at 0**, `B_x` free. The datum tape is an ordinary distance with a residual. Trust chooses which baseline is the datum. Weights come from σ only. |
| Distances | `σ² = a² + (b L)²`. Tape: `a` about 3–5 mm and `b` about 0.5–1 mm/m, or a flat **20 mm** if that split is not used. Laser: about **5 mm**, plus about **50 mm** when the spot hits the front of a roll (a known offset, not part of σ). Slope reduced to horizontal. |
| Trilateration | Not “within 50 mm”. At σ = 20 mm and a 40° intersection the 95% semi-major is **101 mm** (about 25% of points miss 50 mm). Pass: Monte Carlo errors sit inside the predicted ellipse about 95% of the time (NEES ≈ 2), and a point is accepted only when that semi-major is inside its class. Early-refuse under 20° and near 180°. Two tapes alone are **unchecked**. |
| Photo station | 95% semi-major **≤ 200 mm** only when `fx` is inside that ellipse, rays are gravity-levelled (or a bubble widens each ray by its tilt σ), and the station is **checked**. Depth and “4+ marks” are not a gate. A 10% focal error moves the 7 m / 20° station by **±1.98 m**, so “fx within 10%” is not a pass. The rod-in-front 0.1° layout is about **180 mm** with `fx` exact and **387 mm** at 1% `fx`. Two marks and no tape: **no coordinate**. Two marks plus one tape: **two candidates**, usually about 20 m apart (a midpoint tape always). A unique station needs tapes to **both** ends (bearings then check it), a third mark, or an explicit branch choice labelled unchecked. No symmetry test on `β_A + β_B`. |
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

Adjust on the synthetic suite and on one real export meets the table, and the field checklist still runs on the existing PWA. Then Phase 2 can store boundaries and beds as things you believe.

## Phase 2 — Layered garden geometry

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

## Phase 3 — Plant planning

**Goal:** choose and place plants **inside a bed that Phase 2 can draw**.

- A plant is a record on a bed: species name, position in the garden frame (or a clear “unplaced”), spacing radius, sun/shade note, companion notes.
- Spacing is a circle in metres on the plan, using the bed’s solved outline. Overlaps are a warning, not a solver.
- Sun/shade starts as a **user tag** per bed or per plant (full sun / part / shade). No solar model until the outline is trusted.
- Companions start as text (or a small user list) on the plant. No recommendation engine in this phase.
- Species data is **typed by the user** into the garden JSON. No RHS/API dependency yet.

**Exit:** place three plants in a bed, see spacing circles, reload from OneDrive, positions unchanged in the same frame as the bed.

## Phase 4 — Maintenance and horticulture

**Goal:** care as dates and tasks attached to plants and beds, after placements exist.

- Task: title, season or month, optional plant/bed id, done/not done.
- In-app seasonal list (what is due this month) is the first UI. It can live in `garden.json`.
- Reminders that must buzz the phone are **later**: iOS home-screen PWAs are a poor notification host. Prefer “open the list” and, if needed, an “add to calendar” export.
- No watering model, soil sensor, or weather API in this phase.

**Exit:** a bed’s plants show this month’s tasks; completing one survives reload.

## Explicitly later

- Native iOS, ARKit, LiDAR, GPS control (see decisions).
- Full bundle adjustment beyond the Phase 1 resection.
- Railway (`TRK`, 184 mm) — draw only once those points exist.
- Multi-user sync, accounts other than one personal OneDrive.

## Decisions for Paul

Each item is unresolved in the repo or is a fork the next phase should not guess. Recommendation is the default if you do not want to spend time on it.

1. **Stay on the PWA for the survey.** The iPhone work is already Safari: camera, thumb menu, Pages. A native app is a second codebase before the coordinates are true.
   **Recommendation:** keep Vite + the home-screen PWA through Phase 2.

2. **Do not require LiDAR or ARKit.** GPS on a phone is several metres, which is coarser than a bed. LiDAR is Pro-only and weak across a 20 m garden in sun. The notes you already wrote (tape primary, photo secondary) match the physics.
   **Recommendation:** tape and levelled, calibrated bearings. The maths review agrees nothing in the geometry note forces ARKit. Revisit AR only as an experiment after Phase 1 has a number to beat.

3. **Accuracy bars.** The first draft’s flat 50 mm / 100 mm RMS / 200 mm-with-10%-focal-length set does not match σ = 20 mm or a 10% focal error (±1.98 m on a 7 m baseline at 20°).
   **Recommendation:** use the Phase 1 table. Plantable points at a **100 mm** 95% semi-major, with a spare observation. A withheld tape uses **1.96** on the propagated distance σ, not 2.45. Photo stations at **200 mm** only after `fx` is calibrated to about **1%** (`fx/width` about **0.69–0.75**, not 0.9) and the ray is levelled. Trilateration at a 20 mm tape is about **100 mm** (95%) at a 40° crossing, not 50 mm.

4. **Replace the turn-left chain and the isosceles station** with the revised solver: bearing sign flipped, gravity and `py` in the ray, datum **A and `B_y` only**. Two marks plus one tape stay **two candidates**. A unique station needs tapes to both ends, a third mark, or an explicit branch choice.
   **Recommendation:** yes. Keep collecting clicks and tapes as 0.7.25 does, and store gravity with the photo. Change what Adjust writes into `x,y`. Do not treat a midpoint tape as a fix. The follow-up review’s three blocking items are in the geometry note; camera-axis mapping is still a follow-up (section 9 there).

5. **House close.** Today’s 50 mm check measures the gap between two different corners. A polygon of wall lengths only has no traverse misclosure, because a misclosure needs measured angles.
   **Recommendation:** no fixed millimetre threshold. When angles exist, test `mᵀ Q_m⁻¹ m ≤ 5.99` and show 2.45 times the semi-major of `Q_m`. On the demo shed that is **93 mm** for tapes at 20 mm and **144 mm** once each corner also has a 0.2° angle. A flat 50 mm gate false-alarms on about **35%** of correct distance-only sheds at σ = 20 mm, and a tighter tape does not repair that once angles dominate (116 mm at 95% with 3 mm + 1 mm/m and 0.2°).

6. **Offset direction.** `offsetMm` has no direction, so the brick arris is not actually solved. A laser on the front of a roll is about **50 mm** from the centre, and the instrument’s reference is not the pole axis.
   **Recommendation:** millimetres plus a direction for the mark, and an explicit laser face/reference offset. Laser σ in the solve is about **5 mm**, not the 2 mm constant in the code. Store both when the schema bumps.

7. **When to stop special-casing `polygons` id `house`.** The field loop depends on it.
   **Recommendation:** leave it through Phase 1. Fold it into a `structure` item in Phase 2 with a `normalizeDocument` migration.

8. **Layer ids.** `walkway` / `structure` / `plants` / `survey` are already in saved JSON. Product language also wants boundary, paths, and beds.
   **Recommendation:** add `boundary` and `bed`. Keep `walkway` as the path layer id so old files load. Put plant **instances** on the bed in Phase 3, not as a second outline layer.

9. **JSON `objects` vs the word Item.** UI says Item; JSON says `objects`.
   **Recommendation:** leave the key until a version bump. New docs and UI keep saying Item.

10. **Schema version.** Everything is `version: 1` with silent fixes in `normalizeDocument`.
    **Recommendation:** bump to `2` only when offsets, layers, or misclosure change shape. Keep loading v1.

11. **One garden file on personal OneDrive**, last upload wins (PUT, no etag).
    **Recommendation:** stay single-user, no backend. You already pick `garden-v{version}.json` in the Sign in accordion; one active file is enough.

12. **Plan stays 2D.** Camera height (~1 m pole) is not a stored Z. Gravity at the shutter is attitude for levelling the ray, not a height survey. iOS will prompt for motion permission.
   **Recommendation:** stay 2D through Phase 3. Request the gravity vector. If it is refused, require a level bubble and widen the angle σ so an unlevelled phone cannot pass the 200 mm station bar.

13. **Plant facts.** Spacing, sun, and companions have no source in the repo.
    **Recommendation:** you type them. No catalogue API in Phase 3.

14. **Reminders vs a list.**
    **Recommendation:** in-app seasonal list in Phase 4. Calendar export only if you still want a buzz. No push notifications on the PWA.

15. **Tests in CI.** Deploy currently runs `tsc` and Vite only. The three `npm run test:*` scripts do not call the TypeScript solver, and the circle fixture is an intentional skip.
    **Recommendation:** Phase 1 adds a node test of the real solver and runs it in the Pages workflow: ellipse coverage and NEES, the bearing-sign case, and the refusal cases in the table above. Capture the field circle file when you next do that walk; do not synthesise it.

16. **UI churn vs solver work.** `src/ui.ts` is where almost every 0.7.x commit landed, and you are still editing it.
    **Recommendation:** Phase 1 touches `photoGeometry.ts`, `adjustLayerA.ts`, `adjustLayerB.ts`, and tests. Leave the dialog alone except where a residual sentence has to change (`coach.ts`).
