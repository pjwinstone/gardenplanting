# Plan — Layers, items, and simplified “Add point”

> **UI (0.7.16+):** user-facing word is **Item** (was Object). Model JSON still uses `objects` / `GardenObject` / `stickyObjectId` — rename later if needed. Dialog stack: **Garden → Layer → Item → Point** with +/−.

**Status:** **approved** (with refinements below) — implementing.

## Problem with today
- Prompts feel like a survey textbook (modes, rods, occupy…).
- After baseline, you don’t think “occupy” — you think **“I’m collecting evidence for a named thing on a layer.”**
- Geometry should **emerge** (fuzzy circle/rectangle/line) as photos accumulate; early control can be **revised**, not frozen forever.

## Hierarchy (one level under a layer)
```
Layer  (e.g. walkway, structure, plants, survey)
  └── Object  (named thing on that layer)
        ├── geometry type: point | circle | square | triangle | irregular polygon | line | …
        ├── measured points / observations (photos, clicks, tapes)
        ├── selected points (subset or roles used in the fit)
        └── solved shape: fuzzy → tightening as data grows / re-runs
```

- **No deep nesting.** Walkway = layer; circular path & rectangular patch = objects on that layer.

## Sticky + Point workflow
1. **+ Point** continues on the **same layer + object** as the previous add (sticky).
2. Clear GUI to change **layer** and **object name** (create new object anytime).
3. Each add uses the **active baseline** (see below).
4. Short coach only: what’s sticky, what’s active baseline, what to tap next.

## Active baseline (plan-picked, not sacred)
- Active baseline = a **selected set of points** (typically two ends with known/estimated length) drawn from **any layer / any object**, chosen by **clicking on the garden plan**.
- **Visual distinction** on the plan for baselines that have been used to make measurements (e.g. distinct stroke / glyphs vs ordinary edges).
- **Trust / z-order priority:** each baseline has a trust rank (user-editable or derived from residuals). New work **prefers higher-trust** baselines; drawing order / hit-testing can reflect that priority.
- **+ Point** defaults to the **previous** baseline, but the baseline selector can switch to **any** known baseline.
- Moving around the house: pick a new active baseline from whatever you trust *now*; old baselines remain data, not dogma.
- Mathematics: current solve treats the chosen baseline as temporarily fixed for that observation; **Adjust / global refit** can reweight so early mistakes can be put right later.
- Leapfrog still allowed; it updates which segment is “active,” not “the only truth forever.”

## Per-object geometry for error minimisation
For **every object**:
- **Measured points** — raw observations (image taps, tapes, …)
- **Selected points** — which of those (or derived roles) enter the current fit
- **Geometry type** — what the minimizer fits: circle, rectangle, line (colinear), polygon, free points, …

Later constructions (e.g. “these must be straight”) are **geometry types / constraints** on the object, re-runnable when data changes.

## Shape fitting (fuzzy draw-in)
| Geometry | Behaviour |
|---|---|
| **Circle** | Fit centre + radius; translucent ring tightens |
| **Rectangle** | Fit pose + size; fuzzy box |
| **Line** | Colinear fit / corridor |
| **Free / polygon** | Points / edges; optional close |

Residuals live on the object; user can fix mistakes by more observations or changing geometry type / selected points / active baseline, then refit.

## Workflows vs toolbox
- **Workflows:** Establish baseline · + Point (observe object) · Pick active baseline · Leapfrog · Adjust / Refit · Close house  
- **Toolbox capabilities:** photo observe, resect, fit circle/rect/line, pick points on plan, save OneDrive…

## UI — Add point panel (always clear)
When adding, the GUI shows (selectors, not a wall of prose):
1. **Baseline** — which baseline this measurement will use (default = previous; any baseline choosable; plan highlights it)
2. **Layer**
3. **Object name**
4. **Geometry** — square | circle | triangle | irregular polygon (and line later)
5. **Add photo** — capture/observe; run measurement against that baseline; place/update the current point on the plan

Sticky: next **+ Point** keeps the same baseline / layer / object / geometry until changed.

### Inspect any point
- **Click a point on the plan** → open its measurement sheet: baseline used, layer, object, geometry, photo/obs list, residuals — same fields as Add point, so you can see *how* it was measured and revise.

## Phased delivery (this implementation pass)
1. Model: layers, objects, geometry type, measured/selected points, active baseline selection on plan.
2. + Point sticky + GUI to select layer/object; observations append; draw points + fuzzy circle/rect (line can be stub).
3. Simplify coach prompts for this path; keep hamburger / error log / OneDrive.
4. Adjust/refit entry that doesn’t assume one immortal house rectangle baseline.
5. Bump **0.7.0**; Pages; sync this plan into repo docs.

## Defaults locked
- UI label: **+ Point**
- Default layer: `walkway` (user can change)
- Geometry choices in UI: **square | circle | triangle | irregular polygon** (fuzzy fit for circle/square first; triangle/polygon can start as point sets + stub fit)
- **Line** / colinearity = later construction on selected points

## Non-goals this pass
- Deep object trees  
- Full multi-image BA  
- Perfect surveyor-only workflow  
- AI planting  
