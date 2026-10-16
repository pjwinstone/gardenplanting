import tolerancesJson from '../../workflow/tolerances.json';
import type { SurveyLayerRule } from './addPoint/context';

export interface WorkflowTolerances {
  baselineMm: number;
  railwayMm: number;
  flowerBedMm: number;
  treeMm: number;
  cameraPositionMm: number;
}

export const workflowTolerances: WorkflowTolerances = tolerancesJson as WorkflowTolerances;

export function toleranceForLayerRule(rule: SurveyLayerRule | undefined): number {
  switch (rule) {
    case 'baseline':
      return workflowTolerances.baselineMm;
    case 'railway':
      return workflowTolerances.railwayMm;
    case 'flower_bed':
      return workflowTolerances.flowerBedMm;
    case 'tree':
      return workflowTolerances.treeMm;
    default:
      return workflowTolerances.baselineMm;
  }
}

export function toleranceForFix(
  rule: SurveyLayerRule | undefined,
  fix: 'camera_station' | 'free_point' | 'baseline_end' | undefined,
): number {
  if (fix === 'camera_station') return workflowTolerances.cameraPositionMm;
  return toleranceForLayerRule(rule);
}
