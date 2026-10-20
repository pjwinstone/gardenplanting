/** Circle field test Set-up defaults and id migration (field-test.net.yaml rev 5). */

import tolerances from '../../../workflow/tolerances.json';

export const SETUP_STEP_ID = 'setup';

export const FIELD_TEST_STEP_ALIASES: Record<string, string> = {
  kit: 'gather-kit',
  'place-baseline': 'place-baseline-points',
  'tape-baseline': 'tape-baseline',
  'laser-check': 'laser-check-baseline',
  diameters: 'tape-diameter',
  'tape-diameters': 'tape-diameter',
  'set-out': 'mark-edge-points',
  'set-out-circle': 'mark-edge-points',
  plumb: 'mark-edge-points',
  'plumb-canes': 'mark-edge-points',
  cal: 'camera-calibration',
  stn01: 'camera-1',
  stn02: 'camera-2',
  stn03: 'camera-3',
  'camera-left': 'camera-1',
  'camera-right-near': 'camera-2',
  'camera-right-far': 'camera-3',
  'save-send': 'save-to-onedrive',
};

export function canonicalStepId(stepId: string): string {
  return FIELD_TEST_STEP_ALIASES[stepId] ?? stepId;
}

export interface CameraPositionDistances {
  /** Taped distance, m. 0 = not taped (positions 3 and 4 by default). */
  to_bas01: number;
  to_bas02: number;
}

export const CAMERA_POSITION_KEYS = ['position_1', 'position_2', 'position_3', 'position_4'] as const;
export type CameraPositionKey = (typeof CAMERA_POSITION_KEYS)[number];

export interface FieldTestSetupValues {
  /** Diameter of the existing garden circle, m (docs/garden-circle.md). */
  circle_diameter_m: number;
  /** Sleeved canes on the circle edge, EDG01…, at least 8. */
  edge_points: number;
  /** Camera positions round the circle, 3 or 4. */
  camera_position_count: number;
  /** BAS01–BAS02, tangential to the circle, at least D/2. */
  baseline_length_m: number;
  calibration_distance_m: number;
  /** Legacy (rev 3 peg layout). Kept so older saves load; not shown. */
  bas02_from_peg_m?: number;
  camera_positions: Record<CameraPositionKey, CameraPositionDistances>;
  tolerances_mm: {
    baseline: number;
    railway: number;
    flower_bed: number;
    tree: number;
    camera_position: number;
    circle_diameter_baseline: number;
    circle_diameter_plantable: number;
  };
}

export function defaultFieldTestSetup(): FieldTestSetupValues {
  return {
    circle_diameter_m: 12,
    edge_points: 12,
    camera_position_count: 4,
    baseline_length_m: 6,
    calibration_distance_m: 4,
    camera_positions: {
      // 9 m outside the edge, round the circle; 1 and 4 (the baseline side) are taped.
      position_1: { to_bas01: 14.6, to_bas02: 8.6 },
      position_2: { to_bas01: 0, to_bas02: 0 },
      position_3: { to_bas01: 0, to_bas02: 0 },
      position_4: { to_bas01: 7.5, to_bas02: 13.1 },
    },
    tolerances_mm: {
      baseline: tolerances.baselineMm,
      railway: tolerances.railwayMm,
      flower_bed: tolerances.flowerBedMm,
      tree: tolerances.treeMm,
      camera_position: tolerances.cameraPositionMm,
      circle_diameter_baseline: tolerances.circleDiameterCapBaselineMm,
      circle_diameter_plantable: tolerances.circleDiameterCapPlantableMm,
    },
  };
}

/** Older saved values with defaults filled in (rev 3 runs had no edge points or positions 1–4). */
export function migrateFieldTestSetup(values: Partial<FieldTestSetupValues> | undefined): FieldTestSetupValues {
  const d = defaultFieldTestSetup();
  const v = values ?? {};
  const cp: Partial<Record<string, CameraPositionDistances>> = v.camera_positions ?? {};
  return {
    ...d,
    ...v,
    camera_positions: Object.fromEntries(CAMERA_POSITION_KEYS.map((k) => [k, cp[k] ?? d.camera_positions[k]])) as FieldTestSetupValues['camera_positions'],
    tolerances_mm: { ...d.tolerances_mm, ...(v.tolerances_mm ?? {}) },
  };
}

/** Config key -> step ids that need re-check when the value changes. */
export const SETUP_DEPENDS_ON: Record<string, string[]> = {
  circle_diameter_m: ['place-baseline-points', 'tape-diameter', 'circle-result'],
  edge_points: ['mark-edge-points', 'circle-result'],
  camera_position_count: ['camera-3', 'camera-4', 'circle-result'],
  baseline_length_m: ['place-baseline-points', 'tape-baseline', 'laser-check-baseline', 'camera-1', 'camera-2', 'camera-3', 'camera-4'],
  calibration_distance_m: ['camera-calibration'],
  'camera_positions.position_1': ['camera-1'],
  'camera_positions.position_2': ['camera-2'],
  'camera_positions.position_3': ['camera-3'],
  'camera_positions.position_4': ['camera-4'],
  'tolerances_mm.baseline': ['tape-baseline', 'laser-check-baseline'],
  'tolerances_mm.camera_position': ['camera-1', 'camera-2', 'camera-3', 'camera-4'],
  'tolerances_mm.circle_diameter_baseline': ['circle-result'],
  'tolerances_mm.circle_diameter_plantable': ['circle-result'],
};

/** Step id -> later steps whose results rest on its photos. Retaking it sends settled ones to re-check. */
export const RETAKE_DEPENDS_ON: Record<string, string[]> = {
  'camera-calibration': ['camera-1', 'camera-2', 'camera-3', 'camera-4', 'circle-result'],
};

/** Legacy camera position names still match photo events. */
export const CAMERA_POSITION_LEGACY: Record<string, string[]> = {
  'camera-calibration': ['CAL', 'Calibration'],
  // Rev 3 names (STN01–03, Left / Right near / Right far) still match, so old photos map over.
  'camera-1': ['Position 1', 'POS1', 'STN01', 'Left'],
  'camera-2': ['Position 2', 'POS2', 'STN02', 'Right near', 'Right Near'],
  'camera-3': ['Position 3', 'POS3', 'STN03', 'Right far', 'Right Far'],
  'camera-4': ['Position 4', 'POS4'],
};
