#!/usr/bin/env node
/**
 * Field fixture check — circular path vs baseline.
 * Skips (exit 0) when fixtures/field-circle-baseline/garden.json is absent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = join(root, 'fixtures/field-circle-baseline/garden.json');

if (!existsSync(fixture)) {
  console.log(
    'SKIP field-circle-baseline: no garden.json yet (drop real export into fixtures/field-circle-baseline/).',
  );
  process.exit(0);
}

const raw = JSON.parse(readFileSync(fixture, 'utf8'));
const points = raw.points ?? [];
const baselines = raw.baselines ?? [];
const objects = raw.objects ?? [];

const errors = [];
if (!baselines.length) errors.push('expected at least one baseline');
const withXy = points.filter((p) => p.x != null && p.y != null);
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

console.log(
  `OK field-circle-baseline: ${baselines.length} baseline(s), ${withXy.length} points, ${circleItems.length} circle item(s).`,
);
process.exit(0);
