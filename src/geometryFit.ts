/** Fuzzy circle / square / triangle fits for garden objects. */

export interface SolvedCircle {
  cx: number;
  cy: number;
  r: number;
}

export interface SolvedRectangle {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Algebraic circle fit (Kåsa). Needs ≥3 points. */
export function fitCircle(
  pts: { x: number; y: number }[],
): { circle: SolvedCircle; residualMm: number } | null {
  if (pts.length < 3) return null;
  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;
  let sumX3 = 0;
  let sumY3 = 0;
  let sumX2Y = 0;
  let sumXY2 = 0;
  const n = pts.length;
  for (const p of pts) {
    const x = p.x;
    const y = p.y;
    const x2 = x * x;
    const y2 = y * y;
    sumX += x;
    sumY += y;
    sumX2 += x2;
    sumY2 += y2;
    sumXY += x * y;
    sumX3 += x2 * x;
    sumY3 += y2 * y;
    sumX2Y += x2 * y;
    sumXY2 += x * y2;
  }
  const C = n * sumX2 - sumX * sumX;
  const D = n * sumXY - sumX * sumY;
  const E = n * sumY2 - sumY * sumY;
  const G = 0.5 * (n * sumX3 + n * sumXY2 - sumX * (sumX2 + sumY2));
  const H = 0.5 * (n * sumY3 + n * sumX2Y - sumY * (sumX2 + sumY2));
  const denom = C * E - D * D;
  if (Math.abs(denom) < 1e-12) return null;
  const cx = (G * E - D * H) / denom;
  const cy = (C * H - D * G) / denom;
  let rSum = 0;
  for (const p of pts) rSum += Math.hypot(p.x - cx, p.y - cy);
  const r = rSum / n;
  if (!(r > 0) || !Number.isFinite(r)) return null;
  let rss = 0;
  for (const p of pts) {
    const d = Math.hypot(p.x - cx, p.y - cy) - r;
    rss += d * d;
  }
  const residualMm = Math.sqrt(rss / n) * 1000;
  return { circle: { cx, cy, r }, residualMm };
}

/** Axis-aligned fuzzy square from point extents. Needs ≥2 points. */
export function fitRectangle(
  pts: { x: number; y: number }[],
): { rect: SolvedRectangle; residualMm: number } | null {
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const side = Math.max(maxX - minX, maxY - minY, 0.2);
  minX = cx - side / 2;
  maxX = cx + side / 2;
  minY = cy - side / 2;
  maxY = cy + side / 2;
  let rss = 0;
  for (const p of pts) {
    const dx = Math.min(Math.abs(p.x - minX), Math.abs(p.x - maxX));
    const dy = Math.min(Math.abs(p.y - minY), Math.abs(p.y - maxY));
    const insideX = p.x > minX && p.x < maxX;
    const insideY = p.y > minY && p.y < maxY;
    const d = insideX && insideY ? Math.min(dx, dy) : 0;
    rss += d * d;
  }
  const residualMm = Math.sqrt(rss / pts.length) * 1000;
  return { rect: { minX, minY, maxX, maxY }, residualMm };
}

/** First three points as a triangle outline (stub fit). */
export function fitTriangleOutline(
  pts: { id: string; x: number; y: number }[],
): { ids: string[]; residualMm: number } | null {
  if (pts.length < 3) return null;
  const a = pts[0]!;
  const b = pts[1]!;
  const c = pts[2]!;
  let rss = 0;
  for (const p of pts.slice(3)) {
    const d = Math.min(distToSeg(p, a, b), distToSeg(p, b, c), distToSeg(p, c, a));
    rss += d * d;
  }
  const residualMm = pts.length > 3 ? Math.sqrt(rss / (pts.length - 3)) * 1000 : 0;
  return { ids: [a.id, b.id, c.id], residualMm };
}

function distToSeg(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
