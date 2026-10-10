# Guided workflows

Generated from `src/workflows/guided/definitions.ts`. Do not edit by hand.
Refresh with `npm run check:workflows -- --write`.

## Circle field test

Ready. 12 steps.

One phone, about an hour. Look from BAS01 toward BAS02. Left is left.

### 1. Kit

Phone, tapes, canes, sleeves, level, and the pole.

- One iPhone. Rear camera, zoom 1×, held landscape. Same phone for every photo, including the calibration.
- A tape that reaches 8 m clear. A laser, or a tape that reaches 10.5 m. A non-stretch line marked at 4.000 m.
- A centre peg. Six canes for the circle. Two canes for the baseline. One cane for the calibration if you do not reuse a circle cane.
- Sleeves from Print & fit markers, on a 60 mm dowel. Matte. Each sleeve’s own R. A spirit level and the phone pole, about 1 m.
- Camera location off. Leave Offset A (mm) and Offset B (mm) at 0.

Completes when: Tick by hand.

Opens: —.

### 2. Set out the circle

4.000 m from the peg, and 4.000 m from the cane before.

- Peg in the lawn. Line on the peg, 4.000 m to the stick axis. Plant CRC01 nearest the baseline.
- Each next cane is 4.000 m from the peg and 4.000 m from the one before: CRC02, CRC03, CRC04, CRC05, CRC06.
- Closing chord CRC06–CRC01 within 30 mm of 4.000 m, or walk them again.

Completes when: Tick by hand.

Opens: —.

Diagram: circle-plan.

### 3. Check the diameters

CRC01–CRC04 and CRC02–CRC05 are 8.000 m.

- Tape level, axis to axis, 8.000 m. Both diameters within 20 mm.
- Then write radius σ 3 mm. Outside those limits, walk the sticks again. Do not write a larger σ.

Completes when: Tick by hand.

Opens: —.

### 4. Place BAS02 and BAS01

BAS02 is 4.30 m from the peg. BAS01 is 8.000 m from BAS02.

- From the peg through CRC01, 4.30 m is BAS02, about 0.30 m past CRC01. Write the distance you taped.
- Baseline square to that line. From BAS02 back toward the peg mark 3.00 m. From that mark swing 5.00 m, and from BAS02 swing 4.00 m.
- Through that side point, BAS01 is 8.000 m from BAS02.

Completes when: Tick by hand.

Opens: —.

Note: Peg to BAS02 (aim 4.30 m).

### 5. Tape the baseline both ways

Sleeve to sleeve, level, then add R. Type the mean.

- Tape BAS01–BAS02 both ways, sleeve to sleeve, level. Level each reading, then add that end’s measured R.
- The two axis lengths must agree within 10 mm. The mean is the length you type. Do not average a pair that disagrees by more than 10 mm.
- Menu → Baseline. End A BAS01, End B BAS02. Measure with Tape. Offset A and Offset B stay 0. Save baseline.

Completes when: Tick by hand; and baseline.saved tape BAS01–BAS02, offsets 0/0 mm.

Opens: Menu → baseline.

Note: Both pulls, level then +R.

### 6. Laser CHK-BASE

Same baseline, sleeve to sleeve. Do not type the laser.

- Laser the same baseline, sleeve to sleeve, same height. This is CHK-BASE. It is not typed into the app.
- Retake if the dot is more than half that sleeve’s R (about 15 mm) off the middle. Level, then add R for each sleeved end.

Completes when: Tick by hand.

Opens: —.

Note: CHK-BASE laser.

### 7. Plumb and height

Bubble every cane. Write the height you measure.

- Bubble CRC01–CRC06, BAS01, BAS02, and CAL. Middle of the bubble, about 1°. A 2° lean at 0.5 m sleeve height is 17 mm.
- Write height to the middle of the paper. 0.5 m is a good target. Tick plumb only when the bubble passed.
- The app has no box for sleeve R, height, or plumb. They stay in this note. Offsets stay 0.

Completes when: Tick by hand.

Opens: —.

Note: Heights, sleeve R, plumb.

### 8. Calibration CAL

Start this run first. Then one still, about 4 m, phone front to paper.

- Start this run before you take the calibration photo. A shot from earlier does not count.
- Before any station. One plumbed cane. Front of the phone about 4.000 m from the paper, between 3 m and 5 m.
- Tape that, level, write the raw reading. Axis length is the reading plus that sleeve’s R. One still. Name it CAL.
- On iOS, use the in-app camera. Same capture path and lens as the station photos. fx is per lens and per resolution.

Completes when: photo.uploaded CAL, 1 photo.

Opens: Mode ADD_POINT.

Note: CAL, phone front to paper.

### 9. STN01 — left, 8.00 / 8.00

Landscape, 1×. Both ends, and CRC01 to CRC05.

- Left, looking from BAS01 toward BAS02. 8.00 m / 8.00 m. Tape from the pole to the sleeve, level, and add R once.
- Photo 1: both baseline ends, and CRC01, CRC02, CRC03, CRC04, CRC05. CRC06 does not fit.
- Photo 2: turn, keep BAS02, add CRC06. Do not step. 1×, landscape, lens over the middle of the pole, then the bubble.

Completes when: photo.uploaded STN01, 2 photos.

Opens: Mode ADD_POINT.

Diagram: stn01.

Note: STN01 to BAS01 / BAS02.

### 10. STN02 — right, 6.50 / 9.00

Outside the circle. Do not take CRC05. Do not photograph CRC04.

- Right. 6.50 m from BAS01, 9.00 m from BAS02, outside the circle.
- Photo 1: both baseline ends. No circle stick between them.
- Photo 2: turn, keep BAS02. Take CRC02, CRC01, CRC06, CRC03. Do not take CRC05. It sits behind CRC03.
- Do not photograph CRC04 from here.

Completes when: photo.uploaded STN02, 2 photos.

Opens: Mode ADD_POINT.

Note: STN02 to BAS01 / BAS02.

### 11. STN03 — right, 10.50 / 10.50

Required. Two stations are not a finished test.

- Right. 10.50 m / 10.50 m. This station is required.
- Photo 1: both baseline ends, and CRC01, CRC02, CRC03.
- Photo 2: turn, keep BAS02. Add CRC06, CRC05, CRC04. Do not step.

Completes when: photo.uploaded STN03, 2 photos.

Opens: Mode ADD_POINT.

Note: STN03 to BAS01 / BAS02.

### 12. Save and send

Wait until the file is on OneDrive.

- New garden if this phone should not keep an older one. Sign in. Version 1 is /Garden Survey/garden-v1.json.
- Each Photo row must read verified. A line that says Not usable for focal length means retake at 1× and pick Library at Actual Size.
- Menu → Sign in → Save. Wait until it says the file was saved to OneDrive.

Completes when: cloud.saved.

Opens: Menu → cloud.

## Print & fit markers

Ready. 7 steps.

Eight sleeves, the day before the circle test. All by hand.

### 1. Assign the sleeves

Eight codes. Stations are not sleeved.

- BAS01 315, BAS02 36E, CRC01 459, CRC02 6BA, CRC03 8A3, CRC04 952, CRC05 DAC, CRC06 EC5.
- Write the code on the dowel in pencil, next to the top of the sleeve.
- STN01, STN02, and STN03 are where you stand. They are not sleeved. Calibration reuses a cane. No ninth code. No checkerboard.

Completes when: Tick by hand.

Opens: —.

### 2. Print at actual size

A4, 100%, black only. No fit-to-page.

- A4 portrait, 210 × 297 mm. Actual size / 100%. No fit-to-page, no shrink, no scaling, no borderless, no two-up.
- Highest quality. Black only. Colour management off if the driver has a switch for it.
- Open the sleeve PDF and print all-sleeves.pdf, or the eight single pages.

Completes when: Tick by hand.

Opens: PDF docs/markers/all-sleeves.pdf.

### 3. Check the rulers

100 mm bar within ±0.5 mm, or reprint.

- The 100 mm bar must be 100 mm within ±0.5 mm. The 50 mm bar on the blank tab is the other axis.
- The sheet also carries 250 mm down the tab, and 180 mm along the bottom legend. The four black bars at TOP are the sync. Together they are 52 mm.
- A miss means the driver scaled the page. Reprint. Do not use that sheet.

Completes when: Tick by hand.

Opens: —.

### 4. Paper and film

Matte stock. Measure the 100 mm bar again after film.

- Matte. A gloss stripe down the sleeve blinds the reader. Laser or pigment on matte polypropylene or polyester.
- If you print on paper: matte, 120–160 gsm, not dye. Preferred film is matte over laser toner.
- After any film, measure the 100 mm bar again. If the film stretched the sheet, reprint. Keep the sheets dry until the glue has set.

Completes when: Tick by hand.

Opens: —.

### 5. Cut

Left: just inside the dash. Right: on the right-hand dashed line, or the sheet edge.

- Laminate or film the flat sheet first, if you use film. Then cut. Bands stay horizontal. TOP stays up.
- Cut just inside the CUT HERE dash, between the dash and the start of the bands (about 4.4–5.0 mm from the sheet edge), so the band ink runs right to the cut edge. Inside means toward the bands, not into the margin.
- Do not cut down the dash. Its ink ends near 4.35 mm and the bands start near 4.50 mm, so the line itself leaves a sliver of dash plus white at the seam. If you leave the margin on, a white stripe about 5 mm wide hides the bleed. If the dashes or the band ink are clipped, cut at the edge of the ink.
- Cut the right edge on its dashed line. If those dashes did not print, cut the right-hand edge of the sheet. That edge is the outer edge of the blank tab. Cut 5 mm off the top and the bottom. Do not crease the fold.

Completes when: Tick by hand.

Opens: —.

### 6. Join the sleeve

Fix the tab, wrap, stick the left edge down, seam away.

- Fix the blank tab to the 60 mm dowel before you wrap. Flush staples or flush pins in wood, or glue or thin double-sided tape on a tube. No raised heads under the overlap.
- Staples go in the blank part only, at least 4 mm from the fold, never through the bands. The tab reads staple/glue here — overlap under the other edge.
- Wrap snug, printed face out, TOP up. Do not crease the fold. Square the wrap on the 195 mm fold crosses. A 1° spiral costs about 3.3 mm.
- Stick the cut left edge down over the tab with glue or thin double-sided tape.
- Turn that seam away from the stations and the camera. Keep the seam off the middle of the calibration photo.

Completes when: Tick by hand.

Opens: —.

Diagram: sleeve-join.

### 7. Measure R, height, and plumb

R = C / 2π at three heights, to 0.1 mm.

- Do this after the sheet is stuck down. The outside after the film is the R that counts.
- At three heights, wrap a paper strip or a cloth tape. Not a steel tape. R = C / 2π. Use 2π ≈ 6.2832. Round each sleeve to 0.1 mm.
- Height for this test: 0.5 m from the ground to the middle of the paper is the target. Write the height you actually measure.
- Bubble in two directions, about 1°. The app’s offset boxes stay at 0.

Completes when: Tick by hand.

Opens: —.

Note: Sleeve R mm and height m.

## Walk round the house

Coming soon.

A traverse around the house. Coming soon.

## iOS setup

Coming soon.

Phone settings for the field. Coming soon.
