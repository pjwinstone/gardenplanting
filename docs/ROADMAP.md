# Roadmap — Garden Survey toward a planted garden

**Status:** planning note, 2026-10-02. Grounded in [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md). Does not change the survey method in `AGENTS.md`.

The app already coaches a baseline-first field loop, stores a garden JSON, and draws a plan. Coordinates are not yet something to trust at planting scale. **Phase 1 is a geometry prototype.** Layers, plants, and care wait until that prototype has passed the checks below.

Existing docs to keep using, not replace:

- Field method: [plan-baseline-then-house.md](plan-baseline-then-house.md), [stage-2-field-checklist.md](stage-2-field-checklist.md)
- Layers / + Point: [plan-layers-objects-add-point.md](plan-layers-objects-add-point.md)
- Solver proposal for the maths review: [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md)

## Phase 1 — Geometry prototype

**Goal:** one local frame in which a baseline, a house corner, a fence post, and a path point are either **solved with a residual** or **left blank on purpose**.

Build it behind the current Adjust entry and the current JSON. Keep the phone UI. Do not start a native app for this phase.

### What the prototype must prove

| Claim | Pass |
|---|---|
| Datum | Highest-trust baseline fixes translation, rotation, and scale. Other baselines are distance observations in that same frame. |
| Distances | A taped or laser length is recovered within its σ (20 mm tape, 2 mm laser) when that length is the only noise. |
| Trilateration | Two distances to a new point, intersection angle 40–140°, side chosen by the user: **within 50 mm** of truth on the synthetic set. |
| Photo station | Three known marks, subtended baseline 15–40°, focal length known to ~10%: station **within 200 mm**. Two marks only: **no coordinate** unless the centred-baseline shortcut is explicitly accepted and the symmetry check passes. |
| House corner | A corner with only one taped edge stays unfixed (the 90° turn goes away). A corner fixed by a second distance or by two stations gets a residual in mm. |
| Close | Misclosure is two estimates of the **same** point. Warn above **50 mm**. A long wall between the first and last corner is not a failure. |
| Layers share the frame | A bed vertex and a house vertex are both `points` in metres. Fitting a circle does not invent a second coordinate system. |
| Honesty | Underdetermined, danger-circle, and tiny-angle cases produce a sentence and no invented `x,y`. |

Planting beds do not need 20 mm. **100 mm RMS** against a withheld tape is the bar for a point you would plant from. Structure control stays tighter (50 mm misclosure). Photo-only stations are allowed to be the weak 200 mm class and must be labelled weak.

### How to validate

1. **Maths review** of [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md) before coding the solver.
2. **Synthetic recovery**, in CI, importing the real module (not a pasted formula): known garden, Gaussian noise at the stated σ, RMS inside the table above. Include refusal cases (two marks, danger circle, subtended angle under 10°).
3. **Withheld checks:** extra tapes that do not enter the solve; report miss in mm.
4. **Field fixture** already specified in [test-case-circle-baseline.md](test-case-circle-baseline.md): real `garden.json` under `fixtures/field-circle-baseline/`. Circle residual and the near baseline end must match the stake notes. Do not invent that file.
5. Coach lines for this phase stay in `coach.ts` and quote the residual the solver actually computed.

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
- A solved circle/square is a **fit** stored on the item, recomputed from selected points. It is not an observation.
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
   **Recommendation:** tape and two-station angles. Revisit AR only as an experiment after Phase 1 has a number to beat.

3. **Accuracy bars** in the Phase 1 table (50 mm structure misclosure, 100 mm plantable points, 200 mm labelled photo stations).
   **Recommendation:** accept those three numbers. They are loose enough for shrubs and tight enough to notice a bad tie.

4. **Replace the turn-left chain and the isosceles station** with the solver in the geometry proposal, after the advisor’s review.
   **Recommendation:** yes. Keep collecting clicks and tapes the way 0.7.25 does; change what Adjust writes into `x,y`.

5. **House close.** Today’s 50 mm check measures the gap between two different corners.
   **Recommendation:** redefine it as misclosure (geometry proposal) and keep the 50 mm warn threshold.

6. **Offset direction.** `offsetMm` has no direction, so the brick arris is not actually solved.
   **Recommendation:** mm plus a direction (inward normal of a named edge, or a tap). Store it when the schema bumps.

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

12. **Plan stays 2D.** Camera height (~1 m pole) is a constant, not a stored Z, until a real height observation exists.
    **Recommendation:** 2D through Phase 3.

13. **Plant facts.** Spacing, sun, and companions have no source in the repo.
    **Recommendation:** you type them. No catalogue API in Phase 3.

14. **Reminders vs a list.**
    **Recommendation:** in-app seasonal list in Phase 4. Calendar export only if you still want a buzz. No push notifications on the PWA.

15. **Tests in CI.** Deploy currently runs `tsc` and Vite only. The three `npm run test:*` scripts do not call the TypeScript solver, and the circle fixture is an intentional skip.
    **Recommendation:** Phase 1 adds a node test of the real solver and runs it in the Pages workflow. Capture the field circle file when you next do that walk; do not synthesise it.

16. **UI churn vs solver work.** `src/ui.ts` is where almost every 0.7.x commit landed, and you are still editing it.
    **Recommendation:** Phase 1 touches `photoGeometry.ts`, `adjustLayerA.ts`, `adjustLayerB.ts`, and tests. Leave the dialog alone except where a residual sentence has to change (`coach.ts`).
