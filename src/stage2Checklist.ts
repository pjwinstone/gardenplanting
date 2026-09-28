/**
 * Stage 2 field-loop copy — checklist summary for the coach / in-app panel.
 * Keep in sync with docs/stage-2-field-checklist.md.
 */

export interface Stage2Step {
  modeLabel: string;
  doThis: string;
  button: string;
}

export const STAGE2_FIELD_STEPS: Stage2Step[] = [
  {
    modeLabel: 'BASELINE',
    doThis: 'Mark one house edge (B1–B2), tape/laser the length, enter mark offsets (mm) if needed.',
    button: 'Establish baseline',
  },
  {
    modeLabel: 'PHOTO TIE',
    doThis: 'One frame: both baseline ends and the next house mark — tap all.',
    button: 'Take baseline tie',
  },
  {
    modeLabel: 'HOUSE EDGES',
    doThis: 'Grow ~10 irregular corners — tape reachable edges or photo-tie more marks.',
    button: 'Measure house edges → Close house',
  },
  {
    modeLabel: 'ADD POINT',
    doThis: 'Spike, bubble, photograph live control, name the point.',
    button: '+ Point',
  },
  {
    modeLabel: 'EXTRA YAW (optional)',
    doThis: 'Do not step — only yaw the phone for another mark.',
    button: 'Another photo here (yaw)',
  },
  {
    modeLabel: 'LEAPFROG',
    doThis: 'Far side: plant rod B; photograph A+B together; then a second baseline if needed.',
    button: 'Start leapfrog → Rods moved',
  },
  {
    modeLabel: 'ADJUST',
    doThis: 'Run Layer A then B. Read residuals in mm (baseline, edges, close gap).',
    button: 'Adjust',
  },
];

export const STAGE2_ENTRY_COACH =
  'Stage 2 field loop: house-edge baseline → photo tie → grow house corners → Add point → (yaw) → leapfrog / second baseline → adjust. OneDrive keeps saving when you are signed in.';
