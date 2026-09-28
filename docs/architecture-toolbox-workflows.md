# Architecture — toolbox, workflows, layers

## Goals
- Separate **prompts/workflow** from **functionality**
- Functionality = a **toolbox of capabilities** (avoid calling these “features”)
- **Workflows** guide tasks (“Add point”, “add a plant”, “add a post”, leapfrog, …) and call capabilities
- User-facing short label for Add point: **+ Point**
- Hierarchy: **Layer → named Object** (one level); geometry type + measured/selected points
- End-state UI: garden **plan is the main backdrop**; chrome/menu recedes

Survey **method** in AGENTS.md stays (baseline / leapfrog kept); Add point reframes observe-on-layer.

## Layers (conceptual)

| Layer | Responsibility | Examples |
|---|---|---|
| **Toolbox** | Pure **capabilities**; no coach copy | photo observe, resect, fit circle/square, pick baseline, save OneDrive |
| **Workflow / prompts** | Scripts + coach text; call toolbox | `workflowAddPoint`, `workflowEstablishBaseline`, leapfrog, Adjust/refit |
| **Document model** | Layers + objects + points/baselines | walkway/structure/plants/survey; objects with geometry |
| **Presentation** | Plan full-bleed; hamburger; + Point panel; inspector | trust-ordered baselines, fuzzy shapes |

**Note:** **Add point** is a **workflow** that uses toolbox capabilities. Sticky: baseline, layer, object name, geometry until changed. **Add photo** runs the measurement.

## UI (current ≥ 0.7.0)
1. Hamburger + error log (red ☰) + OneDrive + Print tags
2. **+ Point panel:** Baseline · Layer · Object name · Geometry (square/circle/triangle/irregular polygon) · **Add photo**
3. Plan click → measurement inspector (same fields)
4. Baselines show **trust** / used-for-measurement styling; higher trust preferred
5. Fuzzy circle/square draw-in as observations accumulate

See `docs/plan-layers-objects-add-point.md`.

## Success check
- Build ≥ 0.7.0
- Synthetic demo + Adjust + Add photo still work
- Coach copy in `coach.ts`
