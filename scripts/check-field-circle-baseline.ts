/**
 * Field fixture check — circular path vs baseline.
 * Skips (exit 0) when fixtures/field-circle-baseline/garden.json is absent.
 *
 * fxShared: false is a valid record (per-photo focal length). A capture that
 * names STN stations but has no STN03 is reported and not graded.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { circleTrialVerdict } from '../src/solver/circleTrial.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'fixtures/field-circle-baseline/garden.json');

if (!existsSync(fixture)) {
  console.log(
    'SKIP field-circle-baseline: no garden.json yet (drop real export into fixtures/field-circle-baseline/).',
  );
  process.exit(0);
}

const raw = JSON.parse(readFileSync(fixture, 'utf8')) as {
  fxShared?: unknown;
  points?: { id?: string }[];
  baselines?: unknown[];
  objects?: { geometryType?: string }[];
  photos?: { addPointId?: string; stationId?: string }[];
};
const points = raw.points ?? [];
const baselines = raw.baselines ?? [];
const objects = raw.objects ?? [];

const errors: string[] = [];
if (raw.fxShared != null && typeof raw.fxShared !== 'boolean') {
  errors.push('fxShared must be a boolean when present');
}
const stationIds = new Set<string>();
for (const p of points) {
  if (typeof p.id === 'string' && /^STN\d+$/.test(p.id)) stationIds.add(p.id);
}
for (const photo of raw.photos ?? []) {
  const id = photo.addPointId ?? photo.stationId;
  if (typeof id === 'string' && /^STN\d+$/.test(id)) stationIds.add(id);
}
const verdict = circleTrialVerdict({
  fxShared: raw.fxShared === true,
  stationIds: [...stationIds],
});
console.log(verdict.report);

if (!baselines.length) errors.push('expected at least one baseline');
const withXy = points.filter((p) => (p as { x?: number; y?: number }).x != null && (p as { y?: number }).y != null);
if (withXy.length < 3) errors.push(`expected ≥3 coordinated points, found ${withXy.length}`);
const circleItems = objects.filter((o) => o.geometryType === 'circle');
if (!circleItems.length) {
  console.warn('WARN: no object with geometryType=circle yet — fit may still be pending');
}

if (errors.length) {
  console.error('FAIL field-circle-baseline:');
  for (const e of errors) console.error(' -', e);
  process.exit(1);
}

if (!verdict.grade) {
  console.log('SKIP grade field-circle-baseline: two-station capture is reported only.');
  process.exit(0);
}

console.log(
  `OK field-circle-baseline: ${baselines.length} baseline(s), ${withXy.length} points, ${circleItems.length} circle item(s), fxShared=${verdict.fxShared}.`,
);
process.exit(0);
