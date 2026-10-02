/**
 * First circle trial. Shared fx is not in the adjustment yet.
 * A capture is graded only when STN03 was occupied. Two stations are reported.
 * `fxShared: false` is the recorded mode and is a valid fixture field.
 */

export interface CircleTrialInput {
  /** Omitted or false: each photo keeps its own focal length. */
  fxShared?: boolean;
  stationIds: string[];
}

export interface CircleTrialVerdict {
  fxShared: boolean;
  /** False means report the capture and do not pass or fail it. */
  grade: boolean;
  report: string;
}

export function circleTrialVerdict(input: CircleTrialInput): CircleTrialVerdict {
  const fxShared = input.fxShared === true;
  const named = input.stationIds.some((id) => /^STN\d+$/.test(id));
  if (named && !input.stationIds.includes('STN03')) {
    return {
      fxShared,
      grade: false,
      report: 'Two-station capture is reported and not graded. A pass or fail needs STN03.',
    };
  }
  return {
    fxShared,
    grade: true,
    report: fxShared
      ? 'Shared fx is recorded. This solver still estimates one fx per photo.'
      : 'fxShared is false. Each photo keeps its own focal length.',
  };
}
