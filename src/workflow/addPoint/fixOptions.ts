import type { FixOptionChoice, SurveyLayerRule } from './context';

/** STUB: full ranker not implemented — three placeholder options per add-point.net.yaml. */
export function listFixOptionsForLayer(_layer: SurveyLayerRule): FixOptionChoice[] {
  return [
    { id: 'two_tapes_plus_check', label: 'Two tapes + check', twoSolutions: false },
    { id: 'tape_plus_ray', label: 'Tape + ray', twoSolutions: true },
    { id: 'two_rays', label: 'Two rays', twoSolutions: true },
  ];
}
