# Architecture review — Garden Survey (repo `gardenplanting`)

**Reviewed:** 2026-10-02, `main` at `509f5ba` (app **0.7.25**).
**Scope:** what is in the tree today. Method specs already live in [plan-baseline-then-house.md](plan-baseline-then-house.md), [plan-layers-objects-add-point.md](plan-layers-objects-add-point.md), and [architecture-toolbox-workflows.md](architecture-toolbox-workflows.md). This note is the status of the code, not a second method spec.

## What this is

A **static PWA** (Vite + TypeScript) for surveying one ~20×20 m UK garden. Live site: https://pjwinstone.github.io/gardenplanting/

The product name in the UI and `package.json` is **Garden Survey** (`garden-survey` **0.7.25**). The GitHub repo is `gardenplanting`.

| Question | Answer |
|---|---|
| Native iPhone / iOS app (Swift, ARKit, LiDAR)? | No. The phone path is **Safari**, installable as a home-screen PWA. Rear camera via `getUserMedia`, with `<input capture="environment">` as fallback. |
| Backend? | No server. GitHub Pages hosts the static build. |
| Persistence | `localStorage` (photo bytes stripped) + export/import `garden.json` + optional **personal OneDrive** via MSAL / Microsoft Graph. |
| Planting, companions, care schedules, reminders? | Not built. A `plants` layer id exists and is empty of plant records. |
| GPS / map tiles? | Not used. Coordinates are local metres. |

## Stack

- **Vite 6**, **TypeScript 5.7**, **vite-plugin-pwa**. No React/Vue. UI is DOM built in `src/ui.ts`.
- **@azure/msal-browser** for sign-in. Graph writes `/Garden Survey/garden-v{version}.json` (legacy `garden.json` still loadable). See [entra-onedrive-setup.md](entra-onedrive-setup.md).
- Deploy: `.github/workflows/deploy-pages.yml` on push to `main` (Node 22, `npm run build` only). `base` is `/gardenplanting/`.
- Version stamp: `VITE_APP_VERSION` in that workflow (currently `0.7.25`).

## How the app is put together

```
index.html
  main.ts          boot, MSAL
  ui.ts            all chrome (~4.1k lines): hamburger, + Point dialog, camera, plan
  modes.ts         one session mode; illegal actions return a sentence
  coach.ts         the only coach copy
  model.ts         GardenDocument + baseline / house helpers
  layers.ts        layers, items, + Point, photo marks, provisional coordinates
  photoGeometry.ts bearings, pose check, station-from-baseline, resection heuristic
  geometryFit.ts   circle / square / triangle fits
  adjustLayerA.ts  tape / rod / house chain
  adjustLayerB.ts  per-photo pose
  planSvg.ts       plan drawing
  tagsPrint.ts     A4 rod belts + discs
  storage.ts       localStorage + export/import
  onedrive.ts      Graph save/load
  workflows/       thin scripts over the toolbox
  toolbox/         adjust, document, cloud, mode — no coach copy
```

Session modes match `AGENTS.md`: `START`, `BASELINE`, `PHOTO_TIE_BASELINE`, `HOUSE_EDGES`, `ADD_POINT`, `ADD_POINT_EXTRA_YAW`, `LEAPFROG`, `RODS_MOVED`, `FENCE_TAG`, `ADJUST`, `REVIEW`, plus `MENU`. Legacy names (`OCCUPY`, `HOUSE_BASELINE`, …) are normalised on load.

## Data model (`GardenDocument`, `version: 1`)

| Collection | Role today |
|---|---|
| `points` | Ids such as `HSE01`, `FNC01`, `A1`, `OCC…`. Optional `x,y` metres, `offsetMm`, `layerId`, `objectId`, `photoIds`. Kinds: `HSE FNC POL ROD OCC TRK BED BL`. |
| `baselines` | Known length between two marks. `trust` (0–100), tape or laser, optional `isHouseEdge`. |
| `lines` | Tape, laser, rod (4.000 m / mid 2.000 m), or baseline length. |
| `polygons` | The house is the special id `house` on layer `structure`. |
| `layers` / `objects` | Default layers: `walkway`, `structure`, `plants`, `survey`. An object (UI: **Item**) has a geometry type and measured/selected point ids, plus an optional solved circle, square, or polygon. |
| `photos` | Setup id, clicks (`pointId`, `px`, `py`), thumbnail data URL, optional `pose` and per-photo `estimate`. |
| `setups` | Time-boxed instrument setup. `abPhotographedTogether` gates **Rods moved**. |
| `observations` | Mostly residuals written by Adjust. |
| `session` | Mode, sticky layer/item/geometry, active baseline, coach fields. |

Default σ in `model.ts`: tape 0.020 m, laser 0.002 m, rod 0.005 m, clicks ~2 px, angles ~0.2°.

## What works

- **Field shell on a phone browser:** one mode at a time, coach line, hamburger (thumb zone), refusals in sentences, printable rod belts and discs, SVG plan with zoom/pan.
- **Establish baseline** (default: one house edge) with length and mark offsets. House corners can be appended with a taped edge. Close house is refused under 3 corners.
- **+ Point** sticky workflow: Garden → Layer → Item → Point, in-app camera, extra photos, delete, plan inspector. Bright-blob **tag suggestions** on a photo (`tagSuggest.ts`).
- **Photo marks (0.7.25):** tapping both baseline ends runs `stationFromBaselineSighting` and stores that as the **camera station** on the add-point. The code tells the user a third mark does not get world coordinates from that one photo.
- **Provisional points** are pushed off the baseline segment until a sighting exists (so a new point is not drawn on top of control).
- **OneDrive:** sign-in, versioned garden file, auto-load last file, slim local cache so photo thumbs do not blow the quota. In-memory and OneDrive keep the bytes.
- **Synthetic demo** (`syntheticDocument`): 7 m house-edge baseline, irregular 6-corner shed with authored coordinates, rod A, two bed points. **Run milestone demo** draws a plan from those authored numbers.
- **Shape doodles:** Kåsa circle fit (≥3 points), axis-aligned square from extents, triangle from the first three points.

## What is still approximate or unfinished

These are the parts that look like a survey and are not yet a survey adjustment.

1. **House photo-tie does not locate the corner.** Clicks of baseline ends + `HSE03` are stored. `applyPhotoMarks` places the phone, and says the extra mark needs a second sighting or a tape. Layer B does not move `HSE*` points.
2. **Layer A is a construction recipe, not a least-squares adjust.** The active baseline is pinned to the x-axis. Each next house corner with a tape is placed by **turning left 90°** off the previous edge (or straight along +Y for the first edge). A perfect tape on a non-rectangular house still lands in the wrong place. `offsetMm` is applied as a shift of that same point (along +Y on the baseline), with no stored offset direction.
3. **“Close gap” is the distance between the first and last distinct corners**, compared with 50 mm (`closeHouse`, `runLayerA`). On a real outline those corners are a wall apart, so a correct house fails the check. The synthetic shed’s first and last corners are ~3 m apart and the polygon is already `closed: true`. A traverse **misclosure** (two estimates of the same point) is not what this number is.
4. **Layer B resection is a sketch.** `resectPose` uses rod A1–A2 and `(L/2)/tan(θ/2)`, then parks the camera on a fixed side of the rod (“south” in the comment). With no rod it pulls the pose back **3 m** along the mean bearing. `poseDeterminacy` can refuse, but a “determined” pose is still this heuristic. Focal length is `fx = 0.9 × photo width`.
5. **Station-from-baseline uses the same isosceles formula** and a caller-chosen side. Image left/right is read and then ignored (`void clickA`). Two bearings fix an **arc**, not a point; the formula is only fair when the baseline is centred. See [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md).
6. **Extra-photo “scatter”** (`estimatePhotoContribution`) is a spiral of a few centimetres until a real estimate exists. Averaging those with a solved station mixes fiction and measurement.
7. **Square fit** is an axis-aligned bounding square, not a rotated rectangle. **Line** exists on the type and is absent from the geometry picker. Irregular polygon stores the point ids and no residual.
8. **Leapfrog** changes mode and, after A+B are flagged together, closes the setup. There is `declareRodA` and no equivalent placement or length solve for rod B. Fence points in the demo have **no coordinates**.
9. **Plants.** Layer id only. No species, spacing, sun, companions, tasks, or reminders.
10. **Railway** (`TRK`, 184 mm gauge) is named in `AGENTS.md` and not drawn.

`docs/plan-baseline-then-house.md` still says the live app “assumes house rectangle first”. That sentence is leftover: the rectangle path is gone (`applyHouseBaseline` delegates to `setBaseline`). Treat that doc as the **field method**, and this review as **how far the solver got**.

## Tests and fixtures

No `*.test.ts`. CI does not run the npm test scripts.

| Script | What it actually checks |
|---|---|
| `npm run test:station-baseline` | A **copy** of the isosceles formula in plain JS. It does not import `photoGeometry.ts`. |
| `npm run test:occ-off-baseline` | A **copy** of the “stay off the baseline” offset. Same limitation. |
| `npm run test:field-circle` | If `fixtures/field-circle-baseline/garden.json` is missing, **exit 0**. The file is missing on purpose. |

[test-case-circle-baseline.md](test-case-circle-baseline.md) is the right field test (known circle, stake, baseline) and has no capture yet. Screenshot scripts under `scripts/` drive Puppeteer for UI snapshots; they are not assertions.

## Recent activity (Paul is on `main`)

All 43 commits are author `pjwinstone`. From **0.7.0** (2026-09, layers / + Point) through **0.7.25** (2026-10-02, photo-mark wedge and station-from-A/B) the work is field UI: dialog, camera, concertina status, OneDrive versions, local quota, provisional points off the baseline.

Remote `cursor/*` branches are **ancestors of `main`**, not open work. `gh pr list` shows one merged PR (docs, 2026-09-25). Day-to-day integration is push to `main`, which also deploys Pages.

So the mid-stream product work is **on `main` itself**: photo clicks now create a station, the corner solve and a real field fixture are still ahead, and the UI file is moving quickly.

## Risks and debt

- **Accuracy.** The plan can look finished while corners sit on assumed right angles and stations sit on an isosceles shortcut. Planting on top of that will inherit metre-scale error. Sensitivity: for a 7 m baseline subtending 20°, about **1 m of range error per 1°** of angle error; a 10% focal-length error dominates a 2 px click. Small subtended angles are worse.
- **`ui.ts` (~4,100 lines)** holds camera, dialog, menu, and rendering. Geometry changes should stay in `photoGeometry.ts` / adjust modules so UI edits do not fork the solver.
- **Datum bugs that read as product rules.** The 50 mm house-close warning and “good tie” coach lines can fire on the wrong quantity.
- **Document `version: 1`** with ad-hoc migrations inside `normalizeDocument` (occupy → add point, rectangle → square). A real schema change needs an explicit bump.
- **OneDrive PUT overwrites** the named file. Folder create uses conflict `fail`; saves do not use an etag. Safe for one person, one phone.
- **localStorage drops JPEG/PNG/WebP thumbs.** A device that never reaches OneDrive keeps geometry and loses pictures.
- **No solver tests in CI**, and the smoke scripts duplicate formulas instead of calling them.

## Bottom line

The repo is a usable **field notebook and plan viewer** for a baseline-first garden survey, aimed at an iPhone browser, with OneDrive as the file. It is not an iOS AR app, and it does not yet turn photos and tapes into checked coordinates. That gap is the one to close before beds, plants, or reminders. Proposal: [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md). Order of work: [ROADMAP.md](ROADMAP.md).
