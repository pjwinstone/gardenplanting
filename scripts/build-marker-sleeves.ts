#!/usr/bin/env node
/**
 * Write docs/markers/*.pdf — one A4 sleeve per base point (BASnn) and per post bottom (BASnnB),
 * plus all-sleeves.pdf (the tops) and post-bottom-sleeves.pdf (the bottoms).
 * Deterministic. No timestamps. Run: npm run build:marker-sleeves
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_SLEEVES, CIRCLE_SLEEVES, POST_BOTTOM_SLEEVES, renderAllSleevesPdf, renderPostBottomSleevesPdf, renderSleevePdf } from './markerSleeve.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'docs/markers');
mkdirSync(dir, { recursive: true });

for (const sleeve of ALL_SLEEVES) {
  const path = join(dir, `${sleeve.point}.pdf`);
  writeFileSync(path, renderSleevePdf(sleeve));
  console.log(`${path}  ${sleeve.point}  ${sleeve.id}`);
}

const allPath = join(dir, 'all-sleeves.pdf');
writeFileSync(allPath, renderAllSleevesPdf());
console.log(`${allPath}  ${CIRCLE_SLEEVES.length} pages`);

const bottomPath = join(dir, 'post-bottom-sleeves.pdf');
writeFileSync(bottomPath, renderPostBottomSleevesPdf());
console.log(`${bottomPath}  ${POST_BOTTOM_SLEEVES.length} pages`);
