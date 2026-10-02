# Geometry and triangulation — draft for review

**Status:** proposal only. Revised again after the follow-up maths review on PR #2 (2026-10-02). No solver code in this change. It does not change `AGENTS.md`.

**Context:** [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md) describes the 0.7.25 code. [ROADMAP.md](ROADMAP.md) Phase 1 is the prototype that would follow this note. Field practice (house-edge baseline, mark offsets, leapfrog, both baseline ends in frame) stays as in [plan-baseline-then-house.md](plan-baseline-then-house.md).

The direction stands: one 2D frame, one weighted least-squares adjustment, no assumed 90° turns, points left unsolved when the normal matrix says so. The follow-up review confirmed the bearing sign, gravity levelling, the datum rank, and the χ² / MDB / ellipse formulas. It also corrected three items from the first review (one tape does not fix a station, no fixed 120 mm house check, a withheld tape uses 1.96). Those corrections are the ones in force.

## How the review was taken

| Review point | This revision |
|---|---|
| `\|β_A + β_B\| ≈ 0` does not place the station | Shortcut dropped. One tape usually leaves two candidates. Need tapes to both ends, a third mark, or an explicit branch choice. |
| Bearing sign is mirrored; `py` and tilt matter | `β = atan2(cx − px, fx)` before levelling. Gravity rotates the ray. `py` is used. |
| Pinning B at `(L, 0)` over-constrains scale | A fixed, `B_y = 0`, datum tape kept as a normal distance. |
| Zero redundancy hides blunders | Extra observation required for structure corners and plantable points. `σ̂₀`, standardised residuals, redundancy, MDB, error ellipses. |
| Numbers | 10% focal error is **±1.98 m** on the 7 m / 20° isosceles station. 200 mm stations need `fx` to about **1%**. `fx/width ≈ 0.69–0.75`, not 0.9. `σ√2 / sin φ` is 2D DRMS, not cross-track. House check is the propagated `Q_m` (demo shed: **93 mm** tapes only, **144 mm** with 0.2° angles), not a fixed 120 mm. Laser σ ~**5 mm**, plus ~**50 mm** if the spot hits the front of the roll. |
| Arc wording | The arc passes through A and B. `R = L / (2 sin θ)` (10.23 m for 7 m at 20°). |
| Distance model, slope, sag | `σ² = a² + (b L)²`, horizontal reduction, sag called out. |
| Gates | Accept or reject on the **95% error ellipse**. Angle cuts are early warnings only. |
| Circle fit | Geometric fit, not Kåsa alone. Radius on arcs under ~90° is weak. |
| ARKit | Not required. |

## 1. Coordinate frame and datum

Local **2D** Cartesian metres. Right-handed. No OS grid and no GPS in the solve. Phone compass does not enter: near a house it is off by about ±5–10°, and a photo only measures angle differences. Heading is the unknown `ψ` on each photo.

| Element | Definition |
|---|---|
| Origin | Mark **A** of the datum baseline (highest `trust` chooses which baseline; default the house edge). |
| +X | From A toward mark **B**, with `B_y` held at 0 so the axis lies along A→B. |
| +Y | Garden side, stored once at setup. Used for **distance-only** intersections. It is not “left in the image”. |
| Scale | Observed. The datum tape is a weighted distance. It is not a pin. |
| Heights | The plan has no Z. Pole length can separate the two arc-and-tape candidates (section 3.3) and is an eccentricity on tapes taken from the pole, not a term on every ray. |

**Gauge (minimal constraint).** A distance network has a datum defect of **3**: two translations and one rotation. Scale is not a defect. A bearings-only network has a defect of **4**, because nothing sets scale, so the solve needs at least one distance.

- Fix **A = (0, 0)** and **`B_y = 0`**. Leave **`B_x` free**.
- The baseline length stays an ordinary observation with its own residual.
- No soft pin on B. Pinning B to `(L, 0)` would be a fourth constraint: it hides the tape residual, pushes that error into every other point, and biases `σ̂₀`.

Shape, residuals, and `σ̂₀` do not depend on which baseline is the datum. Switching datum is a rigid transform. **Trust chooses the datum only. Weights come from σ, not from trust.**

Point **error ellipses do** depend on the datum: a point near A looks tighter than the same point far from A. That is acceptable for the accept/reject gate. It does not mean the nearby point was measured better.

**Which mirror.** Signed bearings from an upright rear camera have no mirror ambiguity: the left/right order of the two marks fixes the side (section 3.2). The garden sign applies to **distance-only** intersections. Those two solutions mirror across the line through the **two known points**, not across the datum baseline. The garden sign resolves them only when both points lie on that baseline. Otherwise use a third observation, agreement with a ray, or ask. Do not average the two sides.

## 2. Marks and features

A toilet-roll or disc has a **mark centre**. The brick arris or post centre is the **feature**.

Store, per control point:

- `offsetMm` — mark centre to feature, millimetres.
- `offsetDirection` — inward normal of a named edge, outward normal, or a bearing in the frame (radians from +X).

The solved feature is what polygons and beds use. The mark is what a photo clicks and what a tape between two rolls measures. The UI says which.

A laser spot on the **front** of a toilet roll is about **50 mm** in front of the mark centre. The instrument’s reference (often its rear edge) is not the pole axis. Both are known offsets, or the shot is taken to a flat target. Leaving them inside a 2 mm σ will bias the point by centimetres.

Today `offsetMm` is a scalar and Layer A shifts that same point’s `y`. That is not an arris.

## 3. Survey method

Distances first, angles second. Tape or laser, two 4.000 m rods, phone on a pole, clicks on printed marks.

### 3.1 What fixes a new point

| Observation | Result |
|---|---|
| One distance from a known point | Circle. Not a point. |
| Two distances from two known points | A point, up to the mirror across that pair. **Redundancy 0** — fixed but unchecked. |
| Those two distances plus one more (third tape, diagonal, or a ray) | A checked point. This is the minimum for a structure corner or a plantable point. |
| One photo, two known marks | Camera lies on an **arc through A and B**. Not a station. |
| Those two marks plus **one** tape (to A, to B, or to the midpoint) | Usually **two** stations about 20 m apart, with the same bearings. A tape to the midpoint always does this. A tape to one end is unique only when it is shorter than the baseline. |
| Tapes from the pole to **both** A and B | Station trilaterated. The bearings are a check (redundancy 1). Preferred. |
| One photo, three known marks | Pose determined, except near the danger circle. Redundancy 0. |
| Explicit choice between the two candidates | A tap on the plan, or a depression angle from `py`, gravity, and pole height. Label **unchecked**. |
| Four or more known marks, or a pose plus an extra distance | Checked station. |
| Bearings to an unknown mark from two known stations | Ray intersection. Weak when the rays are shallow. Inherits the stations’ covariance. |
| One bearing and one distance | A point, unless the circle cuts the ray twice. |
| Wall lengths only, no angles or ties | Not rigid. Each new corner swings. A 90° turn is not a measurement. |

**House corners** you cannot stand on are clicked marks or tape ends. A frame that contains the baseline and the corner **records rays**. It does not, by itself, write the corner’s `x,y`.

**Leapfrog.** Rod A (4.000 m, a few millimetres) is a short baseline. A and B in one frame, with enough control to solve, transfers the frame. **Rods moved** stays gated on that joint photo. Collinear rod marks A1, A0, A2 are allowed: their danger locus is the line itself, not a circle. `|ρ − R| / R` is undefined there because `R` is infinite; use the station’s distance from that line as a fraction of range. They are weak (about 1.0 m at 95% at 9 m with 0.1° rays), so the ellipse still has to pass.

**Yaw-only extras** share one `(x, y)` and add rays. They are not new stations.

### 3.2 Camera model

Unknowns per photo: `Cx`, `Cy`, yaw `ψ`. Focal length is **not** a per-photo unknown (section 3.5).

**Sign.** Bearings are positive counter-clockwise, same as `atan2(y, x)`.

Image x grows to the right. On an upright phone, image-right is clockwise in plan, so the click bearing is

`β = atan2(cx − px, fx)`

with `cx = width / 2`. Predicted bearing of a world point:

`β_pred = wrap( atan2(Py − Cy, Px − Cx) − ψ )`

The 0.7.25 formula `atan2(px − cx, fx)` has the opposite sign. Camera at the origin, facing +X, the point `(10, 1)` has world azimuth **+5.711°** and projects to `px < cx`, so `atan2(cx − px, fx)` matches `β_pred`. The old formula does not recover that station: with three marks it fits some other station exactly, and with four or more marks it does not fit (about 4.7° residuals in the check). Either result is the wrong place. Use one of these fixes, not both: the click formula above, or keep the old click and set the prediction to `ψ − azimuth`.

When the solver exists, that `(10, 1)` case is the sign check. It is not implemented in this change.

**Side.** With signed bearings and an upright rear camera, resection has no mirror ambiguity. The 0.7.25 path that reads which click is on the left and then ignores it is the bug. The garden sign is only for tapes (section 1).

**Tilt.** `py` is part of the ray. `atan(u / fx)` is the horizontal angle only when pitch and roll are both zero. A phone on a 1 m pole pitches down to see ground marks. At `fx = 900` px on a 1200 px frame the horizontal error versus a levelled ray is:

| Pitch, roll | Click `(u, v)` | Error |
|---|---|---|
| 15°, 0° | `(400, 200)` | +0.49° |
| 15°, 0° | `(400, −200)` | **−2.11°** |
| 0°, 2° | `(0, 300)` | +0.67° |
| 10°, 2° | `(400, 250)` | +1.20° |

That is **5–20×** a 0.1° pixel σ.

Sample the gravity vector at the shutter (`DeviceMotion.accelerationIncludingGravity`; iOS asks permission), not a reading taken later. Build the camera ray `((px − cx) / fx, (py − cy) / fy, 1)` with y downward. Rotate it so the measured gravity maps to vertical. The levelled bearing is

`β = atan2(−x_level, z_level)`.

Any yaw left in that rotation is absorbed by `ψ`. Which device axis is camera x, in portrait and in landscape, is a follow-up (section 9): do not guess it when writing the solver.

If gravity is missing, require a level bubble and **widen** the bearing σ to the tilt still allowed. An unlevelled phone is not a 0.1° instrument, and it should fail the 200 mm station gate.

**Bearing σ** is per ray. Do not inflate it because a rod subtends less than 15°. Weak geometry belongs in the covariance.

`σ_β² = (σ_px / fx)² + (σ_centring / d_i)²`

where `d_i` is the range to that mark. Pole plumb and eccentricity are one station offset shared by every ray in the photo, and the station is already a free unknown, so they do not belong on each ray. Put that offset on tapes measured from the pole, and on the agreement between yaw-only shots that claim the same station. A 1° tilt on a 1 m pole is 17 mm at the ground.

### 3.3 Two marks leave two stations

Angle `θ` subtended by segment AB puts the camera on a circular arc **through A and B**, radius

`R = L / (2 sin θ)`.

For `L = 7` m and `θ = 20°`, `R = 10.23` m. Yaw is fixed once a point on the arc is chosen, because `ψ` absorbs the absolute orientation. Two clicks and three unknowns `(Cx, Cy, ψ)` leave one degree of freedom.

`|β_A + β_B| ≈ 0` only says the optical axis bisects angle ACB. The user can do that from **any** point on the arc by aiming. On the 20° arc the sum was 0.000° at three tested stations, and the isosceles formula then sat **0 m, 3.55 m, and 7.00 m** off the truth. The image cannot tell you the pole is on the perpendicular bisector.

**The centred-baseline shortcut is dropped.** No symmetry tolerance.

**One tape does not finish the job.** `ψ` is free, so both places where the tape circle cuts the camera-side arc produce the same signed bearings. For 7 m at 20°:

| Tape | Result |
|---|---|
| Pole to the midpoint, any length | **Always two** solutions, mirrored across the perpendicular bisector. At 15 m: `(−6.63, 11.06)` and `(13.63, 11.06)`, **20.3 m** apart. Do not offer a midpoint tape. |
| Pole to A or B, shorter than `L` | Unique. |
| Pole to A or B, `L < r < 2R` (about 7–20.5 m, the usual case) | **Two** solutions. At 15 m: `(−5.83, 13.82)` and `(13.35, 6.84)`, **20.4 m** apart. |

Call the result **two candidate stations**. A single station needs one of these:

- **Tapes to both A and B.** That trilaterates the pole. The bearings become a check, so redundancy is 1. This is the field default.
- **A third known mark.**
- **An explicit branch choice:** a depression angle from `py`, gravity, and the pole height, or a tap on the plan. Label that station **unchecked**.

Do not average the two candidates, and do not pick the one closer to the perpendicular bisector. Otherwise the station stays unset. The isosceles formula in `stationFromBaselineSighting` remains a description of the current code, not of this solve.

### 3.4 Three or more marks

Three known marks give three bearing equations in `(Cx, Cy, ψ)`. Start from a closed form (Pierlot & Van Droogenbroeck, ToTal, 2014, or Tienstra, or Collins). That construction’s determinant, or `|ρ − R| / R` with `ρ` the distance from the circumcentre, measures the danger circle. Refine with Levenberg–Marquardt, wrapped residuals, and analytic Jacobians. Stop when the step is under **0.1 mm**.

For marks that are not collinear, warn when `|ρ − R| / R < 0.2`. That ratio is undefined when the marks are collinear (`R` infinite); use the station’s distance from their line as a fraction of range instead (section 3.1). Accept or reject on the **95% ellipse**, not on the angle alone. With 0.1° rays and stations about 9–14 m out, that 95% semi-major was about 180 mm with the rod in front of the house (depth), 0.75 m with every mark to one side, 1.47 m at 1.2 R from the danger circle, and **4.7 m** at 1.05 R.

A fourth click on an unknown mark is a **ray**. A second solved station intersects it. Shallow crossings stay weak: two perfect stations, 0.1° rays, mark 10 m away, 95% semi-major about 43 mm at 90°, 117 mm at 30°, **231 mm at 15°**, 693 mm at 5°. For a 100 mm plantable point, treat crossings under about **25–30°** as an early fail. The ellipse is the real gate.

Two-station points **inherit station error**. A station in the 200 mm class does not produce a 100 mm point unless a tape also ties that station.

### 3.5 Focal length

`fx` is one constant **per phone and per lens**, stored as **`fx / width`** so a resized image does not change the angle. Same for `fy / height`, the principal point, and radial `k1`.

For the iPhone 1× camera (24–26 mm equivalent, 4:3), `fx / width ≈ 0.69–0.75`. The code’s `0.9 × width` is about 20–30% high. Read EXIF `FocalLengthIn35mmFormat` when it is present, as a prior, not as the calibration. Lock zoom at **1×**. Do not use the 0.5× ultra-wide.

Three marks cannot estimate `fx` (four unknowns). Four marks have redundancy 0 and `σ_fx ≈ 5.9%` at 0.1° bearings. Calibrate once: a 4.000 m rod across most of the frame, phone on the bisector at a taped 5 m, repeated. Two-pixel clicks reach about **0.4%**, so **1% is a fair requirement**.

A 10% error in `fx` is not a 10% error in `θ`. On the symmetric 7 m / 20° case, `θ` moves to 18.21° or 22.17°, and the isosceles range moves by **±1.98 m**. In resection layouts the same 10% moved stations by about 0.7–1.8 m, and by up to 4 m near the danger circle. At 1% / 3% / 5% one layout moved 158 / 466 / 766 mm. **A 200 mm station needs `fx` to about 1%**, gravity-levelled rays, and depth or four or more marks. With four marks (baseline ends plus both rod ends) and a good `fx`, the 95% semi-major in that layout was **58 mm**.

## 4. Solver

One weighted non-linear least squares. Not Layer A’s turn, then Layer B’s overwrite.

**Unknowns.** Feature `(x, y)` where the normal matrix has rank for them. Per solved photo: `Cx, Cy, ψ`. Mark = feature + offset vector. `fx` is the calibrated constant, not a free parameter.

**Determinability** is the rank and condition of the global normal matrix. “Two observations pointing at a point” is not enough if those points are themselves free. Two tapes onto undetermined points fix nothing.

**Do not** add a 90° turn, the 3 m fallback pose, or the provisional spiral (`estimatePhotoContribution`). That spiral is drawing only.

### 4.1 Distance σ

`σ² = a² + (b L)²`.

| Instrument | Suggested figures |
|---|---|
| Tape | `a ≈ 3–5` mm (read, hook, centring), `b ≈ 0.5–1` mm/m. A flat 20 mm is the conservative stand-in if this split is not used. |
| Laser | About **5 mm** all in (about 2 mm instrument and 2–3 mm centring at each end), not the 2 mm constant in `model.ts`. Plus the ~50 mm face offset in section 2 when it applies. |
| Rod | 2–5 mm. |

The frame is horizontal. A slope distance `s` with height difference `Δh` enters as `h = √(s² − Δh²)`. Over 10 m, a 0.5 m drop is 12.5 mm too long and a 1.0 m drop is **50 mm**, always long. Record `Δh`, use a tilt-sensing laser, or hold the tape level.

Sag is about 1.5 mm for 10 m at 20 N, and about **48 mm** for 20 m at 10 N. Tension the tape. Slack is not in `σ`.

### 4.2 Redundancy and blunders

A point fixed by exactly two distances, or a three-mark resection, has **redundancy 0**. Residuals are identically zero. A test on `|v| / σ` never fires, and a 1 m blunder is absorbed.

- Global variance factor `σ̂₀² = vᵀ P v / (n − u)`. Here `u` is the count of free unknowns **after** the datum constraints, so `n − u` equals `n − rank`. Test it with a **two-sided** `χ²` on those degrees of freedom.
- Standardised residual `w_i = v_i / (σ_i √r_i)`, where `r_i` is the redundancy number of that observation. Flag it when `|w_i| > 3.29` (α = 0.1%, two-sided). Drop **one** blunder at a time and re-solve.
- Marginal detectable blunder `MDB_i ≈ 4.13 σ_i / √r_i` (α = 0.1%, β = 80%). The 4.13 is `3.29 + 0.84`, the same tail as the `w` test.
- Label the point **fixed but unchecked** when any observation that determines it has `r_i ≲ 0.1`, not only when `r_i` is exactly 0. It may be drawn. It is not a structure corner you trust and not a plantable point.
- **Field rule:** every structure corner and every plantable point needs at least one surplus observation (a third tape, a diagonal, a second station, or a withheld check).

### 4.3 Initialisation

1. Apply the minimal datum (section 1).
2. Intersect circles where two distances exist. If noise keeps them apart, take the closest point on the line of centres and mark it weak.
3. Resect photos from the closed form in section 3.4, then LM.
4. Intersect rays for marks seen from two stations.
5. Leave everything the normal matrix cannot carry without coordinates.

**House polygon.** Vertices are point ids in order. The distance between corner 1 and corner N is a **wall**, not a misclosure. The 0.7.25 close check compares that wall with 50 mm. This proposal does not.

A ring of `n` wall lengths and no angles or diagonals is not rigid. It has `n − 3` internal degrees of freedom. There is no chain to propagate, so there is **no misclosure to compute**.

What produces a check:

- Enough extra distances to pass rigidity and then one more. A 6-corner house needs `2n − 3 = 9` distances to be rigid (6 walls + 3 diagonals or ties) and a **10th** before any residual can speak.
- Chainage and offset from the datum baseline.
- Photo rays from stations that are themselves solved. Surplus rays are the check.

In a simultaneous adjustment the polygon meets by construction. The coach quotes the `w`-tests on the surplus observations, and `σ̂₀`. That is the same information as a misclosure test.

A **traverse misclosure** exists only when angles are measured. Wall lengths alone still have nothing to close. Multiplying a 2D distance RMS by 2.45 (`T = 2.45 σ √n`) overstates it; the old “about 120 mm for six walls” figure is withdrawn.

When angles do exist, propagate the 2×2 misclosure covariance `Q_m` from the distance σ and the angle σ actually used. Accept when

`mᵀ Q_m⁻¹ m ≤ χ²(2, 0.95) = 5.99`

and show **2.45 times the semi-major of `Q_m`**. There is no fixed millimetre threshold.

For the synthetic shed (HSE01–HSE06) that semi-major is:

| Case | 95% semi-major | Chance `|m| > 50 mm` |
|---|---|---|
| σ = 20 mm, distances only | **93 mm** | **35%** |
| σ = 20 mm and 0.2° at each vertex | **144 mm** | 60% |
| 3 mm + 1 mm/m, distances only | 24 mm | 0% |
| 3 mm + 1 mm/m and 0.2° angles | **116 mm** | 39% |

Once angles are in the traverse they dominate. A careful tape does not make a flat 50 mm a safe warning: with 0.2° corners the 95% figure is still 116 mm, and a 50 mm gate would false-alarm about 39% of the time. On distances alone at σ = 20 mm the false-alarm rate of a flat 50 mm gate is **35%**.

An optional “this corner is square” may be a soft angle observation at about **0.5°** (about 30 mm at the end of a 3.5 m wall). It is **off unless the user turns it on**, and the coach says it is an assumption.

**Coach outputs:** each distance residual in mm, `w` for anything that fails, the 95% semi-major of each accepted point, which points are unchecked, which are unset and what single measurement would fix them, and `σ̂₀` in a sentence.

## 5. Targets

State every target as a **95% error-ellipse semi-major** (`√χ²_{2, 0.95} ≈ 2.45` times the 1σ semi-major). A single noisy trial “within X mm” fails at random. Synthetic tests check two things: about 95% of Monte Carlo errors fall inside the predicted ellipse (NEES ≈ 2), and accepted points meet the class below.

Isosceles sensitivity, confirmed, kept only so the old formula’s danger is visible. It is not a solver:

`d = (L / 2) / tan(θ / 2)`, `|dd / dθ| = L / (4 sin²(θ / 2))`.

| `L`, `θ` | `d` | m per 1° | `fx` ±10% (exact) |
|---|---|---|---|
| 7 m, 20° | 19.85 m | 1.013 | **±1.98 m** |
| 7 m, 40° | 9.62 m | 0.261 | ±0.96 m |
| 4 m, 25° | 9.02 m | 0.373 | ±0.90 m |

Trilateration at σ = 20 mm. `σ √2 / sin φ` is the **2D DRMS** (28 mm at 90°, 57 mm at 30°), not the cross-track error. The 1σ semi-axes are `σ / (√2 sin(φ / 2))` and `σ / (√2 cos(φ / 2))`: **20 / 20 mm** at 90°, **41 / 15 mm** at 40°. The 95% semi-major at 40° is **101 mm**, and about **25%** of such points land more than 50 mm from truth (about 4% at 90°). A 50 mm class needs a tighter tape (σ ≈ 5 mm gives a 95% semi-major of about 25 mm at 40°; `3 mm + 1 mm/m` at 8 m gives about 43 mm).

Early warnings, with the ellipse still deciding:

| Case | Early warning |
|---|---|
| Trilateration | `φ` under 20° (95% semi-major about 199 mm at σ = 20 mm) or near 180° |
| Photo, `θ → 0` | Reject. Range error blows up. |
| Danger circle | Warn below 0.2 in `\|ρ − R\| / R` when `R` is finite; reject when the ellipse exceeds the class |
| Ray crossing | Under about 25–30° will not make the 100 mm class |
| Collinear rod | Allowed. `\|ρ − R\| / R` does not apply (`R` infinite). Use distance-to-line / range. Ellipse decides. |

| Class | Pass |
|---|---|
| Datum tape | Its residual and `w`-test. Not “equal to L by construction”. |
| Trilaterated point, checked | 95% semi-major within the class you asked for. At σ = 20 mm that is about **100 mm** near 40° and about **50 mm** near 90°, not a flat 50 mm everywhere. |
| Photo station | 95% semi-major **≤ 200 mm**, and only with `fx` calibrated to **≤ 1%**, levelled rays, and depth or 4+ marks, after the station is unique (both-end tapes, a third mark, or an explicit branch choice). Two marks plus one tape is two candidates, not this class. |
| Plantable point | 95% semi-major **≤ 100 mm**, redundancy at least 1 (`r_i ≲ 0.1` is still unchecked), and a withheld **distance** inside `1.96 √(gᵀ Q_xx g + σ_check²)`. The 1.96 is the 1D 95% factor. `gᵀ Q_xx g` is the variance of the predicted length, including correlation of the two ends, not a point’s ellipse. |
| House check | No fixed millimetre gate. Distances only: no traverse misclosure. With angles: `mᵀ Q_m⁻¹ m ≤ 5.99`, and show 2.45 times the semi-major of `Q_m`. On the demo shed that is **93 mm** (tapes, σ = 20 mm) or **144 mm** (plus 0.2° angles). A flat 50 mm gate false-alarms on **35%** of correct distance-only sheds at σ = 20 mm. |
| Two marks and one tape, in the usual range; rank failure; ellipse over the class | **Two candidates or none.** Not a coordinate you would plant from. |

## 6. Layer data model

Layers do not have their own frames. They classify features that share these points.

```
GardenDocument (one frame)
  control
    baselines          distance + σ + trust (datum choice only)
    lines              tape / laser / rod, optional Δh
    photos             clicks, pose after adjust, fx/width, gravity at shutter
    setups             time box, rods alive, A+B seen together
  features             (today: objects / Items)
    layerId            boundary | structure | walkway | bed | survey
    geometryType       point | line | circle | square | triangle | irregular_polygon
    measuredPointIds / selectedPointIds
    solved*            derived fit, recomputed, never an observation
  points
    feature x,y or unset; offsetMm + offsetDirection
    label: unset | unchecked | checked
```

| Layer id | Features | Point kinds already in the file |
|---|---|---|
| `survey` | Datum, rods, stations | `ROD`, `BL` |
| `structure` | House, sheds | `HSE`. Special polygon `house` stays until a migration |
| `boundary` | Fences, railings | `FNC` |
| `walkway` | Paths | `OCC` today; keep the id so current JSON loads |
| `bed` | Beds that will hold plants | `BED` (kind exists; + Point currently writes `OCC`) |

- Shared corners are shared point ids.
- A circle is a **geometric** (orthogonal-distance) fit, started from Kåsa or Taubin. Kåsa alone pulls the radius small on a short arc. Report `σ_R`. Under about a 90° arc the radius is poorly determined.
- A square is a rotated rectangle, or it is labelled axis-aligned. The current fit forces the axes.
- Plants, later, store a position in this frame. They are valid only on bed vertices that are **checked** points.
- This becomes document `version: 2` when offsets, gravity-on-photo, unset-versus-zero, and the new layer ids are stored. v1 loads with offset not applied and no invented `boundary` / `bed` rows.

## 7. Delta from 0.7.25

| Topic | 0.7.25 code | This proposal |
|---|---|---|
| Datum | Baseline written onto the x-axis; B at `(L, 0)` | A and `B_y` fixed; tape is an observation |
| Next house corner | Left turn of 90° by the taped length | Unfixed until the normal matrix carries it |
| Close gap | Distance between first and last corner vs 50 mm | No traverse misclosure without angles. With angles, propagated `Q_m` (shed: 93 mm tapes only, 144 mm with 0.2°) |
| Two-mark photo | Isosceles station; click order ignored | Arc, then two candidates from one tape. Unique only with both-end tapes, a third mark, or an explicit branch choice |
| Bearing | `atan2(px − cx, fx)`; `py` ignored; `fx = 0.9 × width` | Opposite sign, gravity-levelled ray, `fx/width` 0.69–0.75 calibrated to ~1% |
| Three-mark photo | Rod heuristic or a 3 m push | Closed-form start, then LM; ellipse gate |
| Laser | σ = 2 mm | ~5 mm, plus ~50 mm face offset when it applies |
| Extra photos | Centimetre spiral mixed into the average | Same station; rays only |
| Blunders | `\|r\| / σ`, which is blind at redundancy 0 | `σ̂₀`, `w_i`, MDB, “unchecked” label |

## 8. What the advisor closed

1. **Datum.** Minimal constraint. Not a soft pin, and not `(L, 0)`.
2. **Symmetry shortcut.** Dropped. One tape is not a unique station (follow-up review). Tapes to both ends, a third mark, or an explicit branch choice.
3. **Sensitivity table.** Correct, with the ±1.98 m figure for 10% `fx` on 7 m at 20°. The 200 mm station target does not survive a 10% `fx`.
4. **Resection.** Closed form, then LM. Danger test `|ρ − R| / R`, decision on the ellipse.
5. **`fx`.** One constant per phone and 1× lens. Not per photo.
6. **Circle.** Geometric fit. Report `σ_R`. Short arcs do not determine a radius.
7. **ARKit.** Not required if bearings are levelled and calibrated and the redundancy rules above are kept.

## 9. Follow-ups

Applied from the follow-up review, in the sections above: `w` critical value 3.29, unchecked at `r_i ≲ 0.1`, the levelled bearing `atan2(−x_level, z_level)`, bearing σ without a per-ray plumb term, ellipses depending on the datum, collinear marks not using `|ρ − R| / R`, and the old sign described as a wrong station rather than “the mirror”.

Still to pin down when the camera code is written, not in this note:

1. Map `DeviceMotion` axes onto the camera for portrait and landscape, including EXIF orientation and WebKit’s sign for `accelerationIncludingGravity`.
2. A unit test with a known pitch and roll, and a field check with the phone level on a table.
