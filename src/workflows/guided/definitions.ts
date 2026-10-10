/** Circle field test and marker fitting, plus the two later rows. */

import type { WorkflowDefinition } from './types';

const none = { to: 'none' } as const;

export const circleFieldTest: WorkflowDefinition = {
  id: 'circle-field-test',
  revision: 1,
  status: 'ready',
  title: 'Circle field test',
  summary: 'One phone, about an hour. Look from BAS01 toward BAS02. Left is left.',
  steps: [
    {
      id: 'kit',
      title: 'Kit',
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
      id: 'set-out',
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
      id: 'diameters',
      title: 'Check the diameters',
      instruction: 'CRC01–CRC04 and CRC02–CRC05 are 8.000 m.',
      detail: [
        'Tape level, axis to axis, 8.000 m. Both diameters within 20 mm.',
        'Then write radius σ 3 mm. Outside those limits, walk the sticks again. Do not write a larger σ.',
      ],
      complete: { on: 'manual' },
      link: none,
    },
    {
      id: 'place-baseline',
      title: 'Place BAS02 and BAS01',
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
      id: 'laser-check',
      title: 'Laser CHK-BASE',
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
      id: 'plumb',
      title: 'Plumb and height',
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
      id: 'cal',
      title: 'Calibration CAL',
      instruction: 'One still, before any station. About 4 m, phone front to paper.',
      detail: [
        'Before any station. One plumbed cane. Front of the phone about 4.000 m from the paper, between 3 m and 5 m.',
        'Tape that, level, write the raw reading. Axis length is the reading plus that sleeve’s R. One still. Name it CAL.',
        'Shoot in Camera.app at 1×. In + Point, Library at Actual Size. Not the in-app shutter.',
      ],
      noteLabel: 'CAL, phone front to paper',
      doneTitle: 'CAL photo verified',
      doneInstruction: 'One calibration still is in. Stations are next.',
      complete: { on: 'photo.verified', stationId: 'CAL', minPhotos: 1 },
      link: { to: 'mode', mode: 'ADD_POINT' },
    },
    {
      id: 'stn01',
      title: 'STN01 — left, 8.00 / 8.00',
      instruction: 'Landscape, 1×. Both ends, and CRC01 to CRC05.',
      detail: [
        'Left, looking from BAS01 toward BAS02. 8.00 m / 8.00 m. Tape from the pole to the sleeve, level, and add R once.',
        'Photo 1: both baseline ends, and CRC01, CRC02, CRC03, CRC04, CRC05. CRC06 does not fit.',
        'Photo 2: turn, keep BAS02, add CRC06. Do not step. 1×, landscape, lens over the middle of the pole, then the bubble.',
      ],
      diagram: 'stn01',
      noteLabel: 'STN01 to BAS01 / BAS02',
      doneTitle: 'STN01 photo verified',
      doneInstruction: 'Turn for CRC06. Keep BAS02. Do not step.',
      complete: { on: 'photo.verified', stationId: 'STN01', minPhotos: 2 },
      link: { to: 'mode', mode: 'ADD_POINT' },
    },
    {
      id: 'stn02',
      title: 'STN02 — right, 6.50 / 9.00',
      instruction: 'Outside the circle. Do not take CRC05. Do not photograph CRC04.',
      detail: [
        'Right. 6.50 m from BAS01, 9.00 m from BAS02, outside the circle.',
        'Photo 1: both baseline ends. No circle stick between them.',
        'Photo 2: turn, keep BAS02. Take CRC02, CRC01, CRC06, CRC03. Do not take CRC05. It sits behind CRC03.',
        'Do not photograph CRC04 from here.',
      ],
      noteLabel: 'STN02 to BAS01 / BAS02',
      doneTitle: 'STN02 photo verified',
      doneInstruction: 'CRC05 and CRC04 stay out of this station.',
      complete: { on: 'photo.verified', stationId: 'STN02', minPhotos: 2 },
      link: { to: 'mode', mode: 'ADD_POINT' },
    },
    {
      id: 'stn03',
      title: 'STN03 — right, 10.50 / 10.50',
      instruction: 'Required. Two stations are not a finished test.',
      detail: [
        'Right. 10.50 m / 10.50 m. This station is required.',
        'Photo 1: both baseline ends, and CRC01, CRC02, CRC03.',
        'Photo 2: turn, keep BAS02. Add CRC06, CRC05, CRC04. Do not step.',
      ],
      noteLabel: 'STN03 to BAS01 / BAS02',
      doneTitle: 'STN03 photo verified',
      doneInstruction: 'Both stills are in. Save the garden next.',
      complete: { on: 'photo.verified', stationId: 'STN03', minPhotos: 2 },
      link: { to: 'mode', mode: 'ADD_POINT' },
    },
    {
      id: 'save-send',
      title: 'Save and send',
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
      instruction: 'Just inside CUT HERE, toward the bands. Right edge on the dash, or the sheet.',
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
        'Wrap snug, printed face out, TOP up. Do not crease the fold. Stick the cut left edge down over the tab.',
        'Turn that seam away from the stations and away from the camera.',
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
