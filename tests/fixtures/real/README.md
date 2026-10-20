# Real iPhone fixtures for the whole-photo sleeve scan

`tests/sleeveScanReal.test.ts` runs every `*.json` file in this folder. With no files here, it skips.

Each fixture is one photo and its labels:

```json
{
  "image": "left-photo1.pgm",
  "markerIds": ["315", "36E", "459", "6BA", "8A3", "952", "DAC", "EC5"],
  "sleeves": [
    { "id": "315", "axisX": 1834.6, "midY": 1490.2, "bandPx": 9.1 },
    { "id": "36E", "axisX": 2731.1, "midY": 1502.8 }
  ],
  "note": "Left, photo 1, overcast"
}
```

- `image`: an 8-bit binary PGM (P5) next to the JSON, at full resolution and the right way up. To convert a HEIC or JPEG: `magick IMG_0001.HEIC -auto-orient -colorspace Gray -depth 8 left-photo1.pgm`.
- `markerIds`: optional. It defaults to this garden's set (`src/workflows/guided/markerSet.ts`).
- `sleeves`: every sleeve in this garden's set that a person can read in the photo. `axisX` is the sleeve axis at mid-code height, in full-res px, and `midY` is that height. Add `bandPx` (band height in px) where you can. A sleeve labelled under the scan's band gate (`MIN_SCAN_BAND_PX`, 2.5 px) is not counted against recall. Without `bandPx`, a missed sleeve counts as a miss.
- A photo with no sleeves (`"sleeves": []`) is a negative.

The test uses the same pass bars as the simulation:
- no false positives (no ID that is not labelled, and no position more than 3 px from its label);
- recall of at least 95 % over all fixtures, for sleeves the scan could read (bands ≥ `MIN_SCAN_BAND_PX`);
- axis-x error under 0.3 px for bands ≥ 7 px. Real labels are hand-placed, so use a sub-pixel labelling tool, or loosen `AXIS_TOL_PX` in the test and say so.

It also prints the time per photo.
