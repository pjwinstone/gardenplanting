/** Fail when docs/generated/WORKFLOWS.md drifts from the workflow definitions. */

import { readFileSync, writeFileSync } from 'node:fs';
import { generateWorkflowMarkdown } from '../src/workflows/guided/generateMarkdown.ts';

const file = new URL('../docs/generated/WORKFLOWS.md', import.meta.url);
const next = generateWorkflowMarkdown();

if (process.argv.includes('--write')) {
  writeFileSync(file, next);
  console.log(`Wrote ${file.pathname}`);
  process.exit(0);
}

let current = '';
try {
  current = readFileSync(file, 'utf8');
} catch {
  console.error('docs/generated/WORKFLOWS.md is missing. Run: npm run check:workflows -- --write');
  process.exit(1);
}

if (current !== next) {
  console.error('docs/generated/WORKFLOWS.md is out of date. Run: npm run check:workflows -- --write');
  process.exit(1);
}

console.log('workflow docs in sync');
