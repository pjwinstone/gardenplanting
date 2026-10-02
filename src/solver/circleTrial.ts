/**
 * First circle trial. Shared fx is not in the adjustment yet.
 * Grade only a capture with `fxShared: false` and STN03 present.
 * `fxShared: true` is not graded. Two stations are reported.
 */

export interface CircleTrialInput {
  /** Omitted or false: each photo keeps its own focal length. True is not graded. */
  fxShared?: boolean;
  stationIds: string[];
}

export interface CircleTrialVerdict {
  fxShared: boolean;
  /** True only for fxShared false (or omitted) and STN03 present. */
  grade: boolean;
  report: string;
}

export function circleTrialVerdict(input: CircleTrialInput): CircleTrialVerdict {
  const fxShared = input.fxShared === true;
  const hasThird = input.stationIds.includes('STN03');
  if (fxShared) {
    return {
      fxShared: true,
      grade: false,
      report: 'fxShared is true. This trial is not graded. Grading needs fxShared false and STN03.',
    };
  }
  if (!hasThird) {
    return {
      fxShared: false,
      grade: false,
      report: 'Not graded. A pass or fail needs fxShared false and STN03.',
    };
  }
  return {
    fxShared: false,
    grade: true,
    report: 'fxShared is false and STN03 is present. This capture can be graded.',
  };
}
