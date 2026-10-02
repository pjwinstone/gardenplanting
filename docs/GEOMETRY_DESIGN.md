# Geometry and triangulation — draft for review

**Status:** proposal only. An independent maths advisor should review this before any solver code is written. It does not authorise an implementation, and it does not change `AGENTS.md`.

**Context:** [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md) describes the 0.7.25 code. [ROADMAP.md](ROADMAP.md) Phase 1 is the prototype that would follow a reviewed version of this note. Field practice (house-edge baseline, mark offsets, leapfrog, both baseline ends in frame) stays as in [plan-baseline-then-house.md](plan-baseline-then-house.md).

## 1. Coordinate frame

Local **2D** Cartesian metres. Right-handed. No OS grid and no GPS in the solve.

| Element | Definition |
|---|---|
| Origin | Mark **A** of the **datum baseline** (highest `trust`, default the current house-edge baseline). |
| +X | From A toward mark **B** of that baseline. |
| +Y | The garden side, chosen once when the baseline is established (the side you will stand on). This is a stored sign, not “left of the image”. |
| Scale | The taped or laser length of the datum baseline. |
| Heights | Out of scope. The pole length (~1 m) is a note, not a Z coordinate. |

**Gauge.** A rigid 2D figure has 3 degrees of freedom (translation, rotation) plus scale. Pinning A to `(0,0)`, pinning B to `(L, 0)`, and storing the garden sign of +Y removes them. Every other baseline is then a **distance observation**, not a new origin. The “active baseline” in the UI chooses which control a new measurement prefers; Adjust still runs in this one frame. If the datum baseline’s trust is later lowered, the pin moves to the new datum and coordinates are rewritten. Old `x,y` are not sacred.

**Reflection.** Circle intersections and resection arcs have two sides. The stored garden sign picks the side. If both solutions lie on that side, keep the one closer to an existing ray or ask; do not average them.

## 2. Marks and features

A toilet-roll or disc has a **mark centre**. The brick arris or post centre is the **feature**. They differ by an offset.

Store, per control point:

- `offsetMm` — distance from mark centre to feature, millimetres.
- `offsetDirection` — one of: inward normal of a named edge, outward normal, or an explicit bearing in the garden frame (radians from +X).

The **solved feature** is what polygons and beds use. The **mark** is what photos click and what a tape between two rolls measures. A tape along a wall between two arrises is a feature-to-feature distance; the UI must say which.

Today `offsetMm` is a scalar and Layer A shoves the same point’s `y`. That cannot represent “roll is 40 mm in front of the brick”. This proposal splits mark and feature before anyone trusts a corner.

## 3. Survey method

Distances first, angles second. Same instruments as the app already assumes: tape or laser, two 4.000 m rods, phone on a plumbed pole, clicks on printed marks.

### 3.1 What fixes a new point

| Observation | Fixes the point? |
|---|---|
| One distance from a known point | No. The point lies on a circle. |
| Two distances from two known points | Yes, up to the side choice (trilateration), provided the intersection angle is not tiny. |
| One photo, two known marks | The **camera** lies on an arc. It does not fix a third, unknown mark. |
| One photo, three known marks, level camera | The **camera** pose `(x, y, yaw)` is determined, except on the danger circle (below). |
| Bearings to an unknown mark from **two** known camera stations | Yes: ray intersection, with a poor-geometry check. |
| One bearing and one distance | Yes, up to a noted ambiguity if the distance circle cuts the ray twice. |
| Wall chain of taped edges and no angles | No. Each new corner swings on a circle. A default 90° turn is an assumption, not a measurement. |

**House corners** you cannot stand on are marks in the photo or ends of a tape. Preferred fixes, in order: a second tape from a known point; or two camera stations that both see the mark and enough control to be solved; or one solved station plus a distance. A single frame that contains the baseline and the corner **records** the rays. It does **not** by itself output the corner’s `x,y`.

**Leapfrog.** Rod A (known length 4.000 m, σ 5 mm) is a short baseline. Photographing rod A and rod B in one frame, with three solved marks or a trilateration, transfers the frame to the far side. Picking A up is legal only after that joint observation exists (the app already gates **Rods moved** on this). Rod B then becomes ordinary control in the same frame.

**Yaw-only extra photos** are the same station: one `(x, y)`, several `yaw` values. They add rays. They are not new stations.

### 3.2 Camera model (level pole)

Assume the pole is plumbed and the phone is roughly level, so the plan view is a pinhole:

- Unknowns per photo: `Cx`, `Cy`, yaw `ψ`.
- Click `(px, py)` → horizontal bearing in the camera frame  
  `β = atan2(px − cx, fx)` with `cx = width/2`.
- `py` is ignored for the 2D plan (it would matter for height, which we are not solving).
- Predicted bearing of a known point `P`: `atan2(Py − Cy, Px − Cx) − ψ`.

`fx` is **not** `0.9 × width` as a fact. Treat `fx` as a per-photo nuisance with a wide prior, or calibrate it in the same frame from a rod of known length that subtends a large angle (15–40°). A 10% `fx` error scales the subtended angle and, on a short baseline seen at 20°, moves the station by on the order of a metre (section 5).

### 3.3 Two known points do not locate the camera

Let the baseline subtend an angle `θ` at the camera. The inscribed-angle theorem puts the camera on a **circular arc** through nothing else: every point on that arc sees segment AB at angle `θ`. There are two arcs (two sides). Yaw is then fixed **once** a point on the arc is chosen, because absolute bearings are absorbed by `ψ`. So two clicks give **one** constraint on position (which arc-point family) plus yaw, and one degree of freedom remains.

The current helper `stationFromBaselineSighting` uses

```
d = (L / 2) / tan(θ / 2)
```

and steps that distance along the perpendicular bisector. That is the unique point on the arc only when the camera is aimed so the baseline is symmetric about the optical axis (`β_A ≈ −β_B`). It is a **centred-baseline shortcut**, not a resection. The code path that reads which click is left of the other does not change the side.

**Proposal:** if only two marks are clicked, leave the station unset and say so. Offer the shortcut only when the user has centred the baseline **and** `|β_A + β_B|` is small (advisor to set the tolerance; a starting suggestion is 2°). Label the result approximate.

### 3.4 Three-point resection

Three known, non-collinear marks give three bearing equations in `(Cx, Cy, ψ)`. Solve by Gauss–Newton from a trilateration or arc initial guess, or by the standard 2D resection construction. Reject or warn when the camera lies near the **danger circle** (the circle through the three marks): the angles stay almost right while the position slides. Also warn when any subtended angle between control is under **10°** (section 5).

An unknown fourth click is a **ray** from that pose. A second solved station that sees the same mark intersects the ray. Two rays that are almost parallel stay unfixed.

## 4. Solver

One weighted non-linear least squares over the garden, not two sequential recipes that overwrite each other.

**Unknowns**

- Feature `(x, y)` for every point that has at least two independent constraints. Others stay without coordinates.
- Per photo with enough control: `Cx, Cy, ψ`, and `fx` if not calibrated.
- Mark position = feature + offset vector (section 2), so the offset is not a second free point unless the user left the direction unknown.

**Observations and weights** (variance `σ²`; start from the constants already in `model.ts`)

| Observation | Residual | `σ` |
|---|---|---|
| Tape distance | `‖Pi − Pj‖ − L` | 0.020 m |
| Laser distance | same | 0.002 m |
| Rod length | same | 0.005 m |
| Photo bearing | wrapped angle, predicted minus `β` | `atan(2 px / fx)` as a start (~0.1° if `fx` is honest); loosen when the rod subtends under 15° |
| Datum pin | A and B held as the gauge (section 1), not as fake zero-residuals | — |

**Do not** add a term that pulls a corner onto a 90° turn. **Do not** add the 3 m fallback pose. **Do not** average a solved station with the provisional spiral used for drawing (`estimatePhotoContribution`); that spiral is display-only and must not enter the normal equations.

**Initialisation**

1. Pin the datum baseline.
2. Intersect circles for every point with two distances.
3. Resect photos that see three of those points.
4. Intersect rays for marks seen from two stations.
5. Leave the rest undefined.

**House polygon.** Vertices are point ids in order. The closing condition is a distance observation on the last edge if it was taped, plus a **misclosure** report: propagate the chain (or read it off the least squares) and measure how far the recomputed start misses the pinned start. Warn if that miss is above **50 mm**. The distance between corner 1 and corner N is the closing **wall**, not the misclosure. (The 0.7.25 `closeHouse` gap is that wall-length, compared with 50 mm. This proposal replaces that definition.)

**Active baseline and trust.** During capture, the chosen baseline may be held fixed so the UI can show a tentative point. The stored Adjust result is always the global weighted solve. Trust changes the datum pin and the relative weight of that distance; it does not freeze early coordinates.

**Outputs to keep for the coach** (plain language, millimetres): each distance residual, each point’s RMS, misclosure, and a count of points left unfixed with the missing observation named (“second distance” or “second station”).

## 5. Error handling and accuracy

### Sensitivity (for the advisor to check)

Baseline length `L`, subtended angle `θ`, isosceles range `d = (L/2) / tan(θ/2)`:

`|dd/dθ| = L / (4 sin²(θ/2))` with `θ` in radians.

| `L` | `θ` | Range `d` | About 1° on `θ` | About 10% on `θ` (fx-scale error) |
|---|---|---|---|---|
| 7 m | 20° | ~20 m | ~1.0 m | ~2 m |
| 7 m | 40° | ~10 m | ~0.26 m | ~1 m |
| 4 m rod | 25° | ~9 m | ~0.4 m | ~1 m |

Clicks of 2 px are small beside a bad `fx` or a baseline that only fills a thin angle. **Practical rule:** do not accept a photo station whose control subtends under 10°, and do not quote 20 mm from a photo.

Trilateration with two tapes, `σ = 20 mm`, intersection angle `φ`: the cross-track error is on the order of `σ√2 / sin φ`. Near 90° that is ~30 mm. Near 30° it is ~60 mm. Below 20°, refuse or mark weak.

### Targets the prototype must meet

These are pass/fail for synthetic recovery, not claims about the current code.

| Quantity | Target |
|---|---|
| Datum length vs tape/laser | within that observation’s `σ` |
| Trilaterated point, `φ` 40–140° | within **50 mm** of truth |
| Photo station, 3 marks, subtended 15–40°, `fx` within 10% | within **200 mm** |
| Point a bed would use (distances, or two stations) | **100 mm** RMS vs a withheld tape |
| Traverse misclosure | warn above **50 mm** |
| Two-mark photo, danger circle, `θ < 10°`, single taped corner | **no coordinate** |

### Failure behaviour

- Underdetermined → coordinates omitted, coach says which extra measurement would fix it.
- Normalised residual `|r|/σ > 3` → flag that observation; do not silently drag the datum to fit it.
- Two intersection sides → garden sign, else ask.
- Missing `fx` calibration and no large known rod in frame → photo down-weighted and the station labelled weak even if the iteration converges.
- Adjust must not report `geometryOk` from a construction that ignored angle-less corners.

## 6. Layer data model

Layers do not have their own frames. They classify **features** that reference the same points.

```
GardenDocument (one frame)
  control
    baselines          distance + σ + trust + which two marks
    lines              tape / laser / rod
    photos             clicks, pose (after adjust), fx
    setups             time box, rods alive, A+B seen together
  features  (today: objects / Items)
    layerId            boundary | structure | walkway | bed | survey
    geometryType       point | line | circle | square | triangle | irregular_polygon
    measuredPointIds   observations attached to this feature
    selectedPointIds   subset the fit is allowed to use
    solved*            derived: circle, rectangle, or ring — recomputed, never taped
  points
    id, kind, feature x,y or unset
    offsetMm + offsetDirection
    layerId, featureId
```

| Layer id | Features | Point kinds already in the file |
|---|---|---|
| `survey` | Datum, rods, camera stations | `ROD`, `BL`, station poses on photos |
| `structure` | House, sheds | `HSE`. The special polygon `house` remains until a migration copies it onto a feature |
| `boundary` | Fences, railings | `FNC` (new layer id; points already exist) |
| `walkway` | Paths | `OCC` today; keep the id so current JSON loads |
| `bed` | Beds that will hold plants | `BED` (kind exists; + Point currently writes `OCC`) |

**Relationships**

- A bed vertex may be an existing path or boundary point (same id).
- A circle fit (Kåsa or a geometric fit) reads selected points and writes `solvedCircle` plus residual mm. It does not move the datum.
- A “square” must be a **rotated** rectangle (centre, side, yaw) or be labelled axis-aligned. The current fit forces a square onto the coordinate axes; that is a drawing aid, not a shape.
- Plant instances (later, not in this prototype) store a position in this frame and a spacing radius. They do not carry a private coordinate system. They are valid only when their bed’s vertices are fixed points.
- `plants` as a layer id can remain as an alias for future plant marks. Bed **outlines** belong on `bed`, not on a second copy of the polygon.

**Versioning.** This is a `version: 2` document once `offsetDirection`, unset coordinates (distinguished from `0,0`), and the new layer ids are real. v1 files load by: treating a missing direction as “offset not applied”, and not inventing `boundary` / `bed` rows until the user creates them.

## 7. Delta from the code an advisor will see

| Topic | 0.7.25 code | This proposal |
|---|---|---|
| Datum | Active baseline written onto the x-axis inside Layer A | Highest-trust baseline is the gauge; others are observations |
| Next house corner | Left turn of 90° by the taped length | Unfixed until a second constraint exists |
| Close gap | Distance between first and last corner vs 50 mm | Misclosure of the same point vs 50 mm |
| Two-mark photo | Isosceles station on a chosen side | Arc only; shortcut only if centred and labelled |
| Three-mark photo | Rod heuristic or a 3 m push | Bearing least squares; danger circle rejected |
| Third click | Stored; no world point (this part already matches) | Ray, intersected only with a second station or a distance |
| `fx` | `0.9 × width` | Calibrate or carry a wide prior and widen `σ` |
| Extra photos | Centimetre spiral mixed into the average | Same station; rays only |
| Layers | `walkway`, `structure`, `plants`, `survey` plus a special house polygon | Add `boundary` and `bed`; one frame |

## 8. Questions for the maths advisor

1. Is the gauge (pin A, pin B to `(L,0)`, explicit reflection sign) acceptable, or should the datum baseline be a weighted distance with a soft pin so a bad tape can move?
2. Tolerance on `|β_A + β_B|` before the centred-baseline shortcut is allowed, and whether that shortcut should exist at all.
3. Confirm the range derivative in section 5 and the 10° / 200 mm photo gates.
4. Preferred 2D resection numerical method and the danger-circle test (distance to the circle through the three marks, as a fraction of baseline length).
5. Whether `fx` should be calibrated per photo from a known rod or held as a global per-phone constant after one calibration.
6. Geometric circle fit vs the current algebraic (Kåsa) fit for a path, given points that only cover an arc.
7. Anything here that would force a native ARKit pose instead of tape + bearings. The recommendation in the roadmap is that it should not.
