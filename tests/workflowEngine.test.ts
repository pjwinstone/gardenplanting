import { describe, expect, it } from 'vitest';
import { emptyDocument, normalizeDocument, type GardenDocument, type Photo } from '../src/model';
import { circleFieldTest, printFitMarkers } from '../src/workflows/guided/definitions';
import {
  advanceWorkflow,
  applyWorkflowEvent,
  backWorkflow,
  countVerifiedUsablePhotos,
  doneWorkflow,
  emptyProgress,
  nameMatchesStation,
  noteWorkflow,
  readProgress,
  reconcileRun,
  reduceRun,
  resumeWorkflow,
  startWorkflow,
  tickWorkflow,
  withWorkflowEvent,
  workflowAfterVerifiedPhoto,
} from '../src/workflows/guided/engine';
import type { WorkflowDefinition, WorkflowEvent, WorkflowRun } from '../src/workflows/guided/types';

const NOW = '2026-06-01T12:00:00.000Z';
const LATER = '2026-06-01T12:05:00.000Z';

function started(id: 'circle-field-test' | 'print-fit-markers' = 'circle-field-test') {
  return startWorkflow(emptyProgress(), id, NOW).progress;
}

function photo(id: string, pointId: string, status: 'verified' | 'failed', note?: string): Photo {
  return {
    id,
    setupId: 'setup-1',
    addPointId: pointId,
    width: 100,
    height: 80,
    clicks: [],
    originalFile: {
      fileName: `${id}.jpg`,
      size: 10,
      quickXorHash: 'hash',
      contentType: 'image/jpeg',
      uploadStatus: status,
      usabilityNote: note,
    },
  };
}

function stationDoc(photos: Photo[]): GardenDocument {
  const doc = emptyDocument('Circle');
  doc.objects = [{
    id: 'obj-stn',
    layerId: 'survey',
    name: 'STN01',
    geometryType: 'point',
    measuredPointIds: ['P01'],
    selectedPointIds: [],
  }];
  doc.points = [{ id: 'P01', kind: 'OCC', label: 'STN01 1', objectId: 'obj-stn', photoIds: photos.map((item) => item.id) }];
  doc.photos = photos;
  return doc;
}

describe('guided workflow engine', () => {
  it('ports the circle sheet and the marker sheet, and leaves the other two for later', () => {
    expect(circleFieldTest.steps).toHaveLength(12);
    expect(printFitMarkers.steps).toHaveLength(7);
    expect(new Set(circleFieldTest.steps.map((step) => step.id)).size).toBe(12);
    const later = startWorkflow(emptyProgress(), 'house-traverse', NOW);
    expect(later.changed).toBe(false);
    expect(later.notice).toMatch(/coming soon/i);
    expect(startWorkflow(emptyProgress(), 'ios-setup', NOW).changed).toBe(false);
  });

  it('ticks by hand, including a step the app can detect, and labels that tick manual', () => {
    const progress = started();
    const ticked = tickWorkflow(progress, 'stn01', undefined, NOW);
    const step = ticked.progress.runs['circle-field-test']?.steps.stn01;
    expect(step).toMatchObject({ status: 'complete', completedBy: 'manual' });
    const again = applyWorkflowEvent(ticked.progress, {
      type: 'photo.verified',
      stationId: 'STN01',
      pointLabel: 'STN01 1',
      objectName: 'STN01',
      photoCount: 2,
    }, LATER);
    expect(again.runs['circle-field-test']?.steps.stn01?.completedBy).toBe('auto');
  });

  it('auto-completes STN01 only after two usable verified photos', () => {
    expect(nameMatchesStation('STN01 1', 'STN01')).toBe(true);
    expect(nameMatchesStation('STN010', 'STN01')).toBe(false);
    expect(nameMatchesStation('STN01-extra', 'STN01')).toBe(true);

    const one = stationDoc([photo('a', 'P01', 'verified'), photo('b', 'P01', 'verified', 'Not usable for focal length.')]);
    let doc: GardenDocument = { ...one, workflowProgress: started() };
    expect(countVerifiedUsablePhotos(doc, 'STN01')).toBe(1);
    doc = workflowAfterVerifiedPhoto(doc, 'a', NOW);
    expect(doc.workflowProgress?.runs['circle-field-test']?.steps.stn01?.status).toBe('pending');

    const two = stationDoc([photo('a', 'P01', 'verified'), photo('b', 'P01', 'verified')]);
    doc = { ...two, workflowProgress: doc.workflowProgress };
    doc = workflowAfterVerifiedPhoto(doc, 'b', LATER);
    expect(doc.workflowProgress?.runs['circle-field-test']?.steps.stn01).toMatchObject({
      status: 'complete',
      completedBy: 'auto',
    });
  });

  it('needs both baseline pulls in the note and a tape save with zero offsets', () => {
    let progress = started();
    const saved: WorkflowEvent = {
      type: 'baseline.saved',
      endA: 'BAS01',
      endB: 'BAS02',
      endAId: 'HSE01',
      endBId: 'HSE02',
      kind: 'tape',
      offsetAMm: 0,
      offsetBMm: 0,
      lengthM: 8,
    };
    progress = applyWorkflowEvent(progress, saved, NOW);
    expect(progress.runs['circle-field-test']?.steps['tape-baseline']?.status).toBe('pending');
    expect(progress.runs['circle-field-test']?.steps['tape-baseline']?.seen?.length).toBeGreaterThan(0);

    const swapped = applyWorkflowEvent(started(), { ...saved, endA: 'BAS02', endB: 'BAS01' }, NOW);
    expect(swapped.runs['circle-field-test']?.steps['tape-baseline']?.seen).toBeUndefined();

    const offset = applyWorkflowEvent(started(), { ...saved, offsetAMm: 12 }, NOW);
    expect(offset.runs['circle-field-test']?.steps['tape-baseline']?.seen).toBeUndefined();

    progress = noteWorkflow(progress, 'tape-baseline', '8.002 and 8.006', LATER).progress;
    expect(progress.runs['circle-field-test']?.steps['tape-baseline']).toMatchObject({
      status: 'complete',
      completedBy: 'auto',
      note: '8.002 and 8.006',
    });
  });

  it('a hand tick finishes an all-step even when the app has not seen the save', () => {
    const progress = tickWorkflow(started(), 'tape-baseline', undefined, NOW).progress;
    expect(progress.runs['circle-field-test']?.steps['tape-baseline']?.completedBy).toBe('manual');
  });

  it('does not tick Save and send until that step is the current one, and a second save is a no-op', () => {
    const early = applyWorkflowEvent(started(), { type: 'cloud.saved' }, NOW);
    expect(early.runs['circle-field-test']?.steps['save-send']?.status).toBe('pending');

    let progress = started();
    for (let i = 0; i < 11; i += 1) progress = advanceWorkflow(progress, NOW).progress;
    expect(progress.runs['circle-field-test']?.currentStepId).toBe('save-send');
    const doc = emptyDocument();
    doc.workflowProgress = progress;
    const once = withWorkflowEvent(doc, { type: 'cloud.saved' }, LATER);
    expect(once).not.toBe(doc);
    expect(once.workflowProgress?.runs['circle-field-test']?.steps['save-send']?.completedBy).toBe('auto');
    const twice = withWorkflowEvent(once, { type: 'cloud.saved' }, '2026-06-01T12:06:00.000Z');
    expect(twice).toBe(once);
  });

  it('resumes after a JSON round trip and parks step ids the sheet no longer has', () => {
    let progress = tickWorkflow(started(), 'kit', undefined, NOW).progress;
    progress = advanceWorkflow(progress, NOW).progress;
    const doc = emptyDocument('Field');
    doc.workflowProgress = progress;
    const loaded = normalizeDocument(JSON.parse(JSON.stringify(doc)) as GardenDocument);
    const resumed = resumeWorkflow(readProgress(loaded), 'circle-field-test', LATER).progress;
    const run = resumed.runs['circle-field-test'];
    expect(run?.steps.kit?.status).toBe('complete');
    expect(run?.currentStepId).toBe('set-out');
    expect(resumed.activeId).toBe('circle-field-test');

    const stale: WorkflowRun = {
      ...run!,
      revision: 0,
      steps: { ...run!.steps, 'old-chord': { status: 'complete', completedBy: 'manual' } },
    };
    const parked = reconcileRun(circleFieldTest, stale);
    expect(parked.steps['old-chord']).toBeUndefined();
    expect(parked.parkedStepIds).toEqual(['old-chord']);
    expect(parked.revision).toBe(circleFieldTest.revision);
  });

  it('refuses to finish while a step is open, then finishes and steps back without unticking', () => {
    let progress = started();
    const blocked = doneWorkflow(progress, NOW);
    expect(blocked.changed).toBe(false);
    expect(blocked.notice).toMatch(/open/);
    for (const step of circleFieldTest.steps) {
      progress = tickWorkflow(progress, step.id, undefined, NOW).progress;
    }
    progress = doneWorkflow(progress, LATER).progress;
    expect(progress.runs['circle-field-test']?.finishedAt).toBe(LATER);
    expect(progress.activeId).toBe('circle-field-test');
    const cleared = doneWorkflow(progress, LATER).progress;
    expect(cleared.activeId).toBeUndefined();
    expect(cleared.runs['circle-field-test']?.steps.kit?.status).toBe('complete');

    let walking = advanceWorkflow(started(), NOW).progress;
    walking = backWorkflow(walking, LATER).progress;
    expect(walking.runs['circle-field-test']?.currentStepId).toBe('kit');
  });

  it('matches tape, item, and confirmed marks on a one-step definition', () => {
    const run = (id: string): WorkflowRun => ({
      workflowId: 'circle-field-test',
      revision: 1,
      currentStepId: id,
      updatedAt: NOW,
      steps: { [id]: { status: 'pending', completedBy: null } },
    });
    const def = (id: string, complete: WorkflowDefinition['steps'][number]['complete']): WorkflowDefinition => ({
      id: 'circle-field-test',
      revision: 1,
      status: 'ready',
      title: 'Probe',
      summary: '',
      steps: [{ id, title: id, instruction: id, detail: [], complete, link: { to: 'none' } }],
    });
    const taped = reduceRun(def('tape', { on: 'tape.entered', endA: 'BAS01', endB: 'BAS02' }), run('tape'), {
      type: 'tape.entered',
      endA: 'bas01',
      endB: 'BAS02',
      lengthM: 8,
    }, NOW);
    expect(taped.steps.tape?.status).toBe('complete');
    const created = reduceRun(def('item', { on: 'item.created', name: 'Circle', geometry: 'circle' }), run('item'), {
      type: 'item.created',
      name: 'circle',
      geometry: 'circle',
    }, NOW);
    expect(created.steps.item?.completedBy).toBe('auto');
    const marked = reduceRun(
      def('marks', { on: 'photo.marksConfirmed', stationId: 'STN01', marks: ['A', 'B'] }),
      run('marks'),
      { type: 'photo.marksConfirmed', stationId: 'P01', pointLabel: 'STN01 1', objectName: 'STN01', marks: ['A', 'B'] },
      NOW,
    );
    expect(marked.steps.marks?.status).toBe('complete');
  });
});
