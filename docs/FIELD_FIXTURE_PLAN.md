# Field captures as solver fixtures

**Status:** design only. No app change in this note. `ui.ts` stays as it is. Implementation follows a review of this note.

**Reviewers:** the Photo & Marker Vision Reviewer has reviewed section 1. The five blocking items from that review are taken in the first table. The Geometry & Maths Advisor has reviewed section 3 (PR #4). The second table is that review. Section 2 is the import that joins them.

| Photo review | This revision |
|---|---|
| 1. The `capture` file may be transcoded and stripped of EXIF ([WebKit 207088 comment 26](https://bugs.webkit.org/show_bug.cgi?id=207088#c26)) | A probe page is the first implementation step. A still with no `FocalLength` or no `LensModel` is not an archive file. |
| 2. Gravity cannot be sampled at the shutter | Prefer the MakerNote `AccelerationVector`. Otherwise a stillness-checked pair of motion readings, before the chooser and after the file returns. |
| 3. The page’s clock is when **Use Photo** was tapped | The capture time is `DateTimeOriginal` plus `SubSecTimeOriginal`. |
| 4. Intrinsics, pixel centres, click σ, canvas limit | Intrinsics in sensor pixels. Pixel centres at +0.5. Click σ in full-resolution sensor pixels. The click canvas stays inside Safari’s canvas limit. |
| 5. Uploads can overwrite or vanish | `conflictBehavior=fail`, a `quickXorHash` check, `If-Match` on the manifest, and an IndexedDB queue. |

Notes that travel with those five, and are not separate gates:

- A library JPEG passes when `FocalLength` and `LensModel` are present. The capture does not have to stay HEIC.
- If **Take photo** is no-go and **Choose from library** is go, the Camera app takes the still and the page receives it from the library. That is the split in comment 26.
- Two shots in the same second with no `SubSecTimeOriginal` are taken again. The Use Photo clock is not used to order them.
- `quickXorHash` is the Graph check. SHA-256 stays in the manifest for the import.
- A 409 is the same still only when the stored `quickXorHash` matches. Otherwise the name collided.
- The raw MakerNote is not stored. Only the three acceleration numbers.
- The probe prints GPS as yes or no, not as coordinates.
- `clickSpace` is `sensor-continuous`, so the half-pixel is applied once.

| Maths review | This revision |
|---|---|
| 1× field of view. STN02 saw the baseline ends 81.8° apart. STN01 at 7.20 m / 7.20 m needed 67.5°. | STN01 is **8.00 m / 8.00 m** (60°). STN02 moves to **6.50 m from BAS01 and 9.00 m from BAS02** (59.6°). Every photo in the field sheet is checked against a **67°** landscape frame, which is the narrow end of 1× (`fx/width` 0.75; 0.69 is about 72°). The spare on each side is stated in §3.0. |
| STN02’s second turn saw no known mark. | That turn is gone. STN02’s second photo keeps **BAS02**. CRC04 is not photographed from STN02. |
| The solver needs the side of the baseline. | Datum is BAS01 at the origin, BAS02 on +X, matching the sheet order BAS01–BAS02. Paul ticks left or right looking from BAS01 toward BAS02. The importer writes the index. |
| The lens must be on the pole axis. | `phonePole.lensOnAxis`. The field sheet says to sight the lens over the middle of the pole before plumbing. |
| The circle fit must use the joint covariance. Per-point covariance makes `σ_R` about 1.6–2.5× too small. | §3.2 still fits with the joint cofactor. On this network that σ is **15.0 mm**. The per-point blocks give **14.4 mm**, about 4% optimistic, not 1.6–2.5×. |
| Add about 6 mm of per-stick scatter. | `σ_stick = 6 mm` inside that `C`. |
| Use `σ_setout ≈ 4 mm`. Keep the 3.29 single-point threshold. | `radiusSigmaM` is **0.003**, the common set-out only. The 6 mm stick term stays in `C` and is not counted again. `w_i` and 3.29 are unchanged. |
| Withheld tapes need `σ ≈ 9 mm`, including lean. | That 9 mm was a ground tape. These checks are sleeve to sleeve, so lean cancels. `CHK-BASE` is **5 mm**. The figure checks are **5 mm** and are diagnostics, not the grade. |
| The circle test cannot see a baseline blunder. | The laser baseline is withheld (`CHK-BASE`). The two tape pulls must agree within 10 mm. |
| A pass or fail requires STN03. The fixture’s shared-`fx` flag is false. | Two-station captures are reported and not graded. Completeness requires `fxSharedInSolve: false`. It does not require `fxShared: true`. |

**Field sheet:** [FIELD_PROTOCOL_CIRCLE.md](FIELD_PROTOCOL_CIRCLE.md).

**Depends on:** the phase 1 solver on this branch, [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md), [ROADMAP.md](ROADMAP.md) Phase 1 item 4, and the marker maths in `docs/MARKER_VISION_DESIGN.md` §3 and §6 on `cursor/architecture-roadmap-fe5c` at commit `16fd350`. This note does not change that branch and does not change the survey method in `AGENTS.md`.

The skipped fixture `fixtures/field-circle-baseline/garden.json` stays absent until a real capture is imported. Do not invent it.

## 1. Archive each photo beside the survey file

The app is a PWA in iPhone Safari. It saves one personal OneDrive JSON file. A capture that can be re-solved, or read without the app, needs the original stills as ordinary image files next to that JSON, plus the angles, the baseline, the stations, and the per-photo metadata.

### 1.1 What is saved today

OneDrive is a single PUT of the garden document.

| Piece | Today |
|---|---|
| Folder | `/Garden Survey/` (`ONEDRIVE_FOLDER`) |
| File | `garden-v{version}.json`, default `garden-v1.json`. Legacy `garden.json` still loads. |
| Write | `PUT .../content` as `application/json`. Last upload wins. No etag. |
| Read | Rejects `version !== 1`. `normalizeDocument` keeps extra fields on points, lines, and photos, because those arrays are copied through. |
| List | `children` filtered to `.json` only. A sibling image is invisible to the file picker. |
| Local cache | `slimDocumentForLocalCache` drops any `thumbnailDataUrl` that is a JPEG, PNG, or WebP data URL. localStorage keeps geometry and metadata. |
| Permission | Delegated `Files.ReadWrite` already covers a sibling folder and binary PUT. No new Graph scope. |

Microsoft Graph simple upload (`PUT` content) stops at **4 MB**. A 12 MP HEIC is often 1–3 MB, so one still usually fits a simple PUT. A still over 4 MB needs an upload session. A garden JSON that inlined those stills as base64 would pass 4 MB quickly and would not be a file you can open in Photos.

`Photo` in `model.ts` is `id`, `setupId`, `addPointId`, `yawOnly`, `thumbnailDataUrl`, `width`, `height`, `clicks`, `sightedBaselineId`, optional `exifDateTimeOriginal`, `note`, `pose`, `estimate`. There is no file name, no gravity, no `fx`, no sleeve height, and no bubble. The phase 1 adapter in `solver/document.ts` reads optional `fxOverWidth` and `gravity` if they happen to be on the object, and it skips a photo with no `fxOverWidth` (`no-fx`). Stored `x,y` are not observations. v1 `offsetMm` is not applied.

### 1.2 What Safari and this capture path actually keep

Two paths, both ending in a canvas JPEG.

**In-app shutter (the usual path).** `openInAppCamera` calls `getUserMedia` (`facingMode` environment, ideal 1920×1440). The shutter draws the `<video>` frame and `canvas.toDataURL('image/jpeg', 0.72)` with the long edge capped at **640 px** (`videoToThumbnailDataUrl`).

- There is no still and no EXIF. A video frame has no `DateTimeOriginal`, no `Orientation`, no `FocalLength`, no `FocalLengthIn35mmFormat`, no GPS, and no camera model.
- `ImageCapture.takePhoto()` is the API that would return a camera still. Safari on iOS does not implement it (no support through Safari 26). The canvas fallback is the only in-app shutter.
- The JPEG is display-oriented only in the sense that it copies the video element’s pixels. Nothing writes an orientation tag. iOS does not hand the page a 4032×3024 still on this path. The marker note treats a 1920-wide preview as already too small to be the detection image. 640 px is smaller than that.
- Zoom is not locked. The constraints do not force the 1× lens, so the ultra-wide can be the stream.
- Gravity is not sampled. `DeviceMotion` is never read.

**System camera fallback.** `<input type="file" accept="image/*" capture="environment">` does receive a `File`. That file can be a real still.

- With `accept="image/*"` and no explicit HEIC type, iOS often transcodes a library HEIC to JPEG before the page sees the file. A fresh shutter from `capture` may arrive as JPEG or as HEIC, depending on iOS and on High Efficiency versus Most Compatible. `file.type` and the extension are not reliable. Sniff the bytes: JPEG starts `FF D8 FF`; HEIC is an ISO-BMFF `ftyp` whose brand is `heic`, `heix`, `mif1`, or `msf1`.
- While that `File` exists, its bytes are the original still, EXIF included, orientation tag included.
- The app then discards them. `fileToThumbnailDataUrl` runs `createImageBitmap(file)` and draws a canvas JPEG at quality 0.7 with the long edge capped at **360 px**. `createImageBitmap` applies EXIF orientation by default (`imageOrientation: 'from-image'`), so the bitmap is upright, and the canvas encode writes no EXIF at all. The `File` is not retained.
- Clicks are stored in that thumbnail’s pixel space. `width` and `height` on the photo are the thumbnail’s natural size, or the 1200×900 default if the decode failed.

**Timestamps.** `exifDateTimeOriginal` is not parsed from EXIF. The canned baseline tie sets it to `new Date().toISOString()`, which is the app clock. The + Point path in `layers.ts` does not set it.

**What actually arrives.** Uploading the `File` unchanged is necessary and not sufficient. [WebKit bug 207088 comment 26](https://bugs.webkit.org/show_bug.cgi?id=207088#c26) reports the split that still matters: a photo **chosen from the library** can keep its embedded metadata, and a photo taken through the page’s camera chooser (**Take Photo**, then **Use Photo**) can have that metadata removed before the page ever sees the bytes. iOS may also transcode HEIC to JPEG on the way in. `file.type` does not tell you which happened.

| Path | Bytes the page can keep | `FocalLength` and `LensModel` | Usable as the archive |
|---|---|---|---|
| In-app `getUserMedia` + canvas | Derived JPEG only | Never | No |
| File input, then canvas, as today | Derived JPEG | Stripped by us | No |
| `<input capture>` (new photo in the chooser) | Whatever iOS hands over | **Often missing.** Comment 26. | Only if the probe says go |
| File input, chosen from the library | Often a JPEG transcode of HEIC, sometimes HEIC | Often present, including after the iOS 16.4 library path | Only if the probe says go |

A library that copies tags onto the canvas JPEG can store an app clock. It cannot restore `FocalLength` or `LensModel`. That file is `canvas-derived`.

**Archive rule.** Keep the `File` bytes, sniff them, and read the EXIF without drawing the archive to a canvas. The still is an archive file only when the probe’s go rule passes for **the same path** the session will use. A missing `FocalLength` or a missing `LensModel` fails closed: the photo is not uploaded as a fixture still, the coach says which path failed, and no focal length is invented. A JPEG that still has both tags is acceptable. HEIC is not required.

The in-app shutter can stay as a preview. It is not a fixture photo. Fixture stills are 1× on one phone for the whole session, including the calibration shot. Every still in that session must carry the same `LensModel`. A second lens fails the capture.

### 1.2.1 Probe page — first implementation step

Nothing else in section 1.6 is built until this page has been run on the phone that will do the survey, and the path below has come back **go**. The page does not upload, does not write OneDrive, and does not put the photo in the garden JSON.

Two actions, and no others:

1. **Take photo** — `<input type="file" accept="image/jpeg,image/heic,image/heif" capture="environment">`.
2. **Choose from library** — the same `accept`, **without** `capture`.

For the chosen file the page sniffs the bytes and reads EXIF from those bytes (a parser that understands JPEG APP1 and HEIC `Exif`, not a canvas). It shows:

| Shown | Why |
|---|---|
| Sniffed type, byte length, stored width and height | A resized “Small” or “Medium” is not the 1× still. |
| `FocalLength`, `FocalLengthIn35mmFilm`, `LensModel` | The go/no-go pair, plus the 35 mm prior. |
| `DateTimeOriginal`, `SubSecTimeOriginal`, `OffsetTimeOriginal` | The shutter clock. |
| Orientation, `PixelXDimension`, `PixelYDimension` | Sensor grid for clicks. |
| MakerNote `AccelerationVector` | Present or absent. The three numbers if present. |
| GPS | **Yes or no only.** The probe does not print coordinates. |

**Go**, for that button’s path, only when all of these hold:

- `FocalLength` is present and numeric.
- `LensModel` is present and non-empty.
- `DateTimeOriginal` is present.
- The longer stored side is at least **3000 px** (a full 1× still, not a Small/Medium transcode).

**No-go** otherwise. The page says “this path cannot archive a fixture” and does not offer a way to continue with that file. Missing `SubSecTimeOriginal` is not a no-go by itself. It is shown, and two photos that share a `DateTimeOriginal` with no sub-second are not given an invented order (section 1.3).

The field session uses a path that returned **go** on that phone. Comment 26’s practical split is the expected one: **Take photo** may be no-go, and **Choose from library** may be go. In that case the Camera app takes the still (rear camera, 1×) and the page then receives it from the library. If both buttons are no-go, the fixture capture waits. There is no third path.

### 1.2.2 Time, gravity, and sensor coordinates

**Time.** `DateTimeOriginal` plus `SubSecTimeOriginal` is the shutter time, with `OffsetTimeOriginal` when the file has it. The `File`’s `lastModified`, and the moment the `change` event runs, are when **Use Photo** or the library row was tapped. Those go in `appReceivedAt` and are never copied into `exifDateTimeOriginal`. The filename uses the EXIF clock (section 1.3).

**Gravity.** The page cannot see the shutter. `DeviceMotion` at the `change` event is the phone after the system camera UI, not the phone that took the picture.

- If the still has MakerNote `AccelerationVector`, that vector is the gravity record. `gravity.source` is `makernote`. The raw MakerNote blob is not stored. It carries serial numbers. Only the three components are copied, and `gravity.frame` stays `apple-makernote` until the camera-axis map in [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md) §9 is checked against a probe still. Do not relabel it `(0, +1, 0)`.
- If the vector is absent, the fallback is a **bracket**, not a shutter sample. Start `DeviceMotion` when the button is pressed, keep the samples from the half-second before the chooser opens, and take another half-second after the file returns. `gravity.source` is `motion-bracket` only when both windows are still: each window’s gravity direction stays inside **2°**, the two medians agree inside **2°**, and the magnitude stays near 1 g. The stored vector is the mean of the two medians, with both medians and the angle between them kept beside it. If the check fails, `gravityUsable` is false and the rays stay unlevelled. A bracket is never labelled `makernote`.
- When both exist, keep both and use the MakerNote vector for the solve.

**Coordinates.** Intrinsics and clicks live in the **stored sensor grid**, the pixels in the file before the orientation tag is applied. `fx`, `fy`, `cx`, and `cy` are in those pixels. `fx / width` uses that stored width.

A tap hits a pixel. The measurement is the **centre** of that pixel: stored index `(i, j)` is the continuous point `(i + 0.5, j + 0.5)`. The principal point uses the same continuous frame. The solver reads those continuous values and does not add 0.5 again. `clickSpace` is `sensor-continuous`.

The upright picture the user sees is the sensor grid after the orientation tag. Map the upright pixel back to the stored pixel with the inverse of that tag, then add 0.5. One check from the probe still, before any solve uses the clicks: orientation **1**, tap on the top-left pixel, stored click `(0.5, 0.5)`. Orientation **6** (0th row is the visual right side, 0th column is the visual top): the visual top-left pixel is the stored top-right pixel. That case is checked on a real still. The other six tags use the same EXIF rule and the same corner check.

**Click σ** is in those full-resolution sensor pixels. The geometry note’s about **2 px** is 2 sensor pixels on the 1× still, and only when the tap was placed at that resolution. A tap on a scaled canvas is wider. If the click canvas is downscaled by an integer factor `s`, `σ_sensor = s × σ_tap`, and `σ_tap` is at least half a canvas pixel. That `σ_sensor` is what the ray uses. A 2 px sensor σ is not written for a tap on a 640 px preview.

**Canvas limit.** The archive bytes are never drawn to a canvas. The click surface may use one. Safari’s limit is on the **backing store**, not the CSS box, and `devicePixelRatio` must not multiply it (set the buffer size explicitly, density 1).

| iOS | Max side | Max area |
|---|---|---|
| 17 and earlier | 4096 | 16,777,216 |
| 18 and later | 8192 | 67,108,864 |

A 4032×3024 still fits both. A 48 MP still fits the iOS 18 area and side, and does not fit iOS 17. If the oriented bitmap would exceed the limit on that phone, the click canvas is an integer downsample and `s` scales the click σ. Exceeding the limit fails the canvas; it does not silently clip the still.

### 1.3 Folder layout and file names

The garden JSON remains the one survey document. Stills sit in a sibling folder whose name is the file stem.

```
/Garden Survey/
  garden-v1.json
  garden-v1/
    manifest.json
    photos/
      20261003T142201Z_ph-m3k_STN01.heic
      20261003T142244Z_ph-m3p_STN01.heic
      20261003T141502Z_ph-cal_CAL01.jpg
```

Legacy `garden.json` uses the folder `garden/`. A later `garden-v2.json` uses `garden-v2/` and does not move the old stills.

**Names.** `{exifUtc}_{photoId}_{stationId}.{ext}`

- `exifUtc` is `DateTimeOriginal` plus `SubSecTimeOriginal`, written `YYYYMMDDTHHMMSS.sssZ` after applying `OffsetTimeOriginal` when the file has it. No colons. This is the camera clock, not the Use Photo tap.
- If `SubSecTimeOriginal` is missing, the name has no fractional part. A second file with the same `DateTimeOriginal` and no sub-second is a no-go for that pair: the page asks for the shot again. It does not number them from `appReceivedAt`.
- `photoId` is the id already on the photo record, restricted to letters, digits, and hyphen.
- `stationId` is `addPointId` (yaw-only photos share it). The calibration shot uses its own id.
- `ext` comes from the sniff, `.jpg` or `.heic`, not from `file.type`.

The bytes are immutable. A new shutter is a new photo id and a new file. Re-saving the JSON does not overwrite a still. The manifest is rewritten to match the document.

### 1.4 Manifest, and the metadata on each photo

`manifest.json` is the index a person can read without the app. The garden JSON repeats the same fields on each photo (`captureFile` and the block below) so one file still opens in the app if the manifest is missing. The manifest is canonical for the hash.

```json
{
  "schema": "garden-capture-manifest/1",
  "surveyFile": "garden-v1.json",
  "documentVersion": 1,
  "phone": {
    "phoneId": "paul-iphone",
    "lens": "1x",
    "fxSharedInSolve": false,
    "calibrationPhotoId": "ph-cal"
  },
  "photos": []
}
```

One phone, one 1× lens, one calibration photo. A second `phoneId` is an error, not a second calibration. `fx` is not written as a derived number. The calibration photo contributes raw observations (section 1.4.1). An EXIF `FocalLengthIn35mmFormat`, when the still has it, is stored as a prior only (`fx/width` about 0.69–0.75). It is not the calibration.

`fxSharedInSolve` is **false**. The phase 1 solver gives every photo its own `fx`. The capture is still one phone, so a later shared-`fx` solve has the raw calibration, but this fixture does not claim that today’s solve shared `fx`. Completeness requires the flag to be false. It does not require `fxShared: true`.

Each photo entry:

| Field | Meaning |
|---|---|
| `photoId`, `file`, `sha256`, `quickXorHash`, `byteLength`, `mime` | Identity of the untouched still. `sha256` is for the repo import. `quickXorHash` is what Graph returns and what the upload check compares. |
| `provenance` | `original-still` only after a probe **go**. `canvas-derived` is never a fixture still. |
| `exifPreserved` | True only when the bytes were not re-encoded **and** the go rule passed (`FocalLength` and `LensModel` present). |
| `lensModel` | EXIF `LensModel`. One value for the whole capture. |
| `width`, `height` | Stored sensor pixels, before orientation. |
| `orientedWidth`, `orientedHeight`, `exifOrientation` | The upright view. Clicks are stored after the inverse map, in sensor pixels. `clickSpace` is `sensor-continuous`. |
| `exifDateTimeOriginal` | `DateTimeOriginal` plus `SubSecTimeOriginal`, and `OffsetTimeOriginal` when present. Null if the probe would have been no-go. |
| `appReceivedAt` | When the page received the file. This is the Use Photo or library tap. Not the shutter. |
| `setupId`, `stationId`, `yawOnly`, `sightedBaselineId` | Same meanings as the garden JSON. Yaw-only photos share `stationId`. |
| `gravity` | `{ x, y, z, source, frame, usable }`. `source` is `makernote` or `motion-bracket`. `frame` is `apple-makernote` or `devicemotion-raw`. `usable` is false when the bracket failed the stillness check. The solver’s camera frame, about `(0, +1, 0)`, is not written until §9 of the geometry note is checked. |
| `phonePole` | `{ plumbOk, leanBoundDeg, poleHeightM, lensOnAxis }`. The survey pole, plumbed with a bubble to about 1°. `lensOnAxis` is true only when the lens glass, not the middle of the phone, was over the pole centre. |
| `clicks[]` | `{ pointId, px, py, sigmaPx, sleeveHeightM, sleeveRadiusM, plumbOk, leanBoundDeg }`. `px`, `py` are `sensor-continuous` (pixel centre at +0.5). `sigmaPx` is the click σ in full-resolution sensor pixels. |

**Sleeve height and the bubble live on the click, because they belong to the rod in that photo, and on the photo, because the pole was plumbed for that shutter.**

- `sleeveHeightM` is `h_s`, metres, ground to the **centre of the sleeve**. The same rod keeps one height for the session; copy it onto every click of that rod so the photo entry stands alone. The marker note’s ground shift is `h_s sin λ`: **17 mm at 2° when `h_s` is 0.5 m**, 9 mm at 1°, 35 mm at 2° if the sleeve centre is 1.0 m up. Record the height you measured, not a default.
- `sleeveRadiusM` is that stick’s measured `R`, in metres. The sleeve is glued snug round a 60 mm dowel, so the expectation is about 30 mm. Stock and glue move it. Measure each finished sleeve and store that value on the point and on every click of that point. Do not fill in 30 mm, and do not share one `R` across the capture. The design is `MARKER_VISION_DESIGN.md` on PR #2. A thinner stick stores its own measured `R` the same way.
- `plumbOk` and `leanBoundDeg` are the rod bubble. The field rule is about **1°**. With the bubble, the along-sight lean that one photo cannot see is carried as `σ_λ` of about 1–2°. `plumbOk: false` does not enter this fixture; the rod is replumbed first.
- `phonePole` is the camera pole, separate from the target rod. A 1° lean on a 1 m pole is 17 mm at the ground. `lensOnAxis` is a different error: an iPhone lens near a corner is about 20–50 mm off the middle of the phone. That offset is a lateral bias on every ray from the station. The field sheet has the surveyor sight the lens over the pole centre before the bubble. A photo with `lensOnAxis` false does not enter this fixture.

The garden point for that rod stores the same `sleeveHeightM`, `sleeveRadiusM`, `plumbOk`, and `leanBoundDeg`, so a tape can find them without opening a photo.

#### 1.4.1 Calibration photo

One still in the same capture, same `phoneId`, lens `1x`, rod plumbed, sleeve height recorded. The taped distance is **3–5 m** from the **lens** to the axis. The field protocol uses 4.000 m.

Store the raw pieces, not a computed `fx` and not a range derived from `h_px · d / H`:

| Field | Meaning |
|---|---|
| `kind` | `shared-fx` |
| `rodPointId` | The plumbed rod in the frame. |
| `slopeM`, `deltaHM` | Tape as read, and the height difference. Level tape: `deltaHM` 0. |
| `horizontalM` | `√(slope² − Δh²)`, computed and stored so the sheet can be checked. |
| `radiusM` | `R` added **after** the horizontal reduction. One end is the lens, so this is `+R` once. |
| `from` | `lens` |
| `to` | `axis` |
| `sheetHeightM` | Measured sheet height if the paper was trimmed, else 0.297 m. |
| `sleeveHeightM`, `plumbOk`, `leanBoundDeg` | As on any rod. |

Publishing `fx = h_px · d / H` from this same photo and then using that `fx` on this photo counts the pixels twice. A later adjustment that estimates one `fx` for the phone would consume the tape, the levelled elevations of the sleeve ends, and `H`. This fixture’s solve does not do that. `fxSharedInSolve` stays false, and each photo keeps its own EXIF prior. The circle test fails closed if the calibration photo is missing or if any fixture photo is `canvas-derived`. The calibration shot is still required. It is the raw material for that later estimate, and it is not a derived focal length.

#### 1.4.2 Tapes in the metadata

A tape that enters the solve is a line in the garden JSON plus a copy in the manifest under `distances[]`: `id`, `a`, `b`, `instrument`, `slopeM`, `deltaHM`, `horizontalM`, `endsOnSleeve`. The `R` added for an end is `sleeveRadiusM` of that point, not a radius shared by the tape. The laser baseline is not one of those lines. It is `CHK-BASE` in `ground-truth.json`, withheld. Putting it in `lines` would make `solveGardenDocument` treat it as a used distance.

Approved reduction, from the marker note §3: horizontal first, then `+R` for each end that stopped on the paper. `R` is the sleeve’s measured R (about 30 mm, see MARKER_VISION_DESIGN.md) for **that** stick. Both ends on sleeves means add each end’s own `R`. A laser spot more than about **`R/2` (15 mm at the expected radius)** off the rod centreline is not a measurement; it is retaken. The spot offset is not a stored correction. The stored correction is the measured `R`.

The phase 1 helper `horizontalDistance` adds `faceOffsetM` onto the slope and then takes the square root. On a level tape that is the same as adding `R` afterwards. On a slope the two differ by about 2 mm for this sleeve at 20°. This fixture holds tapes level, so they agree. The importer still stores slope, `Δh`, and `R` separately and builds the solver length as `√(s² − Δh²) + nR`. It does not pass `R` through `faceOffsetM`.

v1 `offsetMm` stays **0** on these points. The current Layer A path shifts `y` by that scalar, and the phase 1 adapter does not apply it. The sleeve’s measured R is the tape correction above, not that box.

### 1.5 One file, and schema v1 / v2

Roadmap decision 11 stands: one active garden file, personal OneDrive, last JSON upload wins, no backend. The sidecar folder is not a second survey. The app still loads `garden-v1.json` and only that.

Roadmap decision 10 and [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md) §6: bump to `version: 2` when offset direction, gravity-on-photo, unset-versus-zero, and the new layer ids change the document. Keep loading v1.

**This archive does not bump the version.** The loader rejects anything other than `version: 1`, and a capture has to open in the current app. New photo and point fields are optional and already survive `normalizeDocument`. Formalising gravity, `fx/width`, sleeve height, and the bubble as required fields waits for that same v2 bump, together with a real offset direction. A v1 file from this capture remains a valid fixture after v2, because v1 keeps loading.

`thumbnailDataUrl` stays the small plan thumb. The archive file is the still. localStorage keeps dropping heavy thumbs.

**Queue.** The still is written to IndexedDB **before** any network call. Database `garden-survey-capture`, store `outbox`, key `photoId`. The value holds the blob, the metadata, `sha256`, `quickXorHash`, and a state `pending`, `uploading`, `uploaded`, or `failed`. Safari may kill the PWA. The queue is what survives. localStorage is not used for the blob. On the next launch, if signed in, the queue drains. A blob is deleted only after the hash check and the manifest update have both succeeded.

**Upload of a still.** Simple PUT under 4 MB, otherwise an upload session. The request uses `@microsoft.graph.conflictBehavior=fail`, so an existing name is a 409 and not a silent replace. On 409, GET the item and compare `file.hashes.quickXorHash` with the hash of the bytes just queued. A match means this still is already there. A mismatch fails closed: the name collided with different bytes, and that photo id is not reused. On a 2xx, GET the item and require the same `quickXorHash` match before the photo is called uploaded. SHA-256 is computed on the device as well and stored in the manifest. It is not the Graph check. Graph does not return SHA-256.

**Manifest.** GET `manifest.json` and keep its `eTag`. PUT with `If-Match` set to that tag. The first create uses `If-None-Match: *`. A 412 means the manifest changed: read it again, union photo entries by `photoId`, and retry. The manifest is not last-upload-wins. The garden JSON stays last-upload-wins, which is roadmap decision 11. The JSON is written after the manifest and never points at a still whose hash check has not passed. A failed still does not block the geometry save. The coach names the photos still in the outbox.

Detaching a point marks the manifest entry `detached` and leaves the file. A later tidy can delete detached files. That tidy is a deliberate action.

### 1.6 What the first implementation has to add

Not in this change. The order is fixed. Step 1 is the gate.

1. **Probe page**, as in §1.2.1, on the survey phone. **Go** only with `FocalLength`, `LensModel`, `DateTimeOriginal`, and a longer side of at least 3000 px, on the path the session will use. **No-go** stops that path. No archive code is written until a path has returned go on that phone.
2. IndexedDB outbox, then PUT with `conflictBehavior=fail`, then the `quickXorHash` check, then the manifest with `If-Match`.
3. Read `DateTimeOriginal` and `SubSecTimeOriginal` from the bytes. Store `appReceivedAt` separately.
4. Gravity from MakerNote `AccelerationVector` when present, otherwise the stillness bracket. Never a single reading at the `change` event.
5. Clicks in `sensor-continuous` pixels, σ in full-resolution sensor pixels, click canvas inside the Safari limit in §1.2.2.
6. Sleeve height, the measured sleeve radius of that stick, and the rod bubble on the point and on each click. `phonePole` on the photo, including `lensOnAxis`. Calibration block as raw tape, `Δh`, `R`, `H`, and sleeve height. One `LensModel` per capture. `fxSharedInSolve` false.
7. Extend the OneDrive list so the sibling folder is recognised, without making a second garden document.

## 2. Turn a capture into a fixture

### 2.1 Node script, not an in-app export

**Recommendation: a Node script** in `scripts/`, run on a computer against a downloaded copy of the OneDrive folder. CI does not log into Graph.

| | Node script | In-app export |
|---|---|---|
| Where it runs | Laptop, after the session | iPhone Safari, during the session |
| Commit | Writes a folder you commit | Produces a download you still have to commit |
| Ground truth | Reads a sheet you fill in after you have walked the circle | Would have to ask for the known radius in the field UI |
| Privacy | Allow-list. Anything not on the list is dropped, including location | Easy to embed the stills and the EXIF location in a share file |
| App code | None. `ui.ts` is untouched | Another path through the dialog Paul is editing |
| CI | `npm test` already runs on the Pages workflow | The phone cannot run the solver test |

The script is `scripts/import-field-capture.mjs`. Inputs are a local directory (the downloaded `garden-v1.json` and `garden-v1/` folder) and a `ground-truth.json` the field sheet tells you to fill. Output is `fixtures/field-circle-baseline/`. It refuses to invent a radius, and it refuses to overwrite an existing fixture without `--force`.

An in-app button that downloads the JSON you already have does not do this job. The app keeps saving the survey. The script is the only step that decides what is a test.

### 2.2 What goes in the repo

Default fixture, committed:

```
fixtures/field-circle-baseline/
  garden.json          survey document, thumbnailDataUrl removed
  manifest.json        copy, file names kept, no Microsoft account fields
  ground-truth.json    the sheet below
  NOTES.md             build stamp, weather, which end is near, anything the JSON does not hold
```

**Photos are not committed.** A session of full stills is tens of megabytes, and the EXIF can carry GPS and a camera serial. The circle test uses clicks, tapes, gravity, sleeve height, and the bubble. It does not open the pixels. OneDrive remains the pixel archive.

`--keep-photos` copies stills into `fixtures/field-circle-baseline/photos/` after deleting the GPS IFD, for a local look by the vision reviewer. That folder stays out of git unless a later change deliberately adds a sample. The circle CI test does not read it.

`garden.json` keeps points, baselines, lines that were **used** in the solve, photos (clicks, `fx` prior if present, gravity, sleeve fields, `captureFile`), setups, and the circle item. Check tapes are **not** copied into `lines`. If they were, `solveGardenDocument` would treat them as ordinary distances. They live only in `ground-truth.json`, and the test appends them as `withheld: true`.

`name` in the document is rewritten to `field-circle-baseline`. Session speech flags and coach prose can stay.

The baseline check script on main, `scripts/check-field-circle-baseline.mjs`, is still a placeholder. `npm run test:field-circle` exits 0 while `fixtures/field-circle-baseline/garden.json` is absent. When a file is present it only checks that a baseline exists and that at least three points have coordinates, and it warns if no circle item is set. It does not run section 3. The field case in `tests/phase1-solver.test.ts`, once PR #3 is merged, is the same kind of skip. Those placeholders are replaced by section 3 when a real `garden.json` arrives. They are not the test.

### 2.3 Ground truth

Written by the surveyor, not fitted by the script. The known radius is not an observation.

```json
{
  "radiusM": 4.0,
  "radiusSigmaM": 0.003,
  "setOut": "peg and non-stretch line, both diameters and the closing chord inside the sheet limits",
  "circlePointIds": ["CRC01", "CRC02", "CRC03", "CRC04", "CRC05", "CRC06"],
  "nearBaselineEndId": "BAS02",
  "farBaselineEndId": "BAS01",
  "pegToNearEndM": 4.3,
  "phoneId": "paul-iphone",
  "lens": "1x",
  "fxSharedInSolve": false,
  "calibrationPhotoId": "ph-cal",
  "sleeveRadiusM": {
    "CRC01": null,
    "CRC02": null,
    "CRC03": null,
    "CRC04": null,
    "CRC05": null,
    "CRC06": null,
    "BAS01": null,
    "BAS02": null,
    "CAL": null
  },
  "sigmaM": {
    "baseline": 0.003,
    "stationTape": 0.010,
    "checkBaseline": 0.005,
    "checkFigure": 0.005
  },
  "sigmaStickM": 0.006,
  "datum": { "originId": "BAS01", "axisPointId": "BAS02" },
  "baselinePullsAgreeWithinM": 0.01,
  "gradeRequiresStationIds": ["STN01", "STN02", "STN03"],
  "branchChoices": [
    { "id": "STN01", "candidateIndex": 0, "side": "left" },
    { "id": "STN02", "candidateIndex": 1, "side": "right" },
    { "id": "STN03", "candidateIndex": 1, "side": "right" }
  ],
  "build": "",
  "withheld": [
    {
      "id": "CHK-BASE",
      "a": "BAS02",
      "b": "BAS01",
      "instrument": "laser",
      "sigmaM": 0.005,
      "tapedAt": "sleeve",
      "slopeM": null,
      "deltaHM": null,
      "note": "laser baseline, sleeve to sleeve; not typed into the app; the tape mean is the observation; add sleeveRadiusM of each sleeved end"
    },
    {
      "id": "CHK-DIA",
      "a": "CRC01",
      "b": "CRC04",
      "instrument": "tape",
      "sigmaM": 0.005,
      "tapedAt": "sleeve",
      "slopeM": null,
      "deltaHM": null,
      "note": "fresh diameter, sleeve to sleeve; axis length is horizontal plus sleeveRadiusM of CRC01 and of CRC04; diagnostic, not a grade failure"
    },
    {
      "id": "CHK-CHORD",
      "a": "CRC01",
      "b": "CRC03",
      "instrument": "tape",
      "sigmaM": 0.005,
      "tapedAt": "sleeve",
      "slopeM": null,
      "deltaHM": null,
      "note": "120° chord, sleeve to sleeve, about 6.93 m axis to axis; add sleeveRadiusM of CRC01 and of CRC03; diagnostic, not a grade failure"
    }
  ]
}
```

`slopeM` and `deltaHM` are the fresh pulls from the sheet. The script does not invent them. `sleeveRadiusM` is the measured R of that stick, copied from the sheet into the point and into each click of that point. A null in this example means the sheet has not been copied yet. The script does not write 0.030. `radiusSigmaM` is the common set-out σ, **3 mm**. The 6 mm stick term is already in `C` (§3.2). Putting it in `radiusSigmaM` as well counted it twice; the old 4 mm did that (about `√(3² + 5.8²/6) ≈ 3.9 mm`). The difference on the radius limit is under 1 mm, and it is still the wrong place for that term. `pegToNearEndM` is the taped distance from the centre peg to the near baseline end, so the “circle approaches this end” check has a number. The peg is not a solved point.

**Datum.** `originId` is BAS01 and `axisPointId` is BAS02. BAS01 is `(0, 0)`. BAS02 lies on `+X`. That is the sheet order, baseline BAS01–BAS02, and it is what `solveGardenDocument` does when the baseline’s `a` is BAS01. The other order, origin at BAS02, is not this fixture. Swapping the ends and keeping these indices unsets the net.

**Sides.** Paul ticks left or right while standing at BAS01 and looking toward BAS02. He does not tick a number. The peg is on the **right** in that view. STN02 and STN03 are on the right with the peg. STN01 is on the left.

`candidateIndex` is the index from `intersectCircles(BAS01, tape to BAS01, BAS02, tape to BAS02)`. With BAS02 on `+X`, index **0** is `+Y`, which is the **left** as you look from BAS01 toward BAS02. Index **1** is the **right**. So STN01 is 0 and STN02 and STN03 are 1. The importer derives the index from the tick and from this datum order. It does not copy the index off the sheet, and it does not guess it from a stored coordinate.

Those indices are the opposite of the earlier note, which defined them with BAS02 as the origin. Using 1, 0, 0 under a BAS01 origin contradicts each station’s own two-mark bearings.

PR #3 at `637b45f` reads `branchChoices` for a both-tapes station. Candidate 0 is +Y of origin→axis and candidate 1 is −Y. An index that agrees with the station’s own two-mark bearings is used. An index that contradicts them unsets that station as `branch-conflict`. The index does not override the photo. The old 1, 0, 0 does that on all three stations. The fixture still records the index from the tick. A click order is a worse place to keep the side than the tick.

`reflected` at `637b45f` counts only an axis that came out with `x < 0`, and points that took their side from the garden-sign fallback. Bearings, rays, and branch choices are not counted, so a garden that really lies on −Y is not flagged. A correct solve of this fixture reports `reflected: false`. `reflected: true` fails the grade. It means the datum came out backwards, or a distance-only point landed on the wrong side.

`baselinePullsAgreeWithinM` is the field gate on the two tape pulls. The mean of the two axis lengths is the baseline in the app, stored with `sigmaM.baseline` of **3 mm**. A pair that differs by more than 10 mm is remeasured, not averaged. A 10 mm limit on the difference of two pulls is `1.96 √2 σ_pull`, so each pull is about **3.6 mm**. The mean of two such pulls is about **2.5 mm**. The stored 3 mm sits just above that, for the level and the sleeve correction. The solver’s unset-tape default is 20 mm. At 20 mm only about 27% of good pulls would pass the 10 mm rule, so that default is not written on this baseline.

Station tapes are one pull each, from the pole to the sleeve, and the long ones are 10.5 m. They are stored at **10 mm** (`sigmaM.stationTape`), the top of the 5–10 mm band. Five millimetres would suit the short level legs and not the 10.5 m ones. Ten millimetres is also the station-tape σ in the trial quoted in §3.3, so the pass rates there belong to this number. Twenty millimetres is not used: a check against a 20 mm network cannot see a 20 mm baseline blunder.

`baselinePullsAgreeWithinM` is not a substitute for `CHK-BASE`. A baseline that is long by the same amount both ways still agrees with itself, and the circle test barely moves, because the station tapes carry the scale. The withheld laser is what sees that blunder.

**Check σ, and where the tape is held.** All three withheld lengths are sleeve to sleeve, the same height as the solved sleeve centres. The lean `√2 · h_s · σ_λ` belongs only when a length is taken at the ground and the solved point is the sleeve. It does not belong here, so the old 9 mm figure is withdrawn.

`CHK-BASE` is **5 mm**. The laser itself is about 2–3 mm, and a dot half a radius off the centreline can still bias the range by about 4 mm. Five millimetres covers both. On the measured grade a baseline typed 20 mm long is caught **94%** of the time. A good laser fails this check about **0.5%** of the time in a model-matched trial.

`CHK-DIA` and `CHK-CHORD` are **5 mm** for the same reason: sleeve to sleeve, lean left out. They are printed. They do not fail the grade (§3.3). A diameter that fails while the grade passes is a hint of a focal length shared by the phone.

### 2.4 Privacy, and the public repo

The garden is a home. The GitHub repo is **public** and has **no licence file**. A committed fixture is a public file. CI never receives the OneDrive token. No account id, no drive path, and no owner name go into the committed JSON.

Photos stay on OneDrive. `--keep-photos` is a local copy. If a later decision commits any image bytes, the script does not strip by a block-list of GPS tags. It **rewrites the file to an allow-list**. A tag that is not on the list is removed, including GPS, serial numbers, owner name, unique IDs, thumbnails, and the raw MakerNote blob.

| Kept, if present | Dropped with everything else |
|---|---|
| Orientation | `GPS*` |
| Stored width and height, `PixelXDimension`, `PixelYDimension` | `BodySerialNumber`, `LensSerialNumber`, camera serials |
| `FocalLength`, `FocalLengthIn35mmFilm` | `CameraOwnerName`, `Artist`, `Copyright`, `UserComment`, `ImageUniqueID` |
| `LensModel`, `LensMake` | The raw MakerNote (serials live here) |
| `DateTimeOriginal`, `SubSecTimeOriginal`, `OffsetTimeOriginal` | Any thumbnail that could carry its own GPS |

The three `AccelerationVector` numbers may be copied into the JSON. The MakerNote itself may not. The same allow-list is applied to JSON fields: no raw EXIF blob, no GPS, no user-agent string that is not needed. Camera location left off on the phone is a backstop. The allow-list is the control.

Whether this public repo should have a licence, and whether a survey of a home belongs in it at all, is a decision for Paul (below). Until that decision, the importer’s default remains observations only, and `--keep-photos` does not `git add` the files.

## 3. Circle-fit test

One real capture. The synthetic suite already checks ellipse coverage and NEES. This test checks that **this** network, solved from the field observations, lands on a circle whose radius matches the set-out, within the covariances the solver published. A single trial “within X mm” is not the gate.

### 3.0 The network this test grades

The field sheet places three taped stations. Views below use the narrow 1× frame, **67°** landscape (`fx/width` 0.75; `2 atan(0.5 / 0.75)`). A phone at 0.69 is about 72° and has more spare. Portrait is not this frame. The sheet says landscape.

Sides are as you look from BAS01 toward BAS02. Index 0 is your left. Index 1 is your right. The peg is on your right.

| Station | Tapes, BAS01 / BAS02 | Side | `candidateIndex` | Photos, and the spare on a 67° frame |
|---|---|---|---|---|
| STN01 | 8.00 / 8.00 | Left | 0 | Both ends and CRC01–CRC05, scene **60°**, about **3.7°** spare each side. Second photo keeps BAS02 and adds CRC06, about **9°** outside BAS02. |
| STN02 | 6.50 / 9.00 | Right | 1 | Both ends, scene **59.6°**, about **3.9°** spare each side. No circle stick lies in that wedge. Second photo keeps BAS02 and takes CRC02, CRC01, CRC06, CRC03. Span about **54°**, about **7°** spare each side. CRC05 is not in this photo. |
| STN03 | 10.50 / 10.50 | Right | 1 | Both ends and CRC01–CRC03, scene **44.8°**, about **11°** spare each side. Second photo keeps BAS02 and adds CRC06, CRC05, CRC04, span **48°**, about **10°** spare each side. |

CRC04 from the old STN02 (5.00 m / 7.00 m) sat about 74° from the nearest baseline end, and CRC03 sat about 82° out, so the turn that showed them had no known mark. Dropping that turn without moving the station still leaves CRC03 with no oriented ray, and CRC03 is one of the two shallow crossings. No peg-side point with both tapes inside 8 m puts CRC03 inside a 67° frame with a baseline end and still crosses it cleanly. **6.50 m / 9.00 m** is the round pair that does, and it keeps both baseline ends inside the same 67° frame, with about the same spare as STN01. From there CRC04 is still about 62° from BAS02 and is not photographed. STN01 and STN03 both see CRC04, and those two rays meet at about **85°**.

CRC02 and CRC03 are the shallow pair between STN01 and STN03 (about **7.5°** and **11°**). STN02 is there to cross them: about **40°** at CRC02 and about **85°** at CRC03, with BAS02 in the same photo so the yaw has a known mark. The other four sticks meet STN01 and STN03 at **52°** or more.

From STN02, CRC05 lies **0.07°** behind CRC03. CRC03 is the near cane (about 3 m) and its sleeve covers the far one (about 10 m). Keeping CRC03’s cane under about 0.8 m would open a vertical gap, and it is easy to miss in the field. The sheet drops CRC05 from that photo instead. CRC05 is still seen from STN01 and from STN03, and those rays meet at about **85°**. The angular span of the STN02 photo does not change: CRC05 was already on CRC03’s azimuth.

**A grade requires STN03.** A capture that has STN01 and STN02 only is solved and the statistics are printed. It is not passed and it is not failed. Two stations with a per-photo `fx` do not support a pass/fail on this circle. The same rule applies when `CHK-BASE` is missing: the report is printed, and there is no grade, because a baseline blunder does not show up in the radius.

**Checked is not expected.** Each station is fixed by exactly two tapes, so that fix has no spare observation. With three stations the phase 1 gate marks only CRC01 checked. With two stations it marks none. Plantable is the same gate plus the ellipse and a withheld distance. This layout’s grade is the circle table in §3.3, not a checked or plantable flag.

PR #3 at `637b45f` reads `branchChoices` and unsets a station as `branch-conflict` when the index contradicts that station’s own two-mark bearings. Do not drop STN01, and do not reuse the old indices 1, 0, 0 that belonged to a BAS02 origin.

### 3.1 Solve

1. Load `garden.json`, `normalizeDocument`, require `version: 1`.
2. Completeness, before any fit:
   - One `phoneId`, one `LensModel`, `lens` `1x`, `fxSharedInSolve` **false**, and the calibration photo present with raw tape, `R`, `H`, `sleeveHeightM`, and `plumbOk`. `fxShared: true` is not a requirement. A true value fails this check, because this solver does not share `fx`.
   - Datum origin BAS01, axis BAS02. `branchChoices` for STN01, STN02, and STN03 are the indices in §3.0, derived from left/right looking from BAS01 toward BAS02.
   - The baseline line carries `sigmaM` 0.003. Each station tape carries `sigmaM` 0.010. A missing `sigmaM` is not filled with the 20 mm default.
   - Every station photo has `phonePole.lensOnAxis` true.
   - Every fixture photo is `original-still` from a probe **go** (`FocalLength` and `LensModel` present). A `canvas-derived` photo, or a still with either tag missing, fails the test.
   - Clicks are `sensor-continuous` and each click has `sigmaPx` in sensor pixels.
   - Every circle point, both baseline ends, and the calibration rod have their own `sleeveRadiusM`, the measured R from the sheet, plus `sleeveHeightM` and `plumbOk: true` with `leanBoundDeg` ≤ 2. A shared stand-in of 30 mm or 32 mm fails this check.
   - Every photo that clicks a circle rod copies that rod’s measured `sleeveRadiusM`, sleeve height, and bubble onto the click.
   - The two baseline tape pulls differ by at most `baselinePullsAgreeWithinM` (10 mm) on the axis lengths.
3. `solveGardenDocument`, passing `branchChoices`. Do not read stored `x,y` as measurements. If STN03 is absent, or `CHK-BASE` is absent, print the statistics and **do not grade**. A grade requires STN01, STN02, and STN03.
4. Append `ground-truth.withheld` as withheld distances using `√(s² − Δh²) + nR`, not `faceOffsetM`. `CHK-BASE` is in that list. It is not a line in `garden.json`.
5. Fail if `reflected` is true, if the variance test is `high`, if the solve did not converge, if any station is `branch-conflict`, or if any circle point is `unset`. `low` is not a failure. This fail is a grade. It is not applied to an ungraded two-station capture; that capture is reported.
6. Photos skipped as `no-fx` fail this fixture. The prior may be the EXIF 35 mm equivalent (`fx/width` in the 0.69–0.75 band, width in sensor pixels) with a relative σ, **one prior per photo**. Each ray uses that photo’s `sigmaPx` in sensor pixels, not a flat 2 px on a thumbnail. The calibration block is present either way. The test does not compute `fx` from the sleeve, and it does not force the photos onto one `fx`.

Checked versus unchecked is reported per point, and for this layout the expected report is that the points are **not** checked, apart from CRC01 when all three stations are in. A circle point does not have to be plantable for the radius test to run. Plantable remains the roadmap rule (95% semi-major ≤ 100 mm, a spare observation, and a withheld distance inside its own limit). The withheld lengths are the laser baseline, the diameter, and one chord. They are checks on those lengths. They are not what makes the other points plantable.

### 3.2 Geometric fit

Use an orthogonal-distance fit of the **solved** circle points only. Kåsa is the seed. Kåsa’s radius is not the result. The existing `fitCircleGeometric` is the right shape and the wrong weight for this gate: it treats points as equal and independent, and it multiplies the radius variance by `rss / dof`. That scaled σ is a residual statistic. The gate stays on the **a-priori** covariances, as in the geometry note.

Let `Q` be the **joint** cofactor of the six circle points, 12×12, in the same point order as `circlePointIds`, from `jointCofactor` at PR #3 `637b45f`. The marginal `(qxx, qxy, qyy)` on each point is not this matrix. On this network the joint cofactor gives a radius σ of **15.0 mm**. The 2×2 blocks alone give **14.4 mm**, about 4% optimistic, not 1.6–2.5 times too small. The joint matrix is still the weight: it matches an independent least squares and the Monte Carlo, all three at 14.9 mm. With the 6 mm stick term in `C` the radius σ is **16.2 mm**. The per-photo focal-length prior is what moves it. Station tapes at 5 mm, 10 mm, and 20 mm change the network-only figure only from 14.2 mm to 16.5 mm.

Let `g_i` be the unit radial vector from the current centre to point `i`. Let `G` be the 6×12 matrix whose `i`th row is `g_iᵀ` in that point’s two columns and zeros elsewhere. Add the per-stick scatter on the diagonal:

`C = G Q Gᵀ + σ²_stick I`

`σ_stick` is **6 mm** (`sigmaStickM`). That is about 3 mm of placement and about 5 mm from a 1° lean at a 0.5 m sleeve, added in quadrature. It is the same order as the lean the bubble does not remove. Leaving it out makes the shape test tight in the same way the marginal blocks do.

Fit by generalised least squares with covariance `C`. Residual `v_i = ‖p_i − c‖ − R`, Jacobian row `(−g_i, −1)`, normal matrix `N = Jᵀ C⁻¹ J`. Recompute `g_i`, `G`, and `C` each iteration.

`σ²_R` is the radius entry of `N⁻¹`. Do not multiply by `σ̂₀²`. If the variance test was `high`, the fixture has already failed; do not inflate this limit to absorb it. Do not form `σ_R` from the per-point blocks. On this layout that shortcut is the 14.4 mm figure, not the 15.0 mm joint one.

Arc span is the same quantity as `arcRad` in `fitCircleGeometric`. The protocol is a full circle, so the span is about `2π` and `radiusWeak` is false. If a future capture spans under `π/2`, report `σ_R` and **do not** apply the radius gate. That is the geometry note and the roadmap: a short arc does not pin a radius.

### 3.3 Pass criteria

`n` is the number of solved circle points. The protocol has `n = 6`, so the circle fit has `n − 3 = 3` degrees of freedom. `χ²(3, 0.95) = 7.815`. `χ²(5, 0.95) = 11.070` if eight points are used.

| Check | Statistic | Pass |
|---|---|---|
| Network | Solver variance test | Not `high`. One-sided, upper tail, α = 5%, as implemented. `low` does not fail. |
| Circle points | Status | None `unset`. |
| Radius | `\|R̂ − R_known\| ≤ 2.576 √(σ²_R + σ²_setout)` | **2.576** is the two-sided 1% factor. With `σ_R` 16.2 mm and `σ_setout` 3 mm that limit is about **42 mm**. The same formula at 1.96 is about **32 mm**. The other rows stay at 5%. `σ_setout` is `radiusSigmaM`, **3 mm**, the common set-out only. At 1.96 this row alone false-fails **9.7%** of correct captures: the empirical s.d. of `R̂` is 19.9 mm against a `σ_R` of 16.2 mm, because a focal error common to the phone is not what the per-photo model assumes. |
| Shape | `vᵀ C⁻¹ v ≤ χ²(n − 3, 0.95)` | `v_i = ‖p_i − ĉ‖ − R̂`. `C` is the joint radial covariance from §3.2, stick scatter included. One-sided. This is the set of radial residuals, not a millimetre cap on each point. |
| One point | `\|w_i\| ≤ 3.29` | `w_i = v_i / √(C_vv)_{ii}`, with `C_vv = C − J N⁻¹ Jᵀ` and `N = Jᵀ C⁻¹ J`. 3.29 is the solver’s two-sided 0.1% residual threshold. It stays 3.29. It is not tightened to a Bonferroni 2.64, and it is not `v_i / (σ_i √(1 − h_ii))` from a diagonal weight matrix. A point outside 1.96 σ is reported and does not by itself fail. |
| Short arc | `arcRad < π/2` | Radius row is not applied. Shape and `w_i` still are. |
| Laser baseline | Existing solver check | `\|miss\| ≤ 1.96 √(gᵀ Q g + σ²_check)` with `σ_check` **5 mm**. Sleeve to sleeve. This row is part of the grade. |
| Figure tapes | Same check, printed only | `CHK-DIA` and `CHK-CHORD`, also **5 mm**, sleeve to sleeve. Printed. They do not fail the grade. |
| Near end | Recorded peg distance | Distance from the fitted circle to `nearBaselineEndId` is smaller than the distance to the far end. The gap to the near end is reported against `\|pegToNearEndM − R_known\|`. It is a stake-note check, not a second radius gate. |
| Calibration | Manifest | Present, raw, same phone, 1×, that rod’s measured `R`, sleeve height, and bubble filled. |
| Class report | 95% semi-major | Printed per circle point. ≤ 100 mm meets the plantable bar only together with the spare-observation rule. The radius test does not require every point to be under 100 mm. A semi-major over 5 m is already `sanity` and unset. |

The radius row is the scale check. The fit can have tiny residuals and a wrong radius; the known radius catches that. The shape row is the radial residuals against the covariances.

**One grade.** Every row above is printed. The CI result is a single pass or fail. It fails when the solve is unusable (no convergence, a circle point unset, a station `branch-conflict`, or `reflected: true`), or when any of these rows fails: network, radius, shape, `|w|`, or `CHK-BASE`. `CHK-DIA`, `CHK-CHORD`, and the near-end note are diagnostics. They do not change the pass or fail.

The rates are from two runs of 1,000 trials on solver `637b45f`, seeds 777 and 4242, with this fixture’s σ (baseline 3 mm, station tapes 10 mm, checks 5 mm sleeve to sleeve, `radiusSigmaM` 3 mm, `σ_stick` 6 mm) and a focal error common to the phone, drawn from the 2% per-photo prior.

| Policy | A correct capture passes | A stick 50 mm off the circle is caught | A baseline typed 20 mm long is caught | A common focal length 5% high is caught |
|---|---|---|---|---|
| Radius at 1.96, the other grade rows unchanged | **85.6–87.0%** | **69–73%** | **94%** | **100%** |
| **This grade: radius at 2.576, the rest unchanged** | **93.2%** | **65%** | **94%** | **100%** |
| Network, radius, shape, and the laser all at 1% | 96.1% | 38.8% | 78.6% | 88.4% |

The radius row is the one moved. At 1.96 it alone false-fails **9.7%** of correct captures. Those failures sit on the same common focal error as the network row and the diameter, so they are not a separate 9.7 points added to something else. Widening only that row to 2.576 is what produces the **93.2% / 65% / 94% / 100%** line. Moving every grade row to 1% would pass 96.1% of correct captures and would catch the 50 mm stick only 38.8% of the time, and a focal length 5% high only 88.4%. Shape stays at `χ²(3, 0.95)` and `|w|` stays at 3.29.

`CHK-DIA` and `CHK-CHORD` stay printed and stay out of the grade. On a correct capture the diameter fails in **16.2%** of trials, but in only **6.3%** is a figure tape the only failure. Taking them out of an all-rows grade lifts the pass rate from **81.8%** to **87.0%**, not to 97%. They add almost nothing on the faults this test is for: about **0.6%** of 50 mm sticks and **0.2%** of 20 mm baselines are seen only there. What they do see, when the grade has passed, is a scale error from a focal length common to the phone. **A diameter or chord that fails while the grade passes means suspect that common focal length.**

The blind spot that remains is the same mechanism. A common focal error of **+3%** moves `R̂` by about **+25 mm**. On the 1.96 radius row that fault **passes 73%** of the time. On this grade, the 2.576 row, it **passes about 92%** (0.917 over 1,000 trials). The radius limit is about **42 mm** at 2.576 and about **32 mm** at 1.96 (`2.576 √(16.2² + 3²)` against `1.96 √(16.2² + 3²)`). Twenty-five millimetres sits inside both, so widening the row does not catch this fault. It is caught when the focal error reaches **+5%** (**100%** on this grade), or later, when one `fx` is shared. A 1% prior would bring the network-only `σ_R` down from 15.0 mm to 11.0 mm. This fixture does not do that. `fxSharedInSolve` stays false.

### 3.4 What one capture does not prove

It does not estimate NEES and it does not show that 95% of repeats fall in the ellipse. That remains the synthetic suite. It does not validate the DeviceMotion-to-camera map, and it does not treat a MakerNote vector as that map. Rays without a mapped, usable gravity vector stay unlevelled, and the station class is judged accordingly. It does not estimate `fx` from the sleeve, and it does not grade a capture as if `fx` had been shared. It stores the observations that estimation needs. A two-station visit is reported and is not a failed grade.

## Decisions

1. **Probe first, then stills.** A path is an archive path only after `FocalLength` and `LensModel` survive on that phone. The canvas shutter is a thumb, not the archive. Stills sit in a sibling folder.
2. **Stay on document version 1** with optional fields. v2 remains the bump already agreed. The sidecar is not a second garden file.
3. **Node import script.** Not an in-app export. Photos stay on OneDrive. The repo gets observations and ground truth. Any future image bytes are rewritten to the allow-list in §2.4.
4. **Circle test** as §3.3. One pass/fail: network, shape, `|w|`, the laser baseline, and the radius row at **2.576** (1%), a limit of about **42 mm** (about **32 mm** at 1.96). A correct capture passes **93.2%**. A 50 mm stick is caught **65%**, a 20 mm baseline **94%**, and a common focal length 5% high **100%**. A common focal length 3% high still passes **about 92%** on this grade (73% was the 1.96 row). Figure tapes are printed and do not fail the grade. `reflected: true` fails it. Joint covariance, `σ_R` 15.0 mm, 6 mm stick scatter, `σ_setout` 3 mm. Baseline σ 3 mm, station tapes 10 mm, checks 5 mm. Datum BAS01 → BAS02, as in PR #3 `637b45f`. A grade needs STN03. The baseline check script on main is still a placeholder.
5. **`+R` after horizontal reduction**, stored separately from v1 `offsetMm`. Leave that box at 0. `R` is the sleeve’s measured R (about 30 mm, see MARKER_VISION_DESIGN.md), stored on each stick.
6. **One phone, one `LensModel`, one calibration shot at 3–5 m**, raw tape and sleeve height, no derived focal length in the file. `fxSharedInSolve` is false: this solver gives each photo its own `fx`.
7. **Licence and the public repo.** The repo is public and has no licence. Paul decides whether to add one, and whether a survey of this garden should be committed here at all. This note does not pick a licence. Until that decision, fixture photos are not committed.
