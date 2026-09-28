/** Layer A: baselines + taped edges + rod lengths + house polygon close residual. */

import type { GardenDocument, Observation, Point } from './model';
import {
  SIGMA,
  HOUSE_CLOSE_WARN_MM,
  currentBaseline,
  housePolygon,
} from './model';

export interface LayerAResult {
  points: Point[];
  observations: Observation[];
  summary: string;
  residualMm: number;
  ok: boolean;
}

function dist(a: Point, b: Point): number | null {
  if (a.x == null || a.y == null || b.x == null || b.y == null) return null;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Place active baseline on +X, apply mark offsets toward +Y (garden side),
 * honour taped house edges where intermediate coords exist, rod lengths, close gap.
 */
export function runLayerA(doc: GardenDocument): LayerAResult {
  const points = doc.points.map((p) => ({ ...p }));
  const observations: Observation[] = [];
  const byId = (id: string) => points.find((p) => p.id === id);

  let residualMm = 0;
  let ok = true;

  const baselines = doc.baselines.length
    ? doc.baselines
    : // Legacy: treat baseline-kind lines as baselines
      doc.lines
        .filter((l) => l.kind === 'baseline' && l.lengthM != null)
        .map((l) => ({
          id: l.id,
          a: l.a,
          b: l.b,
          lengthM: l.lengthM!,
          sigmaM: l.sigmaM,
          kind: 'tape' as const,
          isHouseEdge: true,
        }));

  const primary = currentBaseline(doc) ?? baselines[0];

  if (primary) {
    const a = byId(primary.a);
    const b = byId(primary.b);
    const L = primary.lengthM;
    if (a) {
      a.x = 0;
      a.y = 0;
      a.fixed = true;
      // Offset toward garden (+Y) if mark is not the true corner.
      if (a.offsetMm && a.offsetMm !== 0) {
        a.y = (a.offsetMm / 1000) * (a.offsetMm > 0 ? 1 : -1);
      }
    }
    if (b) {
      b.x = L;
      b.y = 0;
      b.fixed = true;
      if (b.offsetMm && b.offsetMm !== 0) {
        b.y = (b.offsetMm / 1000) * (b.offsetMm > 0 ? 1 : -1);
      }
    }
    if (a && b && a.x != null && a.y != null && b.x != null && b.y != null) {
      const d = dist(a, b)!;
      const rMm = (d - L) * 1000;
      residualMm = Math.max(residualMm, Math.abs(rMm));
      observations.push({
        id: `res-${primary.id}`,
        kind: 'residual',
        pointIds: [primary.a, primary.b],
        value: rMm,
        unit: 'mm',
        note:
          Math.abs(rMm) < 15
            ? `Baseline ${primary.a}–${primary.b} checks out (${Math.abs(rMm).toFixed(0)} mm).`
            : `Baseline ${primary.a}–${primary.b} residual ${rMm.toFixed(0)} mm — check the tape.`,
        sigma: (primary.sigmaM ?? SIGMA.tapeM) * 1000,
      });
    }
  } else {
    ok = false;
    observations.push({
      id: 'res-no-baseline',
      kind: 'residual',
      note: 'No baseline yet — establish one before trusting Layer A.',
      value: 0,
      unit: 'mm',
    });
  }

  // Walk taped house edges to place successive corners when previous is known.
  const house = housePolygon(doc);
  if (house && house.pointIds.length >= 2) {
    for (let i = 1; i < house.pointIds.length; i++) {
      const prevId = house.pointIds[i - 1];
      const curId = house.pointIds[i];
      const edge = doc.lines.find(
        (l) =>
          l.lengthM != null &&
          ((l.a === prevId && l.b === curId) || (l.a === curId && l.b === prevId)),
      );
      const prev = byId(prevId);
      const cur = byId(curId);
      if (!edge || !prev || prev.x == null || prev.y == null || !cur) continue;
      if (cur.fixed && cur.x != null && cur.y != null) continue;
      // Place along +Y from previous if still at origin-ish; else keep existing or estimate along edge direction from baseline.
      if (cur.x == null || cur.y == null) {
        // Simple chain: extend perpendicular-ish using previous edge direction when available.
        const before = i >= 2 ? byId(house.pointIds[i - 2]) : null;
        let dx = 0;
        let dy = edge.lengthM!;
        if (before && before.x != null && before.y != null) {
          const vx = prev.x - before.x;
          const vy = prev.y - before.y;
          const len = Math.hypot(vx, vy) || 1;
          // Turn left (CCW) for typical house walk.
          dx = (-vy / len) * edge.lengthM!;
          dy = (vx / len) * edge.lengthM!;
        }
        cur.x = prev.x + dx;
        cur.y = prev.y + dy;
        if (cur.offsetMm) {
          // Nudge toward interior roughly along the turn normal.
          const n = Math.hypot(dx, dy) || 1;
          cur.x += (-dy / n) * (cur.offsetMm / 1000);
          cur.y += (dx / n) * (cur.offsetMm / 1000);
        }
      }
      const d = dist(prev, cur);
      if (d != null && edge.lengthM != null) {
        const rMm = (d - edge.lengthM) * 1000;
        residualMm = Math.max(residualMm, Math.abs(rMm));
        observations.push({
          id: `res-edge-${prevId}-${curId}`,
          kind: 'residual',
          pointIds: [prevId, curId],
          value: rMm,
          unit: 'mm',
          note:
            Math.abs(rMm) < 25
              ? `Edge ${prevId}–${curId} OK (${Math.abs(rMm).toFixed(0)} mm).`
              : `Edge ${prevId}–${curId} residual ${rMm.toFixed(0)} mm — check the tape.`,
          sigma: (edge.sigmaM ?? SIGMA.tapeM) * 1000,
        });
      }
    }
  }

  // Rod length constraints.
  for (const line of doc.lines.filter((l) => l.kind === 'rod' && l.lengthM != null)) {
    const a = byId(line.a);
    const b = byId(line.b);
    if (!a || !b || a.x == null || a.y == null || b.x == null || b.y == null) continue;
    const d = dist(a, b)!;
    const rMm = (d - line.lengthM!) * 1000;
    residualMm = Math.max(residualMm, Math.abs(rMm));
    const label = line.a.startsWith('A') ? 'Rod A' : line.a.startsWith('B') ? 'Rod B' : line.id;
    observations.push({
      id: `res-${line.id}`,
      kind: 'residual',
      pointIds: [line.a, line.b],
      value: rMm,
      unit: 'mm',
      note:
        Math.abs(rMm) < 15
          ? `${label} length checks out (${Math.abs(rMm).toFixed(0)} mm residual).`
          : `${label} length residual ${rMm.toFixed(0)} mm — check belts.`,
      sigma: (line.sigmaM ?? SIGMA.rodLengthM) * 1000,
    });
  }

  // House close residual when marked closed.
  if (house?.closed && house.pointIds.length >= 3) {
    const first = byId(house.pointIds[0]);
    const last = byId(house.pointIds[house.pointIds.length - 1]);
    if (first?.x != null && first.y != null && last?.x != null && last.y != null) {
      const gapMm = dist(first, last)! * 1000;
      residualMm = Math.max(residualMm, gapMm);
      const warn = gapMm > HOUSE_CLOSE_WARN_MM;
      if (warn) ok = false;
      observations.push({
        id: 'res-house-close',
        kind: 'residual',
        pointIds: [house.pointIds[0], house.pointIds[house.pointIds.length - 1]],
        value: gapMm,
        unit: 'mm',
        note: warn
          ? `House close gap ${gapMm.toFixed(0)} mm — remeasure before you trust the polygon.`
          : `House close gap ${gapMm.toFixed(0)} mm — good enough to proceed.`,
      });
    }
  } else if (house && house.pointIds.length >= 2) {
    observations.push({
      id: 'res-house-open',
      kind: 'residual',
      note: `House polygon open (${house.pointIds.length} corners). Add edges or Close house when ready.`,
      value: 0,
      unit: 'mm',
    });
  }

  if (residualMm >= 50) ok = false;

  const summary = ok
    ? 'Layer A: baseline + edges/rods applied.'
    : 'Layer A: residuals high or house close gap large — remeasure before trusting the plan.';

  return { points, observations, summary, residualMm, ok };
}
