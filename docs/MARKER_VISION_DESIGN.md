# Markers and photo reading — draft for review

**Status:** proposal only. No detection code and no solver code. The cylindrical sleeve is the design. There is no AprilTag and no other flat tag in the field kit.

The Photo & Marker Vision Reviewer and the Geometry & Maths Advisor have both reviewed this note. Their points are applied below.

**Depends on:** the Phase 1 ray model in [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md) and PR #3 (`cursor/phase1-geometry-solver-8c5c`). This note does not change that branch. Stages: [ROADMAP.md](ROADMAP.md) Phase 2.

The stored point is the **axis of the stick at the ground**. The paper is a sleeve around the axis, and its height above the ground is recorded.

## 1. Recommendation

Print one **A4 portrait** sheet per mark. Horizontal bands run across the sheet. Roll the sheet into a cylinder and slide it over the stick. Any direction around the stick shows the same code.

Do not print an AprilTag, an ArUco, or any other flat tag. A face-on square code fails at a grazing angle, which is most of a walk around the garden, and it is not the focal-length prior. The sleeve gives a bearing to the axis (section 6). Focal length is one shared value per phone and 1× lens, solved in the adjustment from a checkerboard prior plus the raw sleeve elevations (section 6.3).

The sleeve is a **tight fit** on the stick it was cut for. A loose tube puts the silhouette on the paper, not on the stick.

Hand clicks stay. The tap is also the seed for where the decoder looks (section 8).

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

**Use the full width, about 64 mm,** unless the stick you already have is thinner. A wider stick is a wider silhouette (section 4). A thinner stick still uses this band layout; the unused side of the sheet stays blank and holds the corner marks and the rulers, and the overlap strip moves in to `πD + 10 mm`.

**The sleeve has to fit that stick.** The finished inside circumference is `πD`, the overlap is glued, and the paper must not be able to sit off to one side. If you can shift the tube so its axis leaves the stick, the centreline is not the point and the sleeve is rejected. Radial play after gluing should be under about **2 mm**. That is what keeps an off-centre sleeve out of the 8–24 mm centring budget in section 6.1.

## 3. Where the point is

The coordinate in the garden is the **axis at ground level**, not the paper surface and not the axis at sleeve height.

**Plumb rod.** Bearings and tapes meet the axis at the height of the sleeve. A lean `λ` moves the ground point by `h_s sin λ`, where `h_s` is the height of the sleeve centre. Record `h_s`. Plumb the rod with a bubble to about **1°**.

| Lean | Ground offset, sleeve centre at 0.5 m | At 1.0 m |
|---|---|---|
| 1° | 9 mm | 17 mm |
| 2° | 17 mm | 35 mm |
| 5° | 44 mm | 87 mm |

The sideways part of that lean shows up in the photo (the axis is not vertical after levelling) and can be taken out. The part along the line of sight does not show in one photo. With the bubble, carry it as `σ_λ` of about **1–2°**, which is the 9–17 mm row above when the sleeve centre is 0.5 m up. An unplumbed rod is stored as the axis at sleeve height and labelled with that bound; it is not the planting point.

**Centring term.** Every sleeve bearing carries `sigmaCentringM`, in metres. It is the `σ_centring` already in the geometry note:

`σ_β² = (σ_px / fx)² + (sigmaCentringM / d)²`.

It is not the pixel midline. Lean plus a sleeve that does not sit on the stick is **8–24 mm**, against a pixel-only claim of 1–3.5 mm. With the bubble at about 1° and the tight fit above, set `sigmaCentringM = 0.010`. If the rod is only known to about 2°, use **0.020**. If the sleeve can rattle, do not publish the bearing until the fit is fixed. The pixel noise stays in `σ_px` and is added as in the formula, not substituted for this term.

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

| Distance | mm per pixel | 13 mm band | 297 mm sleeve | 64 mm stick width |
|---|---|---|---|---|
| 2 m | 0.66 | 20 px | 450 px | 96 px |
| 5 m | 1.65 | **7.9 px** | 180 px | 39 px |
| 8 m | 2.64 | 4.9 px | 112 px | 24 px |
| 15 m | 4.95 | **2.6 px** | **60 px** | **13 px** |

Stick width in pixels is `fx × D / d`. At these ranges the exact tangent angle `2 arcsin(R / d)` matches that to a pixel.

A bar has to be about **8 px** tall before a black/white run is safe to classify after blur. A 14 mm bar is 8.5 px at 5 m. The sheet uses **13 mm** (7.9 px at 5 m) so the quiet zones can grow; see section 5. At 8 m that bar is 4.9 px. At 15 m it is 2.6 px.

## 5. The code that fits on 297 mm

Black is 1, white is 0. Quiet zones stay white.

The previous layout had no clock. Its black-black start occurs inside the data of **201 of 256** eight-bit IDs. ID `0x00` is eight black bands with no edge to count, so it is one stripe. The white-white stop has no edge against the white quiet zone, so the code does not end. Filtering that old field down to the IDs with no run longer than 3 (75 IDs in the vision review) still leaves the stop buried in the margin. That filter is not the printed code.

The clock is a run of four blacks, which the payload is not allowed to contain.

| Bands | Role |
|---|---|
| 5 | **Sync.** `11110` (black, black, black, black, white). The only run of four blacks. Its length divided by 4 is the module height. |
| 12 | **Payload.** Six data bits, then CRC-6. No run of either colour longer than 3. |
| 2 | **Stop.** `01` (white, then black). The last band is black, so it does not disappear into the white quiet zone. |

Vertical budget. The module is **13 mm**, not 14 mm, so the quiet zones can be more than one module. Nineteen bands of 14 mm left only 15 mm and 16 mm of quiet, which is the margin the vision review rejected. At 5 m, 13 mm is 7.9 px against 8.5 px for 14 mm. That is the cost of the larger margin.

| Strip | Height |
|---|---|
| Top quiet zone, white, with a 20 mm vertical check | 22 mm |
| **19 code bands × 13 mm** | **247 mm** |
| Bottom quiet zone, white, with the name and a 100 mm ruler | 28 mm |
| Total | **297 mm** |

**CRC.** The six check bits are the remainder of the six data bits on

`x⁶ + x⁴ + x³ + 1`

(the width-6 polynomial `0x19`). On the 12-bit word, and also on an 8-data-bit word of 14 bits, the minimum distance is **4**. CRC-6/ITU, `x⁶ + x + 1`, has distance **3** on both of those lengths, so it is not used. One flipped band fails the check. **Do not correct a bit.** A corrected band can name the wrong stick.

Of the 64 checksummed words, **28** have no run longer than 3. Those are the issued IDs: `05 07 08 0A 0B 0D 0E 11 12 14 17 19 1A 1B 1D 22 23 25 26 29 2E 32 33 34 35 36 39 3B`. `garden.json` maps each one to a name (`A1`, `HSE03`, `FNC01`, …).

**Is 28 enough?** For the marks you read from across the garden, only just. Six rod sleeves, about ten house corners and four fence discs is 20, with eight left for reprints and a lost sheet. A fuller boundary, eight to twelve posts, uses the rest. Baseline ends are those house corners or those rod marks, not a third set. Bed corners and path pegs are different: a few beds and a path can be fifteen to forty points. Put this sleeve on all of them and 28 is not enough.

Those bed and path points are named when you stand on them (`+ Point`). They do not need a code that reads at 5 m. They stay off this sleeve.

If the long-range set itself goes past about **24** (leave four codes for reprints), add a second bank. Do not shrink the module, and do not stack a second sheet yet.

| Option | What you get | What it costs |
|---|---|---|
| **Second bank (recommended if 28 runs out)** | Sync of **five** blacks instead of four. Same CRC, same run limit, same 13 mm module. Another 28 IDs, **56** in total. A run of five cannot appear in the payload, so the two syncs do not collide. | One extra band. Code height 260 mm, quiet zones about **18 mm** each, down from 22 and 28. Still above the 15 mm margin that was rejected. Module stays 7.9 px at 5 m. |
| Smaller module, more data bits | Eight data bits is 97 IDs, but that is 21 bands. At 11 mm the quiet zones fit, and 11 mm is 8 px at about **4.2 m**. | The 5 m ID promise moves in. |
| Two A4 sheets, 594 mm tall | Room for more bands at 13 mm with the current quiet zones. | The sleeve centre moves up, so the same lean is a larger ground error, and the paper catches the wind. |
| A colour prefix | Another bank with no extra height. | Needs a colour printer. A coloured band in sun is the brightness problem this code was built to avoid. |

Use the five-black bank when the long-range count passes about 24. Stack a second sheet only if 56 is still short. A shorter module is the wrong trade while ID at 5 m is the bar.

Decode from the sync, not from a hope that all 19 edges are visible. On the first bank the module height is the four-black run divided by 4, and there are 19 modules. On the second bank it is the five-black run divided by 5, and there are 20. Every other run must be 1, 2 or 3 modules. Same-colour bands are one run; they are not lost, because the sync sets the scale. Reject a second long black run, a module count that is not 19 or 20, a stop that is not white-then-black, or a failed CRC.

**Range of the ID.** Promise it at **2 m and 5 m** (20 px and 7.9 px per band). At **8 m** a band is 4.9 px: keep the ID only when the sync, the runs and the CRC all pass; otherwise reject the code. At **15 m** a band is 2.6 px: **no ID**.

## 6. Bearing, range, and focal length

### 6.1 Bearing

Take the mean of the two levelled edge azimuths (section 3). If each edge is good to `σ_e` pixels and the errors are independent, the midline is `σ_e / √2` pixels and

`σ_β = (σ_e / √2) / fx` radians.

With `fx = 3028` and `σ_e = 1 px`, `σ_β = 0.013°`. That **pixel** term is a lateral miss of **0.5 mm at 2 m, 1.2 mm at 5 m, 1.9 mm at 8 m, 3.5 mm at 15 m**. At 2 px on the edge at 15 m (the stick is only 13 px wide) it is **7 mm**. These figures are pixel noise only. They are not the precision of the ray.

Two larger terms sit on the same ray:

- **`fx`.** A 1% focal-length error moves a bearing by `sin β cos β × 1%`. At 20° off-centre that is 0.18°: **16 mm at 5 m** and **48 mm at 15 m**. Against the pixel term (1.2 mm and 3.5 mm) that is about **13×**. Across the frame the factor runs from about **4×** near the principal point to about **20×** well off it. `fx` is solved per phone and lens inside the adjustment (section 6.3), so the ellipse carries it. Do not quote the pixel row as the ray.
- **Lean and an off-centre sleeve**, via `sigmaCentringM` (section 3). Unchecked, those two are **8–24 mm**. With a 1° bubble and a tight fit the term is **10 mm**, still several times the pixel row. Sideways lean can be fitted. Along-sight lean stays in `σ_λ`.

The centreline is a valid Phase 1 ray across 2–15 m whenever both edges pass the width check in section 3. Without an ID there is still no point to attach it to, unless this sleeve is the only one in the frame and the user confirms the name.

### 6.2 Range from the sleeve

Do not use `d = fx · H / h_px`, and do not check the sleeve by its raw pixel height or its raw pixel width. A camera pitched down to frame a sleeve whose centre is 0.5 m below a 1.5 m camera overestimates `d = fx · H / h_px` by **24% at 2 m**, **3.4% (169 mm) at 5 m**, 1.2% at 8 m and 0.2% at 15 m. At 5 m that bias is 2.6 times the noise σ quoted below. Even without that pitch model, the elevation of the sleeve biases a pixel-height check by about **1–2%** at garden ranges, because the camera is above the paper. The width check in section 3 compares **levelled azimuths** with `2 arcsin(R / d)`. It does not compare pixel columns.

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
- **One `fx` per phone and per lens**, the 1× lens only, shared by every photo from that phone. The prior is a **checkerboard** of known square size, shot in several orientations, or the taped-rod calibration in [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md) §3.5. EXIF `FocalLengthIn35mmFormat` only checks that the photo is 1× (`fx/width` about 0.69–0.75). It is not the prior. A separate `fx` on each photo cannot carry a taped sleeve in photo `k` into photo `j`. The shared value is what the adjustment estimates; it is not a new unknown on every frame.
- `H` as one constant, or one parameter shared by that batch of paper. In a ratio of two sleeve observations `H` cancels, so the stock does not need an absolute height for ranging. It does for a first calibration. The printed rulers (section 7) are what tell you the sheet was not scaled before you trust `H` or `D`.

Ranging photo `k` with an `fx` taken from photo `k` only returns the tape. It is not a new observation. Publishing that range, and also publishing `fx` as a prior while photo `k` is still in the network, counts the same pixels twice. Derived ranges that all share one calibration photo also share that photo’s tape and edge errors; entering them as independent distances hides the correlation.

With the elevation model, the rim model, a plumbed rod, the checkerboard prior and this shared `fx`, about **1% is reachable at 3–5 m**. Several sleeves from different directions let the unseen lean average rather than sit in one photo. An AprilTag is not part of that calibration and is not printed.

## 7. Print template

One A4 portrait page, black and white, **actual size**. The printer must not scale to fit.

```
297 mm
┌──────────────────────────────────────── 210 mm ─┐
│ +  20 mm vertical check          top quiet 22 mm│
│ ████████████████████████████████████████████    │ 52 mm       sync: four blacks
│                                                 │ 13 mm       sync: white
│  … 12 payload bands, runs of at most 3 …        │
│                                                 │ 13 mm       stop white
│ ████████████████████████████████████████████    │ 13 mm       stop black
│ |--------- 100 mm ruler --------|  A1 · 05      │ 28 mm quiet
└─────────────────────────────────────────────────┘
                                              ↑
                                    10 mm glue strip
                                    (copy of the opposite edge)
```

- Bands run the full circumference. They stop at the glue strip. The **10 mm overlap is a copy of the first 10 mm** of the pattern, marked “glue under”, so the seam does not delete a bar or shift the rings. Glue it so the paper cannot slide off the stick axis (section 2).
- Corner crosses sit in the quiet zones, inset about 5 mm.
- A tick on the overlap edge lines up with a tick on the opposite edge.
- **Rulers, checked before the sheet is rolled.** A **100 mm** horizontal ruler in the bottom quiet zone, and a **20 mm** vertical pair in the top quiet zone. Both must match a steel rule. The four-black sync must measure **52 mm**. If any of those is short or long, the printer scaled the page. Do not use the sheet: `H` and `D` would enter the solve at the wrong size.
- Human text is the point name and the issued code, printed **twice** across the bottom quiet zone, clear of the glue strip and of the ruler. Names avoid O and I.
- **Stock.** Laser print, or pigment ink, on matte synthetic paper (a polyester sheet). Dye ink on copy paper dies in rain and is not acceptable. Gloss laminate is not acceptable either: the profile reader fails on a specular sleeve. A matte pouch is fine if the rulers still measure true after it is sealed.
- The seam is vertical. The decoder reads a vertical profile, so a thin seam does not change the code. It must not become a dark ridge that splits the silhouette; press it flat.

## 8. Reading it

On the full 1× still, in Safari. No library, and no scan of the whole frame for a stick.

The user **taps the column**. That tap is the seed and, if the code is rejected, it is still the hand click. Around the seed, fit the two silhouette edges on many rows. Use a robust fit: drop outlier rows (a leaf, a shadow edge, the seam) instead of letting one bright edge win. Then the width check in section 3. If the two edges are not stable, reject the code and keep the tap.

The profile follows the fitted axis, not image y. The clock is the four-black sync (section 5). A run that is not an integer module, a second run of four blacks, or a CRC failure is a miss. Sun on a gloss sleeve is why the stock in section 7 is matte.

A flat tag is not in this comparison as a thing we might still print. A square fiducial the size of this sheet (about 180 mm) is about 109 px at 5 m and 36 px at 15 m, and it is only usable within about ±45° of straight-on. That is the wrong tool on a stick you walk around. Intrinsics come from the checkerboard, once per phone and lens, not from a tag in the garden.

## 9. What is still open

Both reviews are applied. What is left is practical, not a second code:

1. Count the long-range marks before printing. Twenty-eight covers rods, the house and a short fence. Past about 24, print the five-black bank (56 IDs) rather than a shorter module. Beds and paths stay unnamed by this sleeve.
2. The checkerboard prior and `sigmaCentringM` have to be in the solver when Phase 2 wires detections into it. This note does not change PR #3.
