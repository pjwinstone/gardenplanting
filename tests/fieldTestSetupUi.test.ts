import { describe, expect, it } from 'vitest';
import { emptyDocument } from '../src/model';
import { commitWorkflow, emptyProgress, readProgress, startWorkflow } from '../src/workflows/guided/engine';
import { defaultFieldTestSetup } from '../src/workflows/guided/fieldTestMeta';
import { handleWorkflowCommand, setupValuesWithDraft } from '../src/workflows/guided/guidedChrome';

const NOW = '2026-06-01T12:00:00.000Z';
const src = { getAttribute: () => null };

describe('Set-up step on the roller', () => {
  it('Confirm leaves Set-up and moves to the first open step', () => {
    const doc = commitWorkflow(emptyDocument('Circle day'), startWorkflow(emptyProgress(), 'circle-field-test', NOW).progress);
    expect(readProgress(doc).runs['circle-field-test']?.currentStepId).toBe('setup');
    const result = handleWorkflowCommand('workflow-confirm-setup', doc, src);
    expect(result.doc).toBeDefined();
    const run = readProgress(result.doc!).runs['circle-field-test']!;
    expect(run.setup?.status).toBe('confirmed');
    expect(run.currentStepId).toBe('gather-kit');
  });

  it('applies typed values (comma decimals) and rejects bad ones', () => {
    const base = defaultFieldTestSetup();
    const next = setupValuesWithDraft(base, { circle_diameter_m: '7,99', 'tolerances_mm.baseline': '25' });
    expect(next?.circle_diameter_m).toBeCloseTo(7.99);
    expect(next?.tolerances_mm.baseline).toBe(25);
    expect(base.circle_diameter_m).toBe(8);
    expect(setupValuesWithDraft(base, { circle_diameter_m: 'abc' })).toBeNull();
    expect(setupValuesWithDraft(base, { circle_diameter_m: '0' })).toBeNull();
  });
});
