# Markers and photo reading — draft for review

**Status:** proposal only. No detection code and no solver code. The cylindrical sleeve is the design. A flat tag is an optional extra and is not in the standard print.

The Photo & Marker Vision Reviewer should review the code, the print sheet, and the Safari path. The Geometry & Maths Advisor should review the pixel scale, the centreline bearing, the range estimate, and the radius offset.

**Depends on:** the Phase 1 ray model in [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md) and PR #3 (`cursor/phase1-geometry-solver-8c5c`). This note does not change that branch. Stages: [ROADMAP.md](ROADMAP.md) Phase 2.

The stored point is the **centre of the stick**. The paper is a sleeve around it.

## 1. Recommendation

Print one **A4 portrait** sheet per mark. Horizontal bands run across the sheet. Roll the sheet into a cylinder and slide it over the stick. Any direction around the stick shows the same code.

Do not put a flat AprilTag or ArUco on the stick. A face-on square code fails at a grazing angle, which is most of a walk around the garden. The sleeve’s centreline bearing is already tight (section 5), and focal length can be checked with a tape and the known paper height (section 6). A flat tag earns a place only if that check fails in the field. It is not part of this template.

Hand clicks stay when the code is rejected.

## 2. Sheet, stick, and diameter

A4 portrait is **210 mm** wide and **297 mm** tall. The short side goes around the stick. The long side becomes the height of the sleeve. Bands are horizontal, so they become rings.

The overlap is glue, not extra circumference. With a **10 mm** overlap the full sheet width gives

`D = (210 − 10) / π = 200 / π = 63.7 mm`,

radius **31.8 mm**. A 15 mm overlap on the same sheet gives `195 / π = 62.1 mm`.

The stick chooses the diameter. The sheet only has to be at least `πD + overlap` wide, and it cannot be wider than 210 mm.

| Stick diameter | Radius | Circumference | Paper width with 10 mm overlap | Spare on the 210 mm sheet |
|---|---|---|---|---|
| 25 mm | 12.5 mm | 79 mm | 89 mm | 122 mm |
| 32 mm | 16 mm | 101 mm | 111 mm | 100 mm |
| 40 mm | 20 mm | 126 mm | 136 mm | 74 mm |
| 50 mm | 25 mm | 157 mm | 167 mm | 43 mm |
| **64 mm (full width)** | **32 mm** | **200 mm** | **210 mm** | **0** |

**Use the full width, about 64 mm,** unless the stick you already have is thinner. A wider stick is a wider silhouette (section 5). A thinner stick still uses this band layout; the unused side of the sheet stays blank and holds the corner marks, and the overlap strip moves in to `πD + 10 mm`.

## 3. Where the point is

The coordinate in the garden is the **axis**, not the paper surface.

- A levelled bearing to the **silhouette centreline** already aims at the axis. Circular tangents are symmetric, so the midline is the axis even when you are not square-on. That observation has **no** radial offset.
- A tape or a laser that stops on the **outside of the paper**, along a line that passes through the axis, is short by one radius. The length to the centre is the reading **plus R** (about **32 mm** on the full-width stick). Store that on the observation: `offsetMm = R`, direction from the impact toward the axis.
- A laser that hits the side of the stick, rather than the near face, is not `+R` along the beam. If the spot is obviously off the centreline, do not apply the radius; retake the shot or tape to the near face.
- A wall disc is a different case: millimetres plus a fixed direction (inward normal of that edge). The stick’s radius is not that offset.

This is roadmap decision 6. The old “about 50 mm to the front of a toilet roll” figure is the right kind of correction and the wrong length for this sleeve.

## 4. Pixel scale

Working camera: iPhone **1×**, **26 mm** equivalent, 4:3 still, **4032 × 3024**. The 35 mm frame is 43.3 mm on the diagonal, so the 4:3 width is `43.3 × 0.8 = 34.6 mm` and

`fx / width = 26 / 34.6 = 0.751`, `fx = 0.751 × 4032 = 3028 px`.

A 24 mm-equivalent phone is `fx ≈ 2798 px` (about 8% coarser). The 1920-wide preview is `fx ≈ 1442 px` and is not the detection image. Figures below use 3028 px.

Millimetres per pixel = `1000 × d / fx`:

| Distance | mm per pixel | 14 mm band | 297 mm sleeve | 64 mm stick width |
|---|---|---|---|---|
| 2 m | 0.66 | 21 px | 450 px | 96 px |
| 5 m | 1.65 | **8.5 px** | 180 px | 39 px |
| 8 m | 2.64 | 5.3 px | 112 px | 24 px |
| 15 m | 4.95 | **2.8 px** | **60 px** | **13 px** |

Stick width in pixels is `fx × D / d`. At these ranges the exact tangent angle `2 arcsin(R / d)` matches that to a pixel.

A narrow bar has to be about **8 px** tall before a width or a black/white run is safe to classify after blur. That is **14 mm at 5 m**, **21 mm at 8 m**, and **40 mm at 15 m**.

## 5. The code that fits on 297 mm

Vertical budget:

| Strip | Height |
|---|---|
| Top quiet zone, with corner crosses | 15 mm |
| Bottom quiet zone, with the human ID and corner crosses | 16 mm |
| **19 code bands × 14 mm** | **266 mm** |
| Total | **297 mm** |

Each code band is the same height. The bit is black or white, not a wide/narrow pair. Equal bands are what fit an 8 px bar at 5 m **and** a real checksum. Width coding (wide = 2× narrow) at this same 14 mm floor would average about 21 mm a bar, and 297 mm would hold only about ten bars after the quiet zones: too few for start, data, and a check.

| Bands | Role |
|---|---|
| 3 | **Start / orientation.** Black, black, white. Two blacks in a row cannot appear in the data, so this end is “up”. Upside-down is a reject, not another ID. |
| 8 | **Data.** 256 IDs. `garden.json` maps the number to `A1`, `HSE03`, `FNC01`, and so on. |
| 6 | **Check.** CRC-6 over the data. One flipped band fails the check. |
| 2 | **Stop.** White, white. Confirms the end and the count. |

Decode only if the band count is 19, the start is at the top, the stop is at the bottom, neighbouring data bands were actually separated, and the CRC matches. **Reject otherwise. Do not correct a bit.** A corrected band can name the wrong stick.

64 rods, corners, and posts fit easily in 256. The spare codes are reprints and new posts, not a second garden’s worth of cleverness.

**Range of the ID.** Promise it at **2 m and 5 m** (21 px and 8.5 px per band). At **8 m** a band is 5.3 px: keep the ID only when all 19 runs are found and the CRC passes; otherwise reject the code. At **15 m** a band is 2.8 px: **no ID**.

The previous 15-bar width code (64 IDs, about 250 mm) is retired. It spent the paper on wide bars and still missed the 8 px floor once quiet zones were included.

## 6. Bearing and range

**Bearing.** Locate the left and right silhouette edges and take the midline. If each edge is good to `σ_e` pixels and the errors are independent, the midline is `σ_e / √2` pixels and

`σ_β = (σ_e / √2) / fx` radians, lateral miss `= d × σ_β`.

With `fx = 3028` and `σ_e = 1 px`, `σ_β = 0.013°` and the lateral miss is **0.5 mm at 2 m, 1.2 mm at 5 m, 1.9 mm at 8 m, 3.5 mm at 15 m**. At 2 px on the edge at 15 m (the stick is only 13 px wide) the miss is **7 mm**. That is inside a hand click and inside the tape σ. The centreline is a valid Phase 1 ray across 2–15 m whenever both edges are found. It does not depend on reading the code. Without an ID, though, there is still no point to attach it to, unless this sleeve is the only one in the frame and the user confirms the name.

**Range from the paper height.** The sheet is 297 mm. With both outer edges found,

`d = fx × H / h_px`, `σ_d / d ≈ √( (σ_h / h)² + (σ_fx / fx)² )`.

`σ_h ≈ √2` px if each end is 1 px. On this camera:

| Distance | Sleeve in pixels | Edge term | With `fx` known to 1% | With `fx` known to 5% |
|---|---|---|---|---|
| 2 m | 450 px | 0.3% | **21 mm** | 100 mm |
| 5 m | 180 px | 0.8% | **64 mm** | 253 mm |
| 8 m | 112 px | 1.3% | **129 mm** | 412 mm |
| 15 m | 60 px | 2.4% | **384 mm** | 829 mm |

So:

- It **does** separate the two station candidates that sit about 20 m apart, at every range in this table, even with a 5% focal length.
- It is **not** a tape. At 5 m and a 1% focal length, 64 mm is a check, not a plantable length (the plantable bar is 100 mm with a real spare observation). At 8–15 m it is a weak distance and must carry this σ.
- A lean toward the camera shortens the image. `10°` is about 1.5% (`1 − cos 10°`), `15°` about 3.4%. Past about **15°** from vertical after levelling, drop the range and keep the bearing.
- This formula is the small-angle size. Past 2 m that is enough for the σ already quoted.

**Focal length.** A taped distance to the axis (surface reading **plus R**) and a measured sleeve height observe `fx = h_px × d / H`. At 5 m, `d` to 20 mm and `h` to 1.4 px is about **1%** on `fx`, which is the Phase 1 bar. That is the calibration. It is why a flat tag is not required on every stick. PR #3 review B2 still applies: that `fx` has to enter the covariance, and a ray from a photo whose `fx` is loose must not be published as checked.

## 7. Print template

One A4 portrait page, black and white, **actual size**. The printer must not scale to fit.

```
297 mm
┌──────────────────────────────────────── 210 mm ─┐
│ + corner cross          top quiet 15 mm         │
│ ████████████████████████████████████████████    │ 14 mm  start: black
│ ████████████████████████████████████████████    │ 14 mm  start: black
│                                                 │ 14 mm  start: white
│  … 8 data bands, then 6 check bands …           │
│                                                 │ 14 mm  stop: white
│                                                 │ 14 mm  stop: white
│ +   A1 · 014          A1 · 014          overlap │ 16 mm  ID, twice
└─────────────────────────────────────────────────┘
                                              ↑
                                    10 mm glue strip
                                    (copy of the opposite edge)
```

- Bands run the full circumference. They stop at the glue strip. The **10 mm overlap is a copy of the first 10 mm** of the pattern, marked “glue under”, so the seam does not delete a bar or shift the rings.
- Corner crosses sit in the quiet zones, inset about 5 mm, so a trimmed sheet still has a reference.
- A tick on the overlap edge lines up with a tick on the opposite edge.
- Human text is the point name and the code number, printed **twice** across the bottom quiet zone, clear of the glue strip. Names avoid O and I.
- Matte paper. No laminate.
- The seam is vertical. The decoder reads a vertical profile, so a thin seam does not change the code. It must not become a dark ridge that splits the silhouette; press it flat.

## 8. Reading it, and the flat-tag comparison

In Safari, on the full 1× still: find the high-contrast column, fit the two edges, sample the profile **along the axis**, test the 19 runs, accept or reject. No library.

Tilt: the profile follows the fitted axis, not image y. Leaves or glare that merge or split a band fail the count or the CRC. That is a miss. Sun on a glossy sleeve is the reason the paper stays matte.

**Flat tag, for comparison only.** The largest comfortable square on this same A4 sheet, with a quiet margin, is about **180 mm**. On this camera that is 109 px at 5 m and 36 px at 15 m. Pose of a square fiducial is usually usable within about **±45° of straight-on**. Detection sometimes limps out toward **±70°** and then gets worse quickly; range from the homography goes first. Edge-on, which is what you see after you walk past a card stuck to a stick, it is not a target. Three tags around a 64 mm stick are curved, so they are not that fiducial either.

A flat tag would earn a place only as a **separate** calibration card if a taped sleeve fails to pin `fx` to about 1%. It is not printed on the sleeve.

## 9. What the reviewers should check

1. Is 14 mm / 19 bands / 256 IDs the right cut, or is a 16 mm band and fewer IDs safer at 8 m?
2. Is CRC-6 with no correction enough, given glare on matte paper?
3. Are the centreline lateral figures (a few millimetres) fair once the seam and a slight lean are included?
4. Is `+R` the right tape correction only for a near-face shot, as written?
5. Does the sleeve-plus-tape calibration really make a per-stick flat tag unnecessary?
