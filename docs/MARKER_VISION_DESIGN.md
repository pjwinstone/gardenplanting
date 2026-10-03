# Markers and photo reading — draft for review

**Status:** proposal only. No detection code and no solver code. The cylindrical sleeve is the design. There is no AprilTag and no other flat tag in the field kit.

The Photo & Marker Vision Reviewer and the Geometry & Maths Advisor have both reviewed this note. Their points are applied below.

**Depends on:** the Phase 1 ray model in [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md) and PR #3 (`cursor/phase1-geometry-solver-8c5c`). This note does not change that branch. Stages: [ROADMAP.md](ROADMAP.md) Phase 2.

The stored point is the **axis of the stick at the ground**. The paper is a sleeve around the axis, and its height above the ground is recorded.

## 1. Recommendation

Print one **A4 portrait** sheet per mark. Horizontal bands run across the sheet. Wrap the sheet tight around the dowel and glue it to the wood. Any direction around the stick shows the same code.

Do not print an AprilTag, an ArUco, or any other flat tag. A face-on square code fails at a grazing angle, which is most of a walk around the garden, and it is not the focal-length prior. The sleeve gives a bearing to the axis (section 6). The merged solver keeps a separate focal prior on each photo. One shared value per phone and 1× lens, from a checkerboard prior plus the raw sleeve elevations, is the planned follow-up after the circle field trial (section 6.3).

The sleeve is glued tight to the 60 mm dowel. A loose tube puts the silhouette on the paper, not on the stick.

Hand clicks stay. The tap is also the seed for where the decoder looks (section 8).

## 2. Sheet, stick, and diameter

A4 portrait is **210 mm** wide and **297 mm** tall. The short side goes around the stick. The long side becomes the height of the sleeve. Bands are horizontal, so they become rings.

Printers leave an unprintable border of about **3–5 mm**. This template assumes the worse end, **5 mm**, so one sheet works on a typical home printer. Trim that border off every visible edge. It is not part of the finished sleeve.

**Around the stick.** Trim **5 mm** off the visible vertical edge. That leaves **205 mm** of paper. Wrap that sheet **tight** around a **60 mm** dowel and glue it to the wood. The overlap is whatever is left:

`205 − π × 60 = 205 − 188.5 = 16.5 mm`

(about **15–17 mm**). That overlap is the glue flap, and it runs **down the side seam**. It is not a strip along the bottom. The outer 5 mm of the flap is the unprintable border, hidden under the glue, so about 11 mm of the overlap is printed paper.

The outside of the sleeve is the dowel plus the sheet. For matte PP/PET about **0.2 mm** thick the expected outside diameter and radius are

`D = 60 + 2 × 0.2 = 60.4 mm`,

`R = 30 + 0.2 = 30.2 mm`.

**Measure `R` on each finished sleeve and store that value.** Stock and glue move it. The 30.2 mm figure is the expectation, not the observation. The laser offset is the stored `R`.

**Along the stick.** Trim **5 mm** off the top and **5 mm** off the bottom. Finished height:

`H = 297 − 10 = 287 mm`.

There is no glue on those ends. The flap is the side seam, so both ends are cut. The band layout below is unchanged.

| Stick | Circumference | Overlap on the 205 mm sheet | Expected outside D |
|---|---|---|---|
| **60 mm dowel** | **188.5 mm** | **16.5 mm** | **60.4 mm** (0.2 mm sheet) |
| 60.3 mm tube | 189.4 mm | 15.6 mm | 60.7 mm, same kind of wrap; store its own `R` |
| 63 mm pipe | 197.9 mm | **7 mm** | does not snug; the seam is too short |

A **63 mm** pipe does not get this sheet. After the 5 mm trim only 7 mm is left to glue, and 5 mm of that is unprinted. Wrap the 60 mm dowel. A 60.3 mm tube still falls in the 15–17 mm overlap; the expected `R` in the rest of this note is the 60 mm dowel.

Glue the paper down. A loose tube, or a sleeve you can shift on the stick, is not a published bearing: the centreline would follow the paper, not the dowel. Do not wrap this full sheet around a thinner cane. Cut a shorter sheet (`π × dowel + about 16 mm`) for a thinner stick.

## 3. Where the point is

The coordinate in the garden is the **axis at ground level**, not the paper surface and not the axis at sleeve height.

**Marked height.** Bearings and tapes meet the axis at the sleeve. Mark the sleeve middle on the stick at a fixed height, **0.45 m**, and store that height with the point. That mark is where the sleeve is tied. It is not half of `H`, so cutting the sheet from 297 mm down to 287 mm does not move it. A lean `λ` moves the ground point by `h_s sin λ`: **7.9 mm at 1°** and **24 mm at 3°** with the middle at 0.45 m. That is the centring budget, not the 1–3.5 mm pixel row.

The sideways part of the lean shows up in the photo. Fit the tilted axis, level it with the gravity sample, and extrapolate to the ground. The part along the line of sight does not show in one photo. Plumb the rod to about **1°**. If the sideways lean is fitted, `sigmaCentringM` is only that unseen part, about **8 mm** at 1°. If it is not fitted and the rod may be 3° off, use **0.024 m**. An unplumbed rod is stored as the axis at sleeve height and labelled with that bound; it is not the planting point.

**Centring term.** Every sleeve bearing carries `sigmaCentringM`, in metres. It is the centring piece of the bearing sigma in the geometry note (PR #3 `bearingSigma`):

`σ_β² = (σ_px / fx)² + (sigmaCentringM / d)²`.

It is not the pixel midline. A sleeve that is not glued tight to the dowel adds a shift of the paper axis on top of the lean. Do not publish that bearing. The pixel noise stays in `σ_px`.

**Centreline.** For a plumb rod the two tangent planes are vertical and symmetric about the plane through the axis, so the mean of the two edge **azimuths** is the axis azimuth at any distance and any off-centre angle. Average those levelled azimuths. Averaging pixel columns instead biases the bearing by about `tan β · (R / d)²`: 0.008° (0.3 mm) at 2 m and 30° off-centre. Small, and avoided by using azimuths. The bearing has **no** radial offset. It does not depend on reading the code.

**Surface tape or laser.** Reduce the slope distance to horizontal first, then add the stored `R`. The expected value on this sleeve is **30.2 mm**. The nearest point on the cylinder is horizontal from the axis. Adding `R` along the slope and reducing afterwards leaves `R cos α`, about 2 mm short at 20°. A tape that hooks a small angle `φ` around the face reads short by about `R (1 − cos φ)`: 4 mm at 30°.

A laser spot a sideways distance `e` from the axis hits `√(R² − e²)` in front of the axis, not `R`. Still add `+R`. At the expected 30.2 mm the over-correction is 1 mm, 4 mm and 10 mm at `e = R/4`, `R/2` and `3R/4`. Dropping the correction is wrong by 29 mm, 26 mm and 20 mm at those same offsets. Retake only when the spot is more than about **`R/2` (15 mm)** off the centreline.

When a range is known, reject the bearing if the fitted angular width differs from `2 arcsin(R / d)` by more than about 3σ. That catches an edge that has locked onto a shadow. A 0.5 px difference between the two edge biases moves the midline by about 1 mm at 15 m, which is inside this check.

A wall disc is a different case: millimetres plus a fixed direction (inward normal of that edge). The stick’s radius is not that offset.

This is roadmap decision 6. The old “about 50 mm to the front of a toilet roll” figure is the right kind of correction and the wrong length for this sleeve.

## 4. Pixel scale

Working camera: iPhone **1×**, **26 mm** equivalent, 4:3 still, **4032 × 3024**. The 35 mm frame is 43.3 mm on the diagonal, so the 4:3 width is `43.3 × 0.8 = 34.6 mm` and

`fx / width = 26 / 34.6 = 0.751`, `fx = 0.751 × 4032 = 3028 px`.

A 24 mm-equivalent phone is `fx ≈ 2798 px`. On that camera a 13 mm band is **7.3 px** at 5 m and reaches 8 px at about **4.5 m**. On the 26 mm working camera, 8 px is about **4.9 m** (7.9 px at 5 m). The ID promise is that 4.9 m figure, and it has to be re-measured if the phone is 24 mm. Pro phones can open on a 24, 28 or 35 mm main lens. Read the real image width; do not assume 4032. A 24 MP default on iPhone 15 and later is unverified. The 1920-wide preview is `fx ≈ 1442 px` and is not the detection image. Figures below use 3028 px unless they say otherwise.

Millimetres per pixel = `1000 × d / fx`:

| Distance | mm per pixel | 13 mm band | 287 mm sleeve | 60.4 mm stick width |
|---|---|---|---|---|
| 2 m | 0.66 | 20 px | 435 px | 91 px |
| 5 m | 1.65 | **7.9 px** | 174 px | 37 px |
| 8 m | 2.64 | 4.9 px | 109 px | 23 px |
| 15 m | 4.95 | **2.6 px** | **58 px** | **12.2 px** |

Stick width in pixels is `fx × D / d`. At these ranges the exact tangent angle `2 arcsin(R / d)` matches that to a pixel.

A bar has to be about **8 px** tall before a black/white run is safe to classify after blur. On this camera that is **about 4.9 m** for a 13 mm band, not 5 m: at 5 m the band is 7.9 px, under the floor. A 14 mm bar would be 8.5 px at 5 m. The sheet keeps **13 mm** so the quiet zones still fit (section 5), and the ID promise stops at about 4.9 m. At 8 m that bar is 4.9 px. At 15 m it is 2.6 px.

## 5. The code that fits on the 287 mm sleeve

Black is 1, white is 0. Quiet zones stay white.

The previous layout had no clock. Its black-black start occurs inside the data of **201 of 256** eight-bit IDs. ID `0x00` is `BBW` plus a run of whites: one black stripe about 28 mm tall, with no edges to count. Twelve IDs have a run of eight bands or more, and at 8 m telling eight bands from nine needs the pitch known to about 6% while perspective and lean move it by 2–5%. The white-white stop has no edge against the bottom quiet zone. Filtering that old layout to runs of at most three, with CRC-6 on `x⁶ + x⁴ + x³ + 1`, init 0 and xorout `0x2A`, leaves **75** IDs, and the white stop is still buried in the margin. That filter is not the printed code.

The clock is a run of four blacks, which the payload is not allowed to contain.

| Bands | Role |
|---|---|
| 5 | **Sync.** `11110` (black, black, black, black, white). The only run of four blacks. Upside-down puts this run at the bottom, so orientation is the sync, not a guess. |
| 12 | **Payload.** One of the 61 issued words below. No run of either colour longer than 3. |
| 2 | **Stop.** `01` (white, then black). The last band is black, so the code ends on an edge. |

Vertical budget, on the **finished** sleeve. The module is **13 mm**, not 14 mm, so an empty quiet zone still fits. Nineteen bands of 14 mm left only 15 mm and 16 mm beside the code, and that strip also held the text, so it was not a quiet zone. At 5 m, 13 mm is 7.9 px on the 26 mm working camera, against 8.5 px for 14 mm. A width-coded stack in the old 266 mm code height holds `266 / (1.5 × 14) = 12.7` bars, not about ten; it still cannot carry a sync, a distance-4 payload and a black stop.

| Strip | Height |
|---|---|
| Name, corner cross, outside the quiet zone | 9 mm |
| **Empty quiet zone** | **8 mm** |
| **19 code bands × 13 mm** | **247 mm** |
| **Empty quiet zone** | **8 mm** |
| Name again, and the wrap-direction ruler, outside the quiet zone | 15 mm |
| **Finished height H** | **287 mm** |

The A4 sheet is 297 mm tall. Trim 5 mm off the top and 5 mm off the bottom before the sleeve is rolled. Those offcuts are the unprintable border. They are not part of `H`, and neither of them is a glue flap. The glue flap is the side seam in section 2, about 16.5 mm where the sheet overlaps on the 60 mm dowel.

The 8 mm bands are white and empty. Text, crosses and rulers sit beyond them. The visible side edge is trimmed printed paper, not a white stripe. The side flap, marked “glue under”, is a copy of the overlapping 16.5 mm of the pattern, with the printer’s blank outer 5 mm on the hidden side.

**Which 12-bit words.** Two constructions both refuse a run longer than 3, and both have minimum distance 4. Distance 4 means one, two or three flipped bands cannot become another issued ID. Neither construction corrects a bit.

| Code | Issued IDs | Minimum distance | What a 4-band burst does |
|---|---|---|---|
| CRC-6 on `x⁶ + x⁴ + x³ + 1` (`0x19`), init 0, xorout 0, six data bits, then drop words that break the run limit **and** the end-run rule below | **24** | 4 | About **1.5%** of random 4-band bursts land on another issued ID on the 28-word list (run limit only). The end-run rule leaves **24**, so that rate is no higher. |
| Greedy list, below | **61** | 4 | About **3.7%** of random 4-band flips, and about **7.3%** of four **adjacent** bands (a leaf across the stack), land on another issued ID |

CRC-6/ITU (`x⁶ + x + 1`) is distance 3 at 14 bits (ten weight-3 words), so it is not a candidate. The CRC list is the safer of the two only after four bands have already flipped, because it has fewer targets. Up to three flips they are the same: no wrong ID. The greedy list has the IDs. **Issue the 61.** Acceptance is membership of that list, not a syndrome. A 4-band burst is a damaged sleeve; the projective fit and the run limit still have to pass.

Build the list in numeric order from the 12-bit words with no run longer than 3 and at most two white bands at either end (the sync ends on one white, the stop starts on one white; three more would make a run of four across the join). Keep a word when its distance to every kept word is at least 4 and neither its reverse nor its complement is already kept. That is 61 words. The reverse and the complement of an issued word are not issued.

`222 22D 244 24B 271 28E 293 2B4 2DD 2E7 315 31A 36E 389 447 459 46A 474 48B 495 4A6 4CC 4D2 513 51C 525 5B9 637 6BA 6E9 72B 74D 756 88D 896 8A3 8CA 8D1 919 926 94C 952 96B 975 9BA 9C7 A3B A57 B9C BA5 C6D C73 DAC DB7 DC9 DD4 E24 E4E E99 EC5 EE2`

`garden.json` maps each one to a name (`A1`, `HSE03`, `FNC01`, …).

**Is 61 enough?** Six rod sleeves, about ten house corners and a fence of eight to twelve posts is about 30, with reprints left over. Baseline ends are those house corners or those rod marks. Bed corners and path pegs are another fifteen to forty if each outline is coded, and 61 does not cover that. Those points are named when you stand on them (`+ Point`). They stay off this sleeve.

Sixty-one is enough for now. Do not print a second bank, do not shrink the module, and do not stack a second sheet.

| Option | What you get | What it costs |
|---|---|---|
| **Second bank — future only, not printed** | Sync of **five** blacks instead of four. The same 61 words. **122** IDs, if it is ever used. | See below. Not on this sheet. |
| Smaller module, more payload bits | More words, and the 8 px floor moves in from about 4.9 m. At 11 mm a band is 8 px at about **4.2 m**. | The 4.9 m ID promise goes. |
| Two A4 sheets, 594 mm tall | Room for a longer payload at 13 mm. | The sleeve centre moves up, so the same lean is a larger ground error, and the paper catches the wind. |
| A colour prefix | Another bank with no extra height. | Needs a colour printer. A coloured band in sun is the brightness problem this code was built to avoid. |

**Second bank, if it is ever used.** It is not printed with this design. Twenty bands are `20 × 13 = 260 mm`. On the 287 mm sleeve the two 8 mm quiet zones stay, so the name strips together have only **11 mm** (they are 24 mm on the printed layout). That squeezes the legend. Hamming distance does not separate the banks: both banks use the same 61 words, and a damaged sync can look like the other clock. Using it would require three things that are not done yet. Fit both layouts and accept an ID only when one of them is a clear winner. Add bank confusion to the synthetic test. Promise no ID past **5 m** until that test exists.

Decode with a **1-D projective fit** from the start of the sync to the black stop edge. Equal bands on the paper are not equal steps in the image once the camera pitches. Do not chop the stack into 19 equal pixel slices, and do not take the whole height divided by 19 as the module. The four-black run checks the clock. Each run must then fall on an integer number of those fitted positions, 1, 2 or 3. Reject a second run of four blacks, a word that is not in the list, a stop that is not white-then-black, or a fit that does not land on the edges. **Text beyond the stop is ignored.** The 8 mm quiet zone is only about **0.6 of a band** (`8 / 13`), so a name or a ruler printed past it must not be read as another module.

**Range of the ID.** Promise it from **2 m** (20 px per band) out to **about 4.9 m**, where a 13 mm band is 8 px. At **5 m** it is 7.9 px, under that floor, so 5 m is not the promise. At **8 m** a band is 4.9 px: keep the ID only when the word is in the issued list; otherwise reject the code. At **15 m** a band is 2.6 px: **no ID**.

## 6. Bearing, range, and focal length

### 6.1 Bearing

Take the mean of the two levelled edge azimuths (section 3). If each edge is good to `σ_e` pixels and the errors are independent, the midline is `σ_e / √2` pixels and

`σ_β = (σ_e / √2) / fx` radians.

With `fx = 3028` and `σ_e = 1 px`, `σ_β = 0.013°`. That **pixel** term is a lateral miss of **0.5 mm at 2 m, 1.2 mm at 5 m, 1.9 mm at 8 m, 3.5 mm at 15 m**. At 2 px on the edge at 15 m (the stick is only 12.2 px wide) it is **7 mm**. These figures are pixel noise only. They are not the precision of the ray.

Two larger terms sit on the same ray:

- **`fx`.** A 1% focal-length error moves a bearing by `sin β cos β × 1%`: **0.05° at 5° off-centre, 0.18° at 20°, and 0.26° at the edge**. Centreline noise at 1 px is **0.013°**, so the focal term is **4–20×** larger, and it is the same for every photo from that phone. At 20° off-centre the lateral miss is **6 mm at 2 m, 16 mm at 5 m, 26 mm at 8 m and 48 mm at 15 m**. The merged solver still keeps a separate focal prior on each photo. One value per phone and lens is the follow-up in section 6.3. Do not quote the pixel row as the ray.
- **Lean and a sleeve off the stick**, via `sigmaCentringM` (section 3). At the marked 0.45 m height that is 8 mm at 1° and 24 mm at 3°. The sleeve is glued to the dowel, so a sleeve that can still shift is not a published bearing. Fit the sideways lean. The along-sight part stays in the centring term.

The centreline is a valid Phase 1 ray across 2–15 m whenever both edges pass the width check in section 3. Without an ID there is still no point to attach it to, unless this sleeve is the only one in the frame and the user confirms the name.

### 6.2 Range from the sleeve

Do not use `d = fx · H / h_px`, and do not check the sleeve by its raw pixel height or its raw pixel width. A camera pitched down to frame a sleeve whose centre is 0.5 m below a 1.5 m camera overestimates `d = fx · H / h_px` by **24% at 2 m**, **3.4% (169 mm) at 5 m**, 1.2% at 8 m and 0.2% at 15 m. At 5 m that bias is 2.6 times the noise σ quoted below.

Use the levelled elevation of each end, and give that formula the paper height `H`, not a stretched outline:

`d = H / (tan e_top − tan e_bot)`.

That is exact for a **plumb** sleeve at any camera pitch. The diameter, seen from above, is the rim model below (`d ± R`). Do not also replace `H` with `H cos α + D sin α`. That expression adds the same diameter term a second time.

The width check in section 3 compares **levelled azimuths** with `2 arcsin(R / d)`. It does not compare pixel columns.

**Rims.** The visible end of the paper is not at the axis distance. This is the only place `D` enters the range.

- If the stick runs through the sleeve, the centreline ends are the **front** rims, at `d − R`. The elevation formula then returns the front surface, **30.2 mm short at every range** at the expected radius. Add the stored `R`.
- If the top of the sleeve is against the sky, the top silhouette is the **far** rim and the bottom is the **near** rim. Leaving that unmodelled biases the range by about `−2R tan(e_mid) / H`. With the expected radius and the camera 1.0 m above the sleeve middle that is **−4.2% (−210 mm) at 5 m** and **−1.4% (−210 mm) at 15 m**. With the camera 0.5 m above the middle it is **−2.1% at 5 m**.

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
| 2 m | 435 px | 0.3% | 21 mm | 100 mm |
| 5 m | 174 px | 0.8% | 64 mm | 253 mm |
| 8 m | 109 px | 1.3% | 131 mm | 413 mm |
| 15 m | 58 px | 2.4% | 396 mm | 835 mm |

The pixel term passes the `fx` term at about 8 m. At 15 m with 2 px per end and `fx` to 1% (realistic on a 58 px sleeve) the noise is about **747 mm**. Pitch, rim and lean, if left unmodelled, are larger than this noise at garden ranges. The observation that enters the solver is the elevation form with the rim choice, and its σ includes the edge fit and `σ_λ`. It is a weak distance, not a tape.

**Choosing between the two station candidates.** Two marks and one tape leave two stations on the tape circle (geometry note, §3.3). A range **to the taped mark** is the same from both, so it cannot separate them. The height range has to come from the **untaped** mark: `Δ = |d(P1) − d(P2)|` on that other sleeve. How far apart the stations are in the garden is the wrong test.

On the 7 m baseline at 20°, a 15 m tape to A, the ranges from the two candidates to B are 18.9 m and 9.3 m. Closer to the far intersection (`r → 2R ≈ 20.5 m`) those two ranges to B converge. Separation below uses the **pixel-and-fx noise at the farther range to B** (not yet including lean). `H = 287 mm`:

| Tape to A | Ranges to B | 1 px ends, 1% `fx` | 2 px ends, 1% `fx` | 2 px ends, 5% `fx` |
|---|---|---|---|---|
| 15 m | 18.9 / 9.3 m | 15.7σ | 8.2σ | 6.4σ |
| 17 m | 19.9 / 12.1 m | 11.6σ | 6.0σ | 4.8σ |
| 19 m | 20.5 / 15.3 m | 7.3σ | 3.8σ (3% wrong) | 3.0σ (6%) |
| 20 m | 20.3 / 17.3 m | 4.3σ | 2.2σ (13% wrong) | 1.8σ (19% wrong) |
| 20.4 m | 19.7 / 18.6 m | 1.7σ (20% wrong) | 0.9σ | 0.7σ |

`P(wrong) = Φ(−Δ / 2σ)` for a pick of the nearer candidate. Accept a pick only when **`Δ ≥ 6σ`** (about 0.13% wrong) **and** the observed range is within **2.5σ** of the chosen candidate. Otherwise leave the station unset or ask. **Label the pick unchecked** either way: a branch choice has no spare observation. The `σ` in that test is the observation’s own σ (edge fit, the focal prior, and `σ_λ`), not the noise column alone. Until the shared-`fx` follow-up, that focal prior is separate on each photo.

### 6.3 Focal length, as raw observations

Do not solve `fx = h_px · d / H` and then reuse it. That misses the 1% bar, and it double-counts.

The noise budget at 5 m is real: sleeve ends 0.8% at 1 px, tape 20 mm is 0.4%, together about 0.9%. ISO 216 allows ±2 mm on the 297 mm sheet, about **0.7%** of the finished 287 mm, unless the trimmed sleeve is measured. The biases are the problem. Pitch (+3.4% at 5 m), rim (−0.6% for the 30.2 mm front rim at 5 m, or −4.2% for a sky top and a near bottom) and a 2° lean toward the camera (+0.7% at 5 m) all land at full size on a derived `fx`. The formula in the previous draft misses 1% by about three times.

Enter the adjustment with the raw pieces, not a derived range and not a derived `fx`:

- The tape as a distance. It is the horizontal distance from the **lens** to the axis (surface reading, slope reduced, then `+R`). A 10 mm mistake in where the lens is costs 0.2% at 5 m.
- Each sleeve end as a levelled elevation. Equivalently `tan e_top − tan e_bot = H / (d ± R)`, with the rim choice above. σ comes from the edge fit plus `σ_λ`.
- **Focal length.** The merged solver keeps a separate prior on each photo: when a relative σ is given, `fx = fx₀(1+s)` with prior residual `−s`. One shared `fx` per phone and per 1× lens, with the taped-rod or checkerboard result as its prior, is the planned follow-up after the circle field trial. The maths advisor estimates radius σ falls from about 15 mm to about 6.5 mm once photos from one phone share that parameter. A gate that merely checks `fx` is already within 1% is not that solve. The prior for the follow-up is a **checkerboard** of known square size, several views, repeated on different days, including distortion and focus breathing (about **0.3%** at 2 m). The taped-rod calibration in [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md) §3.5 is the other acceptable prior. EXIF `FocalLengthIn35mmFormat` is an integer, about **±1.9%** at 26 mm, and a Pro phone may be 24, 28 or 35 mm, so EXIF only checks that the shot is 1×. It is not the prior. A separate prior on each photo cannot carry a taped sleeve in photo `k` into photo `j`; that is why the shared parameter is the follow-up.
- The measured `H` and `D` of **that sleeve**, stored with the mark after the rulers are checked. A shared paper-stock parameter is only a fallback. In a ratio of two observations from the same sleeve, `H` cancels. The rulers (section 7) are what tell you the sheet was not scaled before those measurements are stored.

Ranging photo `k` with an `fx` taken from photo `k` only returns the tape. It is not a new observation. Publishing that range, and also publishing `fx` as a prior while photo `k` is still in the network, counts the same pixels twice. Derived ranges that all share one calibration photo also share that photo’s tape and edge errors; entering them as independent distances hides the correlation.

With the elevation model, the rim model, a plumbed rod, the checkerboard prior and the planned shared `fx`, about **1% is reachable at 3–5 m**. Several sleeves from different directions let the unseen lean average rather than sit in one photo. An AprilTag is not part of that calibration and is not printed.

## 7. Print template

One A4 portrait page, black and white, **actual size**. The printer must not scale to fit.

Finished sleeve: **H = 287 mm** tall, wrapped tight on a **60 mm** dowel. Expected **D = 60.4 mm**, **R = 30.2 mm**, overlap about **16.5 mm**. The sheet starts at 297 × 210 mm. Trim 5 mm off the top, the bottom, and the visible side. The glue flap is the overlap down the seam, glued to the dowel.

```
        glue flap, about 16.5 mm             188.5 mm around the dowel
        ┌──────────────────┬───────────────────────────────────────────┐
 trim   │ unprinted outer  │ A1 · 222              corner cross   9 mm │
 5 mm   │ 5 mm hides under │ (empty quiet)                         8 mm │
 off    │ the glue         │ ████████████████████████████████     52 mm │ sync: four blacks
 top    │                  │                                      13 mm │ sync: white
 and    │ 250 mm ruler in  │   … 12 payload bands, runs of at most 3 …  │
 bottom │ this flap,       │                                      13 mm │ stop: white
        │ measured before  │ ████████████████████████████████     13 mm │ stop: black
        │ it is glued      │ (empty quiet)                         8 mm │
        │                  │ |------ 180 mm ruler ------|  A1 · 222     │ 15 mm
        └──────────────────┴───────────────────────────────────────────┘
```

- Bands run around the dowel and stop at the side seam. The flap is a copy of the first 16.5 mm of the pattern, marked “glue under”, with the printer’s blank outer 5 mm on the hidden side. Trim the opposite edge so the visible seam is printed paper, not a white stripe. Glue the sheet tight to the 60 mm dowel (section 2). There is no glue strip on the top or the bottom.
- The **8 mm** quiet zones are empty. The name and the corner cross sit outside them. The decoder ignores text beyond the stop: 8 mm is only about 0.6 of a band (section 5).
- **Rulers, checked with a steel rule before the sheet is rolled.** A **250 mm** ruler along the height, in the side glue flap, measured before it is glued. It fits the 287 mm finished height. It does not fit across the 210 mm sheet, so the wrap-direction ruler is **180 mm**, in the bottom legend, clear of the seam. Letter paper with fit-to-page scales A4 to about **94%**, which turns 250 mm into 235 mm and 180 mm into 169 mm. Either miss means the sheet was scaled. Do not use it. The four-black sync must measure **52 mm**.
- Store the measured `H`, `D` and `R` on that sleeve. Expected 287 mm, 60.4 mm and 30.2 mm are the design for a 0.2 mm sheet, not the observation. The laser offset is the stored `R`.
- Human text is the point name and the issued code, printed twice, outside the quiet zones. Names avoid O and I. The decoder does not read that text.
- **Stock.** Laser or pigment ink on matte polypropylene or polyester (PP/PET). Plain paper cockles and dye ink runs. Gloss laminate and glossy toner put a specular stripe down the sleeve, parallel to a vertical scan, so the profile reader fails. A matte laminate is acceptable if the rulers still measure true after it is sealed.
- The seam is vertical. Press it flat so it does not become a ridge that splits the silhouette.

## 8. Reading it

On the full 1× still, in Safari. No library, and no scan of the whole frame for a stick.

The user **taps the column**, and taps to focus on it. A high-contrast column is also a picket, a cane or a downpipe, and the edges disappear against a hedge or the sky, so the frame is not searched. The tap is the seed and, if the code is rejected, it is still the hand click. The phone is on the pole, not handheld: at 1/60 s a handhold blurs the stick by about 1–4 px. If autofocus locks on leaves at 1 m, a stick at 8 m blurs by about 7–10 px, which is more than a 13 mm band (4.9 px on the 26 mm camera).

Around the seed, fit edges only on rows that have contrast. Sample at least **five columns** across the middle **60%** of the stick’s width and vote. Drop clipped samples and outlier rows (leaf, shadow, seam). Average the two **levelled edge azimuths**, not the pixel columns (section 3). Then the width check. If the edges are not stable, reject the code and keep the tap. Two decodes of the same ID in one photo are a reject.

Stay in the central 60% of the frame. Rolling shutter at about 3°/s across a 15 ms readout adds about **0.045°** to the bearing; at the edge of the frame it is worse.

The profile follows the fitted axis, not image y. Bands are placed by the projective fit in section 5. A run that misses those positions, a second run of four blacks, or a word that is not in the list is a miss. Text beyond the stop is ignored. Sun on gloss toner is why the stock in section 7 is matte.

A flat tag is not in this comparison as a thing we might still print. A square fiducial the size of this sheet (about 180 mm) is about 109 px at 5 m and 36 px at 15 m, and it is only usable within about ±45° of straight-on. That is the wrong tool on a stick you walk around. The planned shared intrinsics come from the checkerboard, once per phone and lens, not from a tag in the garden. The merged solver still keeps a separate focal prior on each photo.

## 9. What is still open

Both reviews are applied. What is left is practical, not a second code:

1. Count the long-range marks before printing. Sixty-one covers rods, the house and a fence, with reprints left. The five-black bank is not printed. If it is ever reconsidered, both layouts have to be fitted and only a clear winner kept, the synthetic test has to include bank confusion, and the ID stays at 5 m or closer until that test exists. Twenty bands squeeze the legend to 11 mm, and Hamming distance does not separate the banks. Beds and paths stay unnamed by this sleeve.
2. The checkerboard prior and `sigmaCentringM` have to be in the solver when Phase 2 wires detections into it. One shared `fx` per phone and lens is the follow-up after the circle field trial, not what the merged solver does. This note does not change that solver.
