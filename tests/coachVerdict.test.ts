import { describe, expect, it } from 'vitest';
import { buildCoach, coachVerdict, formatResidualLine } from '../src/coach';
import { emptyDocument, type GardenDocument } from '../src/model';
import tolerances from '../workflow/tolerances.json';
import { commitWorkflow, confirmSetupWorkflow, emptyProgress, scrollWorkflowToStep, startWorkflow, tickWorkflow } from '../src/workflows/guided/engine';

const NOW = '2026-10-19T20:00:00.000Z';
function withSession(doc: GardenDocument, patch: Partial<GardenDocument['session']>): GardenDocument {
  return { ...doc, session: { ...doc.session, ...patch } };
}
function paulsDoc(guided: boolean): GardenDocument {
  let doc = emptyDocument('Circle day');
  doc = { ...doc, points: [...doc.points, { id: 'CAM-RIGHT-FAR', kind: 'OCC', label: 'Right far' } as GardenDocument['points'][number]] };
  doc = withSession(doc, { mode: 'MENU', lastAction: '+ Photo (yaw) → CAM-RIGHT-FAR', lastResidualMm: 1890, geometryOk: true, currentAddPointId: 'CAM-RIGHT-FAR' });
  if (guided) {
    let p = startWorkflow(emptyProgress(), 'circle-field-test', NOW).progress;
    p = confirmSetupWorkflow(p, undefined, NOW).progress;
    p = scrollWorkflowToStep(p, 'camera-right-far', NOW).progress;
    doc = commitWorkflow(doc, p);
  }
  return doc;
}
const all = (c: ReturnType<typeof buildCoach>) => [c.banner, ...c.body, c.residualLine ?? '', c.geometryLine ?? ''].join('\n');
const JARGON = /\+ Photo|\(yaw\)|residual|Last action|Pick a workflow|Mode list|\bCAM-[A-Z]|good enough/i;

describe('coach verdict', () => {
  it("Paul's case during a run: step guidance + one plain line, nothing legacy, no ids", () => {
    const c = buildCoach(paulsDoc(true));
    expect(c.body[0]).toMatch(/^Step 11: Camera position Right far/);
    expect(c.geometryLine).toBe('Right far is 1.9 m off what the other measurements say. Expected until the lens is calibrated; recheck after calibration.');
    expect(c.residualLine).toBeNull();
    expect(c.nextButton).toBeNull();
    expect(all(c)).not.toMatch(JARGON);
  });

  it('after calibration the bad line asks for a retake', () => {
    let doc = paulsDoc(true);
    const p = tickWorkflow(JSON.parse(JSON.stringify(doc.workflowProgress)), 'camera-calibration', undefined, NOW).progress;
    doc = commitWorkflow(doc, p);
    expect(buildCoach(doc).geometryLine).toMatch(/Retake this camera position\.$/);
  });

  it('outside a run: menu text plus one verdict, never green with a residual over the limit', () => {
    const c = buildCoach(paulsDoc(false));
    expect(c.body[0]).toMatch(/^Menu\./);
    expect(c.geometryLine).toMatch(/Re-measure before you trust the plan\.$/);
    expect(all(c).replace(c.body[0]!, '')).not.toMatch(JARGON);
  });

  it('levels follow tolerances.json at the boundaries, and geometryOk can only lower them', () => {
    const base = emptyDocument('x');
    const at = (mm: number, ok?: boolean) => coachVerdict(withSession(base, { lastResidualMm: mm, geometryOk: ok })).level;
    expect(at(tolerances.baselineMm)).toBe('good');
    expect(at(tolerances.baselineMm + 1)).toBe('usable');
    expect(at(tolerances.cameraPositionMm)).toBe('usable');
    expect(at(tolerances.cameraPositionMm + 1)).toBe('bad');
    expect(at(5, false)).toBe('bad');
    expect(at(5000, true)).toBe('bad');
    expect(coachVerdict(withSession(base, { lastResidualMm: undefined, geometryOk: true })).level).toBe('none');
  });

  it('no contradiction: across residuals, no line says good when the verdict is bad', () => {
    for (const mm of [0, 10, 30, 31, 150, 200, 201, 1890, -1890]) {
      for (const ok of [true, false, undefined]) {
        for (const guided of [true, false]) {
          const doc = withSession(paulsDoc(guided), { lastResidualMm: mm, geometryOk: ok });
          const v = coachVerdict(doc);
          const text = all(buildCoach(doc));
          if (v.level === 'bad') expect(text).not.toMatch(/within tolerance|good enough|looks good/i);
          if (v.level === 'good') expect(text).not.toMatch(/Re-measure|Retake/);
          const res = formatResidualLine(mm);
          if (v.level === 'bad' && ok !== false) expect(res).toMatch(/Re-measure/);
        }
      }
    }
  });
});
