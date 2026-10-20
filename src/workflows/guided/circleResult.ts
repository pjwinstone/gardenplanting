/** Circle result step: solve the garden, fit the circle in the adjust, grade against the tape (docs/garden-circle.md). */

import type { GardenDocument } from '../../model';
import { circleCheckFromSolve, circleVerdict, type CircleVerdict } from '../../solver/circleCheck';
import { solveGardenDocument } from '../../solver/document';
import { migrateFieldTestSetup } from './fieldTestMeta';
import { edgePointsFor } from './markerSet';
import type { WorkflowRun } from './types';

export const TAPE_DIAMETER_STEP_ID = 'tape-diameter';
export const CIRCLE_RESULT_STEP_ID = 'circle-result';

/** Solver point ids of this garden's edge points (by id or by label EDG01…). */
export function edgePointIdsIn(doc: GardenDocument, names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const p = doc.points.find((q) => q.id === name) ?? doc.points.find((q) => q.label === name);
    if (p) out.push(p.id);
  }
  return out;
}

export function circleResultForRun(doc: GardenDocument | null | undefined, run: WorkflowRun): CircleVerdict {
  const values = migrateFieldTestSetup(run.setup?.values);
  const needs = (headline: string, guidance: string[]): CircleVerdict => ({ state: 'needs-data', headline, guidance } as CircleVerdict);
  if (!doc) return needs('No garden open.', []);
  const names = edgePointsFor(doc, values.edge_points);
  let result;
  try {
    result = solveGardenDocument(doc);
  } catch (err) {
    return needs(`The survey does not solve yet: ${(err as Error).message}`, ['Save the baseline (step: Tape the baseline) and take the camera-position photos.']);
  }
  const input = circleCheckFromSolve(result, edgePointIdsIn(doc, names), {
    tapes: run.circleTape ? { diametersM: run.circleTape.diametersM, edge: run.circleTape.edge } : undefined,
    capM: values.tolerances_mm.circle_diameter_baseline / 1000,
    plantableCapM: values.tolerances_mm.circle_diameter_plantable / 1000,
    plannedPoints: values.edge_points,
    cameraClassM: values.tolerances_mm.camera_position / 1000,
    baselineM: values.baseline_length_m,
  });
  return circleVerdict(input);
}
