/** Circle field test and marker fitting, plus the two later rows. */

import type { PhotoTapTarget, StepPhotoTaps, WorkflowDefinition } from './types';

const none = { to: 'none' } as const;

/** Baseline ends must be tapped (they place the camera position); circle canes can be "Not in view". */
const end = (id: string): PhotoTapTarget => ({ id, label: id });
const cane = (id: string): PhotoTapTarget => ({ id, label: id, optional: true });
const bearings = (...photos: PhotoTapTarget[][]): StepPhotoTaps => ({ use: 'bearings', photos });

export const circleFieldTest: WorkflowDefinition = {
  id: 'circle-field-test',
  revision: 3,
  status: 'ready',
  title: 'Circle field test',
  summary: 'One phone, about an hour. Look from BAS01 toward BAS02. Left is left.',
  steps: [
    {
      id: 'gather-kit',
      n: 1,
      kind: 'user',
      title: 'Gather the kit',
      instruction: 'Phone, tapes, canes, sleeves, level, and the pole.',
      detail: [
        'One iPhone. Rear camera, zoom 1×, held landscape. Same phone for every photo, including the calibration.',
        'A tape that reaches 8 m clear. A laser, or a tape that reaches 10.5 m. A non-stretch line marked at 4.000 m.',
        'A centre peg. Six canes for the circle. Two canes for the baseline. One cane for the calibration if you do not reuse a circle cane.',
        'Sleeves from Print & fit markers, on a 60 mm dowel. Matte. Each sleeve’s own R. A spirit level and the phone pole, about 1 m.',
        'Camera location off. Leave Offset A (mm) and Offset B (mm) at 0.',
      ],
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'set-out-circle',
      n: 2,
      kind: 'user',
      title: 'Set out the circle',
      instruction: '4.000 m from the peg, and 4.000 m from the cane before.',
      detail: [
        'Peg in the lawn. Line on the peg, 4.000 m to the stick axis. Plant CRC01 nearest the baseline.',
        'Each next cane is 4.000 m from the peg and 4.000 m from the one before: CRC02, CRC03, CRC04, CRC05, CRC06.',
        'Closing chord CRC06–CRC01 within 30 mm of 4.000 m, or walk them again.',
      ],
      diagram: 'circle-plan',
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'tape-diameters',
      n: 3,
      kind: 'user',
      title: 'Tape the two diameters',
      instruction: 'CRC01–CRC04 and CRC02–CRC05 are 8.000 m.',
      detail: [
        'Tape level, axis to axis, 8.000 m. Both diameters within 20 mm.',
        'Then write radius σ 3 mm. Outside those limits, walk the sticks again. Do not write a larger σ.',
      ],
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'place-baseline-points',
      n: 4,
      kind: 'user',
      title: 'Place the baseline points',
      instruction: 'BAS02 is 4.30 m from the peg. BAS01 is 8.000 m from BAS02.',
      detail: [
        'From the peg through CRC01, 4.30 m is BAS02, about 0.30 m past CRC01. Write the distance you taped.',
        'Baseline square to that line. From BAS02 back toward the peg mark 3.00 m. From that mark swing 5.00 m, and from BAS02 swing 4.00 m.',
        'Through that side point, BAS01 is 8.000 m from BAS02.',
      ],
      noteLabel: 'Peg to BAS02 (aim 4.30 m)',
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'tape-baseline',
      n: 5,
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
      n: 6,
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
      id: 'plumb-canes',
      n: 7,
      kind: 'user',
      title: 'Plumb the canes and note heights',
      instruction: 'Bubble every cane. Write the height you measure.',
      detail: [
        'Bubble CRC01–CRC06, BAS01, BAS02, and CAL. Middle of the bubble, about 1°. A 2° lean at 0.5 m sleeve height is 17 mm.',
        'Write height to the middle of the paper. 0.5 m is a good target. Tick plumb only when the bubble passed.',
        'The app has no box for sleeve R, height, or plumb. They stay in this note. Offsets stay 0.',
      ],
      noteLabel: 'Heights, sleeve R, plumb',
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'camera-calibration',
      n: 8,
      kind: 'app',
      title: 'Calibration photo (focal length)',
      instruction: 'Measures the lens. Landscape, 1×, phone 4.0 m from the cane, sleeve in the middle.',
      detail: [
        'What it is for: the app needs the lens’s real focal length in pixels. A sleeve of known size at a taped distance gives it.',
        '1. Plumb one sleeved cane (a circle cane will do). Stand with the front of the phone 4.0 m from the paper (the Set-up distance). Tape it level and write the reading.',
        '2. Hold the phone sideways (landscape) at 1×, at sleeve height, level. Cane in the middle of the frame, whole sleeve in view, seam turned away.',
        '3. Tap the sleeve to lock focus, then the shutter. One photo, in the in-app camera (the Take photos pill opens it).',
        'After the shutter the photo fills the screen. Pinch to zoom, tap the top edge of the sleeve, then the bottom edge, then Save.',
        'Start this run before you take the calibration photo. A shot from earlier does not count.',
        'How it works: the sleeve is 287 mm tall. At 4.0 m plus the sleeve’s R it is about 215 px tall, and focal length in px = pixels × distance ÷ 0.287 m.',
      ],
      noteLabel: 'Tape reading, phone front to paper (m)',
      doneTitle: '1 calibration photo saved',
      doneInstruction: 'One calibration still is in. Camera positions are next.',
      complete: { on: 'photo.uploaded', stationId: 'Calibration', minPhotos: 1 },
      link: { to: 'camera', stepId: 'camera-calibration', cameraPositionId: 'Calibration' },
      photoTaps: {
        use: 'sleeve-height',
        photos: [[
          { id: 'SLEEVE-TOP', label: 'top edge of the sleeve' },
          { id: 'SLEEVE-BOTTOM', label: 'bottom edge of the sleeve' },
        ]],
      },
    },
    {
      id: 'camera-left',
      n: 9,
      kind: 'app',
      title: 'Camera position Left (8.00 / 8.00)',
      instruction: 'Landscape, 1×. Both ends, and CRC01 to CRC05.',
      detail: [
        'Left, looking from BAS01 toward BAS02. 8.00 m / 8.00 m. Tape from the pole to the sleeve, level, and add R once.',
        'Photo 1: both baseline ends, and CRC01, CRC02, CRC03, CRC04, CRC05. CRC06 does not fit.',
        'Photo 2: turn, keep BAS02, add CRC06. Do not step. 1×, landscape, lens over the middle of the pole, then the bubble.',
      ],
      diagram: 'stn01',
      noteLabel: 'STN01 to BAS01 / BAS02',
      doneTitle: '2 photos saved at camera position Left',
      doneInstruction: 'Turn for CRC06. Keep BAS02. Do not step.',
      complete: { on: 'photo.uploaded', stationId: 'Left', minPhotos: 2 },
      link: { to: 'camera', stepId: 'camera-left', cameraPositionId: 'Left' },
      photoTaps: bearings(
        [end('BAS01'), end('BAS02'), cane('CRC01'), cane('CRC02'), cane('CRC03'), cane('CRC04'), cane('CRC05')],
        [end('BAS02'), cane('CRC06')],
      ),
    },
    {
      id: 'camera-right-near',
      n: 10,
      kind: 'app',
      title: 'Camera position Right near (6.50 / 9.00)',
      instruction: 'Outside the circle. Do not take CRC05. Do not photograph CRC04.',
      detail: [
        'Right. 6.50 m from BAS01, 9.00 m from BAS02, outside the circle.',
        'Photo 1: both baseline ends. No circle stick between them.',
        'Photo 2: turn, keep BAS02. Take CRC02, CRC01, CRC06, CRC03. Do not take CRC05. It sits behind CRC03.',
        'Do not photograph CRC04 from here.',
      ],
      noteLabel: 'STN02 to BAS01 / BAS02',
      doneTitle: '2 photos saved at camera position Right near',
      doneInstruction: 'CRC05 and CRC04 stay out of this position.',
      complete: { on: 'photo.uploaded', stationId: 'Right near', minPhotos: 2 },
      link: { to: 'camera', stepId: 'camera-right-near', cameraPositionId: 'Right near' },
      photoTaps: bearings(
        [end('BAS01'), end('BAS02')],
        [end('BAS02'), cane('CRC02'), cane('CRC01'), cane('CRC06'), cane('CRC03')],
      ),
    },
    {
      id: 'camera-right-far',
      n: 11,
      kind: 'app',
      title: 'Camera position Right far (10.50 / 10.50)',
      instruction: 'Required. Two stations are not a finished test.',
      detail: [
        'Right. 10.50 m / 10.50 m. This station is required.',
        'Photo 1: both baseline ends, and CRC01, CRC02, CRC03.',
        'Photo 2: turn, keep BAS02. Add CRC06, CRC05, CRC04. Do not step.',
      ],
      noteLabel: 'STN03 to BAS01 / BAS02',
      doneTitle: '2 photos saved at camera position Right far',
      doneInstruction: 'Both stills are in. Save the garden next.',
      complete: { on: 'photo.uploaded', stationId: 'Right far', minPhotos: 2 },
      link: { to: 'camera', stepId: 'camera-right-far', cameraPositionId: 'Right far' },
      photoTaps: bearings(
        [end('BAS01'), end('BAS02'), cane('CRC01'), cane('CRC02'), cane('CRC03')],
        [end('BAS02'), cane('CRC06'), cane('CRC05'), cane('CRC04')],
      ),
    },
    {
      id: 'save-to-onedrive',
      n: 12,
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
