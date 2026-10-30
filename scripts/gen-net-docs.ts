/** Writes docs/nets/circle-test.md from workflow/nets/circle-test.nets.yaml (the hierarchy page). */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadNets, toMarkdown } from '../src/engine';

const file = loadNets(readFileSync('workflow/nets/circle-test.nets.yaml', 'utf8'));
writeFileSync('docs/nets/circle-test.md', toMarkdown(file, 'Circle test nets'));
console.log('wrote docs/nets/circle-test.md');
