import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { appendPhotoToPoint } from '../src/layers';
import { emptyDocument, type GardenDocument, type PhotoUploadStatus } from '../src/model';
import {
  ACTION_GUARDS,
  ACTION_PLACES,
  ACTION_TRANSITIONS,
  actionPillClass,
  actionPillCommand,
  actionPillLabel,
  deriveActionState,
  doneBlocker,
  doneBlockerNotice,
  enabledActions,
  fireAction,
  type ActionEvent,
  type ActionState,
} from '../src/workflows/guided/actionNet';
import { ensureCameraPositionPoint } from '../src/workflows/guided/cameraCapture';
import { circleFieldTest } from '../src/workflows/guided/definitions';
import {
  advanceWorkflow,
  commitWorkflow,
  confirmSetupWorkflow,
  doneWorkflow,
  emptyProgress,
  readProgress,
  rejectEvidenceWorkflow,
  retakeEvidenceWorkflow,
  scrollWorkflowToStep,
  skipWithNoteWorkflow,
  startWorkflow,
  tickWorkflow,
  withWorkflowEvent,
  workflowAfterUploadedPhoto,
} from '../src/workflows/guided/engine';
import { handleWorkflowCommand, workflowShowsNotice } from '../src/workflows/guided/guidedChrome';
import type { WorkflowRun, WorkflowStep } from '../src/workflows/guided/types';

const ID = 'circle-field-test';
const T0 = '2026-06-01T12:00:00.000Z';
let clock = Date.parse(T0);
const tick = () => new Date((clock += 1000)).toISOString();

const EVENTS: ActionEvent[] = ['start', 'photo_taken', 'upload_verified', 'photo_refused', 'upload_failed', 'retake', 'retake_done', 'retry', 'settled_by_hand', 'recheck'];

// ---------------------------------------------------------------------------
// 1. The sub-net on its own, walked exhaustively.
// ---------------------------------------------------------------------------
describe('action sub-net (workflow/action.net.yaml)', () => {
  const yaml = parse(readFileSync('workflow/action.net.yaml', 'utf8')) as {
    places: Array<{ id: string; colour: string }>;
    transitions: Array<{ id: string; from: string[]; to: string; guard?: string; recovery?: string }>;
    guards: Record<string, string>;
  };

  it('YAML and TS list the same places, transitions and guards', () => {
    expect(yaml.places.map((p) => p.id)).toEqual(ACTION_PLACES);
    const norm = (t: { id: string; from: string[]; to: string; guard?: string; recovery?: string }) =>
      JSON.stringify([t.id, [...t.from].sort(), t.to, t.guard ?? null, t.recovery ?? null]);
    expect(yaml.transitions.map(norm).sort()).toEqual(ACTION_TRANSITIONS.map(norm).sort());
    for (const g of Object.keys(ACTION_GUARDS)) expect(yaml.guards[g]).toBeTruthy();
    expect(Object.fromEntries(yaml.places.map((p) => [p.id, p.colour]))).toMatchObject({ idle: 'grey', done: 'green', error: 'red' });
  });

  for (const need of [1, 2]) {
    it(`every reachable marking (minPhotos ${need}): all places reached, every transition fires, done always reachable`, () => {
      const key = (s: ActionState) => JSON.stringify([s.place, s.have ?? 0, s.recovery ?? null]);
      const start: ActionState = { place: 'idle', need, have: 0 };
      const seen = new Map<string, ActionState>([[key(start), start]]);
      const edges = new Map<string, string[]>();
      const fired = new Set<string>();
      const queue = [start];
      while (queue.length) {
        const s = queue.shift()!;
        const out: string[] = [];
        for (const ev of EVENTS) {
          const n = fireAction(s, ev, 'why');
          if (n === s) continue;
          const t = enabledActions(s).find((x) => x.id === ev)!;
          fired.add(`${t.id}:${t.to}`);
          if (n.place === 'error') {
            expect(n.reason).toBeTruthy();
            expect(n.recovery).toBeTruthy();
          }
          expect(n.have ?? 0).toBeLessThanOrEqual(need);
          out.push(key(n));
          if (!seen.has(key(n))) {
            seen.set(key(n), n);
            queue.push(n);
          }
        }
        edges.set(key(s), out);
      }
      expect(new Set([...seen.values()].map((s) => s.place))).toEqual(new Set(ACTION_PLACES));
      for (const t of ACTION_TRANSITIONS) {
        if (need === 1 && t.guard === 'morePhotosNeeded') continue; // a 1-photo step never needs more
        expect(fired.has(`${t.id}:${t.to}`), `${t.id} → ${t.to}`).toBe(true);
      }
      // Liveness: from every marking, `done` is reachable WITHOUT a hand tick (photo path only).
      for (const [k, s] of seen) {
        const stack = [s];
        const visited = new Set([k]);
        let ok = s.place === 'done';
        while (stack.length && !ok) {
          const cur = stack.pop()!;
          for (const ev of EVENTS.filter((e) => e !== 'settled_by_hand')) {
            const n = fireAction(cur, ev, 'why');
            if (n === cur || visited.has(key(n))) continue;
            if (n.place === 'done') ok = true;
            visited.add(key(n));
            stack.push(n);
          }
        }
        expect(ok, `done reachable from ${k}`).toBe(true);
      }
    });
  }

  it('illegal events leave the marking unchanged', () => {
    const idle: ActionState = { place: 'idle', need: 1, have: 0 };
    for (const ev of ['photo_taken', 'upload_verified', 'upload_failed', 'retake', 'retry', 'recheck'] as ActionEvent[]) {
      expect(fireAction(idle, ev)).toBe(idle);
    }
    const refused = fireAction(fireAction(idle, 'start'), 'photo_refused', 'Portrait');
    expect(fireAction(refused, 'retry')).toBe(refused); // a refused photo cannot be re-sent, only retaken
  });

  it('pill colour, text and command come only from the place', () => {
    const step = circleFieldTest.steps.find((s) => s.id === 'edge-photos')!;
    const cases: Array<[ActionState, string, string, string]> = [
      [{ place: 'idle', need: 2, have: 0 }, 'act-idle', 'Take photos', 'workflow-go'],
      [{ place: 'in_progress', need: 2, have: 1 }, 'act-in_progress', 'Take photo 2 of 2', 'workflow-go'],
      [{ place: 'in_progress', need: 2, have: 1, markPhotoId: 'ph-2', markNumber: 2 }, 'act-in_progress', 'Mark photo 2 of 2', 'open-photo-mark'],
      [{ place: 'uploading', need: 2, have: 1 }, 'act-uploading', 'Uploading…', 'workflow-go'],
      [{ place: 'done', need: 2, have: 2 }, 'act-done', '✓ Photos in', 'workflow-go'],
      [{ place: 'error', recovery: 'retake', reason: 'x' }, 'act-error', 'Retake', 'workflow-retake'],
      [{ place: 'error', recovery: 'retry', reason: 'x' }, 'act-error', 'Retry upload', 'photo-upload-retry'],
    ];
    for (const [s, cls, label, cmd] of cases) {
      expect(actionPillClass(s)).toBe(`roller-pill ${cls}`);
      expect(actionPillLabel(step, s)).toBe(label);
      expect(actionPillCommand(s)).toBe(cmd);
    }
    const css = readFileSync('src/workflows/guided/guidedRoller.css', 'utf8');
    const base = /\.roller-pill \{[^}]*\}/.exec(css)![0];
    expect(base).not.toMatch(/background/); // no hard-coded colour on the bare pill
    for (const p of ACTION_PLACES) expect(css).toContain(`.roller-pill.act-${p}`);
  });
});

// ---------------------------------------------------------------------------
// 2. Top net with sub-nets composed, on a real document.
// ---------------------------------------------------------------------------
function fresh(): GardenDocument {
  clock = Date.parse(T0);
  let p = startWorkflow(emptyProgress(), ID, T0).progress;
  p = confirmSetupWorkflow(p, undefined, T0).progress;
  return commitWorkflow(emptyDocument('Circle day'), p);
}
const run = (doc: GardenDocument): WorkflowRun => readProgress(doc).runs[ID]!;
const step = (id: string): WorkflowStep => circleFieldTest.steps.find((s) => s.id === id)!;
const action = (doc: GardenDocument, id: string) => deriveActionState(doc, run(doc), step(id));
const moveTo = (doc: GardenDocument, id: string) => commitWorkflow(doc, scrollWorkflowToStep(readProgress(doc), id, tick()).progress);
const camera = (id: string) => (step(id).complete as { stationId: string; minPhotos: number });

function setStatus(doc: GardenDocument, photoId: string, status: PhotoUploadStatus, extra: Record<string, unknown> = {}): GardenDocument {
  const at = tick();
  const next: GardenDocument = {
    ...doc,
    photos: doc.photos.map((p) =>
      p.id === photoId
        ? {
            ...p,
            exifDateTimeOriginal: p.exifDateTimeOriginal ?? at,
            originalFile: {
              fileName: `${p.id}.jpg`, size: 10, quickXorHash: 'h', contentType: 'image/jpeg',
              capturedAt: p.originalFile?.capturedAt ?? at, receivedAt: p.originalFile?.receivedAt ?? at,
              ...p.originalFile, uploadStatus: status, ...extra,
            },
          }
        : p,
    ),
  };
  return status === 'verified' ? workflowAfterUploadedPhoto(next, photoId, tick()) : next;
}

/** Tap screen saved (what saveGuidedTaps records). */
function markTaps(doc: GardenDocument, photoId: string): GardenDocument {
  return { ...doc, photos: doc.photos.map((p) => (p.id === photoId ? { ...p, tapsSavedAt: tick() } : p)) };
}

/** Shutter on the in-app camera for this step. Returns the new photo id. */
function shoot(doc: GardenDocument, stepId: string): { doc: GardenDocument; photoId: string; unmarked: GardenDocument } {
  const ensured = ensureCameraPositionPoint(doc, camera(stepId).stationId);
  const now = vi.spyOn(Date, 'now').mockReturnValue(clock += 1000); // unique ph-<ms> id
  const appended = appendPhotoToPoint(ensured.doc, ensured.pointId, { thumbnailDataUrl: 'data:image/jpeg;base64,AAAA', yawOnly: true, width: 4032, height: 3024 });
  now.mockRestore();
  expect(appended.reason).toBeUndefined();
  const photoId = appended.doc.photos.at(-1)!.id;
  const queued = setStatus(appended.doc, photoId, 'queued');
  return { doc: markTaps(queued, photoId), photoId, unmarked: queued };
}

/** One photo through the sub-net: taken → uploading → verified, checking the pill at each place. */
function photoThrough(doc: GardenDocument, stepId: string, last: boolean): GardenDocument {
  const shot = shoot(doc, stepId);
  doc = shot.doc;
  const needed = camera(stepId).minPhotos;
  // While a non-last photo uploads, the pill already offers the next photo (blue, enabled).
  const inFlight = last ? 'uploading' : 'in_progress';
  expect(action(doc, stepId).place).toBe(inFlight);
  doc = setStatus(doc, shot.photoId, 'uploading');
  expect(action(doc, stepId).place).toBe(inFlight);
  if (!last && needed > 1) expect(actionPillLabel(step(stepId), action(doc, stepId))).toMatch(new RegExp(`^Take photo \\d+ of ${needed}$`));
  doc = setStatus(doc, shot.photoId, 'verified');
  expect(action(doc, stepId).place).toBe(last ? 'done' : 'in_progress');
  return doc;
}

function walkToEnd(doc: GardenDocument, opts: { stopAt?: string } = {}): GardenDocument {
  for (const s of circleFieldTest.steps) {
    if (s.id === opts.stopAt) return doc;
    doc = moveTo(doc, s.id);
    expect(action(doc, s.id).place).toBe('idle');
    const c = s.complete;
    if ('on' in c && c.on === 'photo.uploaded') {
      for (let i = 0; i < c.minPhotos; i += 1) doc = photoThrough(doc, s.id, i === c.minPhotos - 1);
    } else if ('on' in c && c.on === 'cloud.saved') {
      doc = withWorkflowEvent(doc, { type: 'cloud.saved' }, tick());
    } else {
      doc = commitWorkflow(doc, tickWorkflow(readProgress(doc), s.id, undefined, tick()).progress);
    }
    expect(action(doc, s.id).place, s.id).toBe('done');
  }
  return doc;
}

describe('field test with every step\'s action sub-net composed', () => {
  it('happy path 0..12: every pill goes grey → (blue) → uploading → green, then Done finishes', () => {
    let doc = walkToEnd(fresh());
    expect(doneBlocker(doc, circleFieldTest.steps, run(doc))).toBeUndefined();
    const done = doneWorkflow(readProgress(doc), tick());
    expect(done.progress.runs[ID]?.finishedAt).toBeTruthy();
  });

  it('the edge-photo step after one photo reads "Take photo 2 of 12" (blue), not red', () => {
    let doc = moveTo(fresh(), 'edge-photos');
    doc = photoThrough(doc, 'edge-photos', false);
    const a = action(doc, 'edge-photos');
    expect(a).toMatchObject({ place: 'in_progress', have: 1, need: 12 });
    expect(actionPillLabel(step('edge-photos'), a)).toBe('Take photo 2 of 12');
  });

  it('upload failed → red + Retry upload with the reason; a later verify turns it green', () => {
    let doc = moveTo(fresh(), 'camera-calibration');
    const shot = shoot(doc, 'camera-calibration');
    doc = setStatus(shot.doc, shot.photoId, 'failed', { uploadError: 'Size mismatch (local 4591996, OneDrive 0)' });
    const a = action(doc, 'camera-calibration');
    expect(a).toMatchObject({ place: 'error', recovery: 'retry', photoId: shot.photoId });
    expect(a.reason).toContain('OneDrive 0');
    expect(actionPillCommand(a)).toBe('photo-upload-retry');
    doc = setStatus(doc, shot.photoId, 'uploading');
    expect(action(doc, 'camera-calibration').place).toBe('uploading');
    doc = setStatus(doc, shot.photoId, 'verified');
    expect(action(doc, 'camera-calibration').place).toBe('done');
  });

  it('refused at the shutter (portrait) → red + Retake; Retake → grey; good photo → green', () => {
    let doc = moveTo(fresh(), 'edge-photos');
    doc = commitWorkflow(doc, rejectEvidenceWorkflow(readProgress(doc), 'edge-photos', 'Turn the phone sideways.', tick()).progress);
    expect(action(doc, 'edge-photos')).toMatchObject({ place: 'error', recovery: 'retake', reason: 'Turn the phone sideways.' });
    const retake = handleWorkflowCommand('workflow-retake', doc, { getAttribute: (n) => (n === 'data-step' ? 'edge-photos' : null) });
    expect(retake.link).toMatchObject({ to: 'camera', cameraPositionId: 'Edge points' });
    doc = commitWorkflow(doc, retakeEvidenceWorkflow(readProgress(doc), 'edge-photos', tick()).progress);
    expect(action(doc, 'edge-photos').place).toBe('idle');
    for (let i = 0; i < 12; i += 1) doc = photoThrough(doc, 'edge-photos', i === 11);
  });

  it('verified but not usable → red + Retake with the reason; a good retake supersedes it', () => {
    let doc = moveTo(fresh(), 'camera-calibration');
    const shot = shoot(doc, 'camera-calibration');
    doc = setStatus(shot.doc, shot.photoId, 'verified', { usabilityNote: 'Not usable for focal length (not 1×).' });
    expect(action(doc, 'camera-calibration')).toMatchObject({ place: 'error', recovery: 'retake' });
    expect(action(doc, 'camera-calibration').reason).toContain('not 1×');
    doc = photoThrough(doc, 'camera-calibration', true);
  });

  it('verified with no capture time → red with that reason (was a silent "never ticks")', () => {
    let doc = moveTo(fresh(), 'camera-calibration');
    const shot = shoot(doc, 'camera-calibration');
    doc = {
      ...shot.doc,
      photos: shot.doc.photos.map((p) =>
        p.id === shot.photoId ? { ...p, exifDateTimeOriginal: undefined, originalFile: { ...p.originalFile!, capturedAt: undefined, uploadStatus: 'verified' as const } } : p,
      ),
    };
    doc = workflowAfterUploadedPhoto(doc, shot.photoId, tick());
    expect(run(doc).steps['camera-calibration']?.status).not.toBe('ticked_by_app');
    expect(action(doc, 'camera-calibration').place).toBe('error');
    expect(action(doc, 'camera-calibration').reason).toMatch(/no capture time/);
  });

  it('Done from the last step says which step is not green, without moving the roller', () => {
    // Paul's case: 8, 9, 10 done on screen but step 8's upload failed, so it never ticked.
    let doc = walkToEnd(fresh(), { stopAt: 'camera-calibration' });
    doc = moveTo(doc, 'camera-calibration');
    const shot = shoot(doc, 'camera-calibration');
    doc = setStatus(shot.doc, shot.photoId, 'failed', { uploadError: 'Size mismatch (local 4591996, OneDrive 0)' });
    // Steps after calibration done by hand or by photos; calibration is still red.
    for (const id of ['mark-edge-points', 'edge-photos', 'tape-diameter', 'circle-result']) {
      doc = moveTo(doc, id);
      if (id === 'edge-photos') for (let i = 0; i < 12; i += 1) doc = photoThrough(doc, id, i === 11);
      else doc = commitWorkflow(doc, tickWorkflow(readProgress(doc), id, undefined, tick()).progress);
    }
    doc = moveTo(doc, 'save-to-onedrive');
    doc = withWorkflowEvent(doc, { type: 'cloud.saved' }, tick());
    const result = handleWorkflowCommand('workflow-done', doc, { getAttribute: () => null });
    const after = readProgress(result.doc ?? doc);
    expect(workflowShowsNotice()).toBe('Not finished. Step 6 Calibration photo (focal length): Upload failed: Size mismatch (local 4591996, OneDrive 0)');
    expect(after.runs[ID]?.finishedAt).toBeFalsy();
    expect(after.runs[ID]?.currentStepId).toBe('save-to-onedrive');
    const b = doneBlocker(doc, circleFieldTest.steps, run(doc))!;
    expect(b.stepId).toBe('camera-calibration');
    expect(doneBlockerNotice(b)).toBe('Not finished. Step 6 Calibration photo (focal length): Upload failed: Size mismatch (local 4591996, OneDrive 0)');
  });

  it('Done lands on each possible blocker in turn, and a skip with a note unblocks it', () => {
    for (const s of circleFieldTest.steps) {
      let doc = walkToEnd(fresh(), { stopAt: s.id });
      let p = readProgress(doc);
      // Skip the blocker with a note… then finish the rest normally.
      const rest = circleFieldTest.steps.slice(circleFieldTest.steps.indexOf(s) + 1);
      const blocked = doneBlocker(doc, circleFieldTest.steps, run(doc));
      expect(blocked?.stepId).toBe(s.id);
      if (s.id === 'save-to-onedrive') {
        // Not skippable: only the real save makes it green.
        doc = withWorkflowEvent(moveTo(doc, s.id), { type: 'cloud.saved' }, tick());
      } else {
        doc = moveTo(doc, s.id);
        p = skipWithNoteWorkflow(readProgress(doc), s.id, 'Not today', tick()).progress;
        doc = commitWorkflow(doc, p);
      }
      expect(action(doc, s.id).place).toBe('done');
      for (const r of rest) {
        doc = moveTo(doc, r.id);
        const c = r.complete;
        if ('on' in c && c.on === 'photo.uploaded') for (let i = 0; i < c.minPhotos; i += 1) doc = photoThrough(doc, r.id, i === c.minPhotos - 1);
        else if ('on' in c && c.on === 'cloud.saved') doc = withWorkflowEvent(doc, { type: 'cloud.saved' }, tick());
        else doc = commitWorkflow(doc, tickWorkflow(readProgress(doc), r.id, undefined, tick()).progress);
      }
      expect(doneBlocker(doc, circleFieldTest.steps, run(doc)), s.id).toBeUndefined();
      expect(doneWorkflow(readProgress(doc), tick()).progress.runs[ID]?.finishedAt, s.id).toBeTruthy();
    }
  });

  it('Next / Later never change a pill', () => {
    let doc = moveTo(fresh(), 'camera-calibration');
    const before = action(doc, 'camera-calibration');
    doc = commitWorkflow(doc, advanceWorkflow(readProgress(doc), tick()).progress);
    expect(action(doc, 'camera-calibration')).toEqual(before);
  });

  it('Paul: edge photos after photo 1 say Take photo 2 of 12; photo 2 taken but not marked says Mark photo 2 of 12', () => {
    let doc = walkToEnd(fresh(), { stopAt: 'edge-photos' });
    doc = moveTo(doc, 'edge-photos');
    doc = photoThrough(doc, 'edge-photos', false);
    let a = action(doc, 'edge-photos');
    expect(a).toMatchObject({ place: 'in_progress', have: 1, need: 12 });
    expect(actionPillLabel(step('edge-photos'), a)).toBe('Take photo 2 of 12');
    expect(actionPillCommand(a)).toBe('workflow-go');
    // Photo 2 taken, tap screen closed without Save.
    const shot = shoot(doc, 'edge-photos');
    doc = shot.unmarked;
    a = action(doc, 'edge-photos');
    expect(a).toMatchObject({ place: 'in_progress', markPhotoId: shot.photoId, markNumber: 2 });
    expect(actionPillLabel(step('edge-photos'), a)).toBe('Mark photo 2 of 12');
    expect(actionPillCommand(a)).toBe('open-photo-mark');
    // Saved (even with every base point Not in view), then verified; the rest follow: green.
    doc = markTaps(doc, shot.photoId);
    doc = setStatus(doc, shot.photoId, 'uploading');
    expect(action(doc, 'edge-photos').place).toBe('in_progress'); // not the last photo: the pill offers the next
    doc = setStatus(doc, shot.photoId, 'verified');
    expect(action(doc, 'edge-photos').place).toBe('in_progress');
    for (let i = 2; i < 12; i += 1) doc = photoThrough(doc, 'edge-photos', i === 11);
    expect(action(doc, 'edge-photos').place).toBe('done');
    expect(run(doc).steps['edge-photos']?.status).toBe('ticked_by_app');
  });

  it('every enabled pill label starts with a verb (design rule)', () => {
    const verbs = /^(Take|Mark|Retake|Retry|Save)\b/;
    const states: ActionState[] = [
      { place: 'idle', need: 2, have: 0 },
      { place: 'in_progress', need: 2, have: 1 },
      { place: 'in_progress', need: 1, have: 0 },
      { place: 'in_progress', need: 2, have: 1, markPhotoId: 'x', markNumber: 2 },
      { place: 'error', recovery: 'retake', reason: 'r' },
      { place: 'error', recovery: 'retry', reason: 'r' },
    ];
    for (const s of circleFieldTest.steps) {
      for (const st of states) {
        const label = actionPillLabel(s, st);
        if (label) expect(label, `${s.id} ${st.place}`).toMatch(verbs);
      }
    }
  });
});
