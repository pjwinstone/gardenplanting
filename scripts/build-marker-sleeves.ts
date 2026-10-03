#!/usr/bin/env node
/**
 * Write docs/markers/*.pdf — one A4 sleeve per circle-test rod, plus all-sleeves.pdf.
 * Deterministic. No timestamps. Run: node scripts/build-marker-sleeves.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CIRCLE_SLEEVES, renderAllSleevesPdf, renderSleevePdf } from './markerSleeve.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'docs/markers');
mkdirSync(dir, { recursive: true });

for (const sleeve of CIRCLE_SLEEVES) {
  const path = join(dir, `${sleeve.point}.pdf`);
  writeFileSync(path, renderSleevePdf(sleeve));
  console.log(`${path}  ${sleeve.point}  ${sleeve.id}`);
}

const allPath = join(dir, 'all-sleeves.pdf');
writeFileSync(allPath, renderAllSleevesPdf());
console.log(`${allPath}  ${CIRCLE_SLEEVES.length} pages`);
