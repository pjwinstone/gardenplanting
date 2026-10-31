// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { circleResultDetailForRun, edgeAssignmentsFor, edgePointRows, MIN_FIT_EDGE_POINTS, previousEdgePhoto } from '../src/workflows/guided/circleResult';
import { deleteEdgePointWorkflow, readProgress, retakeOnePhotoInDoc, restoreEdgePointWorkflow, saveEdgeNoteWorkflow } from '../src/workflows/guided/engine';
import { handleWorkflowCommand, installWorkflowChrome, renderGuidedChrome, renderGuidedOverlay, resetGuidedNav } from '../src/workflows/guided/guidedChrome';
import { clearSwiped } from '../src/screens/basePointList';
import type { GardenDocument } from '../src/model';
import { buildCircleDoc } from './fixtures/circleDoc';

const ID = 'circle-field-test';
const runOf = (d: GardenDocument) => readProgress(d).runs[ID]!;
const withProgress = (d: GardenDocument, p: ReturnType<typeof readProgress>): GardenDocument => ({ ...d, workflowProgress: p });
const attrs = (a: Record<string, string>) => ({ getAttribute: (n: string) => a[n] ?? null });

describe('circle test edge points', () => {
  beforeEach(() => {
    clearSwiped();
    resetGuidedNav();
    vi.stubGlobal('confirm', () => true);
  });

  it('the circle fits from 3 edge points (exact, so no residuals yet); 2 says it needs 3', () => {
    expect(MIN_FIT_EDGE_POINTS).toBe(3);
    const two = buildCircleDoc(2);
    expect(circleResultDetailForRun(two, runOf(two)).verdict.headline).toMatch(/fits from 3/);
    const d = buildCircleDoc(3);
    const det = circleResultDetailForRun(d, runOf(d));
    expect(det.verdict.fit?.diameterM).toBeGreaterThan(11);
    expect(det.fitIds).toEqual(['EDG01', 'EDG02', 'EDG03']);
    expect(det.verdict.headline).toMatch(/^Exact fit through 3 points/);
    const rows = edgePointRows(d, runOf(d), det);
    expect(rows.map((r) => r.id)).toEqual(['EDG01', 'EDG02', 'EDG03']);
    expect(rows.every((r) => r.residualMm === undefined)).toBe(true);
  });

  it('rows carry name, colour and residual (mm) from 4 points', () => {
    const d = buildCircleDoc(8);
    const rows = edgePointRows(d, runOf(d));
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      expect(['green', 'amber', 'red', 'grey']).toContain(r.level);
      expect(Math.abs(r.residualMm!)).toBeLessThan(30);
    }
  });

  it('delete takes the point out of the fit and refits; restore puts it back; notes save', () => {
    const d = buildCircleDoc(8);
    const row = edgePointRows(d, runOf(d)).find((r) => r.id === 'EDG03')!;
    const before = circleResultDetailForRun(d, runOf(d));
    const del = deleteEdgePointWorkflow(readProgress(d), 'EDG03', row.photoId, '2026-10-28T12:00:00.000Z');
    expect(del.changed).toBe(true);
    const d2 = withProgress(d, del.progress);
    const after = circleResultDetailForRun(d2, runOf(d2));
    expect(after.fitIds).not.toContain('EDG03');
    expect(after.fitIds).toHaveLength(7);
    expect(after.verdict.fit!.diameterM).not.toBe(before.verdict.fit!.diameterM);
    const rows = edgePointRows(d2, runOf(d2));
    expect(rows.at(-1)).toMatchObject({ id: 'EDG03', deleted: true, level: 'unused' });
    // Other points keep their names.
    expect(rows.slice(0, 7).map((r) => r.id)).toEqual(['EDG01', 'EDG02', 'EDG04', 'EDG05', 'EDG06', 'EDG07', 'EDG08']);
    expect(runOf(d2).runLog!.at(-1)).toMatchObject({ type: 'edge-point.deleted', point: 'EDG03' });
    const d3 = withProgress(d2, restoreEdgePointWorkflow(del.progress, row.photoId).progress);
    expect(circleResultDetailForRun(d3, runOf(d3)).fitIds).toHaveLength(8);
    const d4 = withProgress(d3, saveEdgeNoteWorkflow(readProgress(d3), 'EDG05', ' Peg leaning ').progress);
    expect(runOf(d4).edgeNotes).toEqual({ EDG05: 'Peg leaning' });
    expect(saveEdgeNoteWorkflow(readProgress(d4), 'EDG05', '').progress.runs[ID]!.edgeNotes).toEqual({});
  });

  it('the edge photo step shows the circle so far and the list; tap opens a full-screen pop-up with Save/Cancel', () => {
    let d = buildCircleDoc(5);
    installWorkflowChrome(() => {}, (u) => { d = u(d); });
    const chrome = renderGuidedChrome(d);
    document.body.append(chrome);
    expect(chrome.querySelector('[data-testid="edge-summary"]')!.textContent).toMatch(/^5 points · \d+ pass/);
    expect(chrome.querySelector<HTMLButtonElement>('[data-testid="edge-fit-open"]')!.textContent).toMatch(/Circle fit/);
    const row = chrome.querySelector<HTMLElement>('[data-testid="edge-row-EDG02"]')!;
    handleWorkflowCommand('workflow-edge-open', d, attrs({ 'data-value': row.dataset.value!, 'data-point': 'EDG02' }));
    const modal = renderGuidedOverlay(d)!;
    expect(modal.dataset.testid).toBe('edge-modal');
    expect(modal.className).toMatch(/bm-root/);
    expect(modal.querySelector('[data-testid="edge-modal-title"]')!.textContent).toBe('Edge point EDG02');
    expect(modal.querySelector('[data-testid="edge-modal-save"]')).toBeTruthy();
    expect(modal.querySelector('[data-testid="edge-modal-cancel"]')).toBeTruthy();
    // Typing in the note keeps a draft (no command); Save stores it.
    const area = modal.querySelector<HTMLTextAreaElement>('[data-testid="edge-modal-note"]')!;
    expect(area.dataset.cmd).toBeUndefined();
    area.value = 'odd';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    const saved = handleWorkflowCommand('workflow-edge-save', d, attrs({ 'data-point': 'EDG02' }));
    expect(readProgress(saved.doc!).runs[ID]!.edgeNotes).toEqual({ EDG02: 'odd' });
    expect(renderGuidedOverlay(saved.doc!)).toBeNull();
    chrome.remove();
  });

  it('the pop-up has a full-width Retake button above the photo that opens the retake screen on that photo', () => {
    let d = buildCircleDoc(5);
    installWorkflowChrome(() => {}, (u) => { d = u(d); });
    const photoId = [...edgeAssignmentsFor(d, runOf(d))].find(([, id]) => id === 'EDG02')![0];
    const chrome = renderGuidedChrome(d);
    const row = chrome.querySelector<HTMLElement>('[data-testid="edge-row-EDG02"]')!;
    handleWorkflowCommand('workflow-edge-open', d, attrs({ 'data-value': row.dataset.value!, 'data-point': 'EDG02' }));
    const modal = renderGuidedOverlay(d)!;
    const btn = modal.querySelector<HTMLButtonElement>('[data-testid="edge-modal-retake"]')!;
    expect(btn.textContent).toBe('Retake photo of EDG02');
    expect(btn.className).toMatch(/screen-primary/);
    expect(btn.dataset.cmd).toBe('workflow-photos');
    expect(btn.dataset.step).toBe('edge-photos');
    expect(btn.dataset.photo).toBe(photoId);
    const img = modal.querySelector('img')!;
    expect(btn.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Tapping it closes the pop-up and opens the viewer on that one photo, with a big Retake.
    handleWorkflowCommand('workflow-photos', d, attrs({ 'data-step': 'edge-photos', 'data-photo': photoId }));
    const viewer = renderGuidedOverlay(d)!;
    expect(viewer.dataset.testid).toBe('workflow-photos-viewer');
    const r = viewer.querySelectorAll<HTMLButtonElement>('[data-testid="photo-retake"]');
    expect(r).toHaveLength(1);
    expect(r[0]!.dataset.photo).toBe(photoId);
    expect(r[0]!.dataset.cmd).toBe('workflow-photo-retake');
    expect(r[0]!.className).toMatch(/screen-primary .*workflow-retake-wide/);
    expect(viewer.querySelector('[data-testid="viewer-previous"]')).toBeNull();
    handleWorkflowCommand('workflow-photos-close', d, attrs({}));
  });

  it('a retake keeps the edge point: the new photo takes its slot, the old one is its previous photo, and the circle refits', () => {
    const d0 = buildCircleDoc(5);
    const before = edgePointRows(d0, runOf(d0)).find((r) => r.id === 'EDG02')!;
    const oldId = [...edgeAssignmentsFor(d0, runOf(d0))].find(([, id]) => id === 'EDG02')![0];
    const t = '2030-01-01T00:00:00.000Z';
    const r = retakeOnePhotoInDoc(d0, 'edge-photos', oldId, t);
    expect(r.changed).toBe(true);
    // Waiting for the new photo: EDG02 is out of the fit.
    expect(circleResultDetailForRun(r.doc, runOf(r.doc)).fitIds).not.toContain('EDG02');
    const old = r.doc.photos.find((p) => p.id === oldId)!;
    const moved = { ...old, id: 'new-edg02', supersededAt: undefined, clicks: old.clicks!.map((c) => ({ ...c, px: c.px + 60 })), originalFile: { ...old.originalFile!, fileName: 'new.jpg', capturedAt: '2030-01-01T00:01:00.000Z', receivedAt: '2030-01-01T00:01:00.000Z' } };
    const d1: GardenDocument = { ...r.doc, photos: [...r.doc.photos, moved] };
    expect(edgeAssignmentsFor(d1, runOf(d1)).get('new-edg02')).toBe('EDG02');
    expect(edgeAssignmentsFor(d1, runOf(d1)).has(oldId)).toBe(false);
    expect(previousEdgePhoto(d1, runOf(d1), 'EDG02')?.id).toBe(oldId);
    expect(previousEdgePhoto(d1, runOf(d1), 'EDG03')).toBeUndefined();
    const after = edgePointRows(d1, runOf(d1)).find((x) => x.id === 'EDG02')!;
    expect(circleResultDetailForRun(d1, runOf(d1)).fitIds).toContain('EDG02');
    expect(after.residualMm).not.toBe(before.residualMm);
  });

  it('Delete from the list asks first, then refits; Cancel in confirm changes nothing', () => {
    const d = buildCircleDoc(5);
    const row = edgePointRows(d, runOf(d))[1]!;
    vi.stubGlobal('confirm', () => false);
    expect(handleWorkflowCommand('workflow-edge-delete', d, attrs({ 'data-value': row.photoId, 'data-point': row.id })).doc).toBeUndefined();
    vi.stubGlobal('confirm', () => true);
    const r = handleWorkflowCommand('workflow-edge-delete', d, attrs({ 'data-value': row.photoId, 'data-point': row.id }));
    expect(circleResultDetailForRun(r.doc!, runOf(r.doc!)).fitIds).toHaveLength(4);
  });

  it('the Photos viewer is a full-screen pop-up with its own scroll body and Close at the bottom', () => {
    const d = buildCircleDoc(8);
    renderGuidedChrome(d);
    handleWorkflowCommand('workflow-photos', d, attrs({ 'data-step': 'edge-photos' }));
    const v = renderGuidedOverlay(d)!;
    expect(v.dataset.testid).toBe('workflow-photos-viewer');
    expect(v.className).toMatch(/bm-root viewer-modal/);
    expect(v.querySelectorAll('[data-testid="viewer-body"] [data-testid="photo-retake"]')).toHaveLength(8);
    expect(v.querySelector('.bm-foot [data-testid="workflow-photos-close"]')).toBeTruthy();
    handleWorkflowCommand('workflow-photos-close', d, attrs({}));
    expect(renderGuidedOverlay(d)).toBeNull();
  });
});
