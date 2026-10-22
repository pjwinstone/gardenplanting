import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyDocument } from '../src/model';
import { baseGridOf, basePointCount, baseWarnings, nextBaseId, upsertBasePoint, MIN_BASE_POINTS_FOR_PHOTOS } from '../src/baseGrid';
import { editBasePointRun, newPointRun, photoPointsShown, signedTape } from '../src/screens/pointRun';
import { basePointRows } from '../src/screens/basePointList';
import { pointNet, t } from '../src/screens/stepNet';

const NOW = '2026-10-21T10:00:00.000Z';
function grid(diag3 = Math.hypot(4, 6)) {
  let d = emptyDocument('g');
  d = upsertBasePoint(d, { id: 'BAS01' }, NOW);
  d = upsertBasePoint(d, { id: 'BAS02', from: 'BAS01', northM: 0, eastM: 6, diagonalM: 6, postSeparationM: 0.4 }, NOW);
  d = upsertBasePoint(d, { id: 'BAS03', from: 'BAS01', northM: 4, eastM: 6, diagonalM: diag3 }, NOW);
  return d;
}

describe('tasks 3–8: base points', () => {
  it('N/S and E/W toggles: a positive distance is signed by the toggle', () => {
    expect(signedTape(3, -1)).toBe(-3);
    expect(signedTape(-3, 1)).toBe(3);
    expect(signedTape(2.5, undefined)).toBe(2.5);
    expect(signedTape(undefined, -1)).toBeUndefined();
  });

  it('one Save base point stores the tie and the post together', () => {
    const d = grid();
    const g = baseGridOf(d);
    expect(g.ids).toEqual(expect.arrayContaining(['BAS01', 'BAS02', 'BAS03']));
    expect(g.postSeparation.BAS02).toBeCloseTo(0.4);
    expect(d.baseGrid!.ties.filter((x) => x.to === 'BAS02')).toHaveLength(1);
    expect(nextBaseId(d)).toBe('BAS04');
    expect(basePointCount(d)).toBe(3);
  });

  it('editing a base point replaces its tie (no duplicates), re-solves and re-checks the diagonal', () => {
    let d = grid();
    expect(baseWarnings(d).BAS03).toBeUndefined();
    const before = d.points.find((p) => p.id === 'BAS03');
    d = upsertBasePoint(d, { id: 'BAS03', from: 'BAS01', northM: 5, eastM: 6, diagonalM: 7.5, postSeparationM: undefined }, NOW);
    expect(d.baseGrid!.ties.filter((x) => x.to === 'BAS03')).toHaveLength(1);
    const after = d.points.find((p) => p.id === 'BAS03');
    if (before && after) expect(after).not.toEqual(before);
    // a 30 cm diagonal error now warns
    d = upsertBasePoint(d, { id: 'BAS03', from: 'BAS01', northM: 5, eastM: 6, diagonalM: Math.hypot(5, 6) + 0.3 }, NOW);
    expect(baseWarnings(d).BAS03).toBeDefined();
    // and clearing the post removes the setting
    d = upsertBasePoint(d, { id: 'BAS02', from: 'BAS01', northM: 0, eastM: 6, diagonalM: 6 }, NOW);
    expect(baseGridOf(d).postSeparation.BAS02).toBeUndefined();
  });

  it('edit run is prefilled from the saved tie, with sign toggles', () => {
    let d = grid();
    d = upsertBasePoint(d, { id: 'BAS04', from: 'BAS01', northM: -3, eastM: -2, diagonalM: Math.hypot(3, 2) }, NOW);
    const r = editBasePointRun(d, 'BAS04', NOW);
    expect(r.editId).toBe('BAS04');
    expect(r.from).toBe('BAS01');
    expect(r.nSign).toBe(-1);
    expect(r.eSign).toBe(-1);
    expect(r.current).toBe('from_point');
  });

  it('base point list rows carry position, source, post and warnings', () => {
    let d = grid();
    let rows = basePointRows(d);
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(['BAS01', 'BAS02', 'BAS03']));
    expect(rows.find((r) => r.id === 'BAS02')!.line).toMatch(/0\.4/);
    d = upsertBasePoint(d, { id: 'BAS03', from: 'BAS01', northM: 4, eastM: 6, diagonalM: Math.hypot(4, 6) + 0.3 }, NOW);
    rows = basePointRows(d);
    const r3 = rows.find((r) => r.id === 'BAS03')!;
    expect(r3.warning).toBeTruthy();
    expect(['amber', 'red']).toContain(r3.level);
  });

  it('photo points and the circle test are advice-only below 3 base points', () => {
    expect(MIN_BASE_POINTS_FOR_PHOTOS).toBe(3);
    let d = emptyDocument('g');
    expect(photoPointsShown(d, newPointRun(NOW))).toBe(false);
    expect(photoPointsShown(d, { ...newPointRun(NOW), showAll: true })).toBe(true);
    d = grid();
    expect(photoPointsShown(d, newPointRun(NOW))).toBe(true);
    expect(t(pointNet, 'show_anyway')).toBeTruthy();
    expect(t(pointNet, 'save_btn')).toBe('Save base point');
  });

  it('Set-up no longer asks for base points', () => {
    const src = readFileSync('src/workflows/guided/guidedChrome.ts', 'utf8');
    expect(src).not.toMatch(/'baseline_length_m'/);
    expect(src).not.toMatch(/Save tie|Save post/);
  });
});
