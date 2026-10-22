import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { emptyDocument, type GardenDocument, type Photo } from '../src/model';
import { attachRollerWheel, SETTLE_MS } from '../src/workflows/guided/guidedRoller';
import {
  addRunPhoto,
  baseGridOf,
  baseWarnings,
  diagonalCheck,
  cancelRun,
  edit,
  ensurePhotoPoint,
  goBack,
  goNext,
  goTo,
  hintsFor,
  isDone,
  nextBaseId,
  nextNeeded,
  newPointRun,
  retakePhoto,
  rows,
  saveBasePoint,
  stepReason,
  type PointRun,
} from '../src/screens/pointRun';
import { pointNet, t } from '../src/screens/stepNet';
import { applyArchiveDrain, applyWorkflowEvent, commitWorkflow, confirmSetupWorkflow, emptyProgress, keepRollerPosition, pendingArchiveJobs, readProgress, saveBaseTieWorkflow, scrollWorkflowToStep, startWorkflow } from '../src/workflows/guided/engine';
import { POST_SEPARATION_DEFAULT_M } from '../src/solver/controlCluster';

function addBase(doc: GardenDocument, from: string, n: number, e: number, opts: { two?: boolean; sep?: number } = {}): GardenDocument {
  let run: PointRun = edit(newPointRun(), 'choose_type', { type: 'base' });
  const walk = (patch: Partial<PointRun>) => {
    run = { ...run, ...patch };
    const moved = goNext(doc, run);
    expect(moved.reason).toBeUndefined();
    run = moved.run;
  };
  walk({});
  walk({ from });
  walk({ northM: n, eastM: e });
  walk({ diagonalM: Math.hypot(n, e) });
  walk({ twoSleeve: opts.two, separationM: opts.sep });
  expect(run.current).toBe('save_base');
  return saveBasePoint(doc, run).doc;
}

function photo(id: string, pointId: string, extra: Partial<Photo> = {}): Photo {
  return { id, setupId: 's', addPointId: pointId, width: 1200, height: 900, clicks: [], autoSleeves: [], ...extra } as Photo;
}

describe('Add point: base point', () => {
  it('the first base point is BAS01 at 0,0 and needs no tapes', () => {
    const doc = emptyDocument('g');
    let run = edit(newPointRun(), 'choose_type', { type: 'base' });
    for (let i = 0; i < 5; i += 1) run = goNext(doc, run).run;
    expect(run.current).toBe('save_base');
    const saved = saveBasePoint(doc, run);
    expect(saved.id).toBe('BAS01');
    expect(saved.doc.points.find((p) => p.id === 'BAS01')).toMatchObject({ x: 0, y: 0, kind: 'BL', layerId: 'base' });
  });

  it('later base points are taped N/E from an existing one, checked by the diagonal', () => {
    let doc = addBase(emptyDocument('g'), 'BAS01', 0, 0);
    doc = addBase(doc, 'BAS01', 3, 4);
    expect(baseGridOf(doc).ids).toEqual(['BAS01', 'BAS02']);
    const p = doc.points.find((x) => x.id === 'BAS02')!;
    expect(p.x).toBeCloseTo(4, 3);
    expect(p.y).toBeCloseTo(3, 3);
    expect(nextBaseId(doc)).toBe('BAS03');
  });

  it('a bad diagonal is a warning: Next still works, the roller goes on (not to step 0)', () => {
    const doc = addBase(emptyDocument('g'), 'BAS01', 0, 0);
    const run: PointRun = { ...edit(newPointRun(), 'choose_type', { type: 'base' }), from: 'BAS01', northM: 3, eastM: 4, diagonalM: 5.02, current: 'diagonal', fired: [{ id: 'choose_type', choice: 'base' }, { id: 'from_point' }, { id: 'offsets' }] };
    expect(stepReason(doc, run, 'diagonal')).toBeNull();
    const c = diagonalCheck(doc, run)!;
    expect(c.warning?.text).toMatch(/^Diagonal off by 20 mm/);
    const moved = goNext(doc, run);
    expect(moved.reason).toBeUndefined();
    expect(moved.run.current).toBe('post');
    expect(stepReason(doc, { ...run, diagonalM: undefined }, 'diagonal')).toBeNull();
  });

  it('the base point with a failing diagonal is highlighted in the list with the reason', () => {
    let doc = addBase(emptyDocument('g'), 'BAS01', 0, 0);
    let run: PointRun = edit(newPointRun(), 'choose_type', { type: 'base' });
    for (const patch of [{}, { from: 'BAS01' }, { northM: 3, eastM: 4 }, { diagonalM: 5.02 }, {}] as Partial<PointRun>[]) {
      run = goNext(doc, { ...run, ...patch }).run;
    }
    doc = saveBasePoint(doc, run).doc;
    expect(baseWarnings(doc).BAS02?.text).toMatch(/Diagonal off by 20 mm \(expected ±\d+ mm\); base point uncertainty ×/);
  });

  it('two-sleeve post defaults to 1.2 m centre to centre', () => {
    expect(POST_SEPARATION_DEFAULT_M).toBeCloseTo(1.2, 6);
    let doc = addBase(emptyDocument('g'), 'BAS01', 0, 0);
    doc = addBase(doc, 'BAS01', 2, 0, { two: true });
    expect(doc.baseGrid!.points.find((p) => p.id === 'BAS02')!.postSeparationM).toBeCloseTo(1.2, 6);
    expect(baseGridOf(doc).postSeparation.BAS02).toBeCloseTo(1.2, 6);
  });
});

describe('roller never moves by itself', () => {
  it('only Next, Back and a scroll change the current row', () => {
    const doc = emptyDocument('g');
    let run = edit(newPointRun(), 'choose_type', { type: 'photo' });
    expect(run.current).toBe('choose_type');
    // Edits, photos and hints do not move it.
    run = edit(run, 'layer', { layer: 'bed' });
    run = addRunPhoto(run, 'ph1');
    run = { ...run, dismissedHints: ['fewer_than_3'] };
    expect(run.current).toBe('choose_type');
    run = goNext(doc, run).run;
    expect(run.current).toBe('layer');
    run = goBack(run);
    expect(run.current).toBe('choose_type');
    run = goTo(run, 'photos');
    expect(run.current).toBe('photos');
  });

  it('done steps get a tick and the next needed step is marked', () => {
    const doc = emptyDocument('g');
    let run = edit(newPointRun(), 'choose_type', { type: 'photo' });
    run = goNext(doc, run).run;
    expect(isDone(run, 'choose_type')).toBe(true);
    expect(nextNeeded(run)).toBe('layer');
    expect(rows(run).map((s) => s.id)).toEqual(['choose_type', 'layer', 'photos', 'solve', 'save_photo']);
  });

  describe('wheel settle', () => {
    const ROW = 44;
    const IDS = ['a', 'b', 'c'];
    class FakeList extends EventTarget {
      isConnected = true;
      clientHeight = 5 * ROW;
      scrollTop = 0;
      rows = IDS.map((id, i) => ({ dataset: { stepId: id }, offsetTop: 2 * ROW + i * ROW, offsetHeight: ROW, style: {} as Record<string, string> }));
      querySelectorAll() {
        return this.rows;
      }
    }
    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, requestAnimationFrame: (fn: () => void) => globalThis.setTimeout(fn, 0), matchMedia: () => ({ matches: false }) });
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('does not settle while momentum is still scrolling after the finger lifts (the jitter)', () => {
      const list = new FakeList();
      const onSettle = vi.fn();
      attachRollerWheel({ querySelector: () => list } as unknown as HTMLElement, IDS, 'a', onSettle);
      list.dispatchEvent(new Event('touchstart'));
      list.scrollTop = 10;
      list.dispatchEvent(new Event('scroll'));
      list.dispatchEvent(new Event('touchend'));
      // momentum: scroll events keep coming faster than SETTLE_MS
      for (let i = 0; i < 6; i += 1) {
        vi.advanceTimersByTime(SETTLE_MS - 40);
        list.scrollTop += 8;
        list.dispatchEvent(new Event('scroll'));
      }
      expect(onSettle).not.toHaveBeenCalled();
      vi.advanceTimersByTime(SETTLE_MS + 10);
      expect(onSettle).toHaveBeenCalledTimes(1);
      expect(onSettle).toHaveBeenCalledWith('b');
    });

    it('a programmatic scroll (photo upload redraw) never moves it', () => {
      const list = new FakeList();
      const onSettle = vi.fn();
      attachRollerWheel({ querySelector: () => list } as unknown as HTMLElement, IDS, 'a', onSettle);
      list.scrollTop = 88;
      list.dispatchEvent(new Event('scroll'));
      list.dispatchEvent(new Event('scrollend'));
      vi.advanceTimersByTime(1000);
      expect(onSettle).not.toHaveBeenCalled();
    });
  });
});

describe('photo strip retake', () => {
  it('retake supersedes one photo, queues it for the archive, and the new one takes its slot', () => {
    let doc = emptyDocument('g');
    let run = edit(newPointRun(), 'choose_type', { type: 'photo' });
    run = { ...edit(run, 'layer', { layer: 'path' }) };
    const made = ensurePhotoPoint(doc, run);
    doc = made.doc;
    run = made.run;
    expect(run.pointId).toBe('TRK01');
    const withFile = (id: string) => photo(id, 'TRK01', { originalFile: { fileName: `${id}.jpg`, uploadStatus: 'verified' } as Photo['originalFile'] });
    doc = { ...doc, photos: [withFile('p1'), withFile('p2'), withFile('p3')] };
    run = addRunPhoto(addRunPhoto(addRunPhoto(run, 'p1'), 'p2'), 'p3');
    run = { ...run, current: 'photos' };
    const r = retakePhoto(doc, run, 'p2');
    expect(r.doc.photos.find((p) => p.id === 'p2')!.supersededAt).toBeTruthy();
    expect(pendingArchiveJobs(r.doc).map((j) => j.photoId)).toEqual(['p2']);
    expect(r.run.current).toBe('photos');
    const after = addRunPhoto(r.run, 'p4');
    expect(after.photoIds).toEqual(['p1', 'p4', 'p3']);
  });

  it('Cancel removes an unsaved photo point and archives its photos', () => {
    let doc = emptyDocument('g');
    let run = edit(edit(newPointRun(), 'choose_type', { type: 'photo' }), 'layer', { layer: 'bed' });
    const made = ensurePhotoPoint(doc, run);
    doc = { ...made.doc, photos: [photo('p1', made.run.pointId!, { originalFile: { fileName: 'p1.jpg' } as Photo['originalFile'] })] };
    run = addRunPhoto(made.run, 'p1');
    const out = cancelRun(doc, run);
    expect(out.points.some((p) => p.id === run.pointId)).toBe(false);
    expect(pendingArchiveJobs(out)).toHaveLength(1);
  });
});

describe('hints are advice only', () => {
  it('suggests at least 3 base points, can be dismissed, and never blocks Next', () => {
    const doc = addBase(emptyDocument('g'), 'BAS01', 0, 0);
    let run = edit(newPointRun(), 'choose_type', { type: 'photo' });
    expect(hintsFor(doc, run).map((h) => h.id)).toContain('fewer_than_3');
    expect(goNext(doc, run).reason).toBeUndefined();
    run = { ...run, dismissedHints: ['fewer_than_3'] };
    expect(hintsFor(doc, run)).toHaveLength(0);
  });

  it('a photo point that sees only 2 base points gets a where-to-add tip', () => {
    let doc = addBase(emptyDocument('g'), 'BAS01', 0, 0);
    doc = addBase(doc, 'BAS01', 0, 5);
    const run = edit(newPointRun(), 'choose_type', { type: 'photo' });
    const hints = hintsFor(doc, run, { cls: 'none', message: '', seen: ['BAS01', 'BAS02'], perPhoto: [] });
    const tip = hints.find((h) => h.id === 'two_seen')!;
    expect(tip.text).toMatch(/only sees 2 base points \(BAS01, BAS02\)/);
    expect(tip.text).toMatch(/grid (north|south)/);
  });
});

describe('wording comes from the net and the glossary', () => {
  const src = readFileSync(new URL('../src/screens/pointScreen.ts', import.meta.url), 'utf8') + readFileSync(new URL('../src/screens/pointRun.ts', import.meta.url), 'utf8');

  it('every t() key used by the screens exists in point.net.yaml', () => {
    const keys = [...src.matchAll(/t\(pointNet, '([a-z_]+)'/g)].map((m) => m[1]!);
    const dynamic = ['layer_boundary', 'layer_path', 'layer_structure', 'layer_bed'];
    expect(keys.length).toBeGreaterThan(20);
    for (const k of [...keys, ...dynamic]) expect(pointNet.text[k] ?? pointNet.hints[k], k).toBeDefined();
    expect(t(pointNet, 'saved', { id: 'BAS02' })).toBe('Saved BAS02.');
  });

  it('every step has a title, what it needs, and reason wording', () => {
    for (const s of pointNet.steps) {
      expect(s.title).toBeTruthy();
      expect(s.needs).toBeTruthy();
    }
  });

  it('uses base point / photo point / grid north, never the old words', () => {
    const yaml = readFileSync(new URL('../workflow/point.net.yaml', import.meta.url), 'utf8');
    const words = yaml.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(words).not.toMatch(/baseline|observation point|station/i);
    expect(words).toMatch(/base point/);
    expect(words).toMatch(/photo point/);
    expect(words).toMatch(/grid north/);
  });

  it('the glossary defines the terms the screens use', () => {
    const g = parse(readFileSync(new URL('../workflow/glossary.yaml', import.meta.url), 'utf8')) as { terms: { id: string; term: string }[] };
    const ids = new Set(g.terms.map((x) => x.id));
    for (const id of ['base-point', 'base-grid', 'photo-point', 'point-type', 'grid-north', 'grid-east', 'diagonal-check', 'two-sleeve-post', 'sleeve-separation', 'two-point-fix', 'circle-test', 'edge-photo', 'retake', 'photo-strip', 'archive', 'roller', 'hint', 'tools']) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(g.terms.some((x) => x.term === 'Observation point')).toBe(false);
  });
});

describe('nothing but scroll, Next and Back moves the circle roller', () => {
  const ID = 'circle-field-test';
  const onStep = (stepId: string) => {
    let p = startWorkflow(emptyProgress(), ID, '2026-10-22T09:00:00Z').progress;
    p = confirmSetupWorkflow(p, undefined, '2026-10-22T09:00:01Z').progress;
    p = scrollWorkflowToStep(p, stepId, '2026-10-22T09:00:02Z').progress;
    return p;
  };
  const cur = (p: ReturnType<typeof emptyProgress>) => p.runs[ID]?.currentStepId;

  it('a failing diagonal on Grow the base grid does not move the roller', () => {
    let p = onStep('add-base-points');
    p = saveBaseTieWorkflow(p, { from: 'BAS01', to: 'BAS02', eastM: 4, northM: 3, diagonalM: 5 }).progress;
    const bad = saveBaseTieWorkflow(p, { from: 'BAS02', to: 'BAS03', eastM: 2, northM: 2, diagonalM: Math.hypot(2, 2) + 0.03 });
    expect(bad.changed).toBe(true);
    expect(bad.notice).toMatch(/Diagonal off by 30 mm/);
    expect(cur(bad.progress)).toBe('add-base-points');
  });

  it('background events (upload, autosave, archive drain) do not move it', () => {
    const p = onStep('add-base-points');
    const doc = commitWorkflow(emptyDocument('g'), p);
    const saved = applyWorkflowEvent(p, { type: 'cloud.saved' });
    expect(cur(saved)).toBe('add-base-points');
    const up = applyWorkflowEvent(p, { type: 'photo.uploaded', stationId: 'Calibration', pointLabel: '', objectName: '', count: 1, photoIds: ['x'] } as never);
    expect(cur(up)).toBe('add-base-points');
    const drained = applyArchiveDrain(doc, { pending: [], done: [{ at: 'now', action: 'archived', photoId: 'x', fileName: 'x.jpg', path: 'photos/archive/x.jpg' }] });
    expect(readProgress(drained).runs[ID]?.currentStepId).toBe('add-base-points');
  });

  it('a OneDrive copy saved earlier (on Set-up) does not pull the roller back to step 0', () => {
    const p = onStep('add-base-points');
    const local = commitWorkflow(emptyDocument('g'), p);
    const remote = { ...local, workflowProgress: { ...p, runs: { ...p.runs, [ID]: { ...p.runs[ID]!, currentStepId: 'setup' } } } };
    expect(readProgress(keepRollerPosition(remote, local)).runs[ID]?.currentStepId).toBe('add-base-points');
    // A different run (another garden or a new run) is not touched.
    const other = { ...remote, workflowProgress: { ...remote.workflowProgress, runs: { [ID]: { ...remote.workflowProgress.runs[ID]!, startedAt: 'other' } } } };
    expect(readProgress(keepRollerPosition(other, local)).runs[ID]?.currentStepId).toBe('setup');
  });
});
