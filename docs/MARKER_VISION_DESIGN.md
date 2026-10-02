# Markers and photo reading — draft for review

**Status:** proposal only. No detection code and no solver code. The cylindrical sleeve is the design. A flat tag is an optional extra and is not in the standard print.

The Photo & Marker Vision Reviewer should review the code, the print sheet, and the Safari path. The Geometry & Maths Advisor should review the pixel scale, the centreline bearing, the range estimate, and the radius offset.

**Depends on:** the Phase 1 ray model in [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md) and PR #3 (`cursor/phase1-geometry-solver-8c5c`). This note does not change that branch. Stages: [ROADMAP.md](ROADMAP.md) Phase 2.

The stored point is the **axis of the stick at the ground**. The paper is a sleeve around the axis, and its height above the ground is recorded.

## 1. Recommendation

Print one **A4 portrait** sheet per mark. Horizontal bands run across the sheet. Roll the sheet into a cylinder and slide it over the stick. Any direction around the stick shows the same code.

Do not put a flat AprilTag or ArUco on the stick. A face-on square code fails at a grazing angle, which is most of a walk around the garden. The sleeve gives a bearing to the axis (section 6). Focal length is not computed up front: the tape and the sleeve ends go into the adjustment as raw observations, with one `fx` per phone (section 6). A flat tag earns a place only if that shared calibration misses about 1%. It is not part of this template.

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

The coordinate in the garden is the **axis at ground level**, not the paper surface and not the axis at sleeve height.

**Plumb rod.** Bearings and tapes meet the axis at the height of the sleeve. A lean `λ` moves the ground point by `h_s sin λ`, where `h_s` is the height of the sleeve centre. Record `h_s`. Plumb the rod with a bubble to about **1°**.

| Lean | Ground offset, sleeve centre at 0.5 m | At 1.0 m |
|---|---|---|
| 1° | 9 mm | 17 mm |
| 2° | 17 mm | 35 mm |
| 5° | 44 mm | 87 mm |

The sideways part of that lean shows up in the photo (the axis is not vertical after levelling) and can be taken out. The part along the line of sight does not show in one photo. With the bubble, carry it as `σ_λ` of about **1–2°**, which is the 9–17 mm row above when the sleeve centre is 0.5 m up. An unplumbed rod is stored as the axis at sleeve height and labelled with that bound; it is not the planting point.

**Centreline.** For a plumb rod the two tangent planes are vertical and symmetric about the plane through the axis, so the mean of the two edge **azimuths** is the axis azimuth at any distance and any off-centre angle. Average those levelled azimuths. Averaging pixel columns instead biases the bearing by about `tan β · (R / d)²`: 0.008° (0.3 mm) at 2 m and 30° off-centre. Small, and avoided by using azimuths. The bearing has **no** radial offset. It does not depend on reading the code.

**Surface tape or laser.** Reduce the slope distance to horizontal first, then add `R` (31.8 mm on the full-width stick). The nearest point on the cylinder is horizontal from the axis. Adding `R` along the slope and reducing afterwards leaves `R cos α`, about 2 mm short at 20°. A tape that hooks a small angle `φ` around the face reads short by about `R (1 − cos φ)`: 4 mm at 30°.

A laser spot a sideways distance `e` from the axis hits `√(R² − e²)` in front of the axis, not `R`. Still add `+R`. The over-correction is 1 mm, 4 mm and 11 mm at `e = R/4`, `R/2` and `3R/4`. Dropping the correction is wrong by 31 mm, 28 mm and 21 mm at those same offsets. Retake only when the spot is more than about **`R/2` (16 mm)** off the centreline.

When a range is known, reject the bearing if the fitted angular width differs from `2 arcsin(R / d)` by more than about 3σ. That catches an edge that has locked onto a shadow. A 0.5 px difference between the two edge biases moves the midline by about 1 mm at 15 m, which is inside this check.

A wall disc is a different case: millimetres plus a fixed direction (inward normal of that edge). The stick’s radius is not that offset.

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
| 3 | **Start.** Black, black, white, at the top of an upright sleeve. |
| 8 | **Data.** 256 IDs. `garden.json` maps the number to `A1`, `HSE03`, `FNC01`, and so on. |
| 6 | **Check.** CRC-6 over the data. One flipped band fails the check. |
| 2 | **Stop.** White, white, at the bottom. |

Plain data plus CRC-6 **can** contain two blacks in a row, and can contain the start or stop pattern in the middle. Orientation is the whole frame: 19 bands, start pattern at one end, stop pattern at the other. Upside-down fails that pair of ends. It is not a second ID.

Equal bands of the same colour merge into one run. Read a run as `n` modules when its length is `n` times one band. The full stack of 19 bands sets that module scale, so a merged run is still countable.

Decode only if the count is 19, the start is at the top, the stop is at the bottom, and the CRC matches. **Reject otherwise. Do not correct a bit.** A corrected band can name the wrong stick.

64 rods, corners, and posts fit easily in 256. The spare codes are reprints and new posts, not a second garden’s worth of cleverness.

**Range of the ID.** Promise it at **2 m and 5 m** (21 px and 8.5 px per band). At **8 m** a band is 5.3 px: keep the ID only when all 19 runs are found and the CRC passes; otherwise reject the code. At **15 m** a band is 2.8 px: **no ID**.

The previous 15-bar width code (64 IDs, about 250 mm) is retired. It spent the paper on wide bars and still missed the 8 px floor once quiet zones were included.

## 6. Bearing, range, and focal length

### 6.1 Bearing

Take the mean of the two levelled edge azimuths (section 3). If each edge is good to `σ_e` pixels and the errors are independent, the midline is `σ_e / √2` pixels and

`σ_β = (σ_e / √2) / fx` radians.

With `fx = 3028` and `σ_e = 1 px`, `σ_β = 0.013°`. That **pixel** term is a lateral miss of **0.5 mm at 2 m, 1.2 mm at 5 m, 1.9 mm at 8 m, 3.5 mm at 15 m**. At 2 px on the edge at 15 m (the stick is only 13 px wide) it is **7 mm**. These figures are pixel noise only. They are not the precision of the ray.

Two larger terms sit on the same ray:

- **`fx`.** A 1% focal-length error moves a bearing by `sin β cos β × 1%`. At 20° off-centre that is 0.18°: **16 mm at 5 m** and **48 mm at 15 m**, about ten times the pixel term. `fx` is a parameter in the adjustment, so the ellipse carries it. Do not quote the pixel row as the ray.
- **Rod lean**, section 3. The ray hits the axis at sleeve height. The ground point is off by `h_s sin λ`: **17 mm at 2°** when the sleeve centre is 0.5 m up, and 35 mm if it is 1.0 m up. Sideways lean can be fitted. Along-sight lean stays in `σ_λ`.

The centreline is a valid Phase 1 ray across 2–15 m whenever both edges pass the width check in section 3. Without an ID there is still no point to attach it to, unless this sleeve is the only one in the frame and the user confirms the name.

### 6.2 Range from the sleeve

Do not use `d = fx · H / h_px`. That formula assumes the sleeve is square to the optical axis. A camera pitched down to frame a sleeve whose centre is 0.5 m below a 1.5 m camera overestimates `d` by **24% at 2 m**, **3.4% (169 mm) at 5 m**, 1.2% at 8 m and 0.2% at 15 m. At 5 m that bias is 2.6 times the noise σ quoted below.

Use the levelled elevation of each end:

`d = H / (tan e_top − tan e_bot)`.

That is exact for a **plumb** sleeve at any camera pitch.

**Rims.** The visible end of the paper is not at the axis distance.

- If the stick runs through the sleeve, the centreline ends are the **front** rims, at `d − R`. The elevation formula then returns the front surface, **32 mm short at every range**. Add `R`.
- If the top of the sleeve is against the sky, the top silhouette is the **far** rim and the bottom is the **near** rim. Leaving that unmodelled biases the range by about `−2R tan(e_mid) / H`: **−4.1% (−206 mm) at 5 m** and −1.4% at 15 m with the sleeve centre at 0.5 m, and −2.1% at 5 m with it at 1.0 m.

Each end is near or far according to the sign of its height relative to the camera. Solve with `d ± R` in that end’s ray.

**Lean toward the camera** is first order once the camera looks down. It is not `1 − cos λ`. On the front-rim model with `+R`, sleeve centre at 0.5 m:

| Lean toward the camera | 2 m | 5 m | 15 m |
|---|---|---|---|
| 2° | +1.6% | +0.7% | +0.3% |
| 5° | +4.3% | +1.9% | +0.9% |
| 10° | +10.1% | +4.7% | +2.6% |

Leaning away by 10° is −1.4% at 5 m. This component is invisible in one photo. A “drop the range past 15°” rule is too loose for a 1% use. Plumb the rod and carry `σ_λ` of about 1–2° inside the range σ.

**Noise only**, for the same formula, is still worth stating so it is not confused with the biases above. `σ_h ≈ √2` px at 1 px per end. The pixel term grows as `d²` (`σ_d,pix = √2 · d² / (fx · H)`); the `fx` term grows as `d`.

| Distance | Sleeve in pixels | Edge term | Noise, `fx` to 1% | Noise, `fx` to 5% |
|---|---|---|---|---|
| 2 m | 450 px | 0.3% | 21 mm | 100 mm |
| 5 m | 180 px | 0.8% | 64 mm | 253 mm |
| 8 m | 112 px | 1.3% | 129 mm | 412 mm |
| 15 m | 60 px | 2.4% | 384 mm | 829 mm |

The pixel term passes the `fx` term at about 8 m. At 15 m with 2 px per end (realistic on a 60 px sleeve) the noise is about **720 mm**. Pitch, rim and lean, if left unmodelled, are larger than this noise at garden ranges. The observation that enters the solver is the elevation form with the rim choice, and its σ includes the edge fit and `σ_λ`. It is a weak distance, not a tape.

**Choosing between the two station candidates.** Two marks and one tape leave two stations on the tape circle (geometry note, §3.3). A range **to the taped mark** is the same from both, so it cannot separate them. The useful number is the range to **another** sleeve (the other baseline end, or a third mark): `Δ = |d(P1) − d(P2)|`. How far apart the stations are in the garden is the wrong test.

On the 7 m baseline at 20°, a 15 m tape to A, the ranges from the two candidates to B are 18.9 m and 9.3 m. Closer to the far intersection (`r → 2R ≈ 20.5 m`) those two ranges to B converge. Separation in units of the **pixel-and-fx noise** (not yet including lean):

| Tape to A | Ranges to B | 1 px ends, 1% `fx` | 2 px ends, 1% `fx` | 2 px ends, 5% `fx` |
|---|---|---|---|---|
| 15 m | 18.9 / 9.3 m | 16σ | 8.4σ | 6.5σ |
| 17 m | 19.9 / 12.1 m | 12σ | 6.2σ | 4.9σ |
| 19 m | 20.5 / 15.3 m | 7.6σ | 3.9σ (2.5% wrong) | 3.1σ (6%) |
| 20 m | 20.3 / 17.3 m | 4.4σ | 2.3σ (13% wrong) | 1.8σ (18%) |
| 20.4 m | 19.7 / 18.6 m | 1.8σ (19% wrong) | 0.9σ | 0.7σ |

`P(wrong) = Φ(−Δ / 2σ)` for a pick of the nearer candidate. Accept a pick only when **`Δ ≥ 6σ`** (about 0.13% wrong) **and** the observed range is within **2.5σ** of the chosen candidate. Otherwise leave the station unset or ask. **Label the pick unchecked** either way: a branch choice has no spare observation. The `σ` in that test is the observation’s own σ (edge fit, shared `fx`, and `σ_λ`), not the noise column alone.

### 6.3 Focal length, as raw observations

Do not solve `fx = h_px · d / H` and then reuse it. That misses the 1% bar, and it double-counts.

The noise budget at 5 m is real: sleeve ends 0.8% at 1 px, tape 20 mm is 0.4%, together about 0.9%. ISO 216 allows ±2 mm on 297 mm (about 0.4% more) unless the trimmed sheet is measured. The biases are the problem. Pitch (+3.4% at 5 m), rim (−0.6% or −4%) and a 2° lean toward the camera (+0.7% at 5 m) all land at full size on a derived `fx`. The formula in the previous draft misses 1% by about three times.

Enter the adjustment with the raw pieces, not a derived range and not a derived `fx`:

- The tape as a distance. It is the horizontal distance from the **lens** to the axis (surface reading, slope reduced, then `+R`). A 10 mm mistake in where the lens is costs 0.2% at 5 m.
- Each sleeve end as a levelled elevation. Equivalently `tan e_top − tan e_bot = H / (d ± R)`, with the rim choice above. σ comes from the edge fit plus `σ_λ`.
- **One `fx` per phone and 1× zoom**, shared by every photo from that phone, with a loose EXIF prior (`fx/width` about 0.69–0.75). This is the constant in [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md) §3.5. A separate `fx` on each photo cannot carry a taped sleeve in photo `k` into photo `j`.
- `H` as one constant, or one parameter shared by that batch of paper. In a ratio of two sleeve observations `H` cancels, so the stock does not need an absolute height for ranging. It does for a first calibration.

Ranging photo `k` with an `fx` taken from photo `k` only returns the tape. It is not a new observation. Publishing that range, and also publishing `fx` as a prior while photo `k` is still in the network, counts the same pixels twice. Derived ranges that all share one calibration photo also share that photo’s tape and edge errors; entering them as independent distances hides the correlation.

With the elevation model, the rim model, a plumbed rod and this shared `fx`, about **1% is reachable at 3–5 m**. Several sleeves from different directions let the unseen lean average rather than sit in one photo. A flat tag on the stick is still unnecessary under that model. The previous derived-range calibration is not.

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

Tilt: the profile follows the fitted axis, not image y. Same-colour bands are one run of `n` modules (section 5). A run whose length is not an integer module, or a CRC failure, is a miss. Sun on a glossy sleeve is the reason the paper stays matte.

**Flat tag, for comparison only.** The largest comfortable square on this same A4 sheet, with a quiet margin, is about **180 mm**. On this camera that is 109 px at 5 m and 36 px at 15 m. Pose of a square fiducial is usually usable within about **±45° of straight-on**. Detection sometimes limps out toward **±70°** and then gets worse quickly; range from the homography goes first. Edge-on, which is what you see after you walk past a card stuck to a stick, it is not a target. Three tags around a 64 mm stick are curved, so they are not that fiducial either.

A flat tag would earn a place only as a **separate** calibration card if the shared-`fx` model in section 6.3 misses about 1%. It is not printed on the sleeve.

## 9. What is still open

The maths review of this note (PR #2) is applied above. Still for the Photo & Marker Vision Reviewer, who has not commented yet:

1. Is 14 mm / 19 bands / 256 IDs the right cut, or is a 16 mm band and fewer IDs safer at 8 m?
2. Is CRC-6 with no correction enough, given glare on matte paper? Orientation is the full frame (start at one end, stop at the other), because two blacks in a row can occur in the data.
