# Field sheet — circle on a baseline

Print this and take it outside. It is the first real test of the survey: a circle of known size, points on it, a measured baseline, and three places to stand with the phone. One person, a tape, a laser, and one iPhone. About an hour once the probe below has passed. Print the sleeves the day before.

The design behind this sheet is [FIELD_FIXTURE_PLAN.md](FIELD_FIXTURE_PLAN.md). You do not need that file in the garden. You do need the probe page on the phone before the first still.

## 0. Probe, before any still

On the survey iPhone, open the probe page. It has two buttons and it does not upload.

1. **Take photo.** Rear camera, 1×. Accept the picture.
2. **Choose from library.** Pick a still you just took with the Camera app, rear camera, 1×, not edited.

**Go** for a button means the page shows a focal length, a lens name, a time the camera wrote, and a long side of at least 3000 pixels. **No-go** means that button cannot be used for this test.

Use a path that says go.

- If **Take photo** is go, take the survey stills that way.
- If **Take photo** is no-go and **Choose from library** is go, take each still in the Camera app (rear, 1×), then choose it from the library. The page’s own camera button drops the lens data on some iPhones. The library keeps it.
- If both are no-go, stop. This sheet waits. Do not type a focal length in by hand.

Write the result on the sheet: which button was go, the lens name, and whether the page saw a motion reading inside the photo. The time that counts is the time in the photo, not the moment you tap Use Photo.

## What you are proving

The app will work out where the points are. Afterwards a test checks two things: the fitted circle’s radius against the radius you set out, and how far each point sits off that circle, using the error the solver itself claims. Your job is to set the circle honestly, plumb the sticks, and write down the numbers the app does not ask for yet.

## Take with you

- One iPhone. The same phone for every photo, including the calibration shot. Rear camera, zoom at **1×**, held **landscape**. Portrait will not hold both baseline ends.
- A tape that reaches 8 m clear between two points. STN01 uses all of that 8 m.
- A laser, or a tape that reaches **10.5 m**. STN03 is 10.50 m from each end, and STN02’s long leg is 9.00 m. The laser is also a second measurement of the baseline. That reading is a check. It is not the length you type into the app.
- A non-stretch line marked at **4.000 m** against the tape, pulled firm, on the flat.
- A centre peg, six canes for the circle, two canes for the baseline, one cane for the calibration if you do not reuse a circle cane.
- A small spirit level (a bubble).
- Sleeves glued snug round a **60 mm** dowel. Matte paper. Measure each finished sleeve and write its R on this sheet. That correction is the sleeve’s measured R (about 30 mm, see MARKER_VISION_DESIGN.md).
- This sheet and a pen.

Camera location off, if you remember. The import strips GPS anyway. Point the camera at the sticks.

Leave the app’s **offset mm** box at **0**. Write each sleeve’s measured R (about 30 mm, see MARKER_VISION_DESIGN.md) on this sheet. It is applied later, on the tape, after the tape has been made level.

## Numbers to trust

| Thing | Value |
|---|---|
| Circle radius | **4.000 m** from the peg to the stick axis |
| Points | **6**, evenly round the circle |
| Chord between neighbours | **4.000 m** (same length as the radius) |
| Diameter, opposite points | **8.000 m** |
| Long chord (every second point) | **6.93 m** |
| Baseline | **8.000 m** between the two end sticks, level, then sleeve correction |
| Sleeve radius to add | the sleeve’s measured R (about 30 mm, see MARKER_VISION_DESIGN.md), once for each end that stopped on the paper |
| Peg to the near baseline end | **4.30 m** |
| Sleeve centre above the ground | measure it; **0.5 m** is a good height |
| Plumb | bubble in the middle, about **1°** |
| Why the bubble matters | a 2° lean at 0.5 m sleeve height moves the ground point **17 mm**. A photo cannot see a lean toward the camera. |
| Calibration distance | **4.000 m** from the front of the phone to the paper, then that sleeve’s measured R. Between 3 m and 5 m is acceptable. |
| Laser dot | retake if it is more than half that sleeve’s measured R (about 15 mm) off the middle of the stick |

You want a clear patch about **8 m** along the baseline and about **17 m** across, so STN01 on one side and STN03 on the other both fit.

## 1. Set out the circle

1. Put the centre peg in the lawn where you can walk all the way round it.
2. The line stays on the peg. It is already 4.000 m to the axis of a stick, not to the paper. If you measured the line to the paper, mark it longer by the sleeve’s measured R (about 30 mm, see MARKER_VISION_DESIGN.md) so the axis is at 4.000 m.
3. Plant **CRC01** on that line. This will be the point nearest the baseline.
4. Plant **CRC02** so it is 4.000 m from the peg (the line) and 4.000 m from CRC01 (the tape). The tape is the chord.
5. Continue the same way for **CRC03**, **CRC04**, **CRC05**, **CRC06**. Each new stick is 4.000 m from the peg and 4.000 m from the one before.
6. The last chord, CRC06 back to CRC01, should also be 4.000 m. More than 30 mm out: walk the sticks again.
7. Tape the two diameters, CRC01–CRC04 and CRC02–CRC05, holding the tape level. Each should be 8.000 m between the axes. If you taped to the paper, the reading is short by the two sleeves’ measured R added together (about 60 mm). Write the raw reading and “both ends on paper”.
8. Both diameters within 20 mm of 8.000 m, and the closing chord within 30 mm of 4.000 m: write `radius σ = 3 mm`. That 3 mm is the part of the set-out that shifts the whole circle together. The wobble of one stick is counted later, on its own, so it is not in this 3 mm. A 10 mm or 20 mm figure here is a tolerance on a length, not this σ. If a diameter or the closing chord is outside those limits, walk the sticks again. Do not write a larger σ and carry on.

CRC04 is opposite CRC01. CRC01 is the point you will bring close to the baseline.

## 2. Baseline

The two end sticks are **BAS01** and **BAS02**. BAS02 is the end nearest the circle. BAS01 is the far end. The line from the peg through CRC01 is already in the ground.

1. From the peg, through CRC01, go on to **4.30 m**. That point is BAS02. It sits about **0.30 m** past CRC01. Write the distance you actually taped. The circle then passes about 0.30 m from BAS02.
2. The baseline runs square to that line, through BAS02. From BAS02 back toward the peg, mark **3.00 m**. From that mark swing **5.00 m**, and from BAS02 swing **4.00 m**. Where they meet is 4 m out to the side, square to the peg line. A 3-4-5 triangle.
3. BAS01 is **8.000 m** from BAS02, through that side point. The tape runs past the circle and stays clear of it. BAS01 is the far end.
4. Tape BAS01 to BAS02 **both ways**, BAS01 to BAS02 and back. Hold the tape at the **sleeves**, paper to paper, not down at the ground. Pull it firm and hold it level. Write both readings.
5. If one end is higher, write the height difference. The level length is the one that counts. A drop of 0.3 m in 8 m makes the slope reading about 6 mm long.
6. Level each reading first. Then add the sleeve’s measured R (about 30 mm, see MARKER_VISION_DESIGN.md) for each end that stopped on the paper. Write “level, then +R” and the R you used for each end. Both ends on paper means add both.
7. The two axis lengths must agree within **10 mm**. More than that: tape both ways again. Do not average a pair that disagrees by more than 10 mm. The mean of the two that do agree is the baseline you type into the app. Kind: tape.
8. Shoot the same baseline with the laser, again **sleeve to sleeve**, at the same height as the tape, not at the ground. This reading is required. It is a check, and it is **not** typed into the app. The circle test cannot see a bad baseline on its own, because the tapes from the stations carry the scale. Keep the dot within half that sleeve’s measured R (about 15 mm) of the middle of the stick. If it sits further out, shoot again. Level that reading, then add that end’s measured R for each sleeved end. Write the laser on this sheet.

## 3. Plumb every stick and write its height

For each cane, CRC01–CRC06, BAS01, BAS02, and the calibration cane:

1. Bubble in two directions. Middle of the bubble. About 1° is the limit. If it is out, straighten the cane and look again.
2. Measure from the ground to the **middle of the paper**. Write it in the table at the end. Half a metre is a good target. Use whatever it actually is.
3. Tick `plumb ok` only when the bubble passed.

A lean toward the camera does not show in the picture of the stick. At half a metre up, 2° is 17 mm on the ground. That is why the bubble is on this sheet.

The phone’s own tilt is a separate record. It comes from the photo when the probe saw a motion reading there. Otherwise the app uses motion from just before you open the camera and just after the picture comes back, and only if the phone was still both times. The tap on Use Photo is not that moment.

## 4. Calibration shot

Before any station. Same phone. **1×**.

1. Use one plumbed cane (a spare, or CRC01).
2. Stand so the front of the phone is about **4 m** from the stick, and between 3 m and 5 m.
3. Tape from the **front of the phone** to the paper. Hold it level. Write the raw reading. The axis is that reading plus the sleeve’s measured R (about 30 mm, see MARKER_VISION_DESIGN.md), and that sum stays a tape. Leave it as a length.
4. One photo. The sleeve should be a large, clear target, not a speck. Phone held steady, cane filling a good part of the frame.
5. This photo stays in the capture. Name it so you can find it (`CAL`).

Every later photo is this same phone at 1×.

## 5. Where to stand

Each place is fixed by two tapes, one to BAS01 and one to BAS02. Stand where those two lengths meet. There are two such places.

The side is which hand the station is on. Stand at **BAS01** and look toward **BAS02**. The peg is on your **right**. Tick **left** or **right** for each station. That tick is the whole record. Do not write 0 or 1. A station with no side ticked is not placed.

**The lens sits on the pole, not the middle of the phone.** The iPhone camera is near a corner. If the middle of the phone is on the pole, the lens is a couple of centimetres off to one side, and every direction from that station is off by that amount. Before you plumb, look down the pole and slide the phone until the lens glass is over the middle of the pole top. A pencil mark on the pole cap makes the next station quicker. Then bubble the pole (about 1 m, about 1°). Tick “lens on the pole” only after that look.

| Station | From BAS01 | From BAS02 | Looking from BAS01 toward BAS02 |
|---|---|---|---|
| STN01 | 8.00 m | 8.00 m | **Left** (away from the peg) |
| STN02 | 6.50 m | 9.00 m | **Right** (peg’s side, outside the circle) |
| STN03 | 10.50 m | 10.50 m | **Right** (peg’s side, past the far sticks) |

STN01 uses the whole 8 m tape, both ways. Hold it level. There is no spare in an 8 m tape. STN02’s 9.00 m leg and both of STN03’s legs need the laser or a longer tape. At STN02, check you are outside the circle, on your right as you look from BAS01 to BAS02, nearer BAS01 than BAS02.

**STN03 is part of this test.** A capture with only STN01 and STN02 can be written up, and the numbers can be printed, but it is not a pass or a fail. The grade needs all three stations. If you cannot reach 10.5 m, stop and say so on the sheet. Do not call the two-station visit a finished test.

Tape from the **pole** to the **sleeve** on each end stick, not to the ground. Hold it level. Add that end’s measured R if that end is a sleeve. The phone-end of the tape is the pole, not a sleeve, so you add R once, not twice. Write each reading.

In the app these are ordinary tapes. They are how the station is fixed. The photos then check it. Write the side in the notes as well as on the sheet: STN01 left, STN02 right, STN03 right, looking from BAS01 toward BAS02.

## 6. Photos at each station

1×, same phone, **landscape**, pole plumbed, lens on the pole, bubble ticked. Stay on the pole when you turn. A second photo is the same station. Do not step.

The 1× frame, held landscape, is about 67° across on a narrow phone and a little wider on others. Every list below fits inside that 67°, with a few degrees spare at each edge. Aim so the named marks sit in from the edges. If a mark listed for that photo is cut off, the pole is not where the tapes said. Re-measure. Do not take an extra turn to chase it.

**STN01**, on your left as you look from BAS01 toward BAS02.

1. Both baseline ends, and CRC01, CRC02, CRC03, CRC04, CRC05. Those five sticks sit inside the 60° between the two ends. CRC06 does not.
2. Turn, and keep **BAS02** in the frame. Add CRC06. CRC05 may stay in. BAS02 is the known mark in this photo. The turn is only about 9°.

**STN02**, on your right as you look from BAS01 toward BAS02.

1. Both baseline ends. They sit 60° apart, the same class of view as STN01. No circle stick lies between them from here, and that is fine. This photo is what lines the station up.
2. Turn, and keep **BAS02** in the frame. Take CRC02, CRC01, CRC06, and CRC03. BAS02 is the known mark. Do not take CRC05 in this photo. CRC05 sits directly behind CRC03 from here, and CRC03’s cane hides it. CRC05 is already in the STN01 photo and in the STN03 photos.
3. Do not take a photo of CRC04 from here. CRC04 is too far from both baseline ends to share a 1× frame with either of them. A turn that puts CRC04 in the middle has no known mark in it, and the solver cannot aim that photo. CRC04 is photographed from STN01 and from STN03.

**STN03**, on your right, past the far sticks. Required for a grade.

1. Both baseline ends, and CRC01, CRC02, CRC03. Those three sit inside the angle between the ends.
2. Turn, and keep **BAS02** in the frame. Add CRC06, CRC05, and CRC04.

Tap the marks afterwards: BAS01, BAS02, and each CRC you can see. The full photo is the one that is kept. A small preview is not sharp enough at the far sticks. The far sticks may be too small for a code to read itself. Tap them yourself. The sleeve is there so the stick has a known radius and a height.

## 7. Two check tapes

Measure these after the stations. Write them on this sheet. The app’s distances are the baseline and the tapes from the places you stood.

1. **Diameter** CRC01 to CRC04, a fresh pull, separate from the set-out diameters. Hold the tape at the **sleeves**, paper to paper, not at the ground. Level. Raw reading. Note whether each end was on paper, and add that end’s measured R.
2. **Long chord** CRC01 to CRC03. Same rules: sleeve to sleeve, not at the ground. Axis-to-axis should be near **6.93 m**. The neighbour chords of 4.000 m were the set-out. This longer chord is the check.

The laser baseline from section 2 is the third check, also sleeve to sleeve. It stays on this sheet. It is not typed into the app. The tape mean is the baseline in the app.

## 8. In the app, briefly

- Baseline **BAS01 then BAS02**, in that order. BAS01 is the first end. BAS02 is the second. The level length after the sleeve correction, offset mm left at 0. Do not swap the two ends. Swapping them puts every station on the wrong side of the line.
- The six circle points on one item, geometry **circle**.
- A station at each place you stood, with the two tapes, the side you ticked, and the photos.
- The calibration photo kept with the capture.
- Save to OneDrive as usual when you are back on the network.

Keep this filled sheet. The stills that count are the ones from the path the probe marked go. If that path is the library, the Camera Roll is where they live until you choose them. Leave them unedited. The import uses the sheet and those stills.

## Checklist

- [ ] Probe done. The path you used was go (focal length, lens name, camera time, long side at least 3000 px)
- [ ] Same iPhone, same lens, 1×, for the calibration and every station
- [ ] Line marked 4.000 m, six sticks, neighbour chords 4.000 m
- [ ] Both diameters written; closing chord within 30 mm; radius σ **3 mm**
- [ ] Baseline 8.000 m, both directions, level, plus each sleeved end’s measured R
- [ ] The two baseline pulls agree within 10 mm
- [ ] Laser baseline written, and not typed into the app
- [ ] Peg to BAS02 written (aim 4.30 m)
- [ ] Every cane bubbled, height to the middle of the paper written, and that sleeve’s measured R written
- [ ] Calibration tape from the front of the phone written raw
- [ ] STN01, STN02, and STN03, each with two tapes, each ticked left or right looking from BAS01 toward BAS02
- [ ] Lens over the middle of the pole at each station, then the pole bubbled
- [ ] STN01, STN02, STN03 photos as in section 6, landscape, each turn keeping a baseline end in the frame
- [ ] CRC04 not photographed from STN02
- [ ] Check diameter and check chord taped sleeve to sleeve, written, and not typed into the app
- [ ] Offset mm left at 0
- [ ] Saved, and this sheet filled

## Sheet to fill

Build / date / phone name:

Probe — Take photo: go / no-go. Choose from library: go / no-go. Path used:

Lens name on the probe:

Motion reading inside the photo: yes / no.

| Cane | Height to sleeve centre (m) | Sleeve R (mm) | Plumb ok |
|---|---|---|---|
| CRC01 | | | |
| CRC02 | | | |
| CRC03 | | | |
| CRC04 | | | |
| CRC05 | | | |
| CRC06 | | | |
| BAS01 | | | |
| BAS02 | | | |
| CAL | | | |

| Measurement | Raw | Level? | Height diff | Ends on paper | Axis length |
|---|---|---|---|---|---|
| Baseline A→B | | | | | |
| Baseline B→A | | | | | |
| Baseline laser | | | | | |
| Peg to BAS02 | | | | | |
| Diameter CRC01–CRC04 | | | | | |
| Diameter CRC02–CRC05 | | | | | |
| Chord CRC01–CRC03 (check) | | | | | |
| Calibration, phone to paper | | | | | |
| STN01 to BAS01 | | | | | |
| STN01 to BAS02 | | | | | |
| STN02 to BAS01 | | | | | |
| STN02 to BAS02 | | | | | |
| STN03 to BAS01 | | | | | |
| STN03 to BAS02 | | | | | |

Radius σ (3 mm when both diameters and the closing chord passed):

The two baseline pulls differ by (mm):

Looking from BAS01 toward BAS02 — STN01 left / STN02 right / STN03 right:

Lens over the pole centre, then bubble ok — STN01 / STN02 / STN03:

Which photo is the calibration:

Notes (weather, a stick you replanted, a tape that was not level):
