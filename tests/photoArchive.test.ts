import { beforeEach, describe, expect, it } from 'vitest';
import type { GardenDocument, Photo } from '../src/model';
import { emptyDocument } from '../src/model';
import {
  archiveCleanOutCandidates,
  archiveOne,
  archiveOrphans,
  ARCHIVE_RETRY_BASE_MS,
  checkPhotoConsistency,
  deleteArchivedFiles,
  drainArchiveJobs,
  listArchivedFiles,
  listLivePhotoFiles,
  resetArchiveBackoff,
  type ArchiveJob,
  type DriveFile,
} from '../src/photoArchive';
import { createMemoryPhotoQueue, type PhotoQueueRecord } from '../src/photoQueue';
import { circleFieldTest } from '../src/workflows/guided/definitions';
import { applyArchiveDrain, confirmSetupWorkflow, emptyProgress, pendingArchiveJobs, retakeStepPhotosInDoc, startWorkflow } from '../src/workflows/guided/engine';
import { deriveActionState } from '../src/workflows/guided/actionNet';

const G = 'https://graph.microsoft.com/v1.0/me/drive/root:/';
const ROOT = 'Garden Survey/photos';

/** In-memory OneDrive: files and folders by path; records every request. */
function mockGraph(files: Record<string, { size?: number; modifiedAt?: string; body?: string }> = {}) {
  const items = new Map<string, { size: number; modifiedAt: string; body?: string; folder?: boolean }>();
  for (const [k, v] of Object.entries(files)) items.set(k, { size: v.size ?? 10, modifiedAt: v.modifiedAt ?? '2026-10-01T00:00:00Z', body: v.body });
  const calls: { method: string; path: string; body?: string }[] = [];
  let failMoves = 0;
  let etag = 1;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/me/drive/root/children')) return json(201, {});
    if (url === 'https://dl/manifest') return new Response(items.get(`${ROOT}/manifest.json`)?.body ?? '', { status: 200 });
    const rest = decodeURIComponent(url.slice(G.length).split('?')[0]!);
    calls.push({ method, path: rest, body: typeof init?.body === 'string' ? init.body : undefined });
    if (method === 'POST' && rest.endsWith(':/children')) return json(201, {});
    if (method === 'GET' && rest.endsWith(':/children')) {
      const dir = rest.slice(0, -':/children'.length);
      const value = [...items.entries()]
        .filter(([k]) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/'))
        .map(([k, v]) => ({ name: k.slice(dir.length + 1), size: v.size, lastModifiedDateTime: v.modifiedAt, ...(v.folder ? { folder: {} } : {}) }));
      // sub-folders implied by deeper paths
      const subs = new Set([...items.keys()].filter((k) => k.startsWith(`${dir}/`) && k.slice(dir.length + 1).includes('/')).map((k) => k.slice(dir.length + 1).split('/')[0]!));
      for (const s of subs) value.push({ name: s, size: 0, lastModifiedDateTime: '', folder: {} });
      return json(200, { value });
    }
    if (method === 'PATCH') {
      if (failMoves > 0) { failMoves -= 1; return json(503, { error: { message: 'Service unavailable' } }); }
      const it = items.get(rest);
      if (!it) return json(404, { error: { message: 'not found' } });
      const body = JSON.parse(String(init!.body)) as { parentReference: { path: string } };
      const target = body.parentReference.path.replace('/drive/root:/', '');
      items.delete(rest);
      items.set(`${target}/${rest.split('/').pop()}`, it);
      return json(200, {});
    }
    if (method === 'GET' && rest === `${ROOT}/manifest.json`) {
      const m = items.get(rest);
      if (!m) return json(404, {});
      return json(200, { eTag: `"e${etag}"`, size: m.body?.length ?? 0, '@microsoft.graph.downloadUrl': 'https://dl/manifest' });
    }
    if (method === 'PUT' && rest === `${ROOT}/manifest.json:/content`) {
      etag += 1;
      items.set(`${ROOT}/manifest.json`, { size: 1, modifiedAt: '', body: String(init!.body) });
      return json(200, { eTag: `"e${etag}"` });
    }
    if (method === 'DELETE') {
      if (!items.has(rest)) return json(404, {});
      items.delete(rest);
      return new Response(null, { status: 204 });
    }
    return json(400, { error: { message: `unhandled ${method} ${rest}` } });
  };
  return { client: { fetch: fetchImpl as typeof fetch, token: 't' }, items, calls, failNextMoves: (n: number) => { failMoves = n; } };
}

function record(photoId: string, fileName: string): PhotoQueueRecord {
  return { id: photoId, photoId, fileName, status: 'verified', blob: new Blob(['x']), size: 1, contentType: 'image/jpeg' } as unknown as PhotoQueueRecord;
}

const job: ArchiveJob = { photoId: 'cal-1', fileName: 'cal-1.jpg', stepId: 'camera-calibration', runStartedAt: '2026-06-01T12:00:00.000Z', supersededAt: '2026-06-01T12:10:00.000Z', reason: 'retake' };
const manifest = JSON.stringify({ version: 1, updatedAt: '', photos: [{ photoId: 'cal-1', fileName: 'cal-1.jpg' }, { photoId: 'p2', fileName: 'p2.jpg' }] });

beforeEach(() => resetArchiveBackoff());

describe('archive on retake (mocked Graph)', () => {
  it('moves the file to photos/archive/<run>/, marks the manifest, deletes the phone copy', async () => {
    const g = mockGraph({ [`${ROOT}/cal-1.jpg`]: {}, [`${ROOT}/p2.jpg`]: {}, [`${ROOT}/manifest.json`]: { body: manifest } });
    const queue = createMemoryPhotoQueue();
    await queue.put(record('cal-1', 'cal-1.jpg'));
    await queue.put(record('p2', 'p2.jpg'));
    const r = await archiveOne(job, { client: g.client, queue, now: () => '2026-06-01T12:11:00.000Z', logError: () => {} });
    expect(r).toMatchObject({ ok: true, entry: { action: 'archived', path: 'photos/archive/run-2026-06-01T12-00-00Z/cal-1.jpg' } });
    expect(g.items.has(`${ROOT}/cal-1.jpg`)).toBe(false);
    expect(g.items.has(`${ROOT}/archive/run-2026-06-01T12-00-00Z/cal-1.jpg`)).toBe(true);
    const patch = g.calls.find((c) => c.method === 'PATCH')!;
    expect(JSON.parse(patch.body!)['@microsoft.graph.conflictBehavior']).toBe('rename');
    expect(g.calls.some((c) => c.method === 'DELETE')).toBe(false);
    const m = JSON.parse(g.items.get(`${ROOT}/manifest.json`)!.body!);
    expect(m.photos[0]).toMatchObject({ photoId: 'cal-1', archivedAt: '2026-06-01T12:11:00.000Z', archivePath: 'photos/archive/run-2026-06-01T12-00-00Z/cal-1.jpg' });
    expect(m.photos[1].archivedAt).toBeUndefined();
    expect((await queue.list()).map((q) => q.photoId)).toEqual(['p2']);
  });

  it('a failed move is logged, stays pending, backs off, and succeeds on a later retry', async () => {
    const g = mockGraph({ [`${ROOT}/cal-1.jpg`]: {}, [`${ROOT}/manifest.json`]: { body: manifest } });
    const queue = createMemoryPhotoQueue();
    await queue.put(record('cal-1', 'cal-1.jpg'));
    const logs: string[] = [];
    let now = Date.parse('2026-06-01T12:11:00.000Z');
    const deps = { client: g.client, queue, now: () => new Date(now).toISOString(), logError: (m: string) => logs.push(m) };
    g.failNextMoves(1);
    const first = await drainArchiveJobs([job], deps);
    expect(first).toEqual({ pending: [job], done: [] });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/camera-calibration: Could not move cal-1.jpg .*Will retry\./);
    expect((await queue.list())).toHaveLength(1); // phone copy kept until the move works
    const early = await drainArchiveJobs([job], deps); // inside the backoff: not tried
    expect(early.pending).toEqual([job]);
    expect(g.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    now += ARCHIVE_RETRY_BASE_MS;
    const later = await drainArchiveJobs([job], deps);
    expect(later.pending).toEqual([]);
    expect(later.done[0]).toMatchObject({ photoId: 'cal-1', action: 'archived' });
    expect(logs).toHaveLength(1);
    expect(await queue.list()).toEqual([]);
  });

  it('a file already gone from photos/ counts as archived', async () => {
    const g = mockGraph({});
    const r = await archiveOne(job, { client: g.client, queue: createMemoryPhotoQueue(), now: () => '2026-06-01T12:11:00.000Z', logError: () => {} });
    expect(r.ok).toBe(true);
  });
});

describe('clean out archive', () => {
  const files: DriveFile[] = [
    { name: 'a.jpg', path: `${ROOT}/archive/run-x/a.jpg`, size: 1_000_000, modifiedAt: '2026-06-01T00:00:00Z' },
    { name: 'b.jpg', path: `${ROOT}/archive/run-x/b.jpg`, size: 500_000, modifiedAt: '2026-07-01T00:00:00Z' },
    { name: 'c.jpg', path: `${ROOT}/archive/run-y/c.jpg`, size: 7, modifiedAt: '2026-10-15T00:00:00Z' },
  ];

  it('lists archived files older than the age, with total size', () => {
    const r = archiveCleanOutCandidates(files, '2026-10-20T00:00:00Z', 90);
    expect(r.files.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(r.totalBytes).toBe(1_500_000);
    expect(archiveCleanOutCandidates(files, '2026-10-20T00:00:00Z', 120).files.map((f) => f.name)).toEqual(['a.jpg']);
  });

  it('lists every run folder and deletes only under photos/archive/, never live photos', async () => {
    const g = mockGraph({
      [`${ROOT}/live.jpg`]: { modifiedAt: '2020-01-01T00:00:00Z' },
      [`${ROOT}/archive/run-x/a.jpg`]: { modifiedAt: '2026-06-01T00:00:00Z' },
      [`${ROOT}/archive/unreferenced/o.jpg`]: { modifiedAt: '2026-06-01T00:00:00Z' },
    });
    const listed = await listArchivedFiles(g.client);
    expect(listed.ok && listed.files.map((f) => f.name).sort()).toEqual(['a.jpg', 'o.jpg']);
    const live = await listLivePhotoFiles(g.client);
    const r = await deleteArchivedFiles(g.client, [...(listed.ok ? listed.files : []), ...(live.ok ? live.files : [])]);
    expect(r.deleted.map((f) => f.name).sort()).toEqual(['a.jpg', 'o.jpg']);
    expect(r.failed.map((f) => f.file.name)).toEqual(['live.jpg']);
    expect(g.items.has(`${ROOT}/live.jpg`)).toBe(true);
  });
});

function photo(id: string, extra: Partial<Photo> = {}): Photo {
  return { id, setupId: 's', addPointId: 'P', width: 1, height: 1, clicks: [], originalFile: { fileName: `${id}.jpg`, size: 1, quickXorHash: 'h', contentType: 'image/jpeg', uploadStatus: 'verified', capturedAt: '', receivedAt: '' }, ...extra } as Photo;
}

describe('photo consistency check', () => {
  const doc = (photos: Photo[]): GardenDocument => ({ ...emptyDocument('C'), photos });

  it('errors for missing-from-both (step + Retake hint), warns one-sided, finds orphans', () => {
    const d = doc([photo('both'), photo('gone'), photo('phone'), photo('drive'), photo('old', { supersededAt: '2026-06-01T00:00:00Z' })]);
    const r = checkPhotoConsistency({
      doc: d,
      local: [{ photoId: 'both', fileName: 'both.jpg' }, { photoId: 'phone', fileName: 'phone.jpg' }, { photoId: 'x', fileName: 'stray-local.jpg' }],
      driveFileNames: ['both.jpg', 'drive.jpg', 'old.jpg', 'stray.jpg'],
      stepOf: () => ({ id: 'camera-1', label: 'Step 3 Camera 1' }),
    });
    expect(r.errors).toEqual([expect.objectContaining({ photoId: 'gone', stepId: 'camera-1' })]);
    expect(r.errors[0]!.message).toBe("Step 3 Camera 1: photo gone.jpg is missing on the phone and in OneDrive. Retake it: open the step's Photos and tap Retake.");
    expect(r.warnings.map((w) => [w.photoId, w.where])).toEqual([['phone', 'local-only'], ['drive', 'drive-only']]);
    expect(r.orphans.drive).toEqual(['stray.jpg']); // superseded old.jpg is known, waits for its archive job
    expect(r.orphans.local).toEqual([{ photoId: 'x', fileName: 'stray-local.jpg' }]);
    expect(r.driveChecked).toBe(true);
  });

  it('offline: no false errors, only the phone side is checked', () => {
    const r = checkPhotoConsistency({ doc: doc([photo('a')]), local: [] });
    expect(r).toMatchObject({ errors: [], warnings: [], driveChecked: false });
  });

  it('archives orphans by moving them; nothing is deleted', async () => {
    const g = mockGraph({ [`${ROOT}/stray.jpg`]: {} });
    const r = await archiveOrphans(['stray.jpg'], { client: g.client, queue: createMemoryPhotoQueue(), now: () => '2026-10-20T00:00:00Z', logError: () => {} });
    expect(r.done[0]).toMatchObject({ path: 'photos/archive/unreferenced/stray.jpg', reason: 'orphan' });
    expect(g.items.has(`${ROOT}/archive/unreferenced/stray.jpg`)).toBe(true);
    expect(g.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});

describe('retakeStepPhotosInDoc', () => {
  const NOW = '2026-06-01T12:00:00.000Z';
  const AT = '2026-06-01T12:10:00.000Z';

  function calDoc(): GardenDocument {
    let p = confirmSetupWorkflow(startWorkflow(emptyProgress(), 'circle-field-test', NOW).progress, undefined, NOW).progress;
    const run = p.runs['circle-field-test']!;
    run.steps['camera-calibration'] = { ...run.steps['camera-calibration']!, status: 'ticked_by_app', completedBy: 'auto', consumedPhotoIds: ['cal-1'] };
    run.steps['circle-result'] = { ...run.steps['circle-result']!, status: 'ticked_by_app', completedBy: 'auto' };
    run.currentStepId = 'edge-photos';
    const d = emptyDocument('Circle');
    d.objects = [{ id: 'obj-cal', layerId: 'survey', name: 'Calibration', geometryType: 'point', measuredPointIds: ['P-CAL'], selectedPointIds: [] }];
    d.points = [{ id: 'P-CAL', kind: 'OCC', label: 'Calibration 1', objectId: 'obj-cal', photoIds: ['cal-1'] }];
    d.photos = [photo('cal-1', { addPointId: 'P-CAL', exifDateTimeOriginal: '2026-06-01T12:02:00.000Z' })];
    return { ...d, workflowProgress: p };
  }

  it('supersedes the photos, queues archive jobs, and sends calibration dependents to re-check', () => {
    const r = retakeStepPhotosInDoc(calDoc(), 'camera-calibration', AT);
    expect(r.changed).toBe(true);
    expect(r.superseded).toEqual(['cal-1']);
    expect(r.doc.photos[0]!.supersededAt).toBe(AT);
    expect(pendingArchiveJobs(r.doc)).toEqual([expect.objectContaining({ photoId: 'cal-1', fileName: 'cal-1.jpg', reason: 'retake', stepId: 'camera-calibration' })]);
    const run = r.doc.workflowProgress!.runs['circle-field-test']!;
    expect(run.steps['camera-calibration']).toMatchObject({ status: 'waiting_for_app', retakeAfter: AT });
    expect(run.steps['circle-result']?.status).toBe('needs_recheck');
    const step = circleFieldTest.steps.find((s) => s.id === 'camera-calibration')!;
    expect(deriveActionState(r.doc, run, step).place).not.toBe('done');

    const drained = applyArchiveDrain(r.doc, { pending: [], done: [{ at: AT, action: 'archived', photoId: 'cal-1', fileName: 'cal-1.jpg', path: 'photos/archive/run-x/cal-1.jpg' }] });
    expect(pendingArchiveJobs(drained)).toEqual([]);
    expect(drained.workflowProgress!.runs['circle-field-test']!.photoArchive!.log).toHaveLength(1);
    expect(drained.photos[0]!.originalFile!.archivePath).toBe('photos/archive/run-x/cal-1.jpg');
  });
});

describe('Photos viewer commands and Set-up archive age', async () => {
  const chrome = await import('../src/workflows/guided/guidedChrome');
  const meta = await import('../src/workflows/guided/fieldTestMeta');
  const guards = await import('../src/workflows/guided/guards');
  const src = (await import('node:fs')).readFileSync('src/workflows/guided/guidedChrome.ts', 'utf8');
  const at = (step: string) => ({ getAttribute: (n: string) => (n === 'data-step' ? step : null) });

  function calDoc(): GardenDocument {
    const NOW = '2026-06-01T12:00:00.000Z';
    const p = confirmSetupWorkflow(startWorkflow(emptyProgress(), 'circle-field-test', NOW).progress, undefined, NOW).progress;
    const run = p.runs['circle-field-test']!;
    run.steps['camera-calibration'] = { ...run.steps['camera-calibration']!, status: 'ticked_by_app', completedBy: 'auto', consumedPhotoIds: ['cal-1'] };
    run.currentStepId = 'camera-calibration';
    const d = emptyDocument('Circle');
    d.objects = [{ id: 'obj-cal', layerId: 'survey', name: 'Calibration', geometryType: 'point', measuredPointIds: ['P-CAL'], selectedPointIds: [] }];
    d.points = [{ id: 'P-CAL', kind: 'OCC', label: 'Calibration 1', objectId: 'obj-cal', photoIds: ['cal-1'] }];
    d.photos = [photo('cal-1', { addPointId: 'P-CAL', exifDateTimeOriginal: '2026-06-01T12:02:00.000Z' })];
    return { ...d, workflowProgress: p };
  }

  it('no always-on roller Retake any more', () => {
    expect(src).not.toMatch(/roller-retake/);
  });

  it('Photos opens the viewer; its Retake supersedes, opens the camera and asks for the archive drain', () => {
    const d = calDoc();
    chrome.handleWorkflowCommand('workflow-photos', d, at('camera-calibration'));
    expect(chrome.photosViewerOpen()).toBe('camera-calibration');
    const r = chrome.handleWorkflowCommand('workflow-photo-retake', d, at('camera-calibration'));
    expect(chrome.photosViewerOpen()).toBeNull();
    expect(r.photoAction).toBe('archive-drain');
    expect(r.link).toBeDefined();
    expect(r.doc!.photos[0]!.supersededAt).toBeDefined();
  });

  it('Set-up commands map to photo actions', () => {
    const d = calDoc();
    expect(chrome.handleWorkflowCommand('workflow-check-photos', d, at('')).photoAction).toBe('check-photos');
    expect(chrome.handleWorkflowCommand('workflow-clean-archive', d, at('')).photoAction).toBe('clean-archive');
    expect(chrome.handleWorkflowCommand('workflow-archive-orphans', d, at('')).photoAction).toBe('archive-orphans');
  });

  it('archive age: default 90 from tolerances, editable, a whole number of days, no survey re-check', () => {
    const v = meta.defaultFieldTestSetup();
    expect(v.photo_archive_age_days).toBe(90);
    const edited = chrome.setupValuesWithDraft(v, { photo_archive_age_days: '30' })!;
    expect(edited.photo_archive_age_days).toBe(30);
    expect(guards.setupValid({ ...v, photo_archive_age_days: 1.5 })).toBe(false);
    const p = calDoc().workflowProgress!;
    const move = confirmSetupWorkflow(p, edited, '2026-06-02T00:00:00.000Z');
    const run = move.progress.runs['circle-field-test']!;
    expect(run.setup?.status).toBe('confirmed');
    expect(run.steps['camera-calibration']?.status).toBe('ticked_by_app');
    expect(run.runLog?.at(-1)).toMatchObject({ type: 'config.changed', changes: [{ key: 'photo_archive_age_days', from: 90, to: 30 }] });
  });
});
