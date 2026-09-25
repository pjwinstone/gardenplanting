/**
 * Stage 2 field-loop copy — checklist summary for the coach / in-app panel.
 * Keep in sync with docs/stage-2-field-checklist.md.
 */

export interface Stage2Step {
  /** Session mode label shown in the banner. */
  modeLabel: string;
  /** Short phone line. */
  doThis: string;
  /** Mode button that advances. */
  button: string;
}

export const STAGE2_FIELD_STEPS: Stage2Step[] = [
  {
    modeLabel: 'HOUSE BASELINE',
    doThis: 'Tape back wall, side, and diagonal until the house rectangle closes.',
    button: 'Start house → Rod A ready',
  },
  {
    modeLabel: 'PLACE ROD A',
    doThis: 'Plant rod A in sight of the house; belts on both ends.',
    button: 'Rod A ready → Take tie photo',
  },
  {
    modeLabel: 'PHOTO TIE',
    doThis: 'One frame: two house corners and both rod ends — tap all four.',
    button: 'Take tie photo → Occupy',
  },
  {
    modeLabel: 'OCCUPY',
    doThis: 'Spike, bubble, photograph live rod(s), name the point.',
    button: 'Occupy',
  },
  {
    modeLabel: 'EXTRA YAW (optional)',
    doThis: 'Do not step — only yaw the phone for another mark.',
    button: 'Another photo here (yaw)',
  },
  {
    modeLabel: 'LEAPFROG',
    doThis: 'Plant rod B; photograph A and B together before picking A up.',
    button: 'Start leapfrog',
  },
  {
    modeLabel: 'RODS MOVED',
    doThis: 'Confirm move only after the A+B photo. Old setup closes.',
    button: 'Rods moved',
  },
  {
    modeLabel: 'ADJUST',
    doThis: 'Run Layer A then B. Read residuals in mm before trusting the plan.',
    button: 'Adjust',
  },
];

/** Compact coach blurb for the Stage 2 entry. */
export const STAGE2_ENTRY_COACH =
  'Stage 2 field loop: house tapes → rod A → tie photo → occupy → (yaw) → leapfrog → rods moved → adjust. OneDrive keeps saving when you are signed in.';
