import { describe, expect, it } from 'vitest';
import { circleFieldTest } from '../src/workflows/guided/definitions';
import { defaultFieldTestSetup } from '../src/workflows/guided/fieldTestMeta';
import {
  advanceWorkflow,
  confirmSetupWorkflow,
  doneWorkflow,
  emptyProgress,
  rejectEvidenceWorkflow,
  retakeEvidenceWorkflow,
  skipWithNoteWorkflow,
  startWorkflow,
  tickWithReasonWorkflow,
  tickWorkflow,
  reconcileRun,
} from '../src/workflows/guided/engine';

const NOW = '2026-06-01T12:00:00.000Z';

function fieldRun() {
  let progress = startWorkflow(emptyProgress(), 'circle-field-test', NOW).progress;
  progress = confirmSetupWorkflow(progress, undefined, NOW).progress;
  return progress;
}

describe('circle field test step roller', () => {
  it('Later and Skip with a note', () => {
    let progress = fieldRun();
    progress = advanceWorkflow(progress, NOW).progress;
    const later = advanceWorkflow(progress, NOW);
    expect(later.changed).toBe(true);
    expect(later.progress.runs['circle-field-test']?.currentStepId).toBe('set-out-circle');
    expect(later.progress.runs['circle-field-test']?.steps['gather-kit']?.status).toBe('open');

    progress = later.progress;
    const skipped = skipWithNoteWorkflow(progress, 'set-out-circle', 'Rain stopped play', NOW);
    expect(skipped.changed).toBe(true);
    expect(skipped.progress.runs['circle-field-test']?.steps['set-out-circle']?.status).toBe('skipped_with_note');
  });

  it('bad evidence then Retake', () => {
    let progress = fieldRun();
    progress = advanceWorkflow(progress, NOW).progress;
    const bad = rejectEvidenceWorkflow(
      progress,
      'camera-calibration',
      'Photo not usable for focal length. Retake at 1×.',
      NOW,
    );
    expect(bad.progress.runs['circle-field-test']?.steps['camera-calibration']?.status).toBe('evidence_failed');
    progress = retakeEvidenceWorkflow(bad.progress, 'camera-calibration', NOW).progress;
    expect(progress.runs['circle-field-test']?.steps['camera-calibration']?.status).toBe('waiting_for_app');
  });

  it('Tick by hand with a reason and refused without one', () => {
    let progress = fieldRun();
    progress = advanceWorkflow(progress, NOW).progress;
    for (const step of circleFieldTest.steps) {
      if (step.id === 'camera-calibration') break;
      progress = tickWorkflow(progress, step.id, undefined, NOW).progress;
      progress = advanceWorkflow(progress, NOW).progress;
    }
    expect(progress.runs['circle-field-test']?.currentStepId).toBe('camera-calibration');
    const refused = tickWithReasonWorkflow(progress, 'camera-calibration', 'no', NOW);
    expect(refused.changed).toBe(false);
    const ok = tickWithReasonWorkflow(progress, 'camera-calibration', 'Phone would not focus', NOW);
    expect(ok.changed).toBe(true);
    expect(ok.progress.runs['circle-field-test']?.steps['camera-calibration']?.status).toBe('ticked_with_reason');
  });

  it('config edit marks dependants for re-check', () => {
    let progress = fieldRun();
    progress = advanceWorkflow(progress, NOW).progress;
    progress = tickWorkflow(progress, 'gather-kit', undefined, NOW).progress;
    progress = advanceWorkflow(progress, NOW).progress;
    progress = tickWorkflow(progress, 'set-out-circle', undefined, NOW).progress;
    const values = defaultFieldTestSetup();
    values.circle_diameter_m = 7.99;
    const edited = confirmSetupWorkflow(progress, values, NOW);
    expect(edited.progress.runs['circle-field-test']?.steps['set-out-circle']?.status).toBe('needs_recheck');
    expect(edited.progress.runs['circle-field-test']?.runLog?.some((entry) => entry.type === 'config.changed')).toBe(true);
  });

  it('Done blocked then jumps to the first open step and can finish', () => {
    let progress = fieldRun();
    for (const step of circleFieldTest.steps.slice(0, -1)) {
      progress = tickWorkflow(progress, step.id, undefined, NOW).progress;
      progress = advanceWorkflow(progress, NOW).progress;
    }
    progress = advanceWorkflow(progress, NOW).progress;
    const blocked = doneWorkflow(progress, NOW);
    expect(blocked.notice).toMatch(/open/i);
    for (const step of circleFieldTest.steps) {
      progress = tickWorkflow(blocked.progress, step.id, undefined, NOW).progress;
    }
    const finished = doneWorkflow(progress, NOW);
    expect(finished.progress.runs['circle-field-test']?.finishedAt).toBe(NOW);
  });

  it('migrates saved-run alias step ids', () => {
    const run = {
      workflowId: 'circle-field-test' as const,
      revision: 1,
      currentStepId: 'stn01',
      startedAt: NOW,
      updatedAt: NOW,
      steps: {
        kit: { status: 'complete' as const, completedBy: 'manual' as const },
        stn01: { status: 'pending' as const, completedBy: null },
      },
    };
    const migrated = reconcileRun(circleFieldTest, run);
    expect(migrated.steps['gather-kit']?.status).toBe('ticked_by_you');
    expect(migrated.steps.stn01?.status).toBe('waiting_for_app');
    expect(migrated.steps['camera-left']?.status).toBe('waiting_for_app');
  });
});
