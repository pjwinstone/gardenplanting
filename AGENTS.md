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
Exactly one mode at a time. Show it as a large banner + short spoken/text coach line.

1. `START` — New garden or load JSON.
2. `HOUSE_BASELINE` — Enter/laser house corner lengths; declare wall straights. Coach: “Measure the back wall and one diagonal. We will not move on until the house rectangle closes.”
3. `PLACE_ROD_A` — Coach: “Put rod A where the house can see it. Both ends need toilet-roll belts.”
4. `PHOTO_TIE_HOUSE_ROD` — Coach: “Stand where this photo contains two house corners AND both ends of rod A. Then tap those four marks.”
5. `OCCUPY` — Coach: “Spike on the thing you are naming. Bubble the pole. Photograph the live rod(s). Then name the point.”
6. `OCCUPY_EXTRA_YAW` — optional extra photos from the SAME occupy, yaw only. Coach: “Do not step. Only turn the phone so another mark sits in the middle of the frame. These photos share this point.”
7. `LEAPFROG` — Coach: “Plant rod B in the new view. Photograph A and B together before you pick A up.”
8. `RODS_MOVED` — User confirms rods moved. Close setup, open new setup. Coach: “Rod A is no longer the old coordinates.”
9. `FENCE_TAG` — Coach: “You cannot stand in the fence. Stick a roll on the post, photograph it with a live rod.”
10. `ADJUST` — Run Layer A then Layer B. Show residuals in plain language: “House is happy. Rod A looks 12 mm long. Occupied BED02P1 is weak — rod was too small in the frame.”
11. `REVIEW` — Plan on iPad-sized layout; thumbnails beside points.

Buttons that change mode: Start house, Rod A ready, Take tie photo, Occupy, Another photo here (yaw), Start leapfrog, Rods moved, Fence mark, Adjust, Done with this setup.

Refuse illegal actions with a sentence, e.g. occupying when no live control exists; “Rods moved” when A+B have not been photographed together.

## Survey method (do not change)
- Layer A first: house tapes/laser + straight constraints; optional spikes/fence.
- Two 4.000 m rods (A1 A2, B1 B2). Optional mid 2.000 m checks — not a third station.
- Setups dated/time-boxed. Photos belong to a setup via EXIF DateTimeOriginal + explicit Rods moved.
- Camera on a plumbed ~1 m pole is the rover. Occupy = that (x,y).
- Yaw-only extra photos share one occupy point. Do not treat a hand-wave as a new station.
- Unique pose needs house or second rod or a third known mark in the frame (or across shared-C yaw set). If underdetermined, say so; do not invent coordinates.
- Distances primary; photo angles/resection secondary. Full multi-image BA is a later module; v1 is per-photo pose + optional shared-(x,y) for yaw set.
- Railway gauge 184 mm, corridor ~0.60 m — draw later if TRK points exist.

Default σ: tape 0.020 m, laser 0.002 m if flagged, rod length 0.005 m, clicks ~2 px, angles ~0.2° unless rod fills 15–30°.

## Chatty coach
A persistent Coach panel:
- 1–3 sentences, large type
- Last residual in human units (mm)
- Next legal button highlighted
- Optional Web Speech Synthesis to read the coach line after each photo (toggle: Speak steps). Optional Web Speech Recognition for names (“bed two point one”) when the user holds Talk.

Copy examples:
- “I see rod A ends and HSE01, HSE02. Good tie. Rod subtends 24° — strong.”
- “Only one rod end clicked. I cannot fix you on the map yet.”
- “Three photos on BED02P1. Say Repeat if this is another visit, or yaw-only if you did not move your feet.”

## Printable tags (GUI, v1)
A **Print tags** page / panel, A4, black and white.

Generate and print:
- Rod belts: wrap strips for toilet-roll tubes (~100 mm tall, ~140 mm + 10 mm overlap). Pattern: black 15 / white 20 / black 15 mm horizontal bands. Label A1 A2 A0 B1 B2 B0 under the white belt.
- Fence/house discs or small wraps: FNC01… and HSE01… 
- Optional occupy drop-rolls.

Codes: three letters + two digits (HSE, FNC, POL / A1 style for rods). Avoid O/I confusion on printed IDs where easy.

Print via `window.print()` with a print-only CSS stylesheet. What is printed must be the same IDs as in the document model. Include a one-page “how to wrap a toilet roll” instruction on the print sheet.

## Data / stack
Vite + TypeScript. Modules: model.ts, modes.ts, adjustLayerA.ts, adjustLayerB.ts, photoGeometry.ts, storage.ts, planSvg.ts, tagsPrint.ts, coach.ts, ui.ts.

JSON document as previously specified (points, lines, polygons, observations, photos with thumbnails, setups).

localStorage + export/import garden.json. OneDrive via Microsoft Graph (`/Garden Survey/garden.json`) when MSAL env is set — see `docs/entra-onedrive-setup.md`.

## First milestone
1. Write this AGENTS.md.
2. Mode banner + coach + buttons that only enable legal transitions.
3. Synthetic house + rod A + two occupy photos with canned clicks → Adjust draws SVG plan.
4. Print tags page produces A4 rod belts + FNC01–04.
5. README lists the field loop matching the modes.

Ask before changing the survey method. Keep the coach text in one file so copy can be edited without touching the solver.
