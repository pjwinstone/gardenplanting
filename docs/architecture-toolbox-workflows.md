# Architecture — toolbox, workflows, layers

## Goals
- Separate **prompts/workflow** from **functionality**
- Functionality = a **toolbox of capabilities** (avoid calling these “features”)
- **Workflows** guide tasks (“Add point”, “add a plant”, “add a post”, leapfrog, …) and call capabilities
- User-facing short label for Add point: **+ Point**
- Many object types with geometric constraints, on **separate layers**
- End-state UI: garden **plan is the main backdrop**; chrome/menu recedes; active task shown with **minimal coach + hamburger drawer**

Survey **method** in AGENTS.md stays; we refactor structure and UI, not the field geometry rules.

## Layers (conceptual)

| Layer | Responsibility | Examples |
|---|---|---|
| **Toolbox** | Pure **capabilities**; no coach copy | `measureHouseEdge`, `addPoint` (photo/resection/name ops), `placePost`, `placePlant`, `drawPathRect`, `drawRailwaySpline`, `runAdjustA`, `runAdjustB`, `saveGarden` |
| **Workflow / prompts** | Scripts + coach text; call toolbox; own session “task” | `workflowAddPoint`, `workflowEstablishBaseline`, `workflowSurveyHouse`, `workflowAddPost`, `workflowAddPlant` |
| **Document model** | Typed objects + layer id + constraints | `Post`, `Plant`, `Path` (circle/rect), `Railway` (spline), existing HSE/FNC/rod/add-point stations |
| **Presentation** | Plan SVG full-bleed; hamburger drawer; minimal mid-workflow chrome | Map backdrop, coach+next CTA, print tags route, in-app error log |

**Note:** **Add point** is a **workflow** (`ADD_POINT` / `+ Point`) that uses toolbox capabilities (photo, resection, naming, …). Plumbed pole = that (x,y); yaw extras share the point.

## Document / layers (target)
- Each drawable thing has `layerId` (e.g. `survey`, `structure`, `plants`, `paths`, `railway`)
- Constraints live with the type (rod length 4.000 m, railway gauge later, path as rect/circle, …)
- v1 keep existing survey points; add `Post` as first new typed object on `structure` layer

## UI (current ≥ 0.6.1)
1. **Plan-first:** Garden layout fills the viewport; persistent task-strip / button wall is **hidden by default**
2. **Hamburger (top-right):** Sign in / OneDrive, Tools, All mode actions, Print tags, Stage 2 checklist, Load demo, Export/Import, Build stamp, Settings, **Error log**
3. **Mid-workflow chrome:** short coach line + primary next action only (plus compact step forms when typing lengths)
4. **Error log:** `window.onerror`, `unhandledrejection`, and coach/refuse failures; hamburger turns **red** while unseen; opening Error log (or Clear) acknowledges
5. **Naming:** Occupy → **Add point** (`+ Point`); modes `ADD_POINT` / `ADD_POINT_EXTRA_YAW`

## Earlier slices
1. Toolbox / workflows + coach.ts as prompt source; plan-first task strip (0.4.0)
2. Baseline-first survey method (0.5.0)
3. Hamburger UI + error log (0.6.0)

## Non-goals
- Full layer toggles UI
- Railway spline / path geometry editors
- AI plant selection
- Changing AGENTS survey method via UI chrome alone

## Success check
- Build ≥ 0.6.1 with Add point naming
- Synthetic demo + Adjust still work
- OneDrive save still works
- Coach copy still editable in one place (`coach.ts`)
