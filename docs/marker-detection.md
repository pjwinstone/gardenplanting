# Whole-photo sleeve detection — specification

Source: Photo & Marker Vision Reviewer, saved verbatim (20 Oct 2026). The implementation is
`src/workflows/guided/sleeveScan.ts` (pure), `sleeveScan.worker.ts` (Web Worker) and
`sleeveImage.ts` (`scanSleevesFromOriginal`). Tests: `tests/sleeveScan.test.ts`,
`tests/sleeveScanReal.test.ts`. Real iPhone fixtures go in `tests/fixtures/real/` (see the README there).

## Spec (verbatim)

MUST-HAVE: (1) Two stages in a Web Worker, plain TS with typed arrays. Stage A on a ×2 downscale in linear light: horizontal gradient, opposite-sign vertical edge pairs whose width is 4.65±25% of the local band pitch, column vertical-periodicity score (1D autocorrelation, sliding window). Stage B refines each candidate on full-res strips with the existing sleeveDetect path. Hold at most one full-res bitmap. ≤2 s with a time cap that returns partial results. (2) False positives: exact codeword (no correction), sync and stop present, grid RMS ≤0.25 band, width/pitch 4.65±20%, ID in this garden's marker set (pass it in), each ID at most once per photo (duplicates go to manual). (3) Band px: ≥4 px to detect and read the ID (lowered to 2.5 px after Paul's real 8–12 m baseline photos read correctly at 2.8–3.8 px; Stage B skips Stage A tracks whose pitch × 1.5 is under the gate, and the final silhouette width check allows 1 px). Keep the 7 px gate for height/fx; sleeves with 4–7 px bands may be used for their ray but are flagged not-for-CAL. (4) Bearing: axis x at sub-pixel, at mid-code height, as the midpoint of the two linear-light silhouette edges (not the brightest column), plus tilt. (5) Orientation: reuse originalMatchesPreview, and return unavailable on a mismatch.

Fixtures: extend tests/fixtures/sleeveSim.ts with scene backgrounds (fence slats, brick, trellis, striped deck chair), several sleeves, 2–14 m, tilt 5–10°, two sleeves within 0.5 m, partial foliage, at least 5 negatives, and one sleeve not in the set. Pass: zero false positives on the negatives, recall ≥95% for bands ≥4 px, axis-x error <0.3 px for bands ≥7 px. Add a test harness so the real iPhone fixtures can be dropped in later at tests/fixtures/real/ (labelled JSON).

Wire it into the photo tap screen: detected sleeves are drawn labelled with their IDs, taps are pre-filled, and the user presses Save, or taps to add or fix one. Calibration stays one-tap or automatic. Do NOT change the circle/field-test step structure; that redesign waits on the maths advisor.
