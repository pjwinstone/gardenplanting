# Guided workflows

Generated from `src/workflows/guided/definitions.ts`. Do not edit by hand.
Refresh with `npm run check:workflows -- --write`.

## Circle field test

Ready. 13 steps.

Your own garden circle (about 12 m). One phone, about an hour. Look from BAS01 toward BAS02.

### 1. Gather the kit

Phone, tapes, canes, sleeves, level, and the pole.

- One iPhone. Rear camera, zoom 1×, held landscape. Same phone for every photo, including the calibration.
- A tape that reaches across the circle (about 12 m) clear. A laser, or a tape that reaches 15 m, for the camera positions.
- One cane per edge point (Set-up, 12 by default). Two canes for the baseline. One cane for the calibration if you do not reuse an edge cane.
- Sleeves from Print & fit markers (BAS01, BAS02, EDG01…), on a 60 mm dowel. Matte. Each sleeve’s own R. A spirit level and the phone pole, about 1 m.
- Camera location off. Leave Offset A (mm) and Offset B (mm) at 0.

Completes when: Tick by hand.

Opens: —.

### 2. Place the baseline points

Outside the circle, along it (tangential). At least half the diameter long.

- Put BAS01 and BAS02 just outside the circle, side by side along its edge, about 2 m clear of it. The line BAS01–BAS02 runs along the circle, not towards its middle.
- Length: the Set-up baseline (at least half the circle diameter: 6 m for a 12 m circle). Looking from BAS01 toward BAS02, the circle is on your left.
- Plumb both canes (bubble, about 1°) and write each sleeve’s R and height.

Completes when: Tick by hand.

Opens: —.

Note: Baseline sleeve R, heights.

### 3. Tape the baseline both ways

Sleeve to sleeve, level, then add R. Type the mean.

- Tape BAS01–BAS02 both ways, sleeve to sleeve, level. Level each reading, then add that end’s measured R.
- The two axis lengths must agree within 10 mm. The mean is the length you type. Do not average a pair that disagrees by more than 10 mm.
- Menu → Baseline. End A BAS01, End B BAS02. Measure with Tape. Offset A and Offset B stay 0. Save baseline.

Completes when: Tick by hand; and baseline.saved tape BAS01–BAS02, offsets 0/0 mm.

Opens: Menu → baseline.

Note: Both pulls, level then +R.

### 4. Laser check of the baseline

Same baseline, sleeve to sleeve. Do not type the laser.

- Laser the same baseline, sleeve to sleeve, same height. This is CHK-BASE. It is not typed into the app.
- Retake if the dot is more than half that sleeve’s R (about 15 mm) off the middle. Level, then add R for each sleeved end.

Completes when: Tick by hand.

Opens: —.

Note: CHK-BASE laser.

### 5. Tape the diameter

Three tapes across the circle, about 60° apart. Type them below.

- Tape straight across the circle through the middle: the longest reading you can get each time. Then turn about 60° round the circle and tape again, and once more: three readings.
- Keep to one edge of the border every time, inside or outside, and say which below. The edge canes go on that same edge.
- Type the three readings in metres and tap Save diameters. They differ a little on a real circle; the app uses their mean and spread.

Completes when: Tick by hand.

Opens: —.

### 6. Mark the edge points

One sleeved cane per edge point, on the edge you taped, evenly round.

- Plant EDG01, EDG02, … (Set-up, 12 by default) round the circle on the edge you taped, about evenly spaced: never more than 60° between neighbours, and all the way round.
- Each cane carries its own sleeve from the garden marker set; the app finds them in the photos by their code.
- Plumb every cane (bubble, about 1°). Write heights and sleeve R in the note.

Completes when: Tick by hand.

Opens: —.

Note: Heights, sleeve R, plumb.

### 7. Calibration photo (focal length)

Measures the lens. Landscape, 1×, phone 4.0 m from the cane, sleeve in the middle.

- What it is for: the app needs the lens’s real focal length in pixels. A sleeve of known size at a taped distance gives it.
- 1. Plumb one sleeved cane (an edge cane will do). Stand with the front of the phone 4.0 m from the paper (the Set-up distance). Tape it level and write the reading.
- 2. Hold the phone sideways (landscape) at 1×, at sleeve height, level. Cane in the middle of the frame, whole sleeve in view, seam turned away.
- 3. Tap the sleeve to lock focus, then the shutter. One photo, in the in-app camera (the Take photos pill opens it).
- After the shutter the photo fills the screen. Tap once anywhere on the sleeve. The app finds its top and bottom edge from the bands and draws two lines. If they sit on the paper ends, tap Save. If the app is unsure it asks you to tap the top edge, then the bottom edge.
- Start this run before you take the calibration photo. A shot from earlier does not count.
- How it works: the sleeve is 287 mm tall. At 4.0 m plus the sleeve’s R it is about 215 px tall, and focal length in px = pixels × distance ÷ 0.287 m.

Completes when: photo.uploaded Calibration, 1 photo.

Opens: Camera at Calibration.

Tap after the photo (sleeve height, not bearings):
- Photo 1: sleeve.
- The app finds the edges from the printed bands. Only if it is unsure: top edge of the sleeve, bottom edge of the sleeve.

Note: Tape reading, phone front to paper (m).

### 8. Camera position 1 (BAS02 end)

Outside the circle, about 6 m past the edge. Turn on the spot; each photo shares a cane with the one before.

- Stand outside the circle on the BAS02 end. Positions go round the circle so the cameras are on at least 3 sides.
- Tape this position to BAS01 and to BAS02 (Set-up distances), level, pole to sleeve, add R once. The app places the camera from these two tapes.
- Photo 1 and photo 2: landscape, 1×. Turn on the spot, do not step. Photo 2 keeps at least one cane from photo 1 in view (that is how the app points it). A baseline end in view helps but is not needed.
- Taped positions stand on the circle side of the BAS01–BAS02 line, not behind it: two tapes from behind can be read on either side.
- Each edge cane needs photos from two positions at least 30° apart. The Circle result step says which cane needs another photo.

Completes when: photo.uploaded Position 1, 2 photos.

Opens: Camera at Position 1.

Tap after the photo (bearings):
- Photo 1: BAS01 (or Not in view), BAS02 (or Not in view), EDG01 (or Not in view), EDG02 (or Not in view), EDG03 (or Not in view), EDG04 (or Not in view), EDG05 (or Not in view), EDG06 (or Not in view), EDG07 (or Not in view), EDG08 (or Not in view), EDG09 (or Not in view), EDG10 (or Not in view), EDG11 (or Not in view), EDG12 (or Not in view).
- Photo 2: BAS01 (or Not in view), BAS02 (or Not in view), EDG01 (or Not in view), EDG02 (or Not in view), EDG03 (or Not in view), EDG04 (or Not in view), EDG05 (or Not in view), EDG06 (or Not in view), EDG07 (or Not in view), EDG08 (or Not in view), EDG09 (or Not in view), EDG10 (or Not in view), EDG11 (or Not in view), EDG12 (or Not in view).

Note: Position 1 to BAS01 / BAS02.

### 9. Camera position 2 (far side, beyond BAS02)

Outside the circle, about 6 m past the edge. Turn on the spot; each photo shares a cane with the one before.

- Stand outside the circle on the far side, beyond BAS02. Positions go round the circle so the cameras are on at least 3 sides.
- No tape needed here: the app places this position from the sleeves it sees. If Set-up has distances for it, tape them too.
- Photo 1 and photo 2: landscape, 1×. Turn on the spot, do not step. Photo 2 keeps at least one cane from photo 1 in view (that is how the app points it). A baseline end in view helps but is not needed.
- Taped positions stand on the circle side of the BAS01–BAS02 line, not behind it: two tapes from behind can be read on either side.
- Each edge cane needs photos from two positions at least 30° apart. The Circle result step says which cane needs another photo.

Completes when: photo.uploaded Position 2, 2 photos.

Opens: Camera at Position 2.

Tap after the photo (bearings):
- Photo 1: BAS01 (or Not in view), BAS02 (or Not in view), EDG01 (or Not in view), EDG02 (or Not in view), EDG03 (or Not in view), EDG04 (or Not in view), EDG05 (or Not in view), EDG06 (or Not in view), EDG07 (or Not in view), EDG08 (or Not in view), EDG09 (or Not in view), EDG10 (or Not in view), EDG11 (or Not in view), EDG12 (or Not in view).
- Photo 2: BAS01 (or Not in view), BAS02 (or Not in view), EDG01 (or Not in view), EDG02 (or Not in view), EDG03 (or Not in view), EDG04 (or Not in view), EDG05 (or Not in view), EDG06 (or Not in view), EDG07 (or Not in view), EDG08 (or Not in view), EDG09 (or Not in view), EDG10 (or Not in view), EDG11 (or Not in view), EDG12 (or Not in view).

Note: Position 2 to BAS01 / BAS02.

### 10. Camera position 3 (far side, beyond BAS01)

Outside the circle, about 6 m past the edge. Turn on the spot; each photo shares a cane with the one before.

- Stand outside the circle on the far side, beyond BAS01. Positions go round the circle so the cameras are on at least 3 sides.
- No tape needed here: the app places this position from the sleeves it sees. If Set-up has distances for it, tape them too.
- Photo 1 and photo 2: landscape, 1×. Turn on the spot, do not step. Photo 2 keeps at least one cane from photo 1 in view (that is how the app points it). A baseline end in view helps but is not needed.
- Taped positions stand on the circle side of the BAS01–BAS02 line, not behind it: two tapes from behind can be read on either side.
- Each edge cane needs photos from two positions at least 30° apart. The Circle result step says which cane needs another photo.

Completes when: photo.uploaded Position 3, 2 photos.

Opens: Camera at Position 3.

Tap after the photo (bearings):
- Photo 1: BAS01 (or Not in view), BAS02 (or Not in view), EDG01 (or Not in view), EDG02 (or Not in view), EDG03 (or Not in view), EDG04 (or Not in view), EDG05 (or Not in view), EDG06 (or Not in view), EDG07 (or Not in view), EDG08 (or Not in view), EDG09 (or Not in view), EDG10 (or Not in view), EDG11 (or Not in view), EDG12 (or Not in view).
- Photo 2: BAS01 (or Not in view), BAS02 (or Not in view), EDG01 (or Not in view), EDG02 (or Not in view), EDG03 (or Not in view), EDG04 (or Not in view), EDG05 (or Not in view), EDG06 (or Not in view), EDG07 (or Not in view), EDG08 (or Not in view), EDG09 (or Not in view), EDG10 (or Not in view), EDG11 (or Not in view), EDG12 (or Not in view).

Note: Position 3 to BAS01 / BAS02.

### 11. Camera position 4 (BAS01 end)

Outside the circle, about 6 m past the edge. Turn on the spot; each photo shares a cane with the one before.

- Stand outside the circle on the BAS01 end. Positions go round the circle so the cameras are on at least 3 sides.
- Tape this position to BAS01 and to BAS02 (Set-up distances), level, pole to sleeve, add R once. The app places the camera from these two tapes.
- Photo 1 and photo 2: landscape, 1×. Turn on the spot, do not step. Photo 2 keeps at least one cane from photo 1 in view (that is how the app points it). A baseline end in view helps but is not needed.
- Taped positions stand on the circle side of the BAS01–BAS02 line, not behind it: two tapes from behind can be read on either side.
- Each edge cane needs photos from two positions at least 30° apart. The Circle result step says which cane needs another photo.

Completes when: photo.uploaded Position 4, 2 photos.

Opens: Camera at Position 4.

Tap after the photo (bearings):
- Photo 1: BAS01 (or Not in view), BAS02 (or Not in view), EDG01 (or Not in view), EDG02 (or Not in view), EDG03 (or Not in view), EDG04 (or Not in view), EDG05 (or Not in view), EDG06 (or Not in view), EDG07 (or Not in view), EDG08 (or Not in view), EDG09 (or Not in view), EDG10 (or Not in view), EDG11 (or Not in view), EDG12 (or Not in view).
- Photo 2: BAS01 (or Not in view), BAS02 (or Not in view), EDG01 (or Not in view), EDG02 (or Not in view), EDG03 (or Not in view), EDG04 (or Not in view), EDG05 (or Not in view), EDG06 (or Not in view), EDG07 (or Not in view), EDG08 (or Not in view), EDG09 (or Not in view), EDG10 (or Not in view), EDG11 (or Not in view), EDG12 (or Not in view).

Note: Position 4 to BAS01 / BAS02.

### 12. Circle result

The app fits the circle and compares it with your tape.

- Green: the fitted diameter agrees with the tape within its uncertainty and within the limit (60 mm). Amber: close. Red: it does not agree.
- Not a circle: the points do not sit on one circle; check the canes are on the edge you taped. Inconclusive or weak: the geometry is not good enough yet; do what the lines below say, then look again.
- Tick when you have read the result.

Completes when: Tick by hand.

Opens: —.

Note: Result.

### 13. Save to OneDrive

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
