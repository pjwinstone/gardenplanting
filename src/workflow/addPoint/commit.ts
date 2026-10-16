import type { GardenDocument, Point, PointKind } from '../../model';
import { preferredBaseline, setStickyPanel } from '../../layers';
import type { AddPointWorkflowContext, SurveyLayerRule } from './context';

function kindForLayerRule(rule: SurveyLayerRule | undefined): PointKind {
  switch (rule) {
    case 'baseline':
      return 'BL';
    case 'railway':
      return 'TRK';
    case 'flower_bed':
      return 'BED';
    case 'tree':
      return 'BED';
    default:
      return 'OCC';
  }
}

function layerIdForRule(doc: GardenDocument, rule: SurveyLayerRule | undefined): string {
  const layers = doc.layers ?? [];
  switch (rule) {
    case 'railway':
      return layers.find((l) => l.id === 'walkway')?.id ?? layers[0]?.id ?? 'walkway';
    case 'flower_bed':
    case 'tree':
      return layers.find((l) => l.id === 'plants')?.id ?? layers[0]?.id ?? 'plants';
    case 'baseline':
    default:
      return layers.find((l) => l.id === 'structure')?.id ?? layers[0]?.id ?? 'structure';
  }
}

/**
 * Finalise an accepted draft point: set kind/layer and link baseline ends when requested.
 */
export function commitAddPointDraft(
  doc: GardenDocument,
  ctx: AddPointWorkflowContext,
): { doc: GardenDocument; point?: Point } {
  const id = ctx.draftPointId;
  if (!id) return { doc };
  const kind = kindForLayerRule(ctx.layerRule);
  const layerId = layerIdForRule(doc, ctx.layerRule);
  let next: GardenDocument = {
    ...doc,
    points: doc.points.map((p) =>
      p.id === id ? { ...p, kind, layerId, fixed: ctx.fixOption === 'baseline_end' } : p,
    ),
    session: {
      ...doc.session,
      lastAction: `Petri + Point committed ${id} (${kind})`,
      geometryOk: ctx.strength === 'green' || Boolean(ctx.acceptedAmber),
      lastResidualMm: ctx.residualMm,
    },
  };

  next = setStickyPanel(next, { stickyLayerId: layerId });

  if (ctx.fixOption === 'baseline_end') {
    const bl = preferredBaseline(next);
    const pt = next.points.find((p) => p.id === id);
    if (bl && pt) {
      const ends = { a: bl.a, b: bl.b };
      if (!ends.a || ends.a === id) {
        ends.a = id;
      } else if (!ends.b || ends.b === id) {
        ends.b = id;
      }
      next = {
        ...next,
        baselines: next.baselines.map((b) =>
          b.id === bl.id ? { ...b, a: ends.a!, b: ends.b! } : b,
        ),
        session: {
          ...next.session,
          activeBaselineEnds: ends,
          currentBaselineId: bl.id,
        },
      };
    }
  }

  const point = next.points.find((p) => p.id === id);
  return { doc: next, point };
}
