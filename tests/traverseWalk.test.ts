/**
 * Walk round the house: agreed gates, a simulated loop through the workflow
 * events, and the block on removing the datum ends.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { emptyDocument, type GardenDocument, type Photo, type PointKind } from '../src/model';
import { deletePointMeasurement } from '../src/layers';
import type { SolveInput } from '../src/solver/types';
import { saveBaselineLengthWorkflow } from '../src/workflows/establishBaseline';
import { handleWorkflowCommand } from '../src/workflows/guided/guidedChrome';
import { advanceWorkflow, commitWorkflow, readProgress, startWorkflow, tickWorkflow, withWorkflowEvent } from '../src/workflows/guided/engine';
import {
  blockedLine,
  classifyGate,
  closeWalk,
  CROSS_TIE_PROMPT,
  GOOD_LEG,
  LOOP_CLOSES,
  nextTraverse,
  noteTraverseDocument,
  RAW_GAP_NOTE,
  restartHouseWalk,
  saveWalkPhoto,
  saveWalkTape,
  singleSetupWarning,
  TAPE_MISTAKE_LINE,
  walkView,
} from '../src/workflows/guided/traverseWalk';
import type { FieldStatus } from '../src/workflows/guided/types';
import type { WorkflowEvent } from '../src/workflows/guided/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = '2026-10-10T12:00:00.000Z';

function gardenFromFixture(name: string): GardenDocument {
  const fixture = JSON.parse(readFileSync(join(root, 'fixtures/traverse', name), 'utf8')) as { input: SolveInput };
  const input = fixture.input;
  const doc = emptyDocument('Walk round');
  const ids = new Set<string>([input.datum.originId, input.datum.axisPointId]);
  for (const distance of input.distances ?? []) {
    ids.add(distance.a);
    ids.add(distance.b);
  }
  for (const photo of input.photos ?? []) {
    ids.add(photo.stationId);
    for (const click of photo.clicks) ids.add(click.pointId);
  }
  doc.points = [...ids].map((id) => ({
    id,
    kind: (id.startsWith('S') ? 'OCC' : 'HSE') as PointKind,
    label: id,
  }));
  doc.baselines = [{
    id: 'datum',
    a: input.datum.originId,
    b: input.datum.axisPointId,
    lengthM: input.datum.lengthM,
    sigmaM: input.datum.sigmaM,
    kind: 'tape',
  }];
  doc.lines = (input.distances ?? []).map((distance) => ({
    id: distance.id,
    a: distance.a,
    b: distance.b,
    lengthM: distance.slopeM,
    sigmaM: distance.sigmaM,
    kind: 'tape' as const,
    step: distance.step,
    role: distance.role,
    runId: NOW,
    recordedAt: NOW,
  }));
  doc.photos = (input.photos ?? []).map((photo) => ({
    id: photo.id,
    setupId: 'walk',
    stationId: photo.stationId,
    width: photo.width,
    height: photo.height,
    fxOverWidth: photo.fxOverWidth,
    fxRelativeUncertainty: photo.fxRelativeUncertainty,
    sigmaPx: photo.sigmaPx,
    sigmaCentringM: photo.sigmaCentringM,
    gravity: photo.gravity,
    clicks: photo.clicks.map((click) => ({ pointId: click.pointId, px: click.px, py: click.py })),
    step: photo.step,
    role: photo.role,
    closing: photo.closing,
    phoneId: 'ph1',
    lens: '1x',
    runId: NOW,
    originalFile: {
      fileName: `${photo.id}.jpg`,
      size: 1,
      quickXorHash: 'fixture',
      uploadStatus: 'verified' as const,
      capturedAt: NOW,
      receivedAt: NOW,
    },
  }));
  doc.setups = [{ id: 'walk', startedAt: NOW, liveRodIds: [] }];
  return doc;
}

function begin(doc: GardenDocument): GardenDocument {
  const started = startWorkflow(readProgress(doc), 'house-traverse', NOW);
  const committed = commitWorkflow(doc, started.progress);
  return withWorkflowEvent(committed, {
    type: 'baseline.saved',
    endA: 'C1',
    endB: 'C2',
    endAId: 'C1',
    endBId: 'C2',
    kind: 'tape',
    offsetAMm: 0,
    offsetBMm: 0,
    lengthM: 13,
  } satisfies WorkflowEvent, NOW);
}

function stepId(doc: GardenDocument): string | undefined {
  return readProgress(doc).runs['house-traverse']?.currentStepId;
}

function live(doc: GardenDocument): string {
  return walkView(doc).lines.join('\n');
}

function status(doc: GardenDocument): FieldStatus | undefined {
  return walkView(doc).status;
}

function expectHeadline(doc: GardenDocument, mark: string, low: number, high: number): void {
  const mm = Math.round(status(doc)?.accuracyMm ?? NaN);
  expect(status(doc)?.headline).toBe(`${mark} ± ${mm} mm (95%, target ± 100 mm)`);
  expect(mm).toBeGreaterThanOrEqual(low);
  expect(mm).toBeLessThanOrEqual(high);
  expect(status(doc)?.targetMm).toBe(100);
  expect(status(doc)?.note).toBe(TAPE_MISTAKE_LINE);
}

const noDom = { getAttribute: () => null };

describe('walk round the house', () => {
  it('blocks the next leg on the agreed ray, cross-tie, and tape MDB gates', () => {
    const cross = { id: 'c', kind: 'tape' as const, redundancy: 0.34, mdb: 0.021246 };
    const ray = { id: 'r', kind: 'ray' as const, redundancy: 0.136, mdb: 0.00741 };
    const roles = [{ id: 'c', role: 'cross' }];
    expect(classifyGate([ray, cross], roles).ok).toBe(true);

    const lowRay = classifyGate([{ ...ray, redundancy: 0.12 }, cross], roles);
    expect(lowRay.ok).toBe(false);
    expect(lowRay.prompt).toBe(CROSS_TIE_PROMPT);

    const lowCross = classifyGate([ray, { ...cross, redundancy: 0.3 }], roles);
    expect(lowCross.ok).toBe(false);
    expect(lowCross.prompt).toMatch(/cross-tie/i);

    const fatTape = classifyGate([ray, { ...cross, mdb: 0.0214 }], roles);
    expect(fatTape.ok).toBe(false);
    expect(fatTape.tapeMdbMm).toBeCloseTo(21.4, 5);
  });

  it('warns when a house mark is seen from one setup', () => {
    const doc = emptyDocument();
    const photo = (id: string, station: string, pointId: string, step = 0) => ({
      id,
      setupId: 'walk',
      stationId: station,
      cameraSetupId: station,
      width: 10,
      height: 10,
      clicks: [{ pointId, px: 1, py: 1 }],
      step,
    });
    doc.photos = [photo('a', 'S0', 'H2')];
    expect(singleSetupWarning(doc, 0)).toBe('Re-shoot H2 from here; you will not see it again.');
    doc.photos = [photo('a', 'S0', 'H2'), photo('b', 'S1', 'H2')];
    expect(singleSetupWarning(doc, 0)).toBeNull();
    doc.photos = [photo('a', 'S0', 'C3'), photo('b', 'S0', 'H2', 2)];
    expect(singleSetupWarning(doc, 1)).toBeNull();
  });

  it('walks the open prefixes, then the closed loop, through the workflow events', () => {
    let doc = begin(gardenFromFixture('loop4ct-steps.json'));
    expect(doc.houseTraverse?.markOrder).toEqual(['C1', 'C2']);
    expect(doc.houseTraverse?.status).toBe('open');
    expect(readProgress(doc).runs['house-traverse']?.steps.datum?.status).toBe('complete');

    let move = nextTraverse(doc, NOW);
    expect(stepId(move.doc)).toBe('leg');

    doc = withWorkflowEvent(move.doc, { type: 'traverse.observe', step: 0, newestId: 'C2' }, NOW);
    expect(live(doc)).toMatch(/C2 1σ ellipse 3\.1 mm/);
    expect(doc.traverseLegs?.some((leg) => leg.id === 'leg-0' && leg.from === 'C1' && leg.to === 'C2')).toBe(true);
    expect(doc.traverseSetups?.length).toBeGreaterThan(0);

    doc = withWorkflowEvent(doc, { type: 'traverse.observe', step: 2, newestId: 'C4' }, NOW);
    const held = nextTraverse(doc, NOW);
    expect(held.notice).toMatch(/Re-tape|cross-tie/i);
    expect(status(held.doc)?.tone).toBe('amber');
    expect(status(held.doc)?.blocked).toBe(true);
    expect(status(held.doc)?.line).toMatch(/^Re-tape \S+ → \S+$/);
    expectHeadline(held.doc, 'C4', 171, 171);
    expect(stepId(held.doc)).toBe('leg');
    expect(readProgress(held.doc).runs['house-traverse']?.steps.leg?.status).not.toBe('complete');
    expect(live(held.doc)).toMatch(/Add a cross-tie before the next leg/);

    doc = withWorkflowEvent(held.doc, { type: 'traverse.observe', step: 3, newestId: 'C4' }, NOW);
    expect(status(doc)?.tone).toBe('green');
    expect(status(doc)?.blocked).toBe(false);
    expect(status(doc)?.line).toBe(GOOD_LEG);
    expectHeadline(doc, 'C4', 15, 15);
    doc = withWorkflowEvent(doc, { type: 'traverse.close' }, NOW);
    expect(doc.houseTraverse?.closeRequested).toBe(true);
    move = nextTraverse(doc, NOW);
    expect(move.notice).toMatch(/read the closure/i);
    expect(stepId(move.doc)).toBe('close');
    expect(readProgress(move.doc).runs['house-traverse']?.steps.leg?.status).toBe('complete');
    expect(readProgress(move.doc).runs['house-traverse']?.steps.close?.status).toBe('complete');
    expect(move.doc.houseTraverse?.status).toBe('closed');
  }, 120_000);

  it('reviews the duplicate-point closure after the same events', () => {
    let doc = begin(gardenFromFixture('loop4ct-dup.json'));
    doc = nextTraverse(doc, NOW).doc;
    doc = withWorkflowEvent(doc, { type: 'traverse.observe', step: 3, newestId: 'C4' }, NOW);
    doc = withWorkflowEvent(doc, { type: 'traverse.close' }, NOW);
    const ontoClose = nextTraverse(doc, NOW);
    expect(ontoClose.notice ?? status(ontoClose.doc)?.line ?? '').toMatch(/cross-tie|read the closure|Tape to C1/i);
    expect(stepId(ontoClose.doc)).toBe('close');
    const review = nextTraverse(ontoClose.doc, NOW);
    expect(stepId(review.doc)).toBe('closure-review');
    const mis = walkView(review.doc).misclosure;
    expect(review.doc.traverseMisclosure).toBeUndefined();
    expect(mis?.rank).toBe(6);
    expect(mis?.chi2 ?? 1).toBeLessThan(1e-4);
    expect(mis?.rawMisclosureIsBlunderTest).toBe(false);
    expect(mis?.positionPass).toBe(true);
    expect(mis?.azimuthPass).toBe(true);
    const text = live(review.doc);
    const millimetres = [...text.matchAll(/1σ ([0-9.]+) mm/g)].map((match) => Number(match[1]));
    expect(Math.abs(millimetres[0] - 57)).toBeLessThan(1.5);
    expect(Math.abs(millimetres[1] - 48.2)).toBeLessThan(1.5);
    const azimuth = text.match(/1σ ([0-9.]+)°/);
    expect(Math.abs(Number(azimuth?.[1]) - 0.493)).toBeLessThan(0.02);
    expect(text).toMatch(/Variance factor/);
    expect(text).toMatch(/dof /);
    expect(text).toMatch(/rank 6/);
    expect(text).toMatch(/position χ² pass/);
    expect(text).toMatch(/The raw misclosure is not a blunder test/);
    expect(status(review.doc)?.line).toBe(LOOP_CLOSES);
    expect(status(review.doc)?.note).toBe(RAW_GAP_NOTE);
    expect(status(review.doc)?.blocked).toBe(false);
    expect(readProgress(review.doc).runs['house-traverse']?.steps['closure-review']?.status).toBe('complete');
  }, 120_000);

  it('refuses Tick anyway while a leg is blocked, including a corner seen once', () => {
    let doc = begin(gardenFromFixture('loop4ct-steps.json'));
    doc = nextTraverse(doc, NOW).doc;
    doc = withWorkflowEvent(doc, { type: 'traverse.observe', step: 2, newestId: 'C4' }, NOW);
    const held = nextTraverse(doc, NOW);
    expect(status(held.doc)?.blocked).toBe(true);
    const ticked = handleWorkflowCommand('workflow-tick', held.doc, noDom);
    expect(ticked.doc).toBeUndefined();
    expect(readProgress(held.doc).runs['house-traverse']?.steps.leg?.status).not.toBe('complete');
    expect(stepId(nextTraverse(held.doc, NOW).doc)).toBe('leg');

    let red = begin(gardenFromFixture('loop4ct-steps.json'));
    red.photos = red.photos.map((photo) => ({
      ...photo,
      clicks: photo.clicks.filter((click) => click.pointId !== 'C4' || photo.stationId === 'S2'),
    }));
    red = nextTraverse(red, NOW).doc;
    red = withWorkflowEvent(red, { type: 'traverse.observe', step: 2, newestId: 'C4' }, NOW);
    expect(status(red)?.tone).toBe('red');
    expect(status(red)?.line).toBe(blockedLine('C4'));
    expect(status(red)?.blocked).toBe(true);
    expect(handleWorkflowCommand('workflow-tick', red, noDom).doc).toBeUndefined();
    expect(stepId(nextTraverse(red, NOW).doc)).toBe('leg');
  }, 120_000);

  it('names a flagged tape when the loop does not close', () => {
    let doc = begin(gardenFromFixture('loop4ct-dup.json'));
    const tape = doc.lines.find((line) => line.id === 't1-C2-C3');
    expect(tape?.lengthM).toBeGreaterThan(0);
    if (tape) tape.lengthM = (tape.lengthM ?? 0) + 0.5;
    doc = nextTraverse(doc, NOW).doc;
    doc = withWorkflowEvent(doc, { type: 'traverse.observe', step: 3, newestId: 'C4' }, NOW);
    doc = withWorkflowEvent(doc, { type: 'traverse.close' }, NOW);
    doc = nextTraverse(doc, NOW).doc;
    const review = nextTraverse(doc, NOW);
    expect(stepId(review.doc)).toBe('closure-review');
    expect(status(review.doc)?.tone).toBe('red');
    expect(status(review.doc)?.blocked).toBe(true);
    expect(status(review.doc)?.line).toBe("Loop doesn't close — likely blunder at C2–C3 (re-tape C2 → C3)");
    expect(status(review.doc)?.note).toBe(RAW_GAP_NOTE);
    expect(live(review.doc)).toMatch(/The raw misclosure is not a blunder test/);
    expect(handleWorkflowCommand('workflow-tick', review.doc, noDom).doc).toBeUndefined();
    expect(stepId(nextTraverse(review.doc, NOW).doc)).toBe('closure-review');
  }, 120_000);

  it('refuses to remove C1 or C2 while the loop is open', () => {
    const doc = emptyDocument();
    doc.points = [
      { id: 'C1', kind: 'HSE' },
      { id: 'C2', kind: 'HSE' },
      { id: 'C3', kind: 'HSE' },
    ];
    doc.baselines = [{ id: 'datum', a: 'C1', b: 'C2', lengthM: 13, kind: 'tape' }];
    doc.houseTraverse = { id: 't', markOrder: ['C1', 'C2'], status: 'open' };
    const blocked = deletePointMeasurement(doc, 'C1');
    expect(blocked.reason).toMatch(/datum end/);
    expect(blocked.reason).not.toMatch(/baseline end/);
    expect(blocked.doc.points.some((point) => point.id === 'C1')).toBe(true);
    const other = deletePointMeasurement(blocked.doc, 'C2');
    expect(other.reason).toMatch(/C2 stays until the loop is closed/);
    const free = deletePointMeasurement(doc, 'C3');
    expect(free.reason ?? '').not.toMatch(/datum end/);
    expect(free.doc.points.some((point) => point.id === 'C3')).toBe(false);
    const closed = deletePointMeasurement(
      { ...doc, houseTraverse: { ...doc.houseTraverse, status: 'closed' } },
      'C1',
    );
    expect(closed.reason ?? '').not.toMatch(/datum end/);
    expect(closed.reason).toMatch(/baseline end/);
  });

  it('does not pass an empty gate', () => {
    expect(classifyGate([], []).ok).toBe(false);
    let doc = begin(gardenFromFixture('loop4ct-steps.json'));
    doc = nextTraverse(doc, NOW).doc;
    expect(status(doc)?.tone).not.toBe('green');
    expect(status(doc)?.blocked).toBe(true);
    expect(status(doc)?.line).toBe('Tape the new corner before the next leg.');
  });

  it('tags tapes and photos through the save handlers, and closes from the button', () => {
    let doc = emptyDocument('Handlers');
    const started = startWorkflow(readProgress(doc), 'house-traverse', NOW);
    doc = commitWorkflow(doc, started.progress);
    const saved = saveBaselineLengthWorkflow(doc, 4, 0, 0, true);
    expect(saved.ok).toBe(true);
    const baseline = saved.doc.baselines[0];
    doc = withWorkflowEvent(saved.doc, {
      type: 'baseline.saved',
      endA: baseline.a,
      endB: baseline.b,
      endAId: baseline.a,
      endBId: baseline.b,
      kind: 'tape',
      offsetAMm: 0,
      offsetBMm: 0,
      lengthM: 4,
    }, NOW);
    expect(doc.houseTraverse?.runId).toBe(NOW);
    expect(doc.houseTraverse?.markOrder).toEqual([baseline.a, baseline.b]);
    doc = nextTraverse(doc, NOW).doc;
    expect(stepId(doc)).toBe('leg');
    doc = saveWalkTape(doc, { a: baseline.b, b: 'HSE03', lengthM: 3, role: 'leg' }, NOW);
    const tape = doc.lines.find((line) => line.a === baseline.b && line.b === 'HSE03');
    expect(tape?.runId).toBe(NOW);
    expect(tape?.step).toBe(0);
    expect(tape?.role).toBe('leg');
    expect(tape?.recordedAt).toBe(NOW);
    expect(doc.houseTraverse?.newestId).toBe('HSE03');
    const photo: Photo = {
      id: 'ph-real',
      setupId: 'walk',
      stationId: baseline.b,
      width: 200,
      height: 150,
      fxOverWidth: 0.8,
      clicks: [
        { pointId: baseline.a, px: 40, py: 70 },
        { pointId: 'HSE03', px: 150, py: 70 },
      ],
      phoneId: 'ph1',
      lens: '1x',
      originalFile: {
        fileName: 'ph-real.jpg',
        size: 12,
        quickXorHash: 'hash',
        uploadStatus: 'verified',
        capturedAt: NOW,
        receivedAt: NOW,
      },
    };
    doc = saveWalkPhoto(doc, photo);
    const savedPhoto = doc.photos.find((item) => item.id === 'ph-real');
    expect(savedPhoto?.runId).toBe(NOW);
    expect(savedPhoto?.step).toBe(0);
    expect(savedPhoto?.role).toBe('leg');
    expect(savedPhoto?.stationId).toBe(baseline.b);
    doc = withWorkflowEvent(doc, {
      type: 'photo.uploaded',
      photoIds: ['ph-real'],
      stationId: baseline.b,
      pointLabel: 'HSE03',
      objectName: 'House',
      photoCount: 1,
    }, NOW);
    expect(doc.photos.find((item) => item.id === 'ph-real')?.runId).toBe(NOW);
    const closed = handleWorkflowCommand('workflow-close-loop', doc, noDom);
    expect(closed.doc?.houseTraverse?.closeRequested).toBe(true);
    expect(closeWalk(doc, NOW).houseTraverse?.closeRequested).toBe(true);
    expect(readProgress(doc).runs['house-traverse']?.fieldStatus).toBeUndefined();
  });

  it('re-checks after Back, and Start over releases the datum lock', () => {
    let doc = begin(gardenFromFixture('loop4ct-steps.json'));
    doc = nextTraverse(doc, NOW).doc;
    doc = withWorkflowEvent(doc, { type: 'traverse.observe', step: 2, newestId: 'C4' }, NOW);
    expect(status(doc)?.blocked).toBe(true);
    const backed = handleWorkflowCommand('workflow-back', doc, noDom);
    expect(backed.doc).toBeDefined();
    expect(stepId(backed.doc!)).toBe('datum');
    expect(readProgress(backed.doc!).runs['house-traverse']?.fieldStatus).toBeUndefined();
    const returned = nextTraverse(backed.doc!, NOW);
    expect(stepId(returned.doc)).toBe('leg');
    expect(status(returned.doc)?.blocked).toBe(true);
    const repaired = withWorkflowEvent(returned.doc, { type: 'traverse.observe', step: 3, newestId: 'C4' }, NOW);
    expect(status(repaired)?.blocked).toBe(false);
    expect(status(repaired)?.tone).toBe('green');
    const restarted = restartHouseWalk(repaired, '2026-10-10T13:00:00.000Z');
    expect(restarted.houseTraverse).toBeUndefined();
    expect(restarted.pastTraverses?.length).toBe(1);
    const freed = deletePointMeasurement(restarted, 'C1');
    expect(freed.reason ?? '').not.toMatch(/datum end/);
    expect(freed.reason).toMatch(/baseline end/);
  }, 120_000);

  it('refuses Tick anyway and Next on a later step that has not passed', () => {
    let doc = begin(gardenFromFixture('loop4ct-steps.json'));
    doc = nextTraverse(doc, NOW).doc;
    doc = withWorkflowEvent(doc, { type: 'traverse.observe', step: 2, newestId: 'C4' }, NOW);
    noteTraverseDocument(doc);
    const later = tickWorkflow(readProgress(doc), 'adjust', undefined, NOW);
    expect(later.changed).toBe(false);
    expect(later.notice).toMatch(/Read the closure/);
    const review = tickWorkflow(readProgress(doc), 'closure-review', undefined, NOW);
    expect(review.changed).toBe(false);
    const moved = advanceWorkflow(readProgress(doc), NOW);
    expect(moved.changed).toBe(false);
    expect(readProgress(doc).runs['house-traverse']?.currentStepId).toBe('leg');
  }, 120_000);
});
