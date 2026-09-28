# Architecture — toolbox, workflows, layers

## Goals
- Separate **prompts/workflow** from **functionality**
- Functionality = a **toolbox** of options the UI and workflows call
- Workflows guide tasks (“add a plant”, “add a post”, survey leapfrog, …)
- Many object types with geometric constraints, on **separate layers**
- End-state UI: garden **plan is the main backdrop**; chrome/menu recedes; active task shown in a **dropdown / task strip**

Survey **method** in AGENTS.md stays; we refactor structure and UI, not the field geometry rules.

## Layers (conceptual)

| Layer | Responsibility | Examples |
|---|---|---|
| **Toolbox** | Pure capabilities; no coach copy | `measureHouseEdge`, `occupyPoint`, `placePost`, `placePlant`, `drawPathRect`, `drawRailwaySpline`, `runAdjustA`, `runAdjustB`, `saveGarden` |
| **Workflow / prompts** | Scripts + coach text; call toolbox; own session “task” | `workflowSurveyHouse`, `workflowAddPost`, `workflowAddPlant` |
| **Document model** | Typed objects + layer id + constraints | `Post`, `Plant`, `Path` (circle/rect), `Railway` (spline), existing HSE/FNC/rod/occupy points |
| **Presentation** | Plan SVG full-bleed; task strip; optional panels | Map backdrop, task dropdown, print tags route |

## Document / layers (target)
- Each drawable thing has `layerId` (e.g. `survey`, `structure`, `plants`, `paths`, `railway`)
- Constraints live with the type (rod length 4.000 m, railway gauge later, path as rect/circle, …)
- v1 keep existing survey points; add `Post` as first new typed object on `structure` layer

## UI end-state (incremental)
1. **Now (first slice):** Plan SVG dominates viewport; mode banner + coach collapse into a **task strip / dropdown**; toolbox actions not all shown as a button wall
2. **Next:** “Add a post” workflow using toolbox + structure layer
3. **Later:** Hide remaining chrome; more object types; layer toggles

## First slice (implement now)
1. Code split (or clear module boundaries):
   - `toolbox/` (or `toolbox.ts`) — operations extracted from adjust/modes/storage calls
   - `workflows/` + keep `coach.ts` as prompt source only
2. **Plan-first layout:** map is primary backdrop; session mode + coach + next action in a compact **task strip** (dropdown or expandable)
3. Do **not** remove survey capability; legal mode transitions still enforced
4. Bump build stamp; deploy Pages
5. Short note in README pointing here

## Non-goals for this slice
- Full layer toggles UI
- Railway spline / path geometry editors
- AI plant selection
- Changing AGENTS survey method

## Success check
- User sees Build ≥ 0.4.0 with plan-forward UI and task strip
- Synthetic demo + Adjust still work
- OneDrive save still works
- Coach copy still editable in one place (`coach.ts`)
