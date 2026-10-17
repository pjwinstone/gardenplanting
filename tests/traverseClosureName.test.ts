/**
 * Closure review: χ² alone decides red, and a named reading needs the
 * 1.5× margin and |ρ| < 0.9. A short Monte Carlo locks the false-fail rate.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { wrap } from '../src/solver/bearing';
import { W_CRITICAL } from '../src/solver/constants';
import { closureReport } from '../src/solver/closure';
import { solve } from '../src/solver/adjust';
import type { SolveInput, SolverPhotoInput } from '../src/solver/types';
import { closureVerdict } from '../src/workflows/guided/traverseWalk';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(readFileSync(join(root, 'fixtures/traverse/loop4ct-dup.json'), 'utf8')) as {
  input: SolveInput;
  truth: Record<string, { x: number; y: number }>;
};
const truth = fixture.truth;
const base: SolveInput = {
  ...fixture.input,
  cameraCentring: 'setup',
  photos: fixture.input.photos!.map((photo) => ({ ...photo, phoneId: 'ph1', lens: '1x' })),
};
const pairs = [
  { id: 'C1', duplicateId: "C1'" },
  { id: 'C2', duplicateId: "C2'" },
  { id: 'H1', duplicateId: "H1'" },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function setupGroup(photo: SolverPhotoInput): string {
  const closing = photo.closing === true || photo.role === 'close';
  return `${photo.stationId}|${closing ? 'close' : 'open'}`;
}

function designYaw(photo: SolverPhotoInput): number {
  const fx = (photo.fxOverWidth ?? 0) * photo.width;
  const cx = photo.cx ?? photo.width / 2;
  const click = photo.clicks[0];
  const station = truth[photo.stationId];
  const mark = truth[click.pointId];
  const az = Math.atan2(mark.y - station.y, mark.x - station.x);
  const beta = Math.atan2(cx - click.px, fx);
  return wrap(az - beta);
}

function perturb(input: SolveInput, rng: () => number): SolveInput {
  const scale = randn(rng) * 0.02;
  const offsets = new Map<string, { x: number; y: number }>();
  for (const photo of input.photos ?? []) {
    const key = setupGroup(photo);
    if (offsets.has(key)) continue;
    const sigma = photo.sigmaCentringM != null && photo.sigmaCentringM > 0 ? photo.sigmaCentringM : 0.008;
    offsets.set(key, { x: randn(rng) * sigma, y: randn(rng) * sigma });
  }
  return {
    ...input,
    datum: { ...input.datum, lengthM: input.datum.lengthM + randn(rng) * (input.datum.sigmaM ?? 0.004) },
    distances: (input.distances ?? []).map((distance) => ({
      ...distance,
      slopeM: distance.slopeM + randn(rng) * (distance.sigmaM ?? 0.02),
    })),
    photos: (input.photos ?? []).map((photo) => {
      const yaw = designYaw(photo);
      const station = truth[photo.stationId];
      const offset = offsets.get(setupGroup(photo)) ?? { x: 0, y: 0 };
      const cam = { x: station.x + offset.x, y: station.y + offset.y };
      const fx0 = (photo.fxOverWidth ?? 0) * photo.width;
      const cx = photo.cx ?? photo.width / 2;
      const sigmaPx = photo.sigmaPx ?? 2;
      return {
        ...photo,
        clicks: photo.clicks.map((click) => {
          const mark = truth[click.pointId];
          const bearing = wrap(Math.atan2(mark.y - cam.y, mark.x - cam.x) - yaw);
          const beta = bearing + randn(rng) * (sigmaPx / fx0);
          return { ...click, px: cx - fx0 * (1 + scale) * Math.tan(beta) };
        }),
      };
    }),
  };
}

function review(input: SolveInput) {
  const result = solve(input);
  const report = result.converged
    ? closureReport(result, { pairs, fromId: 'C4', startId: 'C1', axisId: 'C2' })
    : null;
  const status = report ? closureVerdict(report, result) : undefined;
  const largest = result.observations
    .filter((row) => row.used && row.standardised != null && (row.kind === 'distance' || row.kind === 'bearing'))
    .reduce((max, row) => Math.max(max, Math.abs(row.standardised ?? 0)), 0);
  return { result, report, status, largest };
}

describe('closure naming', () => {
  it('correlates the two rays of one photo', () => {
    const result = solve(base);
    let best = 0;
    for (const photo of base.photos ?? []) {
      if (photo.clicks.length < 2) continue;
      const rho = result.residualCorrelation(
        `${photo.id}:${photo.clicks[0].pointId}`,
        `${photo.id}:${photo.clicks[1].pointId}`,
      );
      if (rho != null) best = Math.max(best, Math.abs(rho));
    }
    expect(best).toBeGreaterThanOrEqual(0.9);
  }, 60_000);

  it('fails clean loops only when the closure χ² fails', () => {
    const rng = mulberry32(20261011);
    const draws = 200;
    let red = 0;
    let chiFail = 0;
    let greenDirty = 0;
    for (let i = 0; i < draws; i++) {
      const row = review(perturb(base, rng));
      expect(row.report?.rank).toBe(6);
      if (!row.report?.chi2Pass) chiFail += 1;
      if (row.status?.tone === 'red') red += 1;
      if (row.status?.tone === 'green') {
        expect(row.report?.chi2Pass).toBe(true);
        expect(row.largest).toBeLessThanOrEqual(W_CRITICAL);
        expect(row.result.varianceTest).not.toBe('high');
      }
      if (row.status?.tone === 'green' && (row.largest > W_CRITICAL || row.result.varianceTest === 'high')) {
        greenDirty += 1;
      }
      if (row.report?.chi2Pass && (row.largest > W_CRITICAL || row.result.varianceTest === 'high')) {
        expect(row.status?.tone).toBe('amber');
        expect(row.status?.blocked).toBe(true);
        expect(row.status?.line).not.toContain('✓');
      }
      if (!row.report?.chi2Pass) expect(row.status?.tone).toBe('red');
    }
    expect(red).toBe(chiFail);
    expect(greenDirty).toBe(0);
    expect(red / draws).toBeGreaterThan(0.01);
    expect(red / draws).toBeLessThan(0.12);
  }, 180_000);

  it('names the C2–C3 tape when that leg is out by half a metre', () => {
    const rng = mulberry32(11);
    let likely = 0;
    const draws = 40;
    for (let i = 0; i < draws; i++) {
      const input = perturb(base, rng);
      input.distances = (input.distances ?? []).map((distance) => (
        distance.id === 't1-C2-C3' ? { ...distance, slopeM: distance.slopeM + 0.5 } : distance
      ));
      const row = review(input);
      const line = row.status?.line ?? '';
      if (line.includes('likely blunder')) {
        likely += 1;
        expect(line).toContain('C2–C3');
        expect(line).toContain('re-tape C2 → C3');
      }
      expect(line).toContain('C2–C3');
    }
    expect(likely).toBeGreaterThanOrEqual(32);
  }, 120_000);
});
