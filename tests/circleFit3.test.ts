// @vitest-environment happy-dom
/** Regression (Paul, 30 Oct 2026): with exactly 3 edge points the app showed a fit error. */
import { describe, expect, it } from 'vitest';
import { circleResultDetailForRun, edgePointRows } from '../src/workflows/guided/circleResult';
import { edgeFitLine, edgeSummaryText } from '../src/workflows/guided/edgePointUi';
import { readProgress } from '../src/workflows/guided/engine';
import { buildCircleDoc } from './fixtures/circleDoc';

describe('3 edge points: an exact fit, not an error', () => {
  const d = buildCircleDoc(3);
  const run = readProgress(d).runs['circle-field-test']!;
  const det = circleResultDetailForRun(d, run);
  it('residuals ~0, no redundancy, and the status says exact fit with no check possible', () => {
    const fit = det.verdict.fit!;
    expect(fit.dof).toBe(0);
    expect(Math.max(...fit.residualsM.map(Math.abs))).toBeLessThan(1e-9);
    expect(det.verdict.state).toBe('needs-data');
    expect(det.verdict.headline).toMatch(/^Exact fit through 3 points: ⌀ 12\.\d{3} m\. No check possible yet/);
    expect(det.verdict.headline).not.toMatch(/Inconclusive|Not a circle|±/);
    expect(edgeFitLine(det)).toMatch(/exact fit, no check possible$/);
    expect(edgeFitLine(det)).not.toMatch(/±/);
  });
  it('all 3 are in the fit; an unchecked (grey) point is not counted as left out', () => {
    expect(det.fitIds).toEqual(['EDG01', 'EDG02', 'EDG03']);
    const text = edgeSummaryText(edgePointRows(d, run, det));
    expect(text).not.toMatch(/not in the fit/);
  });
  it('4 points: the normal check runs again (dof 1, a ± and an rms)', () => {
    const d4 = buildCircleDoc(4);
    const det4 = circleResultDetailForRun(d4, readProgress(d4).runs['circle-field-test']!);
    expect(det4.verdict.fit!.dof).toBe(1);
    expect(edgeFitLine(det4)).toMatch(/± \d+ mm · 4 points · rms/);
  });
});
