# Field sheet — circle on a baseline

Print this and take it outside. It is the first real test of the survey: a circle of known size, points on it, a measured baseline, and a few places to stand with the phone. One person, a tape, a laser if you have one, and one iPhone. About an hour. Print the sleeves the day before.

The design behind this sheet is [FIELD_FIXTURE_PLAN.md](FIELD_FIXTURE_PLAN.md). You do not need that file in the garden.

## What you are proving

The app will work out where the points are. Afterwards a test checks two things: the fitted circle’s radius against the radius you set out, and how far each point sits off that circle, using the error the solver itself claims. Your job is to set the circle honestly, plumb the sticks, and write down the numbers the app does not ask for yet.

## Take with you

- One iPhone. The same phone for every photo, including the calibration shot. Rear camera, zoom at **1×**.
- A tape that reaches 8 m clear between two points. Longer is fine.
- A laser, if you have one. It cross-checks the baseline. The stations themselves are placed with the tape.
- A non-stretch line marked at **4.000 m** against the tape, pulled firm, on the flat.
- A centre peg, six canes for the circle, two canes for the baseline, one cane for the calibration if you do not reuse a circle cane.
- A small spirit level (a bubble).
- Sleeves on the canes. Full A4 width, about **64 mm** across, radius **32 mm**. Matte paper.
- This sheet and a pen.

Camera location off, if you remember. The import strips GPS anyway. Point the camera at the sticks.

Leave the app’s **offset mm** box at **0**. Write the 32 mm sleeve correction on this sheet. It is applied later, on the tape, after the tape has been made level.

## Numbers to trust

| Thing | Value |
|---|---|
| Circle radius | **4.000 m** from the peg to the stick axis |
| Points | **6**, evenly round the circle |
| Chord between neighbours | **4.000 m** (same length as the radius) |
| Diameter, opposite points | **8.000 m** |
| Long chord (every second point) | **6.93 m** |
| Baseline | **8.000 m** between the two end sticks, level, then sleeve correction |
| Sleeve radius to add | **32 mm** for each end that stopped on the paper |
| Peg to the near baseline end | **4.30 m** |
| Sleeve centre above the ground | measure it; **0.5 m** is a good height |
| Plumb | bubble in the middle, about **1°** |
| Why the bubble matters | a 2° lean at 0.5 m sleeve height moves the ground point **17 mm**. A photo cannot see a lean toward the camera. |
| Calibration distance | **4.000 m** from the front of the phone to the paper, then +32 mm. Between 3 m and 5 m is acceptable. |
| Laser dot | retake if it is more than **16 mm** off the middle of the stick |

You want a clear patch about **8 m** along the baseline and about **16 m** across, so the far station, the tape, and the circle all fit.

## 1. Set out the circle

1. Put the centre peg in the lawn where you can walk all the way round it.
2. The line stays on the peg. It is already 4.000 m to the axis of a stick, not to the paper. If you measured the line to the paper, mark it 32 mm longer so the axis is at 4.000 m.
3. Plant **CRC01** on that line. This will be the point nearest the baseline.
4. Plant **CRC02** so it is 4.000 m from the peg (the line) and 4.000 m from CRC01 (the tape). The tape is the chord.
5. Continue the same way for **CRC03**, **CRC04**, **CRC05**, **CRC06**. Each new stick is 4.000 m from the peg and 4.000 m from the one before.
6. The last chord, CRC06 back to CRC01, should also be 4.000 m. More than 30 mm out: walk the sticks again.
7. Tape the two diameters, CRC01–CRC04 and CRC02–CRC05, holding the tape level. Each should be 8.000 m between the axes. If you taped to the paper, the reading is about 64 mm short; write the raw reading and “both ends on paper”.
8. Both diameters within 20 mm of 8.000 m: the set-out uncertainty is **10 mm**. Write `radius σ = 10 mm`. If you only managed one diameter, write **15 mm**.

CRC04 is opposite CRC01. CRC01 is the point you will bring close to the baseline.

## 2. Baseline

The two end sticks are **BAS01** and **BAS02**. BAS02 is the end nearest the circle. BAS01 is the far end. The line from the peg through CRC01 is already in the ground.

1. From the peg, through CRC01, go on to **4.30 m**. That point is BAS02. It sits about **0.30 m** past CRC01. Write the distance you actually taped. The circle then passes about 0.30 m from BAS02.
2. The baseline runs square to that line, through BAS02. From BAS02 back toward the peg, mark **3.00 m**. From that mark swing **5.00 m**, and from BAS02 swing **4.00 m**. Where they meet is 4 m out to the side, square to the peg line. A 3-4-5 triangle.
3. BAS01 is **8.000 m** from BAS02, through that side point. The tape runs past the circle and stays clear of it. BAS01 is the far end.
4. Tape BAS01 to BAS02 **both ways**, BAS01 to BAS02 and back. Pull the tape firm and hold it level. Write both readings.
5. If one end is higher, write the height difference. The level length is the one that counts. A drop of 0.3 m in 8 m makes the slope reading about 6 mm long.
6. Level the reading first. Then add **32 mm for each end that stopped on the paper**. Write “level, then +32 mm” or “+64 mm”.
7. Mean the two level axis-to-axis lengths. That mean is the baseline you type into the app. Kind: tape.
8. Laser, if you have one: shoot the same baseline. Keep the dot within **16 mm** of the middle of the stick. If it sits further out, shoot again. Level that reading, then add the same 32 mm per sleeved end. Write the laser on this sheet. The tape mean stays the baseline in the app.

## 3. Plumb every stick and write its height

For each cane, CRC01–CRC06, BAS01, BAS02, and the calibration cane:

1. Bubble in two directions. Middle of the bubble. About 1° is the limit. If it is out, straighten the cane and look again.
2. Measure from the ground to the **middle of the paper**. Write it in the table at the end. Half a metre is a good target. Use whatever it actually is.
3. Tick `plumb ok` only when the bubble passed.

A lean toward the camera does not show in the photo. At half a metre up, 2° is 17 mm on the ground. That is why the bubble is on this sheet and not left to the picture.

## 4. Calibration shot

Before any station. Same phone. **1×**.

1. Use one plumbed cane (a spare, or CRC01).
2. Stand so the front of the phone is about **4 m** from the stick, and between 3 m and 5 m.
3. Tape from the **front of the phone** to the paper. Hold it level. Write the raw reading. The axis is that reading plus 32 mm, and that sum stays a tape. Leave it as a length.
4. One photo. The sleeve should be a large, clear target, not a speck. Phone held steady, cane filling a good part of the frame.
5. This photo stays in the capture. Name it so you can find it (`CAL`).

Every later photo is this same phone at 1×.

## 5. Where to stand

Each place is fixed by two tapes, one to BAS01 and one to BAS02. Stand where those two lengths meet. Plumb the phone pole with the bubble (about 1 m, about 1°). The pole is the station.

| Station | From BAS01 | From BAS02 | Which side |
|---|---|---|---|
| STN01 | 7.20 m | 7.20 m | Opposite the peg |
| STN02 | 5.00 m | 7.00 m | Peg’s side, outside the circle, toward BAS01 |
| STN03 | 10.50 m | 10.50 m | Peg’s side, past the far sticks |

There are two places a pair of tapes can meet. Pick the side named above. At STN02, check you are more than 4 m from the peg. STN03 sits a couple of metres past CRC04.

STN01 and STN02 are the pair that sees every stick from two directions, crossing at about 40° or more. An 8 m tape reaches both of them. STN03 is the spare look, from beyond the circle. It needs a laser, or a tape that reaches 10.5 m. If you cannot reach it, skip it and write “no STN03” on the sheet. The two-station pair still stands.

Tape from the **pole** to each end stick. Hold it level. Add 32 mm if that end is a sleeve. The phone-end of the tape is the pole, not a sleeve, so you add 32 mm once, not twice. Write each reading.

In the app these are ordinary tapes. They are how the station is fixed. The photos then check it.

## 6. Photos at each station

1. 1×, same phone, pole plumbed, bubble ticked for this station.
2. First photo: **both baseline ends in the frame**, and as many circle sticks as you can see clearly.
3. If some sticks are outside the frame, turn on the spot and take another photo. Stay on the pole. Those two photos are the same station.
4. You should see every circle stick from at least two stations. If one stick is hidden, take the extra turn that shows it, still without stepping.
5. Tap the marks on the photo afterwards: BAS01, BAS02, and each CRC you can see. The full photo is the one that is kept. A small preview is not sharp enough at the far sticks.

The far sticks may be too small for a code to read itself. Tap them yourself. The sleeve is there so the stick has a known radius and a height.

## 7. Two check tapes

Measure these after the stations. Write them on this sheet. The app’s distances are the baseline and the tapes from the places you stood.

1. **Diameter** CRC01 to CRC04, a fresh pull, separate from the set-out diameters. Level. Raw reading. Note whether each end was on paper (+32 mm each).
2. **Long chord** CRC01 to CRC03. Same rules. Axis-to-axis should be near **6.93 m**. The neighbour chords of 4.000 m were the set-out. This longer chord is the check.

A laser baseline, if you took one, is a third check on this sheet. The tape mean stays the baseline in the app.

## 8. In the app, briefly

- Baseline BAS01–BAS02, the level length after the sleeve correction, offset mm left at 0.
- The six circle points on one item, geometry **circle**.
- A station at each place you stood, with the two tapes and the photos.
- The calibration photo kept with the capture.
- Save to OneDrive as usual when you are back on the network.

The original still, the sleeve height, and the bubble are part of the capture record described in the plan. Until the app writes those itself, keep the Camera Roll stills from the system camera (rear, 1×, unedited) and keep this filled sheet. The import uses both.

## Checklist

- [ ] Same iPhone, 1×, for the calibration and every station
- [ ] Line marked 4.000 m, six sticks, neighbour chords 4.000 m
- [ ] Both diameters written; radius σ 10 mm or 15 mm
- [ ] Baseline 8.000 m, both directions, level, +32 mm per sleeved end
- [ ] Laser baseline written separately, if you took it
- [ ] Peg to BAS02 written (aim 4.30 m)
- [ ] Every cane bubbled, height to the middle of the paper written
- [ ] Calibration tape from the front of the phone written raw
- [ ] STN01 and STN02, each with two tapes. STN03 as well if you could reach 10.5 m
- [ ] Each station: both baseline ends in a photo, yaw only if you had to turn
- [ ] Every circle stick in at least two photos
- [ ] Check diameter and check chord written, and not typed into the app
- [ ] Offset mm left at 0
- [ ] Saved, and this sheet filled

## Sheet to fill

Build / date / phone name:

| Cane | Height to sleeve centre (m) | Plumb ok |
|---|---|---|
| CRC01 | | |
| CRC02 | | |
| CRC03 | | |
| CRC04 | | |
| CRC05 | | |
| CRC06 | | |
| BAS01 | | |
| BAS02 | | |
| CAL | | |

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

Radius σ (10 mm or 15 mm):

Phone pole bubble ok at STN01 / STN02 / STN03:

Which photo is the calibration:

Notes (weather, a stick you replanted, a tape that was not level):
