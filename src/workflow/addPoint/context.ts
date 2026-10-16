export type SurveyLayerRule = 'baseline' | 'railway' | 'flower_bed' | 'tree';

export type FixOption = 'free_point' | 'baseline_end' | 'camera_station';

export type MeasurementStrength = 'green' | 'amber' | 'red' | 'grey';

export interface AddPointWorkflowContext {
  layerRule?: SurveyLayerRule;
  fixOption?: FixOption;
  /** +1 / −1 side of baseline for station solve */
  side?: 1 | -1;
  /** Plan point tapped for side / anchor */
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
}

export function emptyAddPointContext(): AddPointWorkflowContext {
  return {};
}
