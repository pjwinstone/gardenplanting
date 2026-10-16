export type SurveyLayerRule = 'baseline' | 'railway' | 'flower_bed' | 'tree';

/** Ranked fix option from list_fix_options (stub until full enumerator). */
export type FixOptionId = 'two_tapes_plus_check' | 'tape_plus_ray' | 'two_rays';

export type MeasurementStrength = 'green' | 'amber' | 'red' | 'grey';

export interface FixOptionChoice {
  id: FixOptionId;
  label: string;
  twoSolutions: boolean;
}

export interface AddPointWorkflowContext {
  layerRule?: SurveyLayerRule;
  fixOptions?: FixOptionChoice[];
  fixOptionId?: FixOptionId;
  twoSolutions?: boolean;
  sideResolved?: boolean;
  /** +1 / −1 side of baseline for station solve */
  side?: 1 | -1;
  /** Plan point tapped for side choice */
  sideAnchorPointId?: string;
  tapeLengthM?: number;
  pendingPhotoId?: string;
  draftPointId?: string;
  strength?: MeasurementStrength;
  residualMm?: number;
  toleranceMm?: number;
  acceptedAmber?: boolean;
  amberNote?: string;
  strengthDetail?: string;
  baselineWarning?: boolean;
}

export function emptyAddPointContext(): AddPointWorkflowContext {
  return {};
}
