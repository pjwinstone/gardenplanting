# Field captures as solver fixtures

**Status:** design only. No app change in this note. `ui.ts` stays as it is. Implementation follows a review of this note.

**Reviewers:** the Photo & Marker Vision Reviewer has reviewed section 1. The five blocking items from that review are taken in the table below. The Geometry & Maths Advisor reviews section 3. No comment from that advisor was on PR #4 when this revision was written. Section 2 is the import that joins them.

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
    "fxShared": true,
    "calibrationPhotoId": "ph-cal"
  },
  "photos": []
}
```

One phone, one 1× lens, one shared `fx` for every photo in the capture. A second `phoneId` is an error, not a second calibration. `fx` is not written as a derived number. The calibration photo contributes raw observations (section 1.4.1). An EXIF `FocalLengthIn35mmFormat`, when the still has it, is stored as a prior only (`fx/width` about 0.69–0.75). It is not the calibration.

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
| `phonePole` | `{ plumbOk, leanBoundDeg, poleHeightM }`. The survey pole, plumbed with a bubble to about 1°. |
| `clicks[]` | `{ pointId, px, py, sigmaPx, sleeveHeightM, sleeveRadiusM, plumbOk, leanBoundDeg }`. `px`, `py` are `sensor-continuous` (pixel centre at +0.5). `sigmaPx` is the click σ in full-resolution sensor pixels. |

**Sleeve height and the bubble live on the click, because they belong to the rod in that photo, and on the photo, because the pole was plumbed for that shutter.**

- `sleeveHeightM` is `h_s`, metres, ground to the **centre of the sleeve**. The same rod keeps one height for the session; copy it onto every click of that rod so the photo entry stands alone. The marker note’s ground shift is `h_s sin λ`: **17 mm at 2° when `h_s` is 0.5 m**, 9 mm at 1°, 35 mm at 2° if the sleeve centre is 1.0 m up. Record the height you measured, not a default.
- `sleeveRadiusM` is `R`. Full-width A4 sleeve: `(210 − 10) / π / 2 = 0.0318` m. A thinner stick stores its own `R`.
- `plumbOk` and `leanBoundDeg` are the rod bubble. The field rule is about **1°**. With the bubble, the along-sight lean that one photo cannot see is carried as `σ_λ` of about 1–2°. `plumbOk: false` does not enter this fixture; the rod is replumbed first.
- `phonePole` is the camera pole, separate from the target rod. A 1° lean on a 1 m pole is 17 mm at the ground.

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

Publishing `fx = h_px · d / H` from this same photo and then using that `fx` on this photo counts the pixels twice. The adjustment, when it estimates `fx`, consumes the tape, the levelled elevations of the sleeve ends, one shared `fx` for the phone, and `H`. Until that estimation is in the solver, the fixture still carries these raw fields, and an EXIF focal length may sit as the prior `fxOverWidth` with a relative σ. The circle test fails closed if the calibration photo is missing or if any fixture photo is `canvas-derived`.

#### 1.4.2 Tapes in the metadata

A tape or laser is a line in the garden JSON plus a copy in the manifest under `distances[]`: `id`, `a`, `b`, `instrument`, `slopeM`, `deltaHM`, `horizontalM`, `radiusEachEndM`, `endsOnSleeve`.

Approved reduction, from the marker note §3: horizontal first, then `+R` for each end that stopped on the paper. `R` is 0.0318 m on the full-width sleeve. Both ends on sleeves means `+2R`. A laser spot more than about **`R/2` (16 mm)** off the rod centreline is not a measurement; it is retaken. The spot offset is not a stored correction.

The phase 1 helper `horizontalDistance` adds `faceOffsetM` onto the slope and then takes the square root. On a level tape that is the same as adding `R` afterwards. On a slope the two differ by about 2 mm for this sleeve at 20°. This fixture holds tapes level, so they agree. The importer still stores slope, `Δh`, and `R` separately and builds the solver length as `√(s² − Δh²) + nR`. It does not pass `R` through `faceOffsetM`.

v1 `offsetMm` stays **0** on these points. The current Layer A path shifts `y` by that scalar, and the phase 1 adapter does not apply it. The 32 mm is the tape correction above, not that box.

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
6. Sleeve height, sleeve radius, and the rod bubble on the point and on each click. `phonePole` on the photo. Calibration block as raw tape, `Δh`, `R`, `H`, and sleeve height. One `LensModel` per capture.
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

The existing skip stays until this folder contains a real `garden.json`: `tests/phase1-solver.test.ts` skips, and `npm run test:field-circle` exits 0. The placeholder assertions in those two files (any coordinated points, a warning if no circle item) are replaced by section 3 when the file arrives. They are not the test.

### 2.3 Ground truth

Written by the surveyor, not fitted by the script. The known radius is not an observation.

```json
{
  "radiusM": 4.0,
  "radiusSigmaM": 0.01,
  "setOut": "peg and non-stretch line, chords checked",
  "circlePointIds": ["CRC01", "CRC02", "CRC03", "CRC04", "CRC05", "CRC06"],
  "nearBaselineEndId": "BAS02",
  "farBaselineEndId": "BAS01",
  "pegToNearEndM": 4.3,
  "phoneId": "paul-iphone",
  "lens": "1x",
  "calibrationPhotoId": "ph-cal",
  "sleeveRadiusM": 0.0318,
  "build": "",
  "withheld": [
    {
      "id": "CHK-DIA",
      "a": "CRC01",
      "b": "CRC04",
      "instrument": "tape",
      "slopeM": null,
      "deltaHM": null,
      "radiusEachEndM": 0.0318,
      "note": "fresh diameter; axis length is horizontal plus 2R"
    },
    {
      "id": "CHK-CHORD",
      "a": "CRC01",
      "b": "CRC03",
      "instrument": "tape",
      "slopeM": null,
      "deltaHM": null,
      "radiusEachEndM": 0.0318,
      "note": "120° chord, about 6.93 m axis to axis"
    }
  ]
}
```

`slopeM` and `deltaHM` are the fresh pulls from the sheet. The script does not invent them. `radiusSigmaM` is the set-out σ from the protocol (10 mm when both diameters agree). `pegToNearEndM` is the taped distance from the centre peg to the near baseline end, so the “circle approaches this end” check has a number. The peg is not a solved point.

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

### 3.1 Solve

1. Load `garden.json`, `normalizeDocument`, require `version: 1`.
2. Completeness, before any fit:
   - One `phoneId`, one `LensModel`, `lens` `1x`, `fxShared` true, and the calibration photo present with raw tape, `R`, `H`, `sleeveHeightM`, and `plumbOk`.
   - Every fixture photo is `original-still` from a probe **go** (`FocalLength` and `LensModel` present). A `canvas-derived` photo, or a still with either tag missing, fails the test.
   - Clicks are `sensor-continuous` and each click has `sigmaPx` in sensor pixels.
   - Every circle point in `circlePointIds` has `sleeveHeightM`, `sleeveRadiusM`, and `plumbOk: true` with `leanBoundDeg` ≤ 2.
   - Every photo that clicks a circle rod copies that rod’s sleeve height and bubble onto the click.
3. `solveGardenDocument`. Do not read stored `x,y` as measurements. The field sheet’s third station is optional when only an 8 m tape is on site. The test does not require a point named STN03. It requires the circle points.
4. Append `ground-truth.withheld` as withheld distances using `√(s² − Δh²) + nR`, not `faceOffsetM`.
5. Fail if the variance test is `high`, if the solve did not converge, or if any circle point is `unset`. `low` is not a failure.
6. Photos skipped as `no-fx` fail this fixture. The prior may be the EXIF 35 mm equivalent (`fx/width` in the 0.69–0.75 band, width in sensor pixels) with a relative σ, shared by every photo of that phone. Each ray uses that photo’s `sigmaPx` in sensor pixels, not a flat 2 px on a thumbnail. The calibration block is present either way. The test does not compute `fx` from the sleeve.

Checked versus unchecked is reported per point. A circle point does not have to be plantable for the radius test to run. Plantable remains the roadmap rule (95% semi-major ≤ 100 mm, a spare observation, and a withheld distance inside its own limit). This layout’s withheld tapes are the diameter and one chord, so those two lengths carry the plantable distance check. The other points are judged by the circle statistics below.

### 3.2 Geometric fit

Use an orthogonal-distance fit of the **solved** circle points only. Kåsa is the seed. Kåsa’s radius is not the result. The existing `fitCircleGeometric` is the right shape and the wrong weight for this gate: it treats points as equal and independent, and it multiplies the radius variance by `rss / dof`. That scaled σ is a residual statistic. The gate stays on the **a-priori** covariances, as in the geometry note.

Let `Q_i` be the marginal `(qxx, qxy, qyy)` of solved point `i`. Let `g_i` be the unit radial vector from the current centre to the point. The radial variance is

`σ²_{ρ,i} = g_iᵀ Q_i g_i`.

Weight `w_i = 1 / σ²_{ρ,i}`. Iterate the orthogonal Gauss–Newton the same way as `fitCircleGeometric` (residual `‖p_i − c‖ − R`, Jacobian `(−g_i, −1)`), with those weights. Recompute `g_i` and `w_i` each iteration.

`σ²_R` is the radius entry of `(Jᵀ W J)⁻¹`. Do not multiply by `σ̂₀²`. If the variance test was `high`, the fixture has already failed; do not inflate this limit to absorb it.

**Approximation, for the reviewer.** Marginal `Q_i` ignores covariance between points that share a station or the datum. That makes `σ_R` somewhat tight. The withheld tapes already use the joint normal matrix inside the solver, so they are the strict distance checks. Using the joint cofactor of the circle points is a follow-up when the solver exports it, not a reason to block this test.

Arc span is the same quantity as `arcRad` in `fitCircleGeometric`. The protocol is a full circle, so the span is about `2π` and `radiusWeak` is false. If a future capture spans under `π/2`, report `σ_R` and **do not** apply the radius gate. That is the geometry note and the roadmap: a short arc does not pin a radius.

### 3.3 Pass criteria

`n` is the number of solved circle points. The protocol has `n = 6`, so the circle fit has `n − 3 = 3` degrees of freedom. `χ²(3, 0.95) = 7.815`. `χ²(5, 0.95) = 11.070` if eight points are used.

| Check | Statistic | Pass |
|---|---|---|
| Network | Solver variance test | Not `high`. One-sided, upper tail, α = 5%, as implemented. `low` does not fail. |
| Circle points | Status | None `unset`. |
| Radius | `\|R̂ − R_known\| ≤ 1.96 √(σ²_R + σ²_setout)` | 1.96 is the 1D 95% factor, the same one used on a withheld tape. `σ_setout` is `radiusSigmaM`. |
| Shape | `vᵀ W v ≤ χ²(n − 3, 0.95)` | `v_i = ‖p_i − ĉ‖ − R̂`, weights from the a-priori radial variances. One-sided. This is the set of radial residuals, not a millimetre cap on each point. |
| One point | `\|w_i\| ≤ 3.29` | `w_i = v_i / (σ_{ρ,i} √r_i)`, `r_i = 1 − h_ii` from the weighted fit. 3.29 is the solver’s two-sided 0.1% residual threshold. A point outside 1.96 σ is reported and does not by itself fail. |
| Short arc | `arcRad < π/2` | Radius row is not applied. Shape and `w_i` still are. |
| Withheld tape | Existing solver check | `\|miss\| ≤ 1.96 √(gᵀ Q_xx g + σ²_check)` on the axis-to-axis length. |
| Near end | Recorded peg distance | Distance from the fitted circle to `nearBaselineEndId` is smaller than the distance to the far end. The gap to the near end is reported against `\|pegToNearEndM − R_known\|`. It is a stake-note check, not a second radius gate. |
| Calibration | Manifest | Present, raw, same phone, 1×, sleeve height and bubble filled. |
| Class report | 95% semi-major | Printed per circle point. ≤ 100 mm meets the plantable bar only together with the spare-observation rule. The radius test does not require every point to be under 100 mm. A semi-major over 5 m is already `sanity` and unset. |

The radius row is the scale check. The fit can have tiny residuals and a wrong radius; the known radius catches that. The shape row is the radial residuals against the covariances. Together they are the field fixture.

### 3.4 What one capture does not prove

It does not estimate NEES and it does not show that 95% of repeats fall in the ellipse. That remains the synthetic suite. It does not validate the DeviceMotion-to-camera map, and it does not treat a MakerNote vector as that map. Rays without a mapped, usable gravity vector stay unlevelled, and the station class is judged accordingly. It does not estimate `fx` from the sleeve. It stores the observations that estimation needs.

## Decisions

1. **Probe first, then stills.** A path is an archive path only after `FocalLength` and `LensModel` survive on that phone. The canvas shutter is a thumb, not the archive. Stills sit in a sibling folder.
2. **Stay on document version 1** with optional fields. v2 remains the bump already agreed. The sidecar is not a second garden file.
3. **Node import script.** Not an in-app export. Photos stay on OneDrive. The repo gets observations and ground truth. Any future image bytes are rewritten to the allow-list in §2.4.
4. **Circle test** as the table in §3.3, geometric and covariance-weighted, 1.96 on the radius, `χ²(n−3)` on the radial residuals, 3.29 on a single point.
5. **`+R` after horizontal reduction**, stored separately from v1 `offsetMm`. Leave that box at 0.
6. **One phone, one `LensModel`, one shared `fx`, one calibration shot at 3–5 m**, raw tape and sleeve height, no derived focal length in the file.
7. **Licence and the public repo.** The repo is public and has no licence. Paul decides whether to add one, and whether a survey of this garden should be committed here at all. This note does not pick a licence. Until that decision, fixture photos are not committed.
