import { describe, expect, it, vi } from 'vitest';
import { appendPhotoToPoint } from '../src/layers';
import { emptyDocument, type GardenDocument } from '../src/model';
import { ensureCameraPositionPoint } from '../src/workflows/guided/cameraCapture';
import { circleFieldTest } from '../src/workflows/guided/definitions';
import {
  advanceWorkflow,
  commitWorkflow,
  confirmSetupWorkflow,
  emptyProgress,
  readProgress,
  scrollWorkflowToStep,
  startWorkflow,
} from '../src/workflows/guided/engine';
import { handleWorkflowCommand } from '../src/workflows/guided/guidedChrome';
import {
  canSaveTaps,
  clampTapZoom,
  nextTapTarget,
  applySleeveDetection,
  beginSleeveDetection,
  needsSleeveDetection,
  photoTapPlan,
  placeTap,
  saveTapDraft,
  screenToPhotoPx,
  skipTap,
  sleeveHeightPx,
  startTapDraft,
  tapBarView,
  undoTap,
  zoomTapViewAbout,
} from '../src/workflows/guided/photoTaps';

const NOW = '2026-06-01T12:00:00.000Z';
const THUMB = 'data:image/jpeg;base64,AAAA';

function atStep(stepId: string, doc: GardenDocument = emptyDocument('Circle day')): GardenDocument {
  let progress = startWorkflow(emptyProgress(), 'circle-field-test', NOW).progress;
  progress = confirmSetupWorkflow(progress, undefined, NOW).progress;
  progress = scrollWorkflowToStep(progress, stepId, NOW).progress;
  return commitWorkflow(doc, progress);
}

let clock = Date.parse('2026-06-01T12:05:00.000Z');

const pill = (stepId: string) => ({ getAttribute: (name: string) => (name === 'data-step' ? stepId : null) });

/** Roller pill → camera → photo saved on the camera position point. Returns the doc and photo id. */
function takePhoto(doc: GardenDocument, stepId: string): { doc: GardenDocument; photoId: string } {
  const link = handleWorkflowCommand('workflow-go', doc, pill(stepId)).link;
  if (link?.to !== 'camera') throw new Error(`${stepId}: pill did not open the camera`);
  const ensured = ensureCameraPositionPoint(doc, link.cameraPositionId);
  // Photo ids come from Date.now(); two shots in one millisecond would share an id.
  clock += 1000;
  const spy = vi.spyOn(Date, 'now').mockReturnValue(clock);
  const appended = appendPhotoToPoint(ensured.doc, ensured.pointId, { thumbnailDataUrl: THUMB, yawOnly: true, width: 640, height: 480 });
  spy.mockRestore();
  if (appended.reason) throw new Error(appended.reason);
  return { doc: appended.doc, photoId: appended.doc.photos.at(-1)!.id };
}

const photoSteps = circleFieldTest.steps.filter((s) => 'on' in s.complete && s.complete.on === 'photo.uploaded');

describe('tap screen after each guided photo', () => {
  it('every photo step defines its own taps and opens the camera, never the + Point dialog', () => {
    expect(photoSteps.map((s) => s.id)).toEqual(['camera-calibration', 'camera-left', 'camera-right-near', 'camera-right-far']);
    for (const step of photoSteps) {
      expect(step.photoTaps, step.id).toBeDefined();
      expect(step.link.to, step.id).toBe('camera');
      const min = 'on' in step.complete && step.complete.on === 'photo.uploaded' ? step.complete.minPhotos : 0;
      expect(step.photoTaps!.photos.length, step.id).toBe(min);
      for (const list of step.photoTaps!.photos) {
        for (const target of list) expect(['A', 'B', 'TARGET', 'T']).not.toContain(target.id);
      }
    }
  });

  it('calibration asks for one rough tap on the sleeve; confident detection draws the edges to accept', () => {
    const shot = takePhoto(atStep('camera-calibration'), 'camera-calibration');
    const plan = photoTapPlan(shot.doc, shot.photoId)!;
    expect(plan).toMatchObject({ stepId: 'camera-calibration', use: 'sleeve-height', photoNumber: 1, photoCount: 1 });
    expect(plan.targets.map((t) => t.id)).toEqual(['SLEEVE']);
    expect(plan.fallback?.map((t) => t.id)).toEqual(['SLEEVE-TOP', 'SLEEVE-BOTTOM']);
    let draft = startTapDraft(plan);
    let bar = tapBarView(draft);
    expect(bar.prompt).toBe('Tap once on the sleeve. The app finds its top and bottom edge.');
    expect(bar.title).toBe('Calibration photo (focal length)');
    expect(bar.secondary).toBeUndefined();
    expect(bar.primaryEnabled).toBe(false);
    expect(skipTap(draft)).toBe(draft);
    draft = placeTap(draft, 320, 220);
    expect(needsSleeveDetection(draft)).toBe(true);
    draft = beginSleeveDetection(draft);
    expect(tapBarView(draft).prompt).toBe('Finding the sleeve edges…');
    expect(tapBarView(draft).primaryEnabled).toBe(false);
    expect(placeTap(draft, 5, 5)).toBe(draft); // no taps while finding
    // Original is 6.3× the 640 px preview.
    draft = applySleeveDetection(draft, {
      scaleX: 6.3,
      scaleY: 6.3,
      detection: { topY: 1260, bottomY: 1474.2, topX: 2016, bottomX: 2016, heightPx: 214.2, codeTopY: 1272.7, codeBottomY: 1457, codeTopX: 2016, codeBottomX: 2016, codeLengthPx: 184.3, edgeRmsBands: 0.05, id: '315', modulePx: 9.7, upsideDown: false, confidence: 0.95, bits: '1111000110001010101', reasons: [] },
    });
    bar = tapBarView(draft);
    expect(bar.prompt).toMatch(/^Sleeve found/);
    expect(bar.primaryEnabled).toBe(true);
    expect(draft.taps.map((t) => t.pointId)).toEqual(['SLEEVE', 'SLEEVE-TOP', 'SLEEVE-BOTTOM']);
    expect(draft.detection?.top?.py).toBeCloseTo(200, 6);
    const saved = saveTapDraft(shot.doc, draft);
    const photo = saved.doc.photos.find((p) => p.id === shot.photoId)!;
    expect(photo.measureTaps?.map((t) => t.pointId)).toEqual(['SLEEVE', 'SLEEVE-TOP', 'SLEEVE-BOTTOM']);
    expect(photo.measureDetection).toMatchObject({ method: 'auto', confidence: 0.95, heightFullPx: 214.2, codeLengthFullPx: 184.3, codeTopFullPx: { x: 2016, y: 1272.7 }, id: '315' });
    expect(photo.clicks).toEqual([]); // not bearings: the solver never sees them
    expect(saved.message).toMatch(/Code \(247 mm\) is 184 px long/);
    expect(saved.message).toMatch(/confidence 95%/);
    // Reopening keeps the accepted edges; Undo goes back to the rough tap.
    let again = startTapDraft(plan, photo.measureTaps, photo.measureDetection);
    expect(again.detection?.state).toBe('found');
    again = undoTap(again);
    expect(again.taps).toEqual([]);
    expect(again.detection).toBeUndefined();
  });

  it('calibration falls back to manual top and bottom taps when detection is unsure', () => {
    const shot = takePhoto(atStep('camera-calibration'), 'camera-calibration');
    const plan = photoTapPlan(shot.doc, shot.photoId)!;
    let draft = beginSleeveDetection(placeTap(startTapDraft(plan), 320, 220));
    draft = applySleeveDetection(draft, {
      scaleX: 6.3,
      scaleY: 6.3,
      detection: { topY: 1, bottomY: 2, topX: 1, bottomX: 1, heightPx: 1, codeTopY: 1, codeBottomY: 2, codeTopX: 1, codeBottomX: 1, codeLengthPx: 1, edgeRmsBands: 0.5, modulePx: 2, upsideDown: false, confidence: 0.2, bits: '', reasons: ['sync not found'] },
    });
    expect(draft.detection?.state).toBe('unsure');
    expect(tapBarView(draft).prompt).toBe('Not sure of the edges (sync not found). Tap the top edge of the sleeve (1 of 2)');
    expect(tapBarView(draft).primaryEnabled).toBe(false);
    draft = placeTap(draft, 320, 200);
    expect(tapBarView(draft).prompt).toBe('Tap the bottom edge of the sleeve (2 of 2)');
    draft = placeTap(draft, 320, 234);
    expect(tapBarView(draft).primaryEnabled).toBe(true);
    expect(sleeveHeightPx(draft.taps)?.previewPx).toBe(34);
    const undone = undoTap(draft);
    expect(undone.taps.map((t) => t.pointId)).toEqual(['SLEEVE', 'SLEEVE-TOP']);
    const saved = saveTapDraft(shot.doc, draft);
    const photo = saved.doc.photos.find((p) => p.id === shot.photoId)!;
    expect(photo.measureDetection).toMatchObject({ method: 'manual', confidence: 0.2 });
    expect(saved.message).toMatch(/34 px tall/);
  });

  it('calibration with no original on the phone asks for manual taps', () => {
    const shot = takePhoto(atStep('camera-calibration'), 'camera-calibration');
    const plan = photoTapPlan(shot.doc, shot.photoId)!;
    let draft = beginSleeveDetection(placeTap(startTapDraft(plan), 320, 220));
    draft = applySleeveDetection(draft, { scaleX: 1, scaleY: 1, unavailable: 'The full-size photo is no longer on this phone.' });
    expect(tapBarView(draft).prompt).toMatch(/^The full-size photo is no longer on this phone\. Tap the top edge/);
  });

  const camera: Array<[string, string[][]]> = [
    ['camera-left', [['BAS01', 'BAS02', 'CRC01', 'CRC02', 'CRC03', 'CRC04', 'CRC05'], ['BAS02', 'CRC06']]],
    ['camera-right-near', [['BAS01', 'BAS02'], ['BAS02', 'CRC02', 'CRC01', 'CRC06', 'CRC03']]],
    ['camera-right-far', [['BAS01', 'BAS02', 'CRC01', 'CRC02', 'CRC03'], ['BAS02', 'CRC06', 'CRC05', 'CRC04']]],
  ];
  for (const [stepId, perPhoto] of camera) {
    it(`${stepId}: photo 1 and photo 2 ask for the canes the step names`, () => {
      let doc = atStep(stepId);
      const first = takePhoto(doc, stepId);
      const plan1 = photoTapPlan(first.doc, first.photoId)!;
      expect(plan1).toMatchObject({ stepId, use: 'bearings', photoNumber: 1, photoCount: 2 });
      expect(plan1.targets.map((t) => t.id)).toEqual(perPhoto[0]);
      expect(tapBarView(startTapDraft(plan1)).title).toMatch(/photo 1 of 2$/);
      doc = first.doc;
      const second = takePhoto(doc, stepId);
      const plan2 = photoTapPlan(second.doc, second.photoId)!;
      expect(plan2.photoNumber).toBe(2);
      expect(plan2.targets.map((t) => t.id)).toEqual(perPhoto[1]);
      // Baseline ends are required; circle canes can be passed.
      for (const t of [...plan1.targets, ...plan2.targets]) expect(!!t.optional).toBe(t.id.startsWith('CRC'));
    });
  }

  it('camera position: baseline ends must be tapped, canes can be Not in view, Undo steps back', () => {
    const shot = takePhoto(atStep('camera-left'), 'camera-left');
    let draft = startTapDraft(photoTapPlan(shot.doc, shot.photoId)!);
    expect(tapBarView(draft).prompt).toBe('Tap BAS01 (1 of 7)');
    expect(tapBarView(draft).secondary).toBeUndefined();
    draft = placeTap(draft, 10, 300);
    draft = placeTap(draft, 600, 300);
    expect(nextTapTarget(draft)?.id).toBe('CRC01');
    expect(canSaveTaps(draft)).toBe(true);
    expect(tapBarView(draft).secondary).toBe('Not in view');
    draft = skipTap(draft);
    expect(tapBarView(draft).prompt).toBe('Tap CRC02 (4 of 7)');
    draft = undoTap(draft);
    expect(nextTapTarget(draft)?.id).toBe('CRC01');
    draft = undoTap(draft);
    expect(nextTapTarget(draft)?.id).toBe('BAS02');
    expect(canSaveTaps(draft)).toBe(false);
  });

  it('camera position taps are stored as clicks on the garden point ids', () => {
    let base = emptyDocument('Circle day');
    base = { ...base, points: [...base.points, { id: 'P-BAS01', kind: 'BASE', label: 'BAS01' } as never] };
    const shot = takePhoto(atStep('camera-right-near', base), 'camera-right-near');
    let draft = startTapDraft(photoTapPlan(shot.doc, shot.photoId)!);
    draft = placeTap(draft, 100, 200);
    draft = placeTap(draft, 500, 210);
    const saved = saveTapDraft(shot.doc, draft);
    expect(saved.hasBothEnds).toBe(true);
    expect(saved.clicks).toEqual([
      { pointId: 'P-BAS01', px: 100, py: 200 },
      { pointId: 'BAS02', px: 500, py: 210 },
    ]);
  });

  it('a photo not on a guided step keeps the old screen (no plan)', () => {
    const doc = atStep('camera-left');
    const ensured = ensureCameraPositionPoint(doc, 'Shed corner');
    const appended = appendPhotoToPoint(ensured.doc, ensured.pointId, { thumbnailDataUrl: THUMB, width: 640, height: 480 });
    expect(photoTapPlan(appended.doc, appended.doc.photos.at(-1)!.id)).toBeUndefined();
  });
});

describe('roller Next / Later only move the cursor', () => {
  it('moving onto a photo step or Save baseline opens nothing by itself', () => {
    for (const from of ['plumb-canes', 'camera-calibration', 'camera-left', 'camera-right-near', 'laser-check-baseline', 'place-baseline-points']) {
      const progress = readProgress(atStep(from));
      const move = advanceWorkflow(progress, NOW);
      expect(move.changed, from).toBe(true);
      expect(move.link, from).toBeUndefined();
    }
  });
});

describe('tap screen zoom', () => {
  it('pinch zoom is clamped 1–8× and keeps the pinch point still', () => {
    expect(clampTapZoom(0.2)).toBe(1);
    expect(clampTapZoom(20)).toBe(8);
    const v = zoomTapViewAbout({ scale: 1, x: 0, y: 0 }, 2, 100, 50);
    expect(v).toEqual({ scale: 2, x: -100, y: -50 });
    // The content point under (100, 50) stays there: (100 - x) / scale is unchanged.
    expect((100 - v.x) / v.scale).toBe(100);
    expect(zoomTapViewAbout(v, 0.5, 0, 0)).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it('a tap maps to photo pixels through the zoomed box; outside the photo is ignored', () => {
    const box = { left: -200, top: -100, width: 1600, height: 1200 }; // 640×480 photo at 2.5×
    expect(screenToPhotoPx(600, 500, box, { width: 640, height: 480 })).toEqual({ px: 320, py: 240 });
    expect(screenToPhotoPx(-300, 0, box, { width: 640, height: 480 })).toBeUndefined();
  });
});
