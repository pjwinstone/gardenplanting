/** Circle field test Set-up defaults and id migration (field-test.net.yaml rev 3). */

import tolerances from '../../../workflow/tolerances.json';

export const SETUP_STEP_ID = 'setup';

export const FIELD_TEST_STEP_ALIASES: Record<string, string> = {
  kit: 'gather-kit',
  'set-out': 'set-out-circle',
  diameters: 'tape-diameters',
  'place-baseline': 'place-baseline-points',
  'tape-baseline': 'tape-baseline',
  'laser-check': 'laser-check-baseline',
  plumb: 'plumb-canes',
  cal: 'camera-calibration',
  stn01: 'camera-left',
  stn02: 'camera-right-near',
  stn03: 'camera-right-far',
  'save-send': 'save-to-onedrive',
};

export function canonicalStepId(stepId: string): string {
  return FIELD_TEST_STEP_ALIASES[stepId] ?? stepId;
}

export interface CameraPositionDistances {
  to_bas01: number;
  to_bas02: number;
}

export interface FieldTestSetupValues {
  baseline_length_m: number;
  bas02_from_peg_m: number;
  circle_diameter_m: number;
  calibration_distance_m: number;
  camera_positions: {
    left: CameraPositionDistances;
    right_near: CameraPositionDistances;
    right_far: CameraPositionDistances;
  };
  tolerances_mm: {
    baseline: number;
    railway: number;
    flower_bed: number;
    tree: number;
    camera_position: number;
  };
}

export function defaultFieldTestSetup(): FieldTestSetupValues {
  return {
    baseline_length_m: 8,
    bas02_from_peg_m: 4.3,
    circle_diameter_m: 8,
    calibration_distance_m: 4,
    camera_positions: {
      left: { to_bas01: 8, to_bas02: 8 },
      right_near: { to_bas01: 6.5, to_bas02: 9 },
      right_far: { to_bas01: 10.5, to_bas02: 10.5 },
    },
    tolerances_mm: {
      baseline: tolerances.baselineMm,
      railway: tolerances.railwayMm,
      flower_bed: tolerances.flowerBedMm,
      tree: tolerances.treeMm,
      camera_position: tolerances.cameraPositionMm,
    },
  };
}

/** Config key -> step ids that need re-check when the value changes. */
export const SETUP_DEPENDS_ON: Record<string, string[]> = {
  baseline_length_m: [
    'place-baseline-points',
    'tape-baseline',
    'laser-check-baseline',
    'camera-left',
    'camera-right-near',
    'camera-right-far',
  ],
  bas02_from_peg_m: ['place-baseline-points'],
  circle_diameter_m: ['set-out-circle', 'tape-diameters'],
  calibration_distance_m: ['camera-calibration'],
  'camera_positions.left': ['camera-left'],
  'camera_positions.right_near': ['camera-right-near'],
  'camera_positions.right_far': ['camera-right-far'],
  'tolerances_mm.baseline': ['tape-baseline', 'laser-check-baseline'],
  'tolerances_mm.camera_position': ['camera-left', 'camera-right-near', 'camera-right-far'],
};

/** Legacy camera position names still match photo events. */
export const CAMERA_POSITION_LEGACY: Record<string, string[]> = {
  'camera-calibration': ['CAL', 'Calibration'],
  'camera-left': ['STN01', 'Left'],
  'camera-right-near': ['STN02', 'Right near', 'Right Near'],
  'camera-right-far': ['STN03', 'Right far', 'Right Far'],
};
