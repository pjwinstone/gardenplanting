// @vitest-environment happy-dom
/**
 * The circle test branch as nested sub-nets (workflow/nets/circle-test.nets.yaml), checked one
 * net at a time at every level: no dead ends, a way back to the exit from every place, a visible
 * control for every enabled transition in every marking (disabled ones say why), firing a control
 * lands on the place the net says, and nothing moves you unless you tap.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { circleNets } from '../src/workflow/petri/circleNets';
import { checkSubNet, enabledAt, fire, netsBelow, reachablePlaces, NavStack, type SubNet } from '../src/workflow/petri/subnet';
import { commitWorkflow, deleteEdgePointWorkflow, keepRollerPosition, readProgress, saveEdgeNoteWorkflow, scrollWorkflowToStep } from '../src/workflows/guided/engine';
import { guidedNavState, handleWorkflowCommand, installWorkflowChrome, renderGuidedChrome, renderGuidedOverlay, resetGuidedNav } from '../src/workflows/guided/guidedChrome';
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
function run(cmd: string, a: Record<string, string> = {}) {
  const r = handleWorkflowCommand(cmd, doc, attrs(a));
  if (r.doc) doc = r.doc;
  return r;
}
/** One 8-point garden with EDG08 deleted, so Delete and Restore are both enabled in the list. */
function base(): GardenDocument {
  let d = buildCircleDoc(8);
  const row = edgePointRows(d, runOf(d)).find((r) => r.id === 'EDG08')!;
  d = commitWorkflow(d, deleteEdgePointWorkflow(readProgress(d), 'EDG08', row.photoId).progress);
  return d;
}
const photoOf = (id: string) => edgePointRows(doc, runOf(doc)).find((r) => r.id === id)!.photoId;

/** Put the UI in one place of one net (the marking under test). */
const realise: Record<string, Record<string, () => void>> = {
  circle_test: {
    steps: () => { doc = atStep(base(), 'tape-diameter'); },
    edge_points: () => { doc = atStep(base(), 'tape-diameter'); run('workflow-edge-points'); },
  },
  edge_points: {
    list: () => { doc = base(); },
    point: () => { doc = base(); run('workflow-edge-open', { 'data-value': photoOf('EDG02'), 'data-point': 'EDG02' }); },
    fit: () => { doc = base(); run('workflow-edge-fit'); },
  },
  edge_edit: {
    open: () => { doc = base(); run('workflow-edge-open', { 'data-value': photoOf('EDG02'), 'data-point': 'EDG02' }); },
    retake: () => { realise.edge_edit!.open!(); run('workflow-photos', { 'data-step': 'edge-photos', 'data-photo': photoOf('EDG02') }); },
  },
  edge_photo: {
    viewer: () => realise.edge_edit!.retake!(),
  },
  edge_fit: {
    shown: () => realise.edge_points!.fit!(),
  },
};

/** Where the UI is now, in the terms of one net (or `camera` when the result opens it). */
function placeOf(net: string, link?: { to: string }): string {
  const s = guidedNavState(doc);
  const camera = link?.to === 'camera';
  switch (net) {
    case 'circle_test': return !readProgress(doc).activeId ? 'closed' : s.step === 'edge-photos' || s.step === 'circle-result' ? 'edge_points' : 'steps';
    case 'edge_points': return camera ? 'adding' : s.overlay?.startsWith('edge:') || s.overlay?.startsWith('viewer:') ? 'point' : s.fitOpen ? 'fit' : 'list';
    case 'edge_edit': return s.overlay?.startsWith('edge:') ? 'open' : s.overlay?.startsWith('viewer:') ? 'retake' : 'closed';
    case 'edge_photo': return camera ? 'camera' : s.overlay?.startsWith('viewer:') ? 'viewer' : 'done';
    case 'edge_fit': return s.fitOpen ? 'shown' : 'closed';
    default: return '?';
  }
}

const guards: Record<string, () => boolean> = {
  hasPoints: () => edgePointRows(doc, runOf(doc)).length > 0,
  hasLivePoint: () => edgePointRows(doc, runOf(doc)).some((r) => !r.deleted),
  hasDeletedPoint: () => edgePointRows(doc, runOf(doc)).some((r) => r.deleted),
  pointLive: () => !edgePointRows(doc, runOf(doc)).find((r) => r.id === 'EDG02')?.deleted,
  pointDeleted: () => !!edgePointRows(doc, runOf(doc)).find((r) => r.id === 'EDG02')?.deleted,
};

function controlsFor(root: HTMLElement, control: string): HTMLElement[] {
  if (!control.includes('{id}')) return [...root.querySelectorAll<HTMLElement>(`[data-testid="${control}"]`)];
  const [pre, post] = control.split('{id}');
  return [...root.querySelectorAll<HTMLElement>('[data-testid]')].filter((n) => n.dataset.testid!.startsWith(pre!) && n.dataset.testid!.endsWith(post!) && /EDG\d+/.test(n.dataset.testid!));
}

/** The DOM part of the dead-end table: each reachable, on-screen place of each net. */
const table: string[] = [];

describe('circle test sub-nets', () => {
  beforeEach(() => {
    clearSwiped();
    resetGuidedNav();
    vi.stubGlobal('confirm', () => true);
    installWorkflowChrome(() => {}, (u) => { doc = u(doc); });
  });

  const all = netsBelow(circleNets);

  it('has the three levels (and deeper): Home > Circle test > Edge points > Add / Pop-up / Fit > Retake', () => {
    expect(all.map((n) => `${n.level}:${n.id}`)).toEqual(['1:home', '2:circle_test', '3:edge_points', '4:edge_add', '4:edge_edit', '5:edge_photo', '4:edge_fit']);
  });

  for (const net of all) {
    it(`${net.id}: structure — no dead end, an exit from every place, a control for every user move, refit never navigates`, () => {
      expect(checkSubNet(circleNets, net)).toEqual([]);
      for (const p of reachablePlaces(net)) {
        for (const t of enabledAt(net, p).filter((x) => x.auto)) expect(fire(net, p, t.id)).toBe(p);
      }
    });
  }

  for (const net of all.filter((n) => realise[n.id])) {
    for (const place of reachablePlaces(net).filter((p) => realise[net.id]![p])) {
      it(`${net.id} @ ${place}: every enabled transition has a visible control, and firing it lands where the net says`, () => {
        resetGuidedNav();
        realise[net.id]![place]!();
        expect(placeOf(net.id)).toBe(place);
        const enabled = enabledAt(net as SubNet, place, (g) => guards[g]?.() ?? true).filter((t) => t.user && !t.external && t.control);
        // A refined place with no own buttons is driven by its child net (checked on its own).
        if (!net.places.find((p) => p.id === place)?.refines && !net.exits.includes(place)) expect(enabled.length).toBeGreaterThan(0);
        for (const t of enabled) {
          resetGuidedNav();
          realise[net.id]![place]!();
          const root = view();
          const ctl = controlsFor(root, t.control!);
          table.push(`${net.id} | ${place} | ${t.id} | ${t.control} | ${ctl.length ? (ctl[0]!.hasAttribute('disabled') ? `disabled: ${ctl[0]!.dataset.why}` : 'shown') : 'MISSING'}`);
          expect(ctl.length, `${net.id}@${place}: ${t.id} needs a control ${t.control}`).toBeGreaterThan(0);
          const c = ctl.find((n) => !n.hasAttribute('disabled')) ?? ctl[0]!;
          expect(c.hidden).toBe(false);
          if (c.hasAttribute('disabled')) {
            expect(c.dataset.why, `${t.control} is disabled without a reason`).toBeTruthy();
            continue;
          }
          // Into a black box (the tap screen is drawn by the app shell): the control is enough.
          if (net.places.find((p) => p.id === t.to)?.external && c.dataset.cmd === 'open-photo-mark') continue;
          const r = handleWorkflowCommand(c.dataset.cmd!, doc, c);
          if (r.doc) doc = r.doc;
          expect(placeOf(net.id, r.link), `${net.id}@${place} --${t.id}-->`).toBe(t.to);
        }
      });
    }
  }

  it('the child-exit transitions bring you back with focus on the row you were on', () => {
    doc = base();
    run('workflow-edge-open', { 'data-value': photoOf('EDG05'), 'data-point': 'EDG05' });
    run('workflow-photos', { 'data-step': 'edge-photos', 'data-photo': photoOf('EDG05') });
    run('workflow-photos-close');
    expect(guidedNavState(doc).overlay).toBe('edge:EDG05'); // Back pops one level: the pop-up
    run('workflow-edge-cancel');
    expect(guidedNavState(doc).overlay).toBeNull();
    expect(view().querySelector('[data-testid="edge-row-EDG05"]')!.className).toMatch(/edge-row--focus/);
    run('workflow-edge-delete', { 'data-value': photoOf('EDG03'), 'data-point': 'EDG03' });
    const row = view().querySelector('[data-testid="edge-row-EDG03"]')!;
    expect(row.className).toMatch(/base-list-deleted/);
    expect(row.className).toMatch(/edge-row--focus/);
    expect(view().querySelector('[data-testid="edge-restore-EDG03"]')).toBeTruthy();
    expect(guidedNavState(doc).step).toBe('edge-photos');
  });

  it('nothing changes the level or the screen unless you tap: redraws, refits, uploads and a OneDrive copy', () => {
    doc = base();
    run('workflow-edge-open', { 'data-value': photoOf('EDG02'), 'data-point': 'EDG02' });
    const before = JSON.stringify(guidedNavState(doc));
    // Background work: a refit (a note and a delete elsewhere change the fit input), a 13th photo
    // arriving and verifying, many redraws, and a OneDrive copy with an older roller position.
    const p = doc.photos.find((x) => x.id === photoOf('EDG04'))!;
    doc = { ...doc, photos: [...doc.photos, { ...p, id: 'late', originalFile: { ...p.originalFile!, capturedAt: '2026-10-28T12:00:00.000Z', receivedAt: '2026-10-28T12:00:00.000Z' } }] };
    doc = commitWorkflow(doc, saveEdgeNoteWorkflow(readProgress(doc), 'EDG06', 'odd').progress);
    for (let i = 0; i < 5; i++) view();
    const remote = atStep(doc, 'setup');
    doc = keepRollerPosition(remote, doc);
    view();
    expect(JSON.stringify(guidedNavState(doc))).toBe(before);
    expect(edgePointRows(doc, runOf(doc)).map((r) => r.id)).toContain('EDG09');
  });

  it('Confirm Set-up does not auto-advance', () => {
    doc = atStep(buildCircleDoc(3), 'setup');
    run('workflow-confirm-setup');
    expect(guidedNavState(doc).step).toBe('setup');
  });

  it('Add edge point is always there, also with 12 photos (the 13th is EDG13), and opens the camera', () => {
    doc = buildCircleDoc(12);
    const root = view();
    const add = root.querySelector<HTMLButtonElement>('[data-testid="edge-add"]')!;
    expect(add.disabled).toBe(false);
    expect(add.dataset.why).toMatch(/The next one is EDG13/);
    expect(run('workflow-edge-add').link).toEqual({ to: 'camera', stepId: 'edge-photos', cameraPositionId: 'Edge points' });
    const p = doc.photos.find((x) => x.id === 'edge12')!;
    doc = { ...doc, photos: [...doc.photos, { ...p, id: 'edge13', originalFile: { ...p.originalFile!, capturedAt: '2026-10-28T13:00:00.000Z', receivedAt: '2026-10-28T13:00:00.000Z' } }] };
    const after = view();
    expect(after.querySelector('[data-testid="edge-row-EDG13"]')!.className).toMatch(/edge-row--focus/);
    expect(after.querySelector('[data-testid="edge-summary"]')!.textContent).toMatch(/^13 points · /);
  });

  it('three points: Add says one more gives residuals; Circle fit is shown', () => {
    doc = buildCircleDoc(3);
    const root = view();
    expect(root.querySelector<HTMLElement>('[data-testid="edge-add"]')!.dataset.why).toMatch(/3 points so far, 1 more gives residuals/);
    expect(root.querySelector<HTMLButtonElement>('[data-testid="edge-fit-open"]')!.disabled).toBe(false);
    doc = buildCircleDoc(2);
    const two = view().querySelector<HTMLButtonElement>('[data-testid="edge-fit-open"]')!;
    expect(two.disabled).toBe(true);
    expect(two.dataset.why).toMatch(/Needs 3 edge points in the fit \(2 now\)/);
  });

  it('Back pops one level of the navigation stack', () => {
    const s = new NavStack();
    s.push({ net: 'circle_test', place: 'steps', focus: 'tape-diameter' });
    s.push({ net: 'edge_points', place: 'list', focus: 'EDG02' });
    s.push({ net: 'edge_edit', place: 'open', focus: 'EDG02|p' });
    expect(s.pop()!.net).toBe('edge_edit');
    expect(s.popTo('circle_test')!.focus).toBe('tape-diameter');
    expect(s.depth()).toBe(0);
  });

  it('the Home net hooks the circle test button that the Home screen draws', () => {
    expect(readFileSync('src/screens/pointScreen.ts', 'utf8')).toMatch(/testid: 'home-circle-test'/);
    if (process.env.NET_TABLE) console.log(['net | place | transition | control | on screen', ...table].join('\n'));
  });
});
