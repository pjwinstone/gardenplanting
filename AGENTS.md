# Garden Survey — AGENTS.md

You are building **Garden Survey**, a static PWA (Vite + TypeScript) for a ~20×20 m UK garden. No backend, no Xcode, no native iOS. Cursor on the web is the IDE.

## Product tone
The UI is **chatty and procedural**. At every moment the app states:
- what mode we are in
- what the user should do next
- what the last action meant
- whether geometry is good enough to proceed

The user and the code must agree on the current **session mode**. Never leave the user in a silent “upload a photo” void.

## Session modes (state machine)
Exactly one mode at a time. Show it in the task strip + short spoken/text coach line.

1. `START` — New garden or load JSON.
2. `BASELINE` — Mark two ends of a known-length baseline (default: **one house edge**). Enter length + optional mark offsets (mm). Coach: “This edge is your baseline. Measure it. Offsets are OK — tell me the roll/post radius if the mark is not the true corner.”
3. `PHOTO_TIE_BASELINE` — Coach: “Stand where this photo contains both baseline ends AND the house mark you are fixing. Then tap those marks.”
4. `HOUSE_EDGES` — Optional: tape the next reachable wall segment or add another baseline. Grow the irregular house polygon (~10 corners). Coach: “Add the next edge or corner when you can. Far side needs leapfrog.”
5. `OCCUPY` — Coach: “Spike on the thing you are naming. Bubble the pole. Photograph the live control (baseline ends and/or rod). Then name the point.”
6. `OCCUPY_EXTRA_YAW` — optional extra photos from the SAME occupy, yaw only. Coach: “Do not step. Only turn the phone so another mark sits in the middle of the frame. These photos share this point.”
7. `LEAPFROG` — Coach: “Plant rod B in the new view. Photograph A and B together before you pick A up. Use this for the far side of the house / a second baseline.”
8. `RODS_MOVED` — User confirms rods moved. Close setup, open new setup. Coach: “Rod A is no longer the old coordinates.”
9. `FENCE_TAG` — Coach: “You cannot stand in the fence. Stick a roll on the post, photograph it with live control.”
10. `ADJUST` — Run Layer A then Layer B. Residuals in plain language (baseline length, taped edges, house close gap, occupies).
11. `REVIEW` — Plan on iPad-sized layout; thumbnails beside points.

Buttons that change mode: Establish baseline, Take baseline tie, Measure house edges, Occupy, Another photo here (yaw), Start leapfrog, Rods moved, Fence mark, Close house, Adjust, Done with this setup.

Refuse illegal actions with a sentence, e.g. occupying with no live control; “Rods moved” when A+B have not been photographed together; Close house when fewer than 3 corners.

## Survey method
- **Baseline first** (not a forced house rectangle). Default first baseline = **one house edge** (easy to re-establish). Same toolbox supports free lawn pegs later.
- House ≈ **~10 corners**, irregular **polygon** on the structure/buildings layer. No requirement to tape a diagonal.
- **Mark offset / post radius (mm)** is first-class on baseline ends and similar marks — solved point can be the brick arris, not the roll centre.
- Grow corners incrementally: taped edges you can reach, and/or photo-tie new marks to the live baseline, and/or a second baseline via leapfrog for the far side.
- **Close house:** allowed when ≥3 corners; **warn** if polygon close gap &gt; **50 mm**.
- Layer A: baselines + taped edges + rod lengths + polygon close residual. Layer B: per-photo resection to marks (v1).
- **v1 photo-tie:** require **both baseline ends + target mark in one frame**. Full multi-image BA is later.
- Two 4.000 m rods (A1 A2, B1 B2) for leapfrog / helper control. Optional mid 2.000 m checks — not a third station.
- Setups dated/time-boxed. Photos belong to a setup via EXIF DateTimeOriginal + explicit Rods moved.
- Camera on a plumbed ~1 m pole is the rover. Occupy = that (x,y).
- Yaw-only extra photos share one occupy point. Do not treat a hand-wave as a new station.
- Unique pose needs baseline ends or second rod or a third known mark in the frame (or across shared-C yaw set). If underdetermined, say so; do not invent coordinates.
- Distances primary; photo angles/resection secondary.
- Railway gauge 184 mm, corridor ~0.60 m — draw later if TRK points exist.

Default σ: tape 0.020 m, laser 0.002 m if flagged, rod length 0.005 m, clicks ~2 px, angles ~0.2° unless rod fills 15–30°.

## Chatty coach
Coach copy lives only in `coach.ts`:
- 1–3 sentences, large type (task strip shows the lead line)
- Last residual in human units (mm)
- Next legal button highlighted
- Optional Web Speech Synthesis (toggle: Speak steps)

Copy examples:
- “This edge is your baseline. Measure B1–B2. Offsets are OK.”
- “I see both baseline ends and HSE03. Good tie.”
- “Only one baseline end clicked. I cannot fix this corner yet.”
- “House close gap 72 mm — remeasure before you trust the polygon.”

## Printable tags (GUI, v1)
A **Print tags** page / panel, A4, black and white.

Generate and print:
- Rod belts: wrap strips for toilet-roll tubes (~100 mm tall, ~140 mm + 10 mm overlap). Pattern: black 15 / white 20 / black 15 mm horizontal bands. Label A1 A2 A0 B1 B2 B0 under the white belt.
- Fence/house discs or small wraps: FNC01… and HSE01…
- Optional occupy drop-rolls; baseline end discs when useful.

Codes: three letters + two digits (HSE, FNC, POL / A1 style for rods). Avoid O/I confusion on printed IDs where easy.

Print via `window.print()` with a print-only CSS stylesheet. What is printed must be the same IDs as in the document model. Include a one-page “how to wrap a toilet roll” instruction on the print sheet.

## Data / stack
Vite + TypeScript. Modules: `model.ts`, `modes.ts`, `toolbox/`, `workflows/`, `adjustLayerA.ts`, `adjustLayerB.ts`, `photoGeometry.ts`, `storage.ts`, `planSvg.ts`, `tagsPrint.ts`, `coach.ts`, `ui.ts`.

JSON document: points (with optional `offsetMm`), lines, polygons, **baselines**, observations, photos with thumbnails, setups.

Architecture: `docs/architecture-toolbox-workflows.md`. Method plan: `docs/plan-baseline-then-house.md`.

localStorage + export/import garden.json. OneDrive via Microsoft Graph (`/Garden Survey/garden.json`) when MSAL env is set — see `docs/entra-onedrive-setup.md`.

## First milestone (historical) + Stage 2
1. Mode banner / task strip + coach + legal transitions.
2. Synthetic baseline + irregular shed + rod A + occupy photos → Adjust draws SVG plan.
3. Print tags page produces A4 rod belts + FNC01–04.
4. Field checklist matches baseline-first loop.

Keep the coach text in one file so copy can be edited without touching the solver. Ask before changing the survey method again.
