import { describe, expect, it } from 'vitest';
import { emptyDocument } from '../src/model';
import { upsertManifestPhoto, type ManifestPhoto, type PhotosManifest } from '../src/photosManifest';
import { createOncePerKeyLogger } from '../src/errorLogBinding';
import { circleFieldTest } from '../src/workflows/guided/definitions';
import {
  advanceWorkflow,
  commitWorkflow,
  confirmSetupWorkflow,
  emptyProgress,
  pauseWorkflow,
  readProgress,
  rejectEvidenceWorkflow,
  resumePausedWorkflow,
  resumeWorkflow,
  scrollWorkflowToStep,
  startWorkflow,
  tickWorkflow,
} from '../src/workflows/guided/engine';
import { handleWorkflowCommand } from '../src/workflows/guided/guidedChrome';

const PATH = 'Garden Survey/photos/manifest.json';
const NOW = '2026-10-19T19:00:00.000Z';
const row: ManifestPhoto = { fileName: 'new.jpg', photoId: 'ph-new', stationId: 'Left', size: 1, quickXorHash: 'h', receivedAt: NOW } as ManifestPhoto;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function client(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: Array<{ url: string; method: string; ifMatch: string | null; body?: string }> = [];
  return {
    calls,
    token: 'tok',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', ifMatch: new Headers(init?.headers).get('If-Match'), body: init?.body as string | undefined });
      return handler(url, init);
    }) as typeof fetch,
  };
}

describe('photos/manifest.json without a download URL', () => {
  it('reads the body from :/content when the annotation is missing, and keeps existing rows', async () => {
    const remote: PhotosManifest = { version: 1, updatedAt: 'x', photos: [{ ...row, fileName: 'kept.jpg', photoId: 'ph-kept' }] };
    const c = client(async (url, init) => {
      if (init?.method === 'PUT') return json(200, { eTag: '"v2"' });
      if (url.includes(':/content')) return json(200, remote);
      return json(200, { eTag: '"v1"', size: 120 }); // no @microsoft.graph.downloadUrl
    });
    const res = await upsertManifestPhoto({ client: c, manifestPath: PATH, entry: row, now: NOW });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.manifest.photos.map((p) => p.fileName)).toEqual(['kept.jpg', 'new.jpg']);
    expect(c.calls.find((x) => x.method === 'PUT')?.ifMatch).toBe('"v1"');
  });

  it('a 0-byte manifest is read as empty and overwritten under its eTag', async () => {
    const c = client(async (_url, init) => (init?.method === 'PUT' ? json(200, { eTag: '"v2"' }) : json(200, { eTag: '"v0"', size: 0 })));
    const res = await upsertManifestPhoto({ client: c, manifestPath: PATH, entry: row, now: NOW });
    expect(res.ok).toBe(true);
    expect(c.calls.filter((x) => x.url.includes(':/content') && x.method === 'GET')).toHaveLength(0);
    expect(c.calls.find((x) => x.method === 'PUT')?.ifMatch).toBe('"v0"');
  });

  it('an empty or invalid body is rewritten, not an error', async () => {
    for (const body of ['', 'not json']) {
      const c = client(async (url, init) => {
        if (init?.method === 'PUT') return json(200, { eTag: '"v2"' });
        if (url.includes(':/content')) return new Response(body, { status: 200 });
        return json(200, { eTag: '"v1"', size: 5 });
      });
      expect((await upsertManifestPhoto({ client: c, manifestPath: PATH, entry: row, now: NOW })).ok).toBe(true);
    }
  });

  it('a folder named manifest.json is a clear error, not "no download URL"', async () => {
    const c = client(async () => json(200, { eTag: '"f"', folder: { childCount: 0 } }));
    const res = await upsertManifestPhoto({ client: c, manifestPath: PATH, entry: row, now: NOW });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/is a folder/);
  });

  it('the manifest warning is logged once for many photos', () => {
    const lines: string[] = [];
    const log = createOncePerKeyLogger((m) => lines.push(m));
    for (let i = 0; i < 10; i += 1) log('manifest', 'Photos manifest not updated: boom');
    expect(lines).toHaveLength(1);
  });
});

const ID = 'circle-field-test';
const run = (p: ReturnType<typeof emptyProgress>) => p.runs[ID]!;

describe('opening a field test run', () => {
  it('a new run starts on step 0 (Set-up)', () => {
    expect(run(startWorkflow(emptyProgress(), ID, NOW).progress).currentStepId).toBe('setup');
  });

  // Paul (21 Oct 2026): the roller never moves by itself. Reopening keeps the row it was left on
  // and the banner names the next step needed.
  it('reopening keeps the row it was left on and names the first step not green', () => {
    let p = startWorkflow(emptyProgress(), ID, NOW).progress;
    p = confirmSetupWorkflow(p, undefined, NOW).progress;
    for (const s of circleFieldTest.steps.slice(0, 5)) p = tickWorkflow(p, s.id, undefined, NOW).progress;
    p = scrollWorkflowToStep(p, 'edge-photos', NOW).progress; // cursor left on 8
    p = { ...p, activeId: undefined };
    const move = resumeWorkflow(p, ID, NOW);
    expect(run(move.progress).currentStepId).toBe('edge-photos');
    expect(move.notice).toBe('Next needed: step 6, Calibration photo (focal length) is the first step not done.');
  });

  it('reopening names an error, and names Set-up when it is unconfirmed', () => {
    let p = startWorkflow(emptyProgress(), ID, NOW).progress;
    p = advanceWorkflow(p, NOW).progress;
    expect(resumeWorkflow({ ...p, activeId: undefined }, ID, NOW).notice).toBe('Set-up is not confirmed yet (step 0, scroll up).');
    p = confirmSetupWorkflow(p, undefined, NOW).progress;
    p = rejectEvidenceWorkflow(p, 'gather-kit', 'x', NOW).progress;
    const move = resumeWorkflow({ ...p, activeId: undefined }, ID, NOW);
    expect(run(move.progress).currentStepId).toBe(run(p).currentStepId);
    expect(move.notice).toMatch(/^Next needed: step 1, Gather the kit has an error\./);
  });

  it('Resume after Pause keeps the row too', () => {
    let p = startWorkflow(emptyProgress(), ID, NOW).progress;
    p = confirmSetupWorkflow(p, undefined, NOW).progress;
    p = scrollWorkflowToStep(p, 'edge-photos', NOW).progress;
    p = pauseWorkflow(p, NOW).progress;
    const move = resumePausedWorkflow(p, ID, NOW);
    expect(run(move.progress).currentStepId).toBe('edge-photos');
    expect(move.notice).toMatch(/^Next needed: step 1,/);
  });

  it('the Resume button does not move the roller, and the cog still jumps to step 0', () => {
    let p = startWorkflow(emptyProgress(), ID, NOW).progress;
    p = confirmSetupWorkflow(p, undefined, NOW).progress;
    let doc = commitWorkflow(emptyDocument('x'), { ...p, activeId: undefined });
    const resumed = handleWorkflowCommand('workflow-resume', doc, { getAttribute: (n) => (n === 'data-workflow' ? ID : null) });
    doc = resumed.doc ?? doc;
    expect(readProgress(doc).runs[ID]?.currentStepId).toBe(p.runs[ID]?.currentStepId);
    const cog = handleWorkflowCommand('workflow-setup', doc, { getAttribute: () => null });
    expect(readProgress(cog.doc ?? doc).runs[ID]?.currentStepId).toBe('setup');
  });
});
