import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDocument } from '../src/model';
import { circleResultForRun } from '../src/workflows/guided/circleResult';
import { circleFieldTest } from '../src/workflows/guided/definitions';
import {
  advanceWorkflow,
  confirmSetupWorkflow,
  doneWorkflow,
  emptyProgress,
  saveCircleTapeWorkflow,
  startWorkflow,
  tickWorkflow,
} from '../src/workflows/guided/engine';
import { defaultFieldTestSetup, migrateFieldTestSetup } from '../src/workflows/guided/fieldTestMeta';
import { setupValid } from '../src/workflows/guided/guards';
import { circleTapeFromDraft, setupValuesWithDraft } from '../src/workflows/guided/guidedChrome';
import { edgePointsFor, markerIdsFor, pointForMarkerId } from '../src/workflows/guided/markerSet';

const NOW = '2026-10-20T09:00:00.000Z';
const ID = 'circle-field-test';
const fresh = () => confirmSetupWorkflow(startWorkflow(emptyProgress(), ID, NOW).progress, undefined, NOW).progress;

describe('garden circle field test (docs/garden-circle.md)', () => {
  beforeEach(() => vi.stubGlobal('window', { confirm: () => false }));

  it('steps in order: kit, baseline, tapes, diameter, edge points, calibration, 4 positions, result, save', () => {
    expect(circleFieldTest.revision).toBe(4);
    expect(circleFieldTest.steps.map((s) => s.id)).toEqual([
      'gather-kit', 'place-baseline-points', 'tape-baseline', 'laser-check-baseline', 'tape-diameter', 'mark-edge-points',
      'camera-calibration', 'camera-1', 'camera-2', 'camera-3', 'camera-4', 'circle-result', 'save-to-onedrive',
    ]);
    expect(circleFieldTest.steps.map((s) => s.n)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
  });

  it('Set-up defaults: 12 m circle, 12 edge points, 4 positions, 6 m baseline; all editable; rules hold', () => {
    const d = defaultFieldTestSetup();
    expect(d).toMatchObject({ circle_diameter_m: 12, edge_points: 12, camera_position_count: 4, baseline_length_m: 6 });
    expect(d.tolerances_mm).toMatchObject({ circle_diameter_baseline: 60, circle_diameter_plantable: 100 });
    expect(setupValid(d)).toBe(true);
    const edited = setupValuesWithDraft(d, { circle_diameter_m: '11,5', edge_points: '10', camera_position_count: '3', baseline_length_m: '6', 'camera_positions.position_2.to_bas01': '0' })!;
    expect(edited).toMatchObject({ circle_diameter_m: 11.5, edge_points: 10, camera_position_count: 3 });
    expect(setupValid(edited)).toBe(true);
    expect(setupValid({ ...d, baseline_length_m: 5.9 })).toBe(false); // < D/2
    expect(setupValid({ ...d, edge_points: 7 })).toBe(false);
    expect(setupValid({ ...d, camera_position_count: 2 })).toBe(false);
    const oneTaped = migrateFieldTestSetup({ ...d, camera_positions: { ...d.camera_positions, position_4: { to_bas01: 0, to_bas02: 0 } } });
    expect(setupValid(oneTaped)).toBe(false); // the solver needs two taped positions
    expect(setupValuesWithDraft(d, { circle_diameter_m: '0' })).toBeNull();
  });

  it('a rev 3 saved Set-up migrates with the new defaults filled in', () => {
    const old = { baseline_length_m: 8, bas02_from_peg_m: 4.3, circle_diameter_m: 8, calibration_distance_m: 4, camera_positions: { left: { to_bas01: 8, to_bas02: 8 } }, tolerances_mm: { baseline: 30 } };
    const m = migrateFieldTestSetup(old as never);
    expect(m).toMatchObject({ circle_diameter_m: 8, edge_points: 12, camera_position_count: 4 });
    expect(m.camera_positions.position_1.to_bas01).toBeGreaterThan(0);
    expect(m.tolerances_mm.circle_diameter_baseline).toBe(60);
  });

  it('Tape the diameter: three readings and the edge, saved on the run; bad input refused', () => {
    expect(circleTapeFromDraft({ d: ['12.01', '11,99', ''] })).toBeNull();
    expect(circleTapeFromDraft({ d: ['12.01', '11,99', '12.00'], edge: 'outside' })).toEqual({ diametersM: [12.01, 11.99, 12], edge: 'outside' });
    const p = fresh();
    expect(saveCircleTapeWorkflow(p, [12, 12], 'inside', NOW).changed).toBe(false);
    const move = saveCircleTapeWorkflow(p, [12.01, 11.99, 12.0], 'outside', NOW);
    const run = move.progress.runs[ID]!;
    expect(run.circleTape).toEqual({ diametersM: [12.01, 11.99, 12.0], edge: 'outside', savedAt: NOW });
    expect(run.steps['tape-diameter']).toMatchObject({ status: 'ticked_by_you', note: 'Diameters 12.010, 11.990, 12.000 m, outside edge' });
  });

  it('re-taping sends a settled circle result to re-check', () => {
    let p = fresh();
    p = tickWorkflow(p, 'circle-result', undefined, NOW).progress;
    expect(p.runs[ID]!.steps['circle-result']?.status).toBe('ticked_by_you');
    p = saveCircleTapeWorkflow(p, [12, 12, 12], 'inside', NOW).progress;
    expect(p.runs[ID]!.steps['circle-result']?.status).toBe('needs_recheck');
  });

  it('circle result without a garden or a baseline says what is missing', () => {
    const run = fresh().runs[ID]!;
    expect(circleResultForRun(null, run).state).toBe('needs-data');
    const v = circleResultForRun(emptyDocument('x'), run);
    expect(v.state).toBe('needs-data');
    expect(v.headline).toMatch(/does not solve yet/);
  });

  it('walks every step to Done', () => {
    let p = fresh();
    p = advanceWorkflow(p, NOW).progress;
    for (const step of circleFieldTest.steps) {
      p = tickWorkflow(p, step.id, undefined, NOW).progress;
      p = advanceWorkflow(p, NOW).progress;
    }
    p = doneWorkflow(p, NOW).progress;
    expect(p.runs[ID]?.finishedAt).toBe(NOW);
  });

  it('marker set is a document field: point ↔ ID, with the printed set as default', () => {
    expect(edgePointsFor(null)).toHaveLength(12);
    expect(edgePointsFor(null, 8)).toEqual(['EDG01', 'EDG02', 'EDG03', 'EDG04', 'EDG05', 'EDG06', 'EDG07', 'EDG08']);
    expect(pointForMarkerId('8a3')).toBe('EDG03');
    const doc = { markerSet: [{ point: 'BAS01', id: '315' }, { point: 'EDG01', id: 'DB7' }] };
    expect(pointForMarkerId('DB7', doc)).toBe('EDG01');
    expect(pointForMarkerId('8A3', doc)).toBeUndefined();
    expect(markerIdsFor(doc)).toEqual(['315', 'DB7']);
  });
});
