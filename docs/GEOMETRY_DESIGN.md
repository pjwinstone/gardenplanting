# Geometry and triangulation — draft for review

**Status:** proposal only. Revised after the maths review on PR #2 (2026-10-02). No solver code in this change. It does not change `AGENTS.md`.

**Context:** [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md) describes the 0.7.25 code. [ROADMAP.md](ROADMAP.md) Phase 1 is the prototype that would follow this note. Field practice (house-edge baseline, mark offsets, leapfrog, both baseline ends in frame) stays as in [plan-baseline-then-house.md](plan-baseline-then-house.md).

The advisor’s direction is accepted in full: one 2D frame, one weighted least-squares adjustment, no assumed 90° turns, points left unsolved when the normal matrix says so. Nothing in the review is set aside. Where a figure below differs from the first draft, the review’s figure is the one that stands.

## How the review was taken

| Review point | This revision |
|---|---|
| `\|β_A + β_B\| ≈ 0` does not place the station | Shortcut dropped. Two marks plus one tape, or a third mark. |
| Bearing sign is mirrored; `py` and tilt matter | `β = atan2(cx − px, fx)` before levelling. Gravity rotates the ray. `py` is used. |
| Pinning B at `(L, 0)` over-constrains scale | A fixed, `B_y = 0`, datum tape kept as a normal distance. |
| Zero redundancy hides blunders | Extra observation required for structure corners and plantable points. `σ̂₀`, standardised residuals, redundancy, MDB, error ellipses. |
| Numbers | 10% focal error is **±1.98 m** on the 7 m / 20° isosceles station. 200 mm stations need `fx` to about **1%**. `fx/width ≈ 0.69–0.75`, not 0.9. `σ√2 / sin φ` is 2D DRMS, not cross-track. House check ~**120 mm** (95%, 6 walls, σ = 20 mm) and only when a check observation exists. Laser σ ~**5 mm**, plus ~**50 mm** if the spot hits the front of the roll. |
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
| Heights | The plan has no Z. Pole length (~1 m) is used only to turn a tilt into a horizontal eccentricity (section 3.2). |

**Gauge (minimal constraint).** A distance network has a datum defect of **3**: two translations and one rotation. Scale is not a defect.

- Fix **A = (0, 0)** and **`B_y = 0`**. Leave **`B_x` free**.
- The baseline length stays an ordinary observation with its own residual.
- No soft pin on B. Pinning B to `(L, 0)` would be a fourth constraint: it hides the tape residual, pushes that error into every other point, and biases `σ̂₀`.

Shape, residuals, and `σ̂₀` do not depend on which baseline is the datum. Switching datum is a rigid transform. **Trust chooses the datum only. Weights come from σ, not from trust.**

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
| One photo, two known marks | Camera lies on an **arc through A and B**. Does not fix a third mark. |
| Those two marks **plus one tape** from the pole to A, B, or the midpoint | Camera pose `(x, y, ψ)` fixed. Still redundancy 0 until something else sees it. |
| One photo, three known marks | Pose determined, except near the danger circle. Redundancy 0. |
| Four or more known marks, or a pose plus an extra distance | Checked station. |
| Bearings to an unknown mark from two known stations | Ray intersection. Weak when the rays are shallow. Inherits the stations’ covariance. |
| One bearing and one distance | A point, unless the circle cuts the ray twice. |
| Wall lengths only, no angles or ties | Not rigid. Each new corner swings. A 90° turn is not a measurement. |

**House corners** you cannot stand on are clicked marks or tape ends. A frame that contains the baseline and the corner **records rays**. It does not, by itself, write the corner’s `x,y`.

**Leapfrog.** Rod A (4.000 m, a few millimetres) is a short baseline. A and B in one frame, with enough control to solve, transfers the frame. **Rods moved** stays gated on that joint photo. Collinear rod marks A1, A0, A2 are allowed: their danger locus is the line itself, not a circle. They are weak (about 1.0 m at 95% at 9 m with 0.1° rays), so the ellipse still has to pass.

**Yaw-only extras** share one `(x, y)` and add rays. They are not new stations.

### 3.2 Camera model

Unknowns per photo: `Cx`, `Cy`, yaw `ψ`. Focal length is **not** a per-photo unknown (section 3.5).

**Sign.** Bearings are positive counter-clockwise, same as `atan2(y, x)`.

Image x grows to the right. On an upright phone, image-right is clockwise in plan, so the click bearing is

`β = atan2(cx − px, fx)`

with `cx = width / 2`. Predicted bearing of a world point:

`β_pred = wrap( atan2(Py − Cy, Px − Cx) − ψ )`

The 0.7.25 formula `atan2(px − cx, fx)` has the opposite sign. Camera at the origin, facing +X, a point at `(10, 1)` has world azimuth `+5.7°` and appears **left** of centre, so the old formula returns a negative click and the solve walks to the mirror station. Use one of these fixes, not both: the click formula above, or keep the old click and set the prediction to `ψ − azimuth`.

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

At the shutter, store the gravity vector (`DeviceMotion.accelerationIncludingGravity`; iOS asks permission). Build the camera ray `((px − cx) / fx, (py − cy) / fy, 1)` with y downward, rotate it to level, and take the horizontal angle with the sign above.

If gravity is missing, require a level bubble and **widen** the bearing σ to the tilt still allowed. An unlevelled phone is not a 0.1° instrument, and it should fail the 200 mm station gate.

**Bearing σ** is per ray. Do not inflate it because a rod subtends less than 15°. Weak geometry belongs in the covariance.

`σ_β² = (σ_px / fx)² + σ_centring² + σ_plumb²`

A 1° pole tilt on a 1 m pole is 17 mm at the ground, which is 0.1° at 10 m range. Pixel σ, mark centring, and that eccentricity are the three terms.

### 3.3 Two marks: an arc, then a tape

Angle `θ` subtended by segment AB puts the camera on a circular arc **through A and B**, radius

`R = L / (2 sin θ)`.

For `L = 7` m and `θ = 20°`, `R = 10.23` m. Yaw is fixed once a point on the arc is chosen, because `ψ` absorbs the absolute orientation. Two clicks and three unknowns `(Cx, Cy, ψ)` leave one degree of freedom.

`|β_A + β_B| ≈ 0` only says the optical axis bisects angle ACB. The user can do that from **any** point on the arc by aiming. On the 20° arc the sum was 0.000° at three tested stations, and the isosceles formula then sat **0 m, 3.55 m, and 7.00 m** off the truth. The image cannot tell you the pole is on the perpendicular bisector.

**The centred-baseline shortcut is dropped.** No symmetry tolerance.

With two marks, either:

- tape from the pole to A, B, or the midpoint (two bearings + one distance), or
- click a third known mark.

Otherwise the station stays unset. The isosceles formula in `stationFromBaselineSighting` remains a description of the current code, not of this solve.

### 3.4 Three or more marks

Three known marks give three bearing equations in `(Cx, Cy, ψ)`. Start from a closed form (Pierlot & Van Droogenbroeck, ToTal, 2014, or Tienstra, or Collins). That construction’s determinant, or `|ρ − R| / R` with `ρ` the distance from the circumcentre, measures the danger circle. Refine with Levenberg–Marquardt, wrapped residuals, and analytic Jacobians. Stop when the step is under **0.1 mm**.

Warn when `|ρ − R| / R < 0.2`. Accept or reject on the **95% ellipse**, not on the angle alone. With 0.1° rays and stations about 9–14 m out, that 95% semi-major was about 180 mm with the rod in front of the house (depth), 0.75 m with every mark to one side, 1.47 m at 1.2 R from the danger circle, and **4.7 m** at 1.05 R.

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

- Global variance factor `σ̂₀² = vᵀ P v / (n − u)`, tested against `χ²` with `n − u` degrees of freedom.
- Standardised residual `w_i = v_i / (σ_i √r_i)`, where `r_i` is the redundancy number of that observation. Drop **one** blunder at a time and re-solve.
- Marginal detectable blunder `MDB_i ≈ 4.13 σ_i / √r_i` (α = 0.1%, β = 80%).
- `r_i ≈ 0`: label the point **fixed but unchecked**. It may be drawn. It is not a structure corner you trust and not a plantable point.
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

In a simultaneous adjustment the polygon meets by construction. Report the check observations’ residuals and `w`-tests, and `σ̂₀`.

If a traverse-style misclosure is shown because angles exist, its tolerance comes from propagation: `T = 2.45 σ_m`. For 6 walls at σ = 20 mm, `σ_m ≈ σ √6 ≈ 49` mm and **T ≈ 120 mm** (95%). A flat 50 mm would warn on about **31%** of houses that were measured correctly at that σ. With a careful tape (`a = 3` mm, `b = 1` mm/m on 3.5 m walls) `σ_m ≈ 11` mm and T ≈ 28 mm, so 50 mm is then a loose warn. The number on screen is the propagated one for the σ actually used. The default, while tape σ is 20 mm, is about **120 mm** for six walls.

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
| Danger circle | Warn below 0.2 in `\|ρ − R\| / R`; reject when the ellipse exceeds the class |
| Ray crossing | Under about 25–30° will not make the 100 mm class |
| Collinear rod | Allowed, usually weak; ellipse decides |

| Class | Pass |
|---|---|
| Datum tape | Its residual and `w`-test. Not “equal to L by construction”. |
| Trilaterated point, checked | 95% semi-major within the class you asked for. At σ = 20 mm that is about **100 mm** near 40° and about **50 mm** near 90°, not a flat 50 mm everywhere. |
| Photo station | 95% semi-major **≤ 200 mm**, and only with `fx` calibrated to **≤ 1%**, levelled rays, and depth or 4+ marks. Otherwise unset or labelled weak. |
| Plantable point | 95% semi-major **≤ 100 mm**, redundancy ≥ 1, and a withheld check with `\|miss\| ≤ 2.45 √(σ_pred² + σ_check²)`. |
| Six-wall traverse misclosure, σ = 20 mm | Warn above about **120 mm**. No warning at all if the only data are the wall lengths. |
| Two marks and no tape; rank failure; ellipse over the class | **No coordinate** you would plant from. |

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
| Close gap | Distance between first and last corner vs 50 mm | No misclosure on walls alone; ~120 mm when a 6-wall check exists at σ = 20 mm |
| Two-mark photo | Isosceles station; click order ignored | Arc only, until one tape or a third mark |
| Bearing | `atan2(px − cx, fx)`; `py` ignored; `fx = 0.9 × width` | Opposite sign, gravity-levelled ray, `fx/width` 0.69–0.75 calibrated to ~1% |
| Three-mark photo | Rod heuristic or a 3 m push | Closed-form start, then LM; ellipse gate |
| Laser | σ = 2 mm | ~5 mm, plus ~50 mm face offset when it applies |
| Extra photos | Centimetre spiral mixed into the average | Same station; rays only |
| Blunders | `\|r\| / σ`, which is blind at redundancy 0 | `σ̂₀`, `w_i`, MDB, “unchecked” label |

## 8. What the advisor closed

1. **Datum.** Minimal constraint. Not a soft pin, and not `(L, 0)`.
2. **Symmetry shortcut.** Dropped. Arc plus one tape, or a third mark.
3. **Sensitivity table.** Correct, with the ±1.98 m figure for 10% `fx` on 7 m at 20°. The 200 mm station target does not survive a 10% `fx`.
4. **Resection.** Closed form, then LM. Danger test `|ρ − R| / R`, decision on the ellipse.
5. **`fx`.** One constant per phone and 1× lens. Not per photo.
6. **Circle.** Geometric fit. Report `σ_R`. Short arcs do not determine a radius.
7. **ARKit.** Not required if bearings are levelled and calibrated and the redundancy rules above are kept.
