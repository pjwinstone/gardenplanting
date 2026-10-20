/** Circle field test and marker fitting, plus the two later rows. */

import type { PhotoTapTarget, StepPhotoTaps, WorkflowDefinition } from './types';

const none = { to: 'none' } as const;

const cane = (id: string): PhotoTapTarget => ({ id, label: id, optional: true });
const bearings = (...photos: PhotoTapTarget[][]): StepPhotoTaps => ({ use: 'bearings', photos });

/** Base points the edge-photo tap screen offers: the garden's BAS01… sleeves. */
const BASE_POINT_TAPS: PhotoTapTarget[] = Array.from({ length: 14 }, (_, i) => cane(`BAS${String(i + 1).padStart(2, '0')}`));

export const circleFieldTest: WorkflowDefinition = {
  id: 'circle-field-test',
  revision: 6,
  status: 'ready',
  title: 'Circle field test',
  summary: 'Your own garden circle (about 12 m). Base points on a N/E grid, then one photo from each edge point. No canes.',
  steps: [
    {
      id: 'gather-kit',
      n: 1,
      kind: 'user',
      title: 'Gather the kit',
      instruction: 'Phone, tapes, base-point sleeves on posts, pegs, a level.',
      detail: [
        'One iPhone. Rear camera, zoom 1×, held landscape. Same phone for every photo, including the calibration.',
        'A tape that reaches across the circle (about 12 m) clear, and a shorter one for the base-point ties.',
        'Base-point sleeves from Print & fit markers (BAS01, BAS02, BAS03…), each on a post or 60 mm dowel. Matte. Each sleeve’s own R. A spirit level.',
        'One peg per edge point (Set-up, 12 by default). Edge points carry no sleeve: you stand on them for one photo each.',
        'Camera location off. Leave Offset A (mm) and Offset B (mm) at 0.',
      ],
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'place-baseline-points',
      n: 2,
      kind: 'user',
      title: 'Place the baseline points',
      instruction: 'Outside the circle, along it (tangential). At least half the diameter long.',
      detail: [
        'Put BAS01 and BAS02 just outside the circle, side by side along its edge, about 2 m clear of it. The line BAS01–BAS02 runs along the circle, not towards its middle.',
        'Length: the Set-up baseline (at least half the circle diameter: 6 m for a 12 m circle). Looking from BAS01 toward BAS02, the circle is on your left.',
        'Plumb both canes (bubble, about 1°) and write each sleeve’s R and height.',
      ],
      noteLabel: 'Baseline sleeve R, heights',
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'tape-baseline',
      n: 3,
      kind: 'user+app',
      title: 'Tape the baseline both ways',
      instruction: 'Sleeve to sleeve, level, then add R. Type the mean.',
      detail: [
        'Tape BAS01–BAS02 both ways, sleeve to sleeve, level. Level each reading, then add that end’s measured R.',
        'The two axis lengths must agree within 10 mm. The mean is the length you type. Do not average a pair that disagrees by more than 10 mm.',
        'Menu → Baseline. End A BAS01, End B BAS02. Measure with Tape. Offset A and Offset B stay 0. Save baseline.',
      ],
      noteLabel: 'Both pulls, level then +R',
      complete: {
        all: [
          { on: 'manual' },
          {
            on: 'baseline.saved',
            endA: 'BAS01',
            endB: 'BAS02',
            kind: 'tape',
            offsetAMm: 0,
            offsetBMm: 0,
          },
        ],
      },
      link: { to: 'menu', section: 'baseline' },
    },
    {
      id: 'laser-check-baseline',
      n: 4,
      kind: 'user',
      title: 'Laser check of the baseline',
      instruction: 'Same baseline, sleeve to sleeve. Do not type the laser.',
      detail: [
        'Laser the same baseline, sleeve to sleeve, same height. This is CHK-BASE. It is not typed into the app.',
        'Retake if the dot is more than half that sleeve’s R (about 15 mm) off the middle. Level, then add R for each sleeved end.',
      ],
      noteLabel: 'CHK-BASE laser',
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'add-base-points',
      n: 5,
      kind: 'user',
      title: 'Add base points',
      instruction: 'Grow the network: East, North, then the diagonal as the check. The app re-adjusts after each one.',
      detail: [
        'BAS01 is the origin of a North/East grid. Set North and East by eye or with the compass; the grid is the frame, north is for display only.',
        'For each new base point (BAS02, BAS03, … from the marker set): from a point already placed, tape how far East it is and how far North (minus for west or south), then tape the diagonal straight to it. Type the three and Save tie.',
        'The diagonal is the check. If it shows red, re-tape that tie (remove it and save it again). Extra ties to other points make it stronger.',
        'Spread several base points so each edge point will see 4 or more of them at good angles: some near the middle, staggered so none hides behind another. Plumb each post.',
        'Tick when every base point is placed and no diagonal is red.',
      ],
      noteLabel: 'Base points',
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'camera-calibration',
      n: 6,
      kind: 'app',
      title: 'Calibration photo (focal length)',
      instruction: 'Measures the lens. Landscape, 1×, phone 4.0 m from the cane, sleeve in the middle.',
      detail: [
        'What it is for: the app needs the lens’s real focal length in pixels. A sleeve of known size at a taped distance gives it.',
        '1. Plumb one sleeved post (a base point will do). Stand with the front of the phone 4.0 m from the paper (the Set-up distance). Tape it level and write the reading.',
        '2. Hold the phone sideways (landscape) at 1×, at sleeve height, level. Cane in the middle of the frame, whole sleeve in view, seam turned away.',
        '3. Tap the sleeve to lock focus, then the shutter. One photo, in the in-app camera (the Take photos pill opens it).',
        'After the shutter the photo fills the screen. Tap once anywhere on the sleeve. The app finds its top and bottom edge from the bands and draws two lines. If they sit on the paper ends, tap Save. If the app is unsure it asks you to tap the top edge, then the bottom edge.',
        'Start this run before you take the calibration photo. A shot from earlier does not count.',
        'How it works: the sleeve is 287 mm tall. At 4.0 m plus the sleeve’s R it is about 215 px tall, and focal length in px = pixels × distance ÷ 0.287 m.',
      ],
      noteLabel: 'Tape reading, phone front to paper (m)',
      doneTitle: '1 calibration photo saved',
      doneInstruction: 'One calibration still is in. Edge points are next.',
      complete: { on: 'photo.uploaded', stationId: 'Calibration', minPhotos: 1 },
      link: { to: 'camera', stepId: 'camera-calibration', cameraPositionId: 'Calibration' },
      photoTaps: {
        use: 'sleeve-height',
        photos: [[{ id: 'SLEEVE', label: 'sleeve' }]],
        fallback: [
          { id: 'SLEEVE-TOP', label: 'top edge of the sleeve' },
          { id: 'SLEEVE-BOTTOM', label: 'bottom edge of the sleeve' },
        ],
      },
    },
    {
      id: 'mark-edge-points',
      n: 7,
      kind: 'user',
      title: 'Mark the edge points',
      instruction: 'One peg per edge point, on the edge, evenly round.',
      detail: [
        'Peg EDG01, EDG02, … (Set-up, 12 by default) round the circle, about evenly spaced: never more than 60° between neighbours, and all the way round. Go round in order: the photos are matched to the pegs in that order.',
        'Keep to one edge of the border, inside or outside, and use the same edge when you tape the diameter.',
        'No cane and no sleeve: you stand on the peg for the photo.',
      ],
      noteLabel: 'Edge used, anything odd',
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'edge-photos',
      n: 8,
      kind: 'app',
      title: 'One photo from each edge point',
      instruction: 'Stand on each peg in order, face the base points, one landscape photo at 1×.',
      detail: [
        'Start at EDG01 and go round in order. Stand on the peg, phone at eye height, landscape, 1×, and turn so the base points are in the frame. One photo, no turning, no tape.',
        'Then tap every base point you can see (the app suggests them from their codes). It needs at least 4 for a checked point; a missing or hidden one turns that point grey.',
        'A bad photo: open Photos and Retake that one. The new photo takes the same edge point.',
      ],
      noteLabel: 'Anything odd',
      doneTitle: 'A photo from every edge point',
      doneInstruction: 'Tape the diameter next.',
      complete: { on: 'photo.uploaded', stationId: 'Edge points', minPhotos: 12 },
      link: { to: 'camera', stepId: 'edge-photos', cameraPositionId: 'Edge points' },
      photoTaps: bearings(...Array.from({ length: 12 }, () => BASE_POINT_TAPS)),
    },
    {
      id: 'tape-diameter',
      n: 9,
      kind: 'user',
      title: 'Tape the diameter',
      instruction: 'Three tapes across the circle, about 60° apart. Type them below.',
      detail: [
        'Tape straight across the circle through the middle: the longest reading you can get each time. Then turn about 60° round the circle and tape again, and once more: three readings.',
        'Keep to one edge of the border every time, inside or outside, and say which below. The edge pegs are on that same edge.',
        'Type the three readings in metres and tap Save diameters. They differ a little on a real circle; the app uses their mean and spread.',
      ],
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'circle-result',
      n: 10,
      kind: 'user+app',
      title: 'Circle result',
      instruction: 'The app fits the circle and compares it with your tape.',
      detail: [
        'First each edge point gets a colour. Green: checked, and no undetected error could move it more than 40 mm. Amber: up to 60 mm, or one reading a little off. Red: a reading disagrees (a base point moved or a wrong tap). Grey: unchecked (too few base points in the photo, or poor angles).',
        'Then the circle. Green: the fitted diameter agrees with the tape within its uncertainty and within the limit (60 mm). Amber: close. Red: it does not agree.',
        'Not a circle: the points do not sit on one circle; check the pegs are on the edge you taped. Weak: fix the red or grey points first (the lines below say which). Calibrate first: the focal length is not known well enough yet.',
        'Tick when you have read the result.',
      ],
      noteLabel: 'Result',
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'save-to-onedrive',
      n: 11,
      kind: 'app',
      title: 'Save to OneDrive',
      instruction: 'Wait until the file is on OneDrive.',
      detail: [
        'New garden if this phone should not keep an older one. Sign in. Version 1 is /Garden Survey/garden-v1.json.',
        'Each Photo row must read verified. A line that says Not usable for focal length means retake at 1× and pick Library at Actual Size.',
        'Menu → Sign in → Save. Wait until it says the file was saved to OneDrive.',
      ],
      doneTitle: 'Saved to OneDrive',
      doneInstruction: 'The garden file is on OneDrive.',
      complete: { on: 'cloud.saved' },
      link: { to: 'menu', section: 'cloud' },
    },
  ],
};

export const printFitMarkers: WorkflowDefinition = {
  id: 'print-fit-markers',
  revision: 1,
  status: 'ready',
  title: 'Print & fit markers',
  summary: 'Eight sleeves, the day before the circle test. All by hand.',
  steps: [
    {
      id: 'assign',
      title: 'Assign the sleeves',
      instruction: 'Eight codes. Stations are not sleeved.',
      detail: [
        'BAS01 315, BAS02 36E, CRC01 459, CRC02 6BA, CRC03 8A3, CRC04 952, CRC05 DAC, CRC06 EC5.',
        'Write the code on the dowel in pencil, next to the top of the sleeve.',
        'STN01, STN02, and STN03 are where you stand. They are not sleeved. Calibration reuses a cane. No ninth code. No checkerboard.',
      ],
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'print',
      title: 'Print at actual size',
      instruction: 'A4, 100%, black only. No fit-to-page.',
      detail: [
        'A4 portrait, 210 × 297 mm. Actual size / 100%. No fit-to-page, no shrink, no scaling, no borderless, no two-up.',
        'Highest quality. Black only. Colour management off if the driver has a switch for it.',
        'Open the sleeve PDF and print all-sleeves.pdf, or the eight single pages.',
      ],
      complete: { on: 'manual' },
      link: { to: 'marker-pdf', file: 'all-sleeves.pdf' },
    },
    {
      id: 'rulers',
      title: 'Check the rulers',
      instruction: '100 mm bar within ±0.5 mm, or reprint.',
      detail: [
        'The 100 mm bar must be 100 mm within ±0.5 mm. The 50 mm bar on the blank tab is the other axis.',
        'The sheet also carries 250 mm down the tab, and 180 mm along the bottom legend. The four black bars at TOP are the sync. Together they are 52 mm.',
        'A miss means the driver scaled the page. Reprint. Do not use that sheet.',
      ],
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'paper',
      title: 'Paper and film',
      instruction: 'Matte stock. Measure the 100 mm bar again after film.',
      detail: [
        'Matte. A gloss stripe down the sleeve blinds the reader. Laser or pigment on matte polypropylene or polyester.',
        'If you print on paper: matte, 120–160 gsm, not dye. Preferred film is matte over laser toner.',
        'After any film, measure the 100 mm bar again. If the film stretched the sheet, reprint. Keep the sheets dry until the glue has set.',
      ],
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'cut',
      title: 'Cut',
      instruction: 'Left: just inside the dash. Right: on the right-hand dashed line, or the sheet edge.',
      detail: [
        'Laminate or film the flat sheet first, if you use film. Then cut. Bands stay horizontal. TOP stays up.',
        'Cut just inside the CUT HERE dash, between the dash and the start of the bands (about 4.4–5.0 mm from the sheet edge), so the band ink runs right to the cut edge. Inside means toward the bands, not into the margin.',
        'Do not cut down the dash. Its ink ends near 4.35 mm and the bands start near 4.50 mm, so the line itself leaves a sliver of dash plus white at the seam. If you leave the margin on, a white stripe about 5 mm wide hides the bleed. If the dashes or the band ink are clipped, cut at the edge of the ink.',
        'Cut the right edge on its dashed line. If those dashes did not print, cut the right-hand edge of the sheet. That edge is the outer edge of the blank tab. Cut 5 mm off the top and the bottom. Do not crease the fold.',
      ],
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'join',
      title: 'Join the sleeve',
      instruction: 'Fix the tab, wrap, stick the left edge down, seam away.',
      detail: [
        'Fix the blank tab to the 60 mm dowel before you wrap. Flush staples or flush pins in wood, or glue or thin double-sided tape on a tube. No raised heads under the overlap.',
        'Staples go in the blank part only, at least 4 mm from the fold, never through the bands. The tab reads staple/glue here — overlap under the other edge.',
        'Wrap snug, printed face out, TOP up. Do not crease the fold. Square the wrap on the 195 mm fold crosses. A 1° spiral costs about 3.3 mm.',
        'Stick the cut left edge down over the tab with glue or thin double-sided tape.',
        'Turn that seam away from the stations and the camera. Keep the seam off the middle of the calibration photo.',
      ],
      diagram: 'sleeve-join',
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'measure',
      title: 'Measure R, height, and plumb',
      instruction: 'R = C / 2π at three heights, to 0.1 mm.',
      detail: [
        'Do this after the sheet is stuck down. The outside after the film is the R that counts.',
        'At three heights, wrap a paper strip or a cloth tape. Not a steel tape. R = C / 2π. Use 2π ≈ 6.2832. Round each sleeve to 0.1 mm.',
        'Height for this test: 0.5 m from the ground to the middle of the paper is the target. Write the height you actually measure.',
        'Bubble in two directions, about 1°. The app’s offset boxes stay at 0.',
      ],
      noteLabel: 'Sleeve R mm and height m',
      complete: { on: 'manual' },
      link: none,
    },
  ],
};

export const houseTraverse: WorkflowDefinition = {
  id: 'house-traverse',
  revision: 1,
  status: 'later',
  title: 'Walk round the house',
  summary: 'A traverse around the house. Coming soon.',
  steps: [],
};

export const iosSetup: WorkflowDefinition = {
  id: 'ios-setup',
  revision: 1,
  status: 'later',
  title: 'iOS setup',
  summary: 'Phone settings for the field. Coming soon.',
  steps: [],
};

export const GUIDED_WORKFLOWS: WorkflowDefinition[] = [
  circleFieldTest,
  printFitMarkers,
  houseTraverse,
  iosSetup,
];

export function workflowById(id: string): WorkflowDefinition | undefined {
  return GUIDED_WORKFLOWS.find((workflow) => workflow.id === id);
}
