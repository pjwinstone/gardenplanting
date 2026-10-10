import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateWorkflowMarkdown } from '../src/workflows/guided/generateMarkdown';

describe('workflow markdown', () => {
  it('matches the generated reference and keeps the field sentences', () => {
    const file = readFileSync(new URL('../docs/generated/WORKFLOWS.md', import.meta.url), 'utf8');
    const generated = generateWorkflowMarkdown();
    expect(file).toBe(generated);
    expect(generated).toContain('12 steps');
    expect(generated).toContain('7 steps');
    expect(generated).toContain('CUT HERE');
    expect(generated).toContain('just inside the CUT HERE dash');
    expect(generated).toContain('4.4–5.0 mm');
    expect(generated).toContain('Flush staples');
    expect(generated).not.toContain('exactly on the dashed line');
    expect(generated).toContain('STN01');
    expect(generated).toContain('STN03');
    expect(generated).toContain('Coming soon');
  });
});