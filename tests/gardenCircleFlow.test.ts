import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDocument } from '../src/model';
import { circleResultForRun, edgePhotoAssignments } from '../src/workflows/guided/circleResult';
import { circleFieldTest } from '../src/workflows/guided/definitions';
import {
  advanceWorkflow,
  confirmSetupWorkflow,
  doneWorkflow,
  emptyProgress,
  removeBaseTieWorkflow,
  saveBasePostWorkflow,
  saveBaseTieWorkflow,
  saveCircleTapeWorkflow,
  startWorkflow,
  tickWorkflow,
} from '../src/workflows/guided/engine';
import { defaultFieldTestSetup, migrateFieldTestSetup } from '../src/workflows/guided/fieldTestMeta';
import { setupValid } from '../src/workflows/guided/guards';
import { baseTieFromDraft, circleTapeFromDraft, setupValuesWithDraft } from '../src/workflows/guided/guidedChrome';
import { basePointsFor, edgePointsFor, markerIdsFor, pointForMarkerId } from '../src/workflows/guided/markerSet';

const NOW = '2026-10-20T09:00:00.000Z';
const ID = 'circle-field-test';
const fresh = () => confirmSetupWorkflow(startWorkflow(emptyProgress(), ID, NOW).progress, undefined, NOW).progress;

describe('garden circle field test (docs/garden-circle.md)', () => {
  beforeEach(() => vi.stubGlobal('window', { confirm: () => false }));

  it('rev 6 steps in order: kit, baseline, base points, calibration, edge points, one photo each, diameter, result, save', () => {
    expect(circleFieldTest.revision).toBe(6);
    expect(circleFieldTest.steps.map((s) => s.id)).toEqual([
      'gather-kit', 'place-baseline-points', 'tape-baseline', 'laser-check-baseline', 'add-base-points',
      'camera-calibration', 'mark-edge-points', 'edge-photos', 'tape-diameter', 'circle-result', 'save-to-onedrive',
    ]);
    expect(circleFieldTest.steps.map((s) => s.n)).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
  });

  it('Set-up defaults: 12 m circle, 12 edge points, 6 m baseline; all editable; rules hold', () => {
    const d = defaultFieldTestSetup();
    expect(d).toMatchObject({ circle_diameter_m: 12, edge_points: 12, baseline_length_m: 6 });
    expect(d.tolerances_mm).toMatchObject({ circle_diameter_baseline: 60, circle_diameter_plantable: 100 });
    expect(setupValid(d)).toBe(true);
    const edited = setupValuesWithDraft(d, { circle_diameter_m: '11,5', edge_points: '10', baseline_length_m: '6' })!;
    expect(edited).toMatchObject({ circle_diameter_m: 11.5, edge_points: 10 });
    expect(setupValid(edited)).toBe(true);
    expect(setupValid({ ...d, baseline_length_m: 5.9 })).toBe(false); // < D/2
    expect(setupValid({ ...d, edge_points: 7 })).toBe(false);
    // Rev 6: legacy camera-position values no longer gate Set-up.
    const oneTaped = migrateFieldTestSetup({ ...d, camera_positions: { ...d.camera_positions, position_4: { to_bas01: 0, to_bas02: 0 } } });
    expect(setupValid(oneTaped)).toBe(true);
    expect(setupValuesWithDraft(d, { circle_diameter_m: '0' })).toBeNull();
  });

  it('a rev 3 saved Set-up migrates with the new defaults filled in', () => {
    const old = { baseline_length_m: 8, bas02_from_peg_m: 4.3, circle_diameter_m: 8, calibration_distance_m: 4, camera_positions: { left: { to_bas01: 8, to_bas02: 8 } }, tolerances_mm: { baseline: 30 } };
    const m = migrateFieldTestSetup(old as never);
    expect(m).toMatchObject({ circle_diameter_m: 8, edge_points: 12 });
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

  it('circle result without a garden, base points or calibration says what is missing', () => {
    let p = fresh();
    expect(circleResultForRun(null, p.runs[ID]!).state).toBe('needs-data');
    const v = circleResultForRun(emptyDocument('x'), p.runs[ID]!);
    expect(v.state).toBe('needs-data');
    expect(v.headline).toMatch(/No base points yet/);
    p = saveBaseTieWorkflow(p, { from: 'BAS01', to: 'BAS02', eastM: 6, northM: 0, diagonalM: 6 }, NOW).progress;
    expect(circleResultForRun(emptyDocument('x'), p.runs[ID]!).headline).toMatch(/No focal length yet/);
  });

  it('Add base points: N/E/diagonal ties stored on the run, logged, re-adjusted; a bad diagonal is a warning on that base point', () => {
    expect(baseTieFromDraft({ from: 'bas01', to: 'bas03', e: '3,2', n: '4.1', d: '' })).toEqual({ from: 'BAS01', to: 'BAS03', eastM: 3.2, northM: 4.1, diagonalM: undefined });
    expect(baseTieFromDraft({ from: 'BAS01', to: 'BAS03', e: 'x', n: '', d: '' })).toBeNull();
    let p = fresh();
    // A new point without E and N is refused; a tie from no placed point is refused.
    expect(saveBaseTieWorkflow(p, { from: 'BAS01', to: 'BAS03', diagonalM: 5 }, NOW).changed).toBe(false);
    expect(saveBaseTieWorkflow(p, { from: 'BAS05', to: 'BAS03', eastM: 1, northM: 1, diagonalM: 1.414 }, NOW).changed).toBe(false);
    p = saveBaseTieWorkflow(p, { from: 'BAS01', to: 'BAS02', eastM: 6, northM: 0, diagonalM: 6 }, NOW).progress;
    const ok = saveBaseTieWorkflow(p, { from: 'BAS02', to: 'BAS03', eastM: -2.8, northM: 4.1, diagonalM: Math.hypot(2.8, 4.1) }, NOW);
    expect(ok.notice).toMatch(/every diagonal checks out/);
    p = tickWorkflow(ok.progress, 'circle-result', undefined, NOW).progress;
    const bad = saveBaseTieWorkflow(p, { from: 'BAS03', to: 'BAS04', eastM: -1.8, northM: 2.2, diagonalM: Math.hypot(1.8, 2.2) + 0.03 }, NOW);
    expect(bad.notice).toMatch(/BAS04: Diagonal off by \d+ mm \(expected ±\d+ mm\); base point uncertainty ×/);
    const run = bad.progress.runs[ID]!;
    expect(run.baseTies).toHaveLength(3);
    expect(run.runLog?.filter((e) => e.type === 'base-tie.saved')).toHaveLength(3);
    expect(run.steps['circle-result']?.status).toBe('needs_recheck');
    const removed = removeBaseTieWorkflow(bad.progress, run.baseTies![2].id, NOW);
    expect(removed.progress.runs[ID]!.baseTies).toHaveLength(2);
    expect(removed.progress.runs[ID]!.runLog?.at(-1)?.type).toBe('base-tie.removed');
  });

  it('two-sleeve posts: Set-up default 1.2 m, editable per base point, logged; the result re-checks', () => {
    const d = defaultFieldTestSetup();
    expect(d.post_separation_m).toBe(1.2);
    expect(setupValid({ ...d, post_separation_m: 0 })).toBe(false);
    expect(setupValuesWithDraft(d, { post_separation_m: '1,15' })!.post_separation_m).toBe(1.15);
    // Older saves without the field get the default.
    expect(migrateFieldTestSetup({ ...d, post_separation_m: undefined } as never).post_separation_m).toBe(1.2);
    let p = tickWorkflow(fresh(), 'circle-result', undefined, NOW).progress;
    expect(saveBasePostWorkflow(p, 'BAS03B', 1.2, NOW).changed).toBe(false);
    expect(saveBasePostWorkflow(p, 'BAS03', 0.05, NOW).changed).toBe(false);
    const saved = saveBasePostWorkflow(p, 'bas03', 1.25, NOW);
    expect(saved.notice).toMatch(/BAS03: post sleeves 1.250 m apart/);
    p = saved.progress;
    const run = p.runs[ID]!;
    expect(run.basePostSeparationM).toEqual({ BAS03: 1.25 });
    expect(run.runLog?.at(-1)).toMatchObject({ type: 'base-post.saved', point: 'BAS03', separationM: 1.25 });
    expect(run.steps['circle-result']?.status).toBe('needs_recheck');
    p = saveBasePostWorkflow(p, 'BAS03', null, NOW).progress;
    expect(p.runs[ID]!.basePostSeparationM).toEqual({});
  });

  it('marker set: each base point maps to a top code (BASnn) and a post-bottom code (BASnnB)', () => {
    expect(pointForMarkerId('315')).toBe('BAS01');
    expect(pointForMarkerId('222')).toBe('BAS01B');
    expect(basePointsFor(null)).toHaveLength(14);
    expect(markerIdsFor(null)).toHaveLength(28);
  });

  it('edge photos map to EDG01… in the order taken; a per-photo retake keeps its edge point', () => {
    const ph = (id: string, at: string, supersededAt?: string) => ({ id, setupId: 's', width: 1, height: 1, clicks: [], originalFile: { capturedAt: at }, supersededAt } as never);
    const names = ['EDG01', 'EDG02', 'EDG03'];
    const m = edgePhotoAssignments([ph('a', '2026-10-20T10:00:00Z'), ph('b', '2026-10-20T10:01:00Z', '2026-10-20T10:05:00Z'), ph('c', '2026-10-20T10:02:00Z'), ph('b2', '2026-10-20T10:06:00Z')], names);
    expect(Object.fromEntries(m)).toEqual({ a: 'EDG01', c: 'EDG03', b2: 'EDG02' });
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
    // Rev 6: the former edge codes are base-point codes BAS03…BAS14; Paul can reassign them.
    expect(pointForMarkerId('8a3')).toBe('BAS05');
    expect(basePointsFor(null)).toHaveLength(14);
    const doc = { markerSet: [{ point: 'BAS01', id: '315' }, { point: 'BAS07', id: 'DB7' }] };
    expect(pointForMarkerId('DB7', doc)).toBe('BAS07');
    expect(pointForMarkerId('8A3', doc)).toBeUndefined();
    expect(markerIdsFor(doc)).toEqual(['315', 'DB7']);
  });
});
