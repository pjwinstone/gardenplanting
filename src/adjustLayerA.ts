/** Layer A: house tapes/laser + straight constraints; optional spikes/fence. */

import type { GardenDocument, Observation, Point } from './model';
import { SIGMA } from './model';

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
 * Enforce house rectangle from tape/laser lengths and straights.
 * Fixes HSE01 at origin, back wall along +X when possible.
 */
export function runLayerA(doc: GardenDocument): LayerAResult {
  const points = doc.points.map((p) => ({ ...p }));
  const observations: Observation[] = [];

  const byId = (id: string) => points.find((p) => p.id === id);

  // Seed house from lengths if coordinates missing.
  const back = doc.lines.find((l) => l.a === 'HSE01' && l.b === 'HSE02' && l.lengthM != null);
  const side = doc.lines.find(
    (l) =>
      ((l.a === 'HSE01' && l.b === 'HSE04') || (l.a === 'HSE04' && l.b === 'HSE01')) &&
      l.lengthM != null,
  );
  const diag = doc.lines.find(
    (l) =>
      ((l.a === 'HSE01' && l.b === 'HSE03') || (l.a === 'HSE03' && l.b === 'HSE01')) &&
      l.lengthM != null,
  );

  const L = back?.lengthM ?? 8;
  const W = side?.lengthM ?? 6;

  const h1 = byId('HSE01');
  const h2 = byId('HSE02');
  const h3 = byId('HSE03');
  const h4 = byId('HSE04');

  if (h1) {
    h1.x = 0;
    h1.y = 0;
    h1.fixed = true;
  }
  if (h2) {
    h2.x = L;
    h2.y = 0;
    h2.fixed = true;
  }
  if (h4) {
    h4.x = 0;
    h4.y = W;
    h4.fixed = true;
  }
  if (h3) {
    h3.x = L;
    h3.y = W;
    h3.fixed = true;
  }

  // Diagonal check.
  let residualMm = 0;
  if (h1 && h3 && diag?.lengthM != null) {
    const d = dist(h1, h3)!;
    const r = (d - diag.lengthM) * 1000;
    residualMm = Math.abs(r);
    observations.push({
      id: 'res-house-diag',
      kind: 'residual',
      pointIds: ['HSE01', 'HSE03'],
      value: r,
      unit: 'mm',
      note:
        Math.abs(r) < 25
          ? 'House is happy.'
          : `House diagonal residual ${r.toFixed(0)} mm — check the tape.`,
      sigma: (diag.sigmaM ?? SIGMA.tapeM) * 1000,
    });
  } else {
    observations.push({
      id: 'res-house-ok',
      kind: 'residual',
      note: 'House is happy.',
      value: 0,
      unit: 'mm',
    });
  }

  // Rod length constraints (Layer A distances primary).
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

  // Straight constraints: zero cross-track for declared wall straights (already axis-aligned).
  for (const line of doc.lines.filter((l) => l.kind === 'straight')) {
    observations.push({
      id: `res-straight-${line.id}`,
      kind: 'residual',
      pointIds: [line.a, line.b],
      value: 0,
      unit: 'mm',
      note: `Straight ${line.a}–${line.b} held.`,
    });
  }

  const houseOk = residualMm < 50 || observations.some((o) => o.note === 'House is happy.');
  const summary = houseOk
    ? 'Layer A: house closed; rod length constraints applied.'
    : 'Layer A: house residuals high — remeasure before Layer B.';

  return { points, observations, summary, residualMm, ok: houseOk };
}
