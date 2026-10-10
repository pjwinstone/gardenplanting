/**
 * Walk round the house: agreed gates, a simulated loop through the workflow
 * events, and the block on removing the datum ends.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { emptyDocument, type GardenDocument, type PointKind } from '../src/model';
import { deletePointMeasurement } from '../src/layers';
import type { SolveInput } from '../src/solver/types';
import { commitWorkflow, readProgress, startWorkflow, withWorkflowEvent } from '../src/workflows/guided/engine';
import {
  classifyGate,
  CROSS_TIE_PROMPT,
  nextTraverse,
  singleSetupWarning,
} from '../src/workflows/guided/traverseWalk';
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
  return (readProgress(doc).runs['house-traverse']?.liveLines ?? []).join('\n');
}

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
    expect(held.notice).toMatch(/cross-tie/i);
    expect(stepId(held.doc)).toBe('leg');
    expect(readProgress(held.doc).runs['house-traverse']?.steps.leg?.status).not.toBe('complete');
    expect(live(held.doc)).toMatch(/Add a cross-tie before the next leg/);

    doc = withWorkflowEvent(held.doc, { type: 'traverse.observe', step: 3, newestId: 'C4' }, NOW);
    doc = withWorkflowEvent(doc, { type: 'traverse.close' }, NOW);
    expect(doc.houseTraverse?.closeRequested).toBe(true);
    move = nextTraverse(doc, NOW);
    expect(move.notice).toMatch(/Close the loop: tape to C1/);
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
    expect(ontoClose.notice ?? live(ontoClose.doc)).toMatch(/cross-tie|Close the loop/i);
    expect(stepId(ontoClose.doc)).toBe('close');
    const review = nextTraverse(ontoClose.doc, NOW);
    expect(stepId(review.doc)).toBe('closure-review');
    const mis = review.doc.traverseMisclosure;
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
    expect(text).toMatch(/rank 6/);
    expect(text).toMatch(/position χ² pass/);
    expect(text).toMatch(/The raw misclosure is not a blunder test/);
    expect(readProgress(review.doc).runs['house-traverse']?.steps['closure-review']?.status).toBe('complete');
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
});
