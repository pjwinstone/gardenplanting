import { describe, expect, it } from 'vitest';
import type { GardenDocument, Photo } from '../src/model';
import { emptyDocument } from '../src/model';
import { circleFieldTest } from '../src/workflows/guided/definitions';
import { actionRetakeAvailable, deriveActionState, fireAction } from '../src/workflows/guided/actionNet';
import { confirmSetupWorkflow, countUploadedPhotosForStep, emptyProgress, retakeEvidenceWorkflow, startWorkflow } from '../src/workflows/guided/engine';
import type { WorkflowProgress } from '../src/workflows/guided/types';

const NOW = '2026-06-01T12:00:00.000Z';
const RETAKE_AT = '2026-06-01T12:10:00.000Z';
const step = circleFieldTest.steps.find((s) => s.id === 'camera-calibration')!;

function calPhoto(id: string, at: string): Photo {
  return {
    id, setupId: 'setup-1', addPointId: 'P-CAL', width: 4032, height: 3024, clicks: [], exifDateTimeOriginal: at,
    originalFile: { fileName: `${id}.jpg`, size: 10, quickXorHash: 'h', contentType: 'image/jpeg', uploadStatus: 'verified', capturedAt: at, receivedAt: at },
  };
}

function doc(photos: Photo[]): GardenDocument {
  const d = emptyDocument('Circle');
  d.objects = [{ id: 'obj-cal', layerId: 'survey', name: 'Calibration', geometryType: 'point', measuredPointIds: ['P-CAL'], selectedPointIds: [] }];
  d.points = [{ id: 'P-CAL', kind: 'OCC', label: 'Calibration 1', objectId: 'obj-cal', photoIds: photos.map((p) => p.id) }];
  d.photos = photos;
  return d;
}

function doneRun(): WorkflowProgress {
  let p = confirmSetupWorkflow(startWorkflow(emptyProgress(), 'circle-field-test', NOW).progress, undefined, NOW).progress;
  const run = p.runs['circle-field-test']!;
  run.steps['camera-calibration'] = { ...run.steps['camera-calibration']!, status: 'ticked_by_app', completedBy: 'auto', consumedPhotoIds: ['cal-1'] };
  run.steps['camera-1'] = { ...run.steps['camera-1']!, status: 'ticked_by_app', completedBy: 'auto' };
  run.currentStepId = 'camera-2';
  return p;
}

describe('calibration photo can always be retaken', () => {
  it('done calibration (roller moved on) still offers Retake', () => {
    const p = doneRun();
    const action = deriveActionState(doc([calPhoto('cal-1', '2026-06-01T12:02:00.000Z')]), p.runs['circle-field-test']!, step);
    expect(action.place).toBe('done');
    expect(actionRetakeAvailable(step, action)).toBe(true);
    expect(fireAction(action, 'retake_done')).toMatchObject({ place: 'in_progress', have: 0 });
  });

  it('upload error offers Retake as well as Retry', () => {
    expect(actionRetakeAvailable(step, { place: 'error', recovery: 'retry', need: 1, have: 0 })).toBe(true);
  });

  it('Retake reopens the step, drops the old photo, and sends dependent results to re-check', () => {
    const old = calPhoto('cal-1', '2026-06-01T12:02:00.000Z');
    const move = retakeEvidenceWorkflow(doneRun(), 'camera-calibration', RETAKE_AT);
    expect(move.changed).toBe(true);
    const run = move.progress.runs['circle-field-test']!;
    expect(run.steps['camera-calibration']).toMatchObject({ status: 'waiting_for_app', retakeAfter: RETAKE_AT, consumedPhotoIds: [] });
    expect(run.steps['camera-1']?.status).toBe('needs_recheck');
    expect(countUploadedPhotosForStep(doc([old]), 'Calibration', run, 'camera-calibration').count).toBe(0);
    expect(deriveActionState(doc([old]), run, step).place).not.toBe('done');
    const fresh = calPhoto('cal-2', '2026-06-01T12:11:00.000Z');
    expect(countUploadedPhotosForStep(doc([old, fresh]), 'Calibration', run, 'camera-calibration').photoIds).toEqual(['cal-2']);
  });

  it('a refused newest photo (status still waiting) can be retaken', () => {
    let p = confirmSetupWorkflow(startWorkflow(emptyProgress(), 'circle-field-test', NOW).progress, undefined, NOW).progress;
    expect(retakeEvidenceWorkflow(p, 'camera-calibration', RETAKE_AT).changed).toBe(true);
  });
});
