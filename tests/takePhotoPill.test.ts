import { describe, expect, it } from 'vitest';
import { appendPhotoToPoint } from '../src/layers';
import { emptyDocument, type GardenDocument } from '../src/model';
import { checkCameraPositionPhoto, ensureCameraPositionPoint } from '../src/workflows/guided/cameraCapture';
import {
  commitWorkflow,
  confirmSetupWorkflow,
  emptyProgress,
  readProgress,
  rejectEvidenceWorkflow,
  scrollWorkflowToStep,
  startWorkflow,
  workflowAfterUploadedPhoto,
} from '../src/workflows/guided/engine';
import { handleWorkflowCommand } from '../src/workflows/guided/guidedChrome';

const NOW = '2026-06-01T12:00:00.000Z';
const THUMB = 'data:image/jpeg;base64,AAAA';

function atStep(stepId: string): GardenDocument {
  let progress = startWorkflow(emptyProgress(), 'circle-field-test', NOW).progress;
  progress = confirmSetupWorkflow(progress, undefined, NOW).progress;
  progress = scrollWorkflowToStep(progress, stepId, NOW).progress;
  return commitWorkflow(emptyDocument('Circle day'), progress);
}

const pill = (stepId: string) => ({ getAttribute: (name: string) => (name === 'data-step' ? stepId : null) });

function markVerified(doc: GardenDocument, photoId: string, at: string): GardenDocument {
  return {
    ...doc,
    photos: doc.photos.map((p) =>
      p.id === photoId
        ? {
            ...p,
            exifDateTimeOriginal: at,
            originalFile: { fileName: `${p.id}.jpg`, size: 10, quickXorHash: 'h', contentType: 'image/jpeg', uploadStatus: 'verified', capturedAt: at, receivedAt: at },
          }
        : p,
    ),
  };
}

describe('Take photos pill goes straight to the camera', () => {
  it('each camera step pill carries its camera position id; Save baseline goes to baseline save', () => {
    const cases: Array<[string, string]> = [
      ['camera-calibration', 'Calibration'],
      ['camera-1', 'Position 1'],
      ['camera-2', 'Position 2'],
      ['camera-3', 'Position 3'],
      ['camera-4', 'Position 4'],
    ];
    for (const [stepId, cameraPositionId] of cases) {
      const result = handleWorkflowCommand('workflow-go', atStep(stepId), pill(stepId));
      expect(result.link).toEqual({ to: 'camera', stepId, cameraPositionId });
    }
    const baseline = handleWorkflowCommand('workflow-go', atStep('tape-baseline'), pill('tape-baseline'));
    expect(baseline.link).toEqual({ to: 'mode', mode: 'BASELINE' });
  });

  it('Retake goes to the camera too', () => {
    const doc = atStep('camera-calibration');
    const bad = rejectEvidenceWorkflow(readProgress(doc), 'camera-calibration', 'Not usable for focal length', NOW).progress;
    const result = handleWorkflowCommand('workflow-retake', commitWorkflow(doc, bad), pill('camera-calibration'));
    expect(result.link).toEqual({ to: 'camera', stepId: 'camera-calibration', cameraPositionId: 'Calibration' });
  });

  it('camera position point is created once, then reused (legacy CAL name counts)', () => {
    const first = ensureCameraPositionPoint(emptyDocument('x'), 'Right near');
    expect(first.created).toBe(true);
    expect(first.doc.points.find((p) => p.id === first.pointId)).toMatchObject({ kind: 'OCC', label: 'Right near' });
    const again = ensureCameraPositionPoint(first.doc, 'Right near');
    expect(again).toMatchObject({ created: false, pointId: first.pointId });
    expect(again.doc).toBe(first.doc);
  });

  it('chain: pill → point → photo saved with that point id → verified upload ticks the step', () => {
    let doc = atStep('camera-calibration');
    const link = handleWorkflowCommand('workflow-go', doc, pill('camera-calibration')).link;
    expect(link?.to).toBe('camera');
    if (link?.to !== 'camera') return;
    const ensured = ensureCameraPositionPoint(doc, link.cameraPositionId);
    const appended = appendPhotoToPoint(ensured.doc, ensured.pointId, { thumbnailDataUrl: THUMB, yawOnly: true, width: 4032, height: 3024 });
    expect(appended.reason).toBeUndefined();
    const photo = appended.doc.photos.at(-1)!;
    expect(photo.addPointId).toBe(ensured.pointId);
    doc = markVerified(appended.doc, photo.id, '2026-06-01T12:01:00.000Z');
    doc = workflowAfterUploadedPhoto(doc, photo.id, '2026-06-01T12:01:05.000Z');
    expect(readProgress(doc).runs['circle-field-test']?.steps['camera-calibration']?.status).toBe('ticked_by_app');
  });

  it('landscape at 1× only: portrait asks to turn the phone sideways, 2× is refused', () => {
    expect(checkCameraPositionPhoto({ width: 4032, height: 3024, zoom: 1 })).toMatchObject({ ok: true, orientation: 'landscape', zoom: 1 });
    const portrait = checkCameraPositionPhoto({ width: 3024, height: 4032, zoom: 1 });
    expect(portrait.ok).toBe(false);
    expect(portrait.message).toMatch(/^Turn the phone sideways/);
    expect(checkCameraPositionPhoto({ width: 4032, height: 3024, zoom: 2 }).ok).toBe(false);
    expect(checkCameraPositionPhoto({ width: 4032, height: 3024 }).ok).toBe(true);
  });
});
