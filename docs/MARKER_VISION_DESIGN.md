# Markers and photo reading — draft for review

**Status:** proposal only. No detection code and no solver code. The Photo & Marker Vision Reviewer should review the marker and the Safari path. The Geometry & Maths Advisor should review the ray, range, and focal-length parts.

**Depends on:** the Phase 1 ray model in [GEOMETRY_DESIGN.md](GEOMETRY_DESIGN.md), as implemented on PR #3 (`cursor/phase1-geometry-solver-8c5c`). This note does not change that branch. Roadmap stages: [ROADMAP.md](ROADMAP.md) Phase 2.

Today’s rod belt is a toilet-roll wrap about **100 mm** tall and **140 mm + 10 mm** around, with the same black 15 / white 20 / black 15 mm stripes on every rod and a human label (A1, A2, A0, B1, B2, B0). Those stripes do not identify the rod. Clicks are still manual.

## 1. Recommendation

Print a **wrap-around ring code** on each rod and post: horizontal bands that go all the way round, so any side of the pole shows the same code. Use that for **identity** and for the **bearing** of the pole axis.

Add a **flat AprilTag (family 36h11)** only where you can look at a face straight on: a small card on the garden side of a rod, or a larger board when you need a name at long range. Use that face to tighten **focal length** and range. Do not wrap the square tag onto the cylinder. A planar code on a curve is not the code the detector was built for.

ArUco is the fallback square code if a WASM AprilTag cannot be shown to run in iPhone Safari. It is not the primary mark.

Hand clicks stay. A failed decode is a miss, not a guess.

## 2. Why not the other shapes

| Mark | From the side you didn’t face | What a hit actually gives | Outdoor false ID |
|---|---|---|---|
| **Ring of bands (this proposal)** | Same code, 360° | Bearing of the axis, ID, a coarse range from the known stack height | You own the checksum. Glare can flip a bar. |
| **Flat AprilTag / ArUco** | Gone once you walk past the face. On a 44 mm tube a square tag is edge-on for most of the circle | Four corners, a homography, a much better range and an `fx` check when the face is large enough | AprilTag 36h11 is strong. Small ArUco dictionaries are not. |
| **Current 15/20/15 belt** | Visible all round | A blob a person can click. Every rod looks alike | No ID to get wrong |
| **Three or four flat tags stuck around the tube** | Only the one facing you | Pose of that face, if it is still flat | The tube is curved, so the “flat” tag is bent |

A ring is rotationally symmetric. It cannot tell you which way around the pole you stood, and it cannot give a full pose. That is acceptable: Phase 1 needs a **ray to a known point**, and the point is the **axis** of the tube, which is already the mark centre.

A flat tag is the right tool when the ray is not enough, in particular for focal length (section 6). It is the wrong tool as the only mark on a rod you walk around.

## 3. Ring code

Bands are **horizontal on the printed sheet** and become rings on the pole. Colour alternates, black then white, so every edge is a real transition. The bit is the **width**, not the brightness: narrow = 0, wide = 1, wide = 2× narrow. A brightness threshold alone will fail in sun.

Layout, top to bottom, after a white quiet zone:

| Bars | Widths | Role |
|---|---|---|
| 3 | wide, narrow, wide | Start. Data is not allowed to begin with this run. |
| 6 | narrow or wide | Payload. **64 IDs.** |
| 4 | narrow or wide | CRC-4 over the payload (polynomial `x⁴ + x + 1`). |
| 2 | narrow, wide | Stop, so an upside-down sleeve does not match the start. |

That is 15 bars. With a 14 mm narrow bar, a typical mix of wide bars, and two short quiet zones, the sleeve is about **250 mm** tall. A 100 mm toilet-roll belt can keep the human label. It cannot hold this code.

64 IDs cover two rods (A1 A2 A0 B1 B2 B0), a house of about ten corners, a run of fence posts, and spares. The printed number is only an index. `garden.json` maps it to a point id (`A1`, `HSE03`, `FNC01`), so a tag can be reassigned without a new pattern. Human text in the quiet zone uses the existing names and avoids O and I.

**Errors.** One flipped bar fails the CRC. The decoder **rejects**. It does not correct. A corrected bit can name the other rod. Two issued payloads must not differ by a single bar; the CRC is what enforces that for single width errors. A read that fails the bar count, the start, the stop, or the CRC produces **no observation**.

## 4. Size at 2–15 m

The in-app camera asks for about **1920×1440**. A full 1× still is about **4032** px wide. For both, `fx / width ≈ 0.72` on the iPhone 1× lens (24–26 mm equivalent, 4:3). Pixels across a feature of height `h` at distance `d` are `fx · h / d`.

| Feature | 2 m, full 1× | 5 m, full 1× | 8 m, full 1× | 15 m, full 1× | 15 m, 1920-wide |
|---|---|---|---|---|---|
| 100 mm toilet-roll belt | ~145 px | ~58 px | ~36 px | **~19 px** | **~9 px** |
| 14 mm narrow bar | ~20 px | **~8 px** | ~5 px | ~3 px | ~1 px |
| 44 mm tube width | ~64 px | ~26 px | ~16 px | ~9 px | ~4 px |
| 80 mm flat tag | ~116 px | ~46 px | ~29 px | ~15 px | ~7 px |
| 150 mm flat tag | — | — | ~54 px | **~29 px** | ~14 px |

A bar needs about **8 px** to measure a width ratio after blur. On a full-resolution 1× frame that is a 14 mm bar at **5 m**, and it is already failing at 8 m. On the 1920-wide preview it fails sooner. Detect on the **full 1× still**, not the preview.

**ID bar:** 2 m and 5 m, correct or blank. **8–15 m:** the sleeve may still give a centreline bearing if both edges are visible (the tube is still ~9 px wide at 15 m on a full-res frame). Do not promote that to an ID. A name at 15 m needs a **large flat board** (150 mm is only ~29 px, enough to try a detection, not enough for a stable pose).

## 5. What a cylinder measures

Sample the image **along the pole axis**, not down a raw image column. Fit the two silhouette edges, take the midline, and read the bright/dark profile along that line. The axis is the angle bisector of the two tangent rays, so the midline is the bearing of the **centre**, including when you are not square-on.

That bearing is one horizontal ray to the mark centre. It is the same observation as a careful click. It does not say how far away the pole is, and it does not say which side of the garden you are on by itself. Phase 1 still applies: two rods and no tape are not a station; one tape usually leaves two stations about 20 m apart; tapes to both baseline ends, or a third mark, fix a station.

**Range from the stack.** The metric height `H` of the code is known, so

`d ≈ fx · H / h_px`.

The relative error is about `σ_fx / fx` plus `σ_h / h`. A 1% focal length and a 2 px error on a 40 px stack are already several percent of range: **decimetres at 5–8 m**, not a 20 mm tape. Enter it as a distance observation with that σ. It is good enough to throw away the wrong station candidate (those two solutions are ~20 m apart). It is not a plantable length. If the pole leans, or the fitted axis is more than about **15°** from vertical after levelling, drop the range and keep the bearing.

Tilt, leaves, and glare:

- **Tilt.** The profile follows the fitted axis. Gravity still levels the ray (section 6). A strong lean widens or drops the range only.
- **Leaves.** A hidden bar fails the CRC. No ID, so no ray. A visible centreline without an ID is not an observation, because the point is unknown.
- **Glare.** Matte paper, width ratios, CRC. A clipped run is a miss. Do not laminate the sleeve into a mirror.

## 6. Rays, intrinsics, and the Phase 1 solver

Store the detection in the same pixel buffer the solver will use. `px` is the midline at the start-bar. `py` is that bar’s vertical position. Orientation and EXIF must be applied **before** those numbers are saved, so “image right” matches the bearing formula. DeviceMotion axis mapping stays the open item in the geometry note: a photo with no camera-frame gravity vector stays unlevelled.

The levelled bearing is the one PR #3 already checks:

`β = atan2(−x_level, z_level)`

from the ray `((px − cx) / fx, (py − cy) / fy, 1)` with y downward. `σ_px` comes from the edge fit. A clean sleeve should land near **1–2 px**, which is the hand-click budget (`σ_β² = (σ_px / fx)² + (σ_centring / d)²`).

**Focal length (advisor B2 on PR #3).** A 10% `fx` error moves the 7 m / 20° station by **±1.98 m**. In the solver review, a 1% `fx` prior that never entered the covariance covered only about **67%** of stations with the reported 95% ellipse, and a ray from a both-tapes station with a 10% `fx` error moved a new mark by **309 mm** while still calling it checked. Marker rays must not repeat that.

- Carry `fx` as a parameter with a prior, or as a consider parameter, so every ellipse includes it.
- A ring of known height observes `fx · H` only. It is a weak scale check and it is mixed up with lean. It does **not** by itself meet the 1% bar.
- A flat AprilTag of known size, seen large and fairly square, observes `fx` and the principal point through the homography. That is the observation that can earn the 1% prior. If the tag is oblique or tiny, keep the centre ray and drop the scale update.
- The 1% rule applies to **any** photo whose rays fix other points, not only to a resected camera (B2b). Do not publish checked or plantable while the variance test is high (B2c).

**Behind the camera (advisor B3).** A detection in the frame is in front of that exposure. The adjust can still slide the point behind the camera if the ID was wrong. Do not publish a point with a negative depth along the ray, outside the field of view, or closer than about **0.5 m** to the camera that claims to see it.

An optional AprilTag’s four corners are four rays in the tag’s own plane. For this 2D solver, pass the **centre of the quad** as the mark ray. Pass the known side length as the scale observation above. Do not open a second coordinate frame.

## 7. Printing

Same path as today: A4, black and white, actual size, `window.print()`.

- Ring sheet: bands parallel to the long edge of the wrap, quiet zone at the **overlap**, seam taped in the quiet zone so it does not cut a bar. Circumference is the tube or the rod plus 10 mm.
- Human name in the quiet zone, matching the point id.
- AprilTag, if used, on a **flat** card, not on the wrap. One lookup row maps both the ring index and the AprilTag id to the same point.
- Matte paper. The current belt graphic can remain as a finder above a short label, but it is not the code.

## 8. In the browser

The ring decoder is a canvas scan: find a high-contrast column, fit its axis, read the profile, test start, stop, and CRC. No library. That runs in iPhone Safari.

The flat face, when you print one, should be **AprilTag 36h11** through a small **WASM** build. Safari has run WASM for years; this still needs a phone check before it is a dependency. OpenCV.js is too large for this PWA. `js-aruco2` is pure JavaScript and is the fallback if WASM fails, with a larger dictionary than 4×4 so a leaf is less likely to become a valid id. The ring path must not wait on that.

## 9. Several photos

Stage (c) does not replace the adjuster. Each accepted detection is a bearing on that photo, tied to a point id by the marker table. The same id in another photo is the same point, including across a yaw-only set and across a later station. A single view of a ring does not create a distance except for the weak stack range in section 5.

Stage (d), later and optional: use the full ray, not only the horizontal bearing, and allow a height. The ring still has no twist around the pole. Planting does not wait for this.

## 10. What the reviewers should try to break

1. Is 64 IDs and a reject-only CRC the right capacity, or do fence-plus-house runs need 8 payload bits on a taller sleeve?
2. Is 8 px per narrow bar the right detection floor on an iPhone 1× still, and is 5 m the right ID range to promise?
3. Is the stack range honest as a weak distance, and is dropping it past about 15° of lean enough?
4. Does the AprilTag homography actually observe `fx` well enough to be the B2 prior, once the tag is allowed to be 30° off axis?
5. Confirm WASM AprilTag in Safari, or say ArUco is the face code we should specify instead.
