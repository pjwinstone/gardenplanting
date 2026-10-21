# Rebuild plan rev 3: two activities, roller kept, net-driven (base 9248b08)

rev 3 (Paul, 21 Oct): point types are **base point** (always base layer) and **photo point** (any other layer); "observation point" retired. Advisory tips added. Marker/base-point photo identification kept as is.

## Home
Plan view + two buttons: **Add point**, **Circle test**. Everything else (Set-up/tolerances, cloud/OneDrive, error log, print markers, old screens) under a collapsed **Tools** menu.

## Activities (steps shown on the roller)
**Add point**
1. Choose type: Base point or Photo point.
- Base point:
  2. From which existing base point (the first base point ever is fixed at 0,0; no tapes needed).
  3. Taped offsets along grid north and grid east (N, E).
  4. Diagonal tape check (red if |w| > 3.29, tie σ 4 mm / 1°).
  5. Optional two-sleeve post (separation default 1.2 m centre-to-centre, editable).
  6. Save.
- Photo point (boundary/railing, path, house/structure, bed — never the base layer):
  2. Choose layer (boundary/railing, path, house/structure, bed).
  3. Photos (1+ from one spot).
  4. Solve → status (green/amber/red/grey, "2-point fix (unchecked)"), accuracy per point, base points seen.
  5. Save / Discard.
**Circle test**: taped diameter → edge photos (count from Set-up edge_points, not fixed 12) → fit (drop-down later) → compare with tape → verdict (controlCircleVerdict).

**Grid north** = Paul's own chosen direction along the house, roughly north (may be 20–40° off), NOT compass. Stored with the base grid; optional "grid vs compass offset" field reserved for later sun work (not built in PR1).

## Roller (kept, fixed)
- Moves ONLY on user scroll or Next/Back. No auto-advance on photo upload, solve, re-render or doc change. Remove every programmatic scroll except restoring the user's own position after re-render.
- Jitter fix: one scroll-settle path (snap on scrollend / single debounce), no re-render while touching, re-render preserves scrollTop, no transform recalculation feeding back into scroll; reuse the detached-node guard.
- Row marks: ✓ completed; small "next" dot on the next-needed step; × / ↻ as now.

## Net-driven screens
- Small net per activity: `workflow/add-point.net.yaml` (rewritten, with the base/observation branch) and `workflow/circle-test.net.yaml`. Transitions = steps; guards give enable/disable plus a plain reason string.
- The UI renders straight from the net (no legacy UI running beside it). Every step uses ONE template:
  title · "What it needs" line · step body (inputs) · photo strip · button row **Photos | Back | Next | Cancel** (always same order/place). Disabled buttons show why (reason from the guard, e.g. "Needs the diagonal tape").
- Reuse src/workflow/petri/{engine,guards,loadNet,persist}.ts; drop guided/engine step machinery and actionNet.
- **Glossary + net are the only source of on-screen wording**; a test fails if a screen string is not in them. Update glossary: base point, base grid, photo point, point type, grid north, grid east, diagonal check, two-sleeve post, sleeve separation, 2-point fix, circle test, edge photo, retake, archive. Retire "baseline", "station", "control point" (kept as aliases).

## Tips (advisory, not a step)
- Dismissible tip box under the step body; never disables Next; dismissed per run.
- Fewer than 3 base points: "aim for at least 3 base points around the house".
- Photo point sees only 2 base points: suggests a third roughly perpendicular to the line between them (grid direction), 3–8 m away.
- Base points nearly in a line from the spot: suggests one off to the side.
- Wording in point.net.yaml `hints:`.

## Photo identification
- Unchanged: the existing whole-photo sleeve scan (sleeveScan/sleeveImage/markerSet) runs on each photo point photo after capture; found sleeves become the photo's base point taps.

## Photo strip (every step)
- Thumbnails of all photos in the run, on every step (not just the current photo step).
- Tap → viewer: image, upload/scan status, **Retake** / Close.
- Retake: one-photo retake (generalised retakeOnePhotoInDoc), old photo archived to photos/archive/ by existing rules, camera opens, new photo takes the same slot, re-solve. Roller does not move.

## Files
Keep: src/solver/*, sleeveDetect/sleeveScan(+worker)/sleeveImage/markerSet/photoTaps, circleResult, controlCluster, model/storage/photo* (archive, queue, upload, sync, exif, original), onedrive/msal/cloud*, errorLog, tagsPrint/markers, planSvg, workflow/petri/*, workflow/addPoint/{baselinePoints,strength,commit,context}.ts, guidedRoller wheel (fixed), glossary.yaml, all solver/marker tests.
New: src/screens/{home,stepTemplate,photoStrip,photoViewer,netScreen}.ts + screens.css; step bodies src/screens/steps/*.ts; workflow/circle-test.net.yaml; tests: roller-no-auto-move, retake from each activity, disabled-reason, wording-from-glossary, first base point 0,0, two-sleeve default.
PR1 as built: Add point is net-driven (workflow/point.net.yaml, src/screens/*). Circle test opens the existing circle roller (now with no auto-move, next-needed dot, jitter fix, photo strip on every step); porting it onto the new step template is PR2.
Hidden behind Tools (PR1), deleted (PR2): guidedChrome, guided/engine step machinery, actionNet, field-test.net.yaml/action.net.yaml, workflows/{establishBaseline,measureHouse,milestone,stage2Field}.ts, coach, stage2Checklist, modes; most of ui.ts. Their tests go with them.

## Patch split
- **PR1 "Net-driven Add point + Circle test"**: new nets, step template, photo strip, roller fix, glossary update; Home is the start screen; old UI only via Tools → "Old workflows". Existing tests pass.
- **PR2 "Remove legacy workflow UI"** (after Paul tries TestFlight): delete hidden code, old nets/tests/scripts; update docs/app-overview.md and FIELD_PROTOCOL_CIRCLE.md.

## Risks
- Existing saved runs (roller/guided state locally and on OneDrive) must still load; migration or read-only legacy view needed before PR2.
- ui.ts (6.2k lines, ~144 commands incl. sign-in, upload queue, error log) is the biggest effort/regression risk.
- Retake helpers are tied to guided step ids (retakeAfter, EDGE_PHOTOS_STEP_ID); need a run-agnostic version keeping archive rules.
- Jitter cause not yet reproduced on a phone; fix is from code reading, needs Paul to confirm on TestFlight.
- Existing base points are in the old "baseline" frame; grid-north is whatever frame they already use, so no rotation; just relabel.
- npm test chains check:workflows/field-circle scripts tied to old yaml; PR2 must edit package.json.
- Scan speed (4.8 s vs 2 s cap) still affects every photo.
- PR1 likely large (~2–3k lines); one cloud agent run.
