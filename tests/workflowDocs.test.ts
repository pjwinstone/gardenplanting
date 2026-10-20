import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateWorkflowMarkdown } from '../src/workflows/guided/generateMarkdown';

describe('workflow markdown', () => {
  it('matches the generated reference and keeps the field sentences', () => {
    const file = readFileSync(new URL('../docs/generated/WORKFLOWS.md', import.meta.url), 'utf8');
    const generated = generateWorkflowMarkdown();
    expect(file).toBe(generated);
    expect(generated).toContain('11 steps');
    expect(generated).toContain('7 steps');
    expect(generated).toContain('CUT HERE');
    expect(generated).toContain('Left: just inside the dash. Right: on the right-hand dashed line, or the sheet edge.');
    expect(generated).toContain('just inside the CUT HERE dash');
    expect(generated).toContain('4.4–5.0 mm');
    expect(generated).toContain('Flush staples');
    expect(generated).toContain('195 mm fold crosses');
    expect(generated).toContain('3.3 mm');
    expect(generated).toContain('thin double-sided tape');
    expect(generated).toContain('off the middle of the calibration photo');
    expect(generated).toContain('in-app camera');
    expect(generated).toContain('Start this run before you take the calibration photo');
    expect(generated).toContain('A shot from earlier does not count');
    expect(generated).not.toContain('Camera.app');
    expect(generated).not.toContain('exactly on the dashed line');
    expect(generated).toContain('photo.uploaded Edge points');
    expect(generated).toContain('Grow the base grid');
    expect(generated).toContain('Start the base grid (BAS01, BAS02)');
    expect(generated).toContain('STN01');
    expect(generated).toContain('Tape the diameter');
    expect(generated).toContain('Circle result');
    expect(generated).toContain('Coming soon');
  });
});