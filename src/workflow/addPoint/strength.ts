/**
 * Measurement strength for the Petri Add point workflow.
 * Uses Layer B residuals when a draft point + photo marks exist; otherwise grey stubs.
 */

import type { GardenDocument } from '../../model';
import { runLayerB } from '../../adjustLayerB';
import { runLayerA } from '../../adjustLayerA';
import type { AddPointWorkflowContext, MeasurementStrength } from './context';
import { toleranceForFix } from '../tolerances';

/** Stubs — no maths yet; always grey until Geometry & Maths Advisor signs off. */
export const STRENGTH_STUBS = [
  'railway_gauge_corridor_mm',
  'flower_bed_edge_soft_fit',
  'tree_trunk_offset_check',
  'tape_only_no_plan_coords',
] as const;

export interface StrengthResult {
  strength: MeasurementStrength;
  residualMm?: number;
  toleranceMm: number;
  detail: string;
  stub?: string;
}

export function computeMeasurementStrength(
  doc: GardenDocument,
  ctx: AddPointWorkflowContext,
): StrengthResult {
  const toleranceMm = toleranceForFix(ctx.layerRule, undefined);
  const pointId = ctx.draftPointId;

  if (!pointId) {
    return {
      strength: 'grey',
      toleranceMm,
      detail: 'No draft point yet — capture a photo or tape reading.',
      stub: 'tape_only_no_plan_coords',
    };
  }

  const point = doc.points.find((p) => p.id === pointId);
  if (!point) {
    return {
      strength: 'grey',
      toleranceMm,
      detail: 'Draft point missing from document.',
      stub: 'tape_only_no_plan_coords',
    };
  }

  const layerStub =
    ctx.layerRule === 'railway'
      ? 'railway_gauge_corridor_mm'
      : ctx.layerRule === 'flower_bed'
        ? 'flower_bed_edge_soft_fit'
        : ctx.layerRule === 'tree'
          ? 'tree_trunk_offset_check'
          : undefined;

  const hasPhoto = (point.photoIds ?? []).some((id) => doc.photos.some((ph) => ph.id === id));
  const tapeOnly =
    ctx.tapeLengthM != null &&
    ctx.tapeLengthM > 0 &&
    !hasPhoto &&
    (point.x == null || point.y == null);

  if (tapeOnly) {
    return {
      strength: 'grey',
      toleranceMm,
      detail: 'Tape-only strength is not implemented without plan coordinates.',
      stub: 'tape_only_no_plan_coords',
    };
  }

  const layerA = runLayerA(doc);
  const layerB = runLayerB(doc, layerA.points);
  const occ = layerB.points.find((p) => p.id === pointId);
  const planted = doc.points.find((p) => p.id === pointId);
  let residualMm: number | undefined;

  if (
    occ?.x != null &&
    occ?.y != null &&
    planted?.x != null &&
    planted?.y != null
  ) {
    const dx = (occ.x ?? 0) - (planted.x ?? 0);
    const dy = (occ.y ?? 0) - (planted.y ?? 0);
    residualMm = Math.hypot(dx, dy) * 1000;
  } else {
    residualMm = layerB.residualMm > 0 ? layerB.residualMm : layerA.residualMm;
  }

  if (residualMm == null || Number.isNaN(residualMm)) {
    return {
      strength: 'grey',
      toleranceMm,
      detail: 'Adjust could not produce a residual for this point yet.',
      stub: 'tape_only_no_plan_coords',
    };
  }

  const amberBand = toleranceMm * 1.5;
  let strength: MeasurementStrength;
  if (residualMm <= toleranceMm) strength = 'green';
  else if (residualMm <= amberBand) strength = 'amber';
  else strength = 'red';

  if (ctx.layerRule === 'railway') {
    return {
      strength: 'grey',
      residualMm,
      toleranceMm,
      detail: `Layer B residual ${residualMm.toFixed(0)} mm, but railway corridor check is not implemented.`,
      stub: 'railway_gauge_corridor_mm',
    };
  }

  const stubSuffix =
    layerStub && (ctx.layerRule === 'flower_bed' || ctx.layerRule === 'tree')
      ? ' (layer-specific fit still a stub — residual from Adjust Layer B only).'
      : '';

  return {
    strength,
    residualMm,
    toleranceMm,
    detail: `Residual ${residualMm.toFixed(0)} mm (tolerance ${toleranceMm} mm).${stubSuffix}`,
    stub: layerStub && (ctx.layerRule === 'flower_bed' || ctx.layerRule === 'tree') ? layerStub : undefined,
  };
}
