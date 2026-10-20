/** Auto-filled taps from the whole-photo scan on the camera-position tap screen. */
import { describe, expect, it } from 'vitest';
import {
  applyAutoSleeves,
  beginAutoScan,
  canSaveTaps,
  needsAutoScan,
  placeTap,
  saveTapDraft,
  startTapDraft,
  tapBarView,
  undoTap,
  type PhotoTapPlan,
} from '../src/workflows/guided/photoTaps';
import type { ScannedSleeve } from '../src/workflows/guided/sleeveScan';
import type { GardenDocument } from '../src/model';

const plan: PhotoTapPlan = {
  photoId: 'ph-1',
  stepId: 'edge-photos',
  stepTitle: 'Camera position Left',
  cameraPositionId: 'Edge points',
  use: 'bearings',
  photoNumber: 1,
  photoCount: 2,
  targets: [
    { id: 'BAS01', label: 'BAS01' },
    { id: 'BAS02', label: 'BAS02' },
    { id: 'BAS03', label: 'BAS03', optional: true },
    { id: 'BAS05', label: 'BAS05', optional: true },
  ],
};

function sleeve(id: string, axisX: number, midY: number, bandPx = 9): ScannedSleeve {
  return { id, axisX, midY, tiltDeg: 6, slope: 0.1, bandPx, codeTopY: midY - 90, codeBottomY: midY + 90, widthPx: 4.65 * bandPx, edgeRmsBands: 0.05, confidence: 0.9, notForCal: bandPx < 7, codeCoverage: 0.8 };
}

describe('auto-filled taps', () => {
  it('a fresh camera-position photo asks for the scan; a calibration photo does not', () => {
    expect(needsAutoScan(startTapDraft(plan))).toBe(true);
    expect(needsAutoScan(startTapDraft({ ...plan, use: 'sleeve-height', targets: [{ id: 'SLEEVE', label: 'sleeve' }] }))).toBe(false);
    // Already marked: keep the user's taps, no scan.
    expect(needsAutoScan(startTapDraft(plan, [{ pointId: 'BAS01', px: 1, py: 2 }]))).toBe(false);
  });

  it('found sleeves become the taps for their points, labelled with the ID, and Save is ready', () => {
    let d = beginAutoScan(startTapDraft(plan));
    expect(tapBarView(d).prompt).toBe('Finding the canes…');
    expect(tapBarView(d).primaryEnabled).toBe(false);
    d = applyAutoSleeves(d, {
      sleeves: [sleeve('36E', 2000.4, 1500), sleeve('315', 1000.8, 1490), sleeve('8A3', 3000, 1480, 5), sleeve('DAC', 500, 1500)],
      duplicates: [],
      scaleX: 4,
      scaleY: 4,
    });
    // DAC (BAS07) is not a target of this photo: ignored.
    expect(d.taps.map((t) => t.pointId)).toEqual(['BAS01', 'BAS02', 'BAS05']);
    expect(d.taps[0]).toMatchObject({ px: 250.2, py: 372.5 });
    expect(d.auto!.pins.map((p) => p.label)).toEqual(['BAS01 · 315', 'BAS02 · 36E', 'BAS05 · 8A3']);
    expect(d.auto!.pins.find((p) => p.code === '8A3')!.record.notForCal).toBe(true);
    expect(canSaveTaps(d)).toBe(true);
    expect(tapBarView(d).prompt).toBe('Found BAS01, BAS02, BAS05. Tap BAS03 (3 of 4), or Save. Tap a pin to fix it.');
  });

  it('tap near a pin fixes it; a tap elsewhere adds the missed cane', () => {
    let d = applyAutoSleeves(beginAutoScan(startTapDraft(plan)), { sleeves: [sleeve('315', 1000, 1500), sleeve('36E', 2000, 1500)], duplicates: [], scaleX: 4, scaleY: 4 });
    d = placeTap(d, 255, 380, 24);
    expect(d.taps.find((t) => t.pointId === 'BAS01')).toMatchObject({ px: 255, py: 380 });
    expect(d.auto!.pins.find((p) => p.targetId === 'BAS01')!.moved).toBe(true);
    expect(d.taps).toHaveLength(2);
    d = placeTap(d, 100, 380, 24);
    expect(d.taps.find((t) => t.pointId === 'BAS03')).toMatchObject({ px: 100, py: 380 });
    // Undo removes the last target's tap, auto or not.
    d = undoTap(d);
    expect(d.taps.map((t) => t.pointId)).toEqual(['BAS01', 'BAS02']);
  });

  it('nothing found or no original: plain manual taps', () => {
    const none = applyAutoSleeves(beginAutoScan(startTapDraft(plan)), { sleeves: [], duplicates: ['315'], scaleX: 4, scaleY: 4 });
    expect(none.taps).toEqual([]);
    expect(tapBarView(none).prompt).toBe('No canes found. 315 seen twice: tap it. Tap BAS01 (1 of 4)');
    const gone = applyAutoSleeves(beginAutoScan(startTapDraft(plan)), { scaleX: 1, scaleY: 1, unavailable: 'The full-size photo is no longer on this phone.' });
    expect(gone.auto!.state).toBe('unavailable');
    expect(tapBarView(gone).prompt).toBe('Tap BAS01 (1 of 4)');
  });

  it('Save stores the scan on the photo and the clicks in target order', () => {
    const doc = { photos: [{ id: 'ph-1', width: 1008, height: 756 }], points: [{ id: 'p-bas01', label: 'BAS01' }, { id: 'p-bas02', label: 'BAS02' }] } as unknown as GardenDocument;
    let d = applyAutoSleeves(beginAutoScan(startTapDraft(plan)), { sleeves: [sleeve('36E', 2000, 1500), sleeve('315', 1000, 1500)], duplicates: [], scaleX: 4, scaleY: 4 });
    d = placeTap(d, 260, 375, 24);
    const saved = saveTapDraft(doc, d);
    expect(saved.clicks.map((c) => c.pointId)).toEqual(['p-bas01', 'p-bas02']);
    expect(saved.hasBothEnds).toBe(true);
    const rec = saved.doc.photos[0].autoSleeves!;
    expect(rec.map((r) => [r.pointName, r.id, r.confirmed])).toEqual([['BAS01', '315', false], ['BAS02', '36E', true]]);
    expect(saved.message).toBe('2 canes marked on Camera position Left. 1 found automatically.');
  });
});
