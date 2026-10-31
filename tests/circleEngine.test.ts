// @vitest-environment happy-dom
/**
 * Garden Planting circle test on the engine: per-net soundness, a visible control for every
 * enabled user move, and one test per action (the place it lands on, the focus it restores).
 * Camera and tap screen are explicit places of edge_add, driven through the same calls ui.ts makes.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkNet, toMarkdown } from '../src/engine';
import { circleNets, circleEngine, circleCameraEvent } from '../src/app/circle/circleEngine';
import { commitWorkflow, deleteEdgePointWorkflow, readProgress, scrollWorkflowToStep } from '../src/workflows/guided/engine';
import { handleWorkflowCommand, installWorkflowChrome, renderGuidedChrome, renderGuidedOverlay, resetGuidedNav } from '../src/workflows/guided/guidedChrome';
import { edgePointRows } from '../src/workflows/guided/circleResult';
import { clearSwiped } from '../src/screens/basePointList';
import type { GardenDocument } from '../src/model';
import { buildCircleDoc } from './fixtures/circleDoc';

const ID = 'circle-field-test';
const runOf = (d: GardenDocument) => readProgress(d).runs[ID]!;
const attrs = (a: Record<string, string>) => ({ getAttribute: (n: string) => a[n] ?? null });
const atStep = (d: GardenDocument, step: string) => commitWorkflow(d, scrollWorkflowToStep(readProgress(d), step).progress);

let doc: GardenDocument;
function view(): HTMLElement {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  host.append(renderGuidedChrome(doc));
  const o = renderGuidedOverlay(doc);
  if (o) host.append(o);
  document.body.append(host);
  return host;
}
function cmd(c: string, a: Record<string, string> = {}) {
  const r = handleWorkflowCommand(c, doc, attrs(a));
  if (r.doc) doc = r.doc;
  return r;
}
const path = () => circleEngine.path().join(' / ');
const photoOf = (id: string) => edgePointRows(doc, runOf(doc)).find((r) => r.id === id)!.photoId;
const tid = (h: HTMLElement, id: string) => h.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

function start(n = 8, deleted?: string): HTMLElement {
  doc = buildCircleDoc(n);
  if (deleted) doc = commitWorkflow(doc, deleteEdgePointWorkflow(readProgress(doc), deleted, photoOf(deleted)).progress);
  installWorkflowChrome(() => {}, (u) => { doc = u(doc); });
  return view();
}

beforeEach(() => {
  clearSwiped();
  resetGuidedNav();
  vi.stubGlobal('confirm', () => true);
});

describe('circle nets: soundness, every net at every level', () => {
  for (const net of Object.values(circleNets.nets)) {
    it(`${net.id}: no dead end, no trap, bounded, no dead move`, () => {
      expect(checkNet(circleNets, net).problems).toEqual([]);
    });
  }
  it('every user move has a control id and a label (or is a child exit)', () => {
    for (const n of Object.values(circleNets.nets)) for (const t of n.transitions) {
      if (t.kind === 'app' || t.on_exit || n.id === 'home') continue;
      expect(t.control, `${n.id}.${t.id}`).toBeTruthy();
      expect(t.label, `${n.id}.${t.id}`).toBeTruthy();
    }
  });
  it('the generated hierarchy page is up to date (npx tsx scripts/gen-net-docs.ts)', () => {
    expect(readFileSync('docs/nets/circle-test.md', 'utf8')).toBe(toMarkdown(circleNets, 'Circle test nets'));
  });
});

describe('edge point list (edge_points@list)', () => {
  it('lands on the list, Add pinned at the top with the engine buttons and their reasons', () => {
    const h = start(2);
    expect(path()).toBe('home@circle / circle_test@edge / edge_points@list');
    const pin = tid(h, 'edge-add-pin')!;
    expect(pin.className).toMatch(/edge-add-pin/);
    expect(tid(pin, 'edge-add')!.disabled).toBe(false);
    const fit = tid(h, 'edge-fit-open')!;
    expect(fit.disabled).toBe(true);
    expect(fit.textContent).toMatch(/Needs 3 edge points in the fit \(2 now\)/);
    expect(tid(h, 'edge-substages')!.dataset.place).toBe('list');
  });
  it('add_point opens the camera place; photo_in the tap screen; Save returns to the list, new point highlighted', () => {
    start(3);
    cmd('workflow-edge-add');
    expect(path()).toMatch(/edge_points@adding \/ edge_add@camera$/);
    expect(circleCameraEvent('photo_in')).toBe(true);
    expect(path()).toMatch(/edge_add@tapscreen$/);
    doc = buildCircleDoc(4); // the 4th photo is in (the app adds it through the photo callback)
    expect(circleCameraEvent('taps_saved')).toBe(true);
    expect(path()).toMatch(/edge_points@list$/);
    const h = view();
    expect(tid(h, 'edge-add')!.disabled).toBe(false);
    expect(h.querySelector('[data-testid="edge-item-EDG04"]')!.className).toMatch(/edge-item--focus/);
  });
  it('three saves in a row: back on the list with Add every time', () => {
    start(1);
    for (let n = 2; n <= 4; n += 1) {
      cmd('workflow-edge-add');
      circleCameraEvent('photo_in');
      doc = buildCircleDoc(n);
      circleCameraEvent('taps_saved');
      const h = view();
      expect(path()).toMatch(/edge_points@list$/);
      expect(tid(h, 'edge-add')).not.toBeNull();
      expect(h.querySelectorAll('[data-testid^="edge-item-"]')).toHaveLength(n);
    }
  });
  it('camera Cancel returns to the list with nothing added', () => {
    start(3);
    cmd('workflow-edge-add');
    expect(circleCameraEvent('camera_cancel')).toBe(true);
    expect(path()).toMatch(/edge_points@list$/);
    expect(view().querySelectorAll('[data-testid^="edge-item-"]')).toHaveLength(3);
  });
  it('tap screen Later (close) returns to the list too', () => {
    start(3);
    cmd('workflow-edge-add');
    circleCameraEvent('photo_in');
    expect(circleCameraEvent('taps_later')).toBe(true);
    expect(path()).toMatch(/edge_points@list$/);
  });
  it('camera events outside Add edge point are ignored (other flows keep their own path)', () => {
    start(3);
    expect(circleCameraEvent('taps_saved')).toBe(false);
    expect(path()).toMatch(/edge_points@list$/);
  });
  it('show_fit / close: the fit panel opens and closes, back on the list', () => {
    const h0 = start(5);
    expect(tid(h0, 'edge-fit-open')!.disabled).toBe(false);
    cmd('workflow-edge-fit');
    expect(path()).toMatch(/edge_fit@shown$/);
    expect(tid(view(), 'edge-fit-panel')).not.toBeNull();
    cmd('workflow-edge-fit-close');
    expect(path()).toMatch(/edge_points@list$/);
    expect(tid(view(), 'edge-fit-panel')).toBeNull();
  });
  it('delete_point / restore_point stay on the list', () => {
    start(5);
    const p = photoOf('EDG03');
    cmd('workflow-edge-delete', { 'data-value': p, 'data-point': 'EDG03' });
    expect(path()).toMatch(/edge_points@list$/);
    expect(circleEngine.log.at(-1)).toBe('edge_points.delete_point(EDG03)');
    cmd('workflow-edge-restore', { 'data-value': p, 'data-point': 'EDG03' });
    expect(circleEngine.log.at(-1)).toBe('edge_points.restore_point(EDG03)');
  });
  it('refit (an app move) never changes the level', () => {
    start(5);
    const before = path();
    expect(circleEngine.fire('refit')).toBe(true);
    expect(path()).toBe(before);
  });
});

describe('edge point pop-up (edge_edit)', () => {
  const open = () => { start(6); cmd('workflow-edge-open', { 'data-value': photoOf('EDG02'), 'data-point': 'EDG02' }); };
  it('open_point shows the pop-up; Cancel returns to the list on that row', () => {
    open();
    expect(path()).toMatch(/edge_edit@open$/);
    expect(renderGuidedOverlay(doc)).not.toBeNull();
    cmd('workflow-edge-cancel');
    expect(path()).toMatch(/edge_points@list$/);
    expect(renderGuidedOverlay(doc)).toBeNull();
    expect(view().querySelector('[data-testid="edge-item-EDG02"]')!.className).toMatch(/edge-item--focus/);
  });
  it('Save returns to the list', () => {
    open();
    cmd('workflow-edge-save', { 'data-point': 'EDG02' });
    expect(path()).toMatch(/edge_points@list$/);
  });
  it('Delete and Restore in the pop-up stay in the pop-up', () => {
    open();
    const p = photoOf('EDG02');
    cmd('workflow-edge-delete', { 'data-value': p, 'data-point': 'EDG02' });
    expect(path()).toMatch(/edge_edit@open$/);
    cmd('workflow-edge-restore', { 'data-value': p, 'data-point': 'EDG02' });
    expect(path()).toMatch(/edge_edit@open$/);
  });
  it('Retake: viewer, Close back to the pop-up', () => {
    open();
    cmd('workflow-photos', { 'data-step': 'edge-photos', 'data-photo': photoOf('EDG02') });
    expect(path()).toMatch(/edge_photo@viewer$/);
    cmd('workflow-photos-close', { 'data-step': 'edge-photos' });
    expect(path()).toMatch(/edge_edit@open$/);
    expect(renderGuidedOverlay(doc)).not.toBeNull();
  });
  it('Retake: camera, tap screen Save lands on the list with that point in focus (same exit as Add)', () => {
    open();
    cmd('workflow-photos', { 'data-step': 'edge-photos', 'data-photo': photoOf('EDG02') });
    cmd('workflow-photo-retake', { 'data-step': 'edge-photos', 'data-photo': photoOf('EDG02') });
    expect(path()).toMatch(/edge_photo@camera \/ edge_add@camera$/);
    circleCameraEvent('photo_in');
    circleCameraEvent('taps_saved');
    expect(path()).toBe('home@circle / circle_test@edge / edge_points@list');
    expect(circleEngine.focus()).toBe('EDG02');
  });
  it('Retake: camera Cancel also lands on the list', () => {
    open();
    cmd('workflow-photos', { 'data-step': 'edge-photos', 'data-photo': photoOf('EDG02') });
    cmd('workflow-photo-retake', { 'data-step': 'edge-photos', 'data-photo': photoOf('EDG02') });
    circleCameraEvent('camera_cancel');
    expect(path()).toMatch(/edge_points@list$/);
  });
});

describe('step buttons (circle_test@steps) and Help', () => {
  it('replace the roller: Now, Next, All steps, Help', () => {
    const h = start(3);
    expect(h.querySelector('.roller-wheel')).toBeNull();
    expect(tid(h, 'step-current-btn')!.textContent).toMatch(/Now/);
    expect(tid(h, 'step-next')).not.toBeNull();
    cmd('workflow-steps-all');
    const all = view().querySelectorAll('[data-testid^="step-pick-"]');
    expect(all.length).toBeGreaterThan(8);
  });
  it('picking another step leaves the list (pick_step); Edge points / Back go between them', () => {
    start(3);
    cmd('workflow-step-pick', { 'data-step': 'tape-diameter' });
    expect(path()).toBe('home@circle / circle_test@steps');
    const h = view();
    expect(tid(h, 'edge-points-open')).not.toBeNull();
    cmd('workflow-edge-points');
    expect(path()).toMatch(/edge_points@list$/);
    const back = tid(view(), 'edge-back')!;
    expect(back.disabled).toBe(false);
    cmd('workflow-edge-back');
    expect(path()).toBe('home@circle / circle_test@steps');
    expect(runOf(doc).currentStepId).toBe('tape-diameter');
  });
  it('Back is shown but disabled, with its reason, when you did not come from a step', () => {
    const b = tid(start(3), 'edge-back')!;
    expect(b.disabled).toBe(true);
    expect(b.textContent).toMatch(/pick a step/);
  });
  it('back_step: every step has Back to the previous step; the first has it disabled with its reason', () => {
    start(3);
    cmd('workflow-steps-all');
    const ids = [...view().querySelectorAll<HTMLElement>('[data-testid^="step-pick-"]')].map((b) => b.dataset.step!);
    for (let i = ids.length - 1; i > 0; i -= 1) {
      cmd('workflow-step-pick', { 'data-step': ids[i]! });
      const b = tid(view(), 'step-back')!;
      expect(b.disabled, ids[i]).toBe(false);
      expect(b.textContent).toMatch(/^‹ Back: /);
      cmd('workflow-step-back');
      expect(runOf(doc).currentStepId).toBe(ids[i - 1]);
      expect(path()).toMatch(/edge-photos|circle-result/.test(ids[i - 1]!) ? /edge_points@list$/ : /circle_test@steps$/);
    }
    const first = tid(view(), 'step-back')!;
    expect(first.disabled).toBe(true);
    expect(first.textContent).toMatch(/first step/);
  });
  it('Help shows the hierarchy with where you are marked', () => {
    start(3);
    cmd('workflow-help');
    const h = view();
    expect(tid(h, 'help-panel')).not.toBeNull();
    expect(h.querySelector('[data-testid="eng-help-here"]')!.textContent).toMatch(/^Edge points/);
  });
  it('a redraw never moves you (no automatic navigation)', () => {
    start(6);
    const before = path();
    for (let i = 0; i < 3; i += 1) view();
    doc = atStep(doc, runOf(doc).currentStepId);
    view();
    expect(path()).toBe(before);
  });
});
