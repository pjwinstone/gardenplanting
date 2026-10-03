import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { PHOTO_DB_NAME, createIndexedDbPhotoQueue, type PhotoQueueRecord } from '../src/photoQueue';
import { quickXorHash } from '../src/quickXorHash';
import {
  discardQueuedPhoto,
  drainPhotoQueue,
  releaseSurveyPhotos,
  surveyPhotoIdsForPoint,
} from '../src/photoSync';
import type { Photo } from '../src/model';
import type { GraphRequest, PhotosManifest } from '../src/photosManifest';

const bytes = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 11, 12]);
const hash = quickXorHash(bytes).base64;

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(PHOTO_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

describe('deleted photo retention', () => {
  it('keeps a retire row when the move fails, then retries it', async () => {
    const queue = createIndexedDbPhotoQueue();
    await queue.put(queuedRecord());
    let patches = 0;
    const patchBodies: string[] = [];
    const manifestBodies: PhotosManifest[] = [];
    const methods: string[] = [];
    const fetchImpl = photoFetch({
      onPatch: (_url, init) => {
        patches += 1;
        patchBodies.push(String(init?.body ?? ''));
        return patches === 1 ? json(500, { error: { message: 'move failed' } }) : json(200, {});
      },
      onManifest: (body) => {
        manifestBodies.push(body);
      },
      methods,
    });
    const client: GraphRequest = { token: 'tok', fetch: fetchImpl };

    const first = await discardQueuedPhoto('ph-1', queue, {
      client,
      now: '2026-10-03T12:00:00.000Z',
    });
    expect(first.ok).toBe(false);
    expect(first.error).toMatch(/photos\/deleted/);
    const [waiting] = await queue.list();
    expect(waiting?.status).toBe('retire');
    expect(waiting?.deletedAt).toBe('2026-10-03T12:00:00.000Z');
    expect(patches).toBe(1);

    const failed = await drainPhotoQueue({
      queue,
      getToken: async () => 'tok',
      fetchImpl,
      now: () => '2026-10-03T12:01:00.000Z',
      onStatus: () => undefined,
    });
    expect(failed).toBe(0);
    expect(patches).toBe(2);
    expect(await queue.list()).toEqual([]);
    expect(manifestBodies.at(-1)?.photos).toHaveLength(1);
    expect(manifestBodies.at(-1)?.photos[0]?.deletedAt).toBe('2026-10-03T12:00:00.000Z');
    expect(manifestBodies.at(-1)?.photos[0]?.fileName).toBe(queuedRecord().fileName);
    expect(methods).not.toContain('DELETE');
    expect(patchBodies.at(-1)).toContain('"@microsoft.graph.conflictBehavior":"rename"');
  });

  it('does not write deletedAt when the photo was never uploaded', async () => {
    const queue = createIndexedDbPhotoQueue();
    await queue.put(queuedRecord());
    let manifestPuts = 0;
    let patchBody = '';
    const fetchImpl = photoFetch({
      onPatch: (_url, init) => {
        patchBody = String(init?.body ?? '');
        return json(404, {});
      },
      onManifest: () => {
        manifestPuts += 1;
      },
    });
    const result = await discardQueuedPhoto('ph-1', queue, {
      client: { token: 'tok', fetch: fetchImpl },
      now: '2026-10-03T12:02:00.000Z',
    });
    expect(result.ok).toBe(true);
    expect(manifestPuts).toBe(0);
    expect(patchBody).toContain('"@microsoft.graph.conflictBehavior":"rename"');
    expect(await queue.list()).toEqual([]);
  });

  it('keeps the manifest row when the photo is deleted after the manifest write', async () => {
    const queue = createIndexedDbPhotoQueue();
    await queue.put({ ...queuedRecord(), bytesOnDrive: false });
    const methods: string[] = [];
    const saved: { manifest: PhotosManifest | null } = { manifest: null };
    let manifestWrites = 0;
    const failed = await drainPhotoQueue({
      queue,
      getToken: async () => 'tok',
      now: () => '2026-10-03T12:00:00.000Z',
      onStatus: () => undefined,
      fetchImpl: photoFetch({
        methods,
        manifest: () => saved.manifest,
        onManifest: async (body) => {
          manifestWrites += 1;
          saved.manifest = body;
          if (manifestWrites === 1) await discardQueuedPhoto('ph-1', queue, { now: '2026-10-03T12:05:00.000Z' });
        },
      }),
    });
    expect(failed).toBe(0);
    expect(manifestWrites).toBeGreaterThan(1);
    expect(saved.manifest?.photos).toHaveLength(1);
    expect(saved.manifest?.photos[0]?.fileName).toBe(queuedRecord().fileName);
    expect(saved.manifest?.photos[0]?.deletedAt).toBe('2026-10-03T12:05:00.000Z');
    expect(methods).toContain('PATCH');
    expect(methods).not.toContain('DELETE');
    expect(await queue.list()).toEqual([]);
  });

  it('moves the renamed file when the photo is deleted after a name clash', async () => {
    const queue = createIndexedDbPhotoQueue();
    await queue.put({ ...queuedRecord(), bytesOnDrive: false });
    const methods: string[] = [];
    const patched: string[] = [];
    const saved: { manifest: PhotosManifest | null } = { manifest: null };
    const failed = await drainPhotoQueue({
      queue,
      getToken: async () => 'tok',
      now: () => '2026-10-03T12:00:00.000Z',
      onStatus: () => undefined,
      fetchImpl: photoFetch({
        methods,
        manifest: () => saved.manifest,
        onJpgPut: async (url) => {
          if (!url.includes('-2.jpg')) return json(409, { error: { code: 'nameAlreadyExists' } });
          await discardQueuedPhoto('ph-1', queue, { now: '2026-10-03T12:06:00.000Z' });
          return json(200, item(bytes.byteLength, hash));
        },
        onItemGet: () => json(200, item(bytes.byteLength, 'different-hash')),
        onPatch: async (url) => {
          patched.push(url);
          return json(200, {});
        },
        onManifest: (body) => {
          saved.manifest = body;
        },
      }),
    });
    expect(failed).toBe(0);
    expect(patched.some((url) => url.includes('-2.jpg'))).toBe(true);
    expect(saved.manifest?.photos[0]?.fileName).toContain('-2.jpg');
    expect(saved.manifest?.photos[0]?.deletedAt).toBe('2026-10-03T12:06:00.000Z');
    expect(methods).not.toContain('DELETE');
    expect(await queue.list()).toEqual([]);
  });

  it('releases every photo on the point-delete cascade', async () => {
    const queue = createIndexedDbPhotoQueue();
    await queue.put({
      ...queuedRecord(),
      id: 'queued-photo',
      photoId: 'queued-photo',
      fileName: 'queued.jpg',
      bytesOnDrive: false,
    });
    const photos: Photo[] = [
      {
        id: 'queued-photo',
        setupId: 's1',
        addPointId: 'P01',
        width: 10,
        height: 10,
        clicks: [],
        originalFile: {
          fileName: 'queued.jpg',
          size: bytes.byteLength,
          quickXorHash: hash,
          uploadStatus: 'queued',
        },
      },
      {
        id: 'drive-photo',
        setupId: 's1',
        addPointId: 'P01',
        width: 10,
        height: 10,
        clicks: [],
        originalFile: {
          fileName: 'drive.jpg',
          size: 20,
          quickXorHash: 'drive-hash',
          uploadStatus: 'verified',
        },
      },
    ];
    const doc = {
      points: [{ id: 'P01', photoIds: ['queued-photo', 'extra-only-on-point'] }],
      photos,
    };
    const ids = surveyPhotoIdsForPoint(doc, 'P01');
    expect(ids).toEqual(['queued-photo', 'extra-only-on-point', 'drive-photo']);

    const methods: string[] = [];
    const patched: string[] = [];
    const jpgPuts: string[] = [];
    const saved: { manifest: PhotosManifest | null } = { manifest: null };
    const client: GraphRequest = {
      token: 'tok',
      fetch: photoFetch({
        methods,
        onJpgPut: (url) => {
          jpgPuts.push(url);
          return json(200, item(1, hash));
        },
        onPatch: (url) => {
          patched.push(url);
          return json(200, {});
        },
        onManifest: (body) => {
          saved.manifest = body;
        },
      }),
    };
    const release = await releaseSurveyPhotos(photos, ids, queue, {
      client,
      now: '2026-10-03T12:07:00.000Z',
    });
    expect(release.ok).toBe(true);
    expect(await queue.list()).toEqual([]);
    expect(jpgPuts).toEqual([]);
    expect(patched.some((url) => url.includes('drive.jpg'))).toBe(true);
    expect(saved.manifest?.photos.map((photo) => photo.fileName)).toEqual(['drive.jpg']);
    expect(saved.manifest?.photos[0]?.deletedAt).toBe('2026-10-03T12:07:00.000Z');
    expect(methods).not.toContain('DELETE');
  });
});

function queuedRecord(): PhotoQueueRecord {
  return {
    id: 'ph-1',
    photoId: 'ph-1',
    stationId: 'P01',
    observationId: 'obs-1',
    fileName: 'P01_20261002T232600123Z.jpg',
    blob: new Blob([bytes], { type: 'image/jpeg' }),
    size: bytes.byteLength,
    contentType: 'image/jpeg',
    receivedAt: '2026-10-02T23:26:00.123Z',
    capturedAt: '2026-10-02T23:26:00.123+01:00',
    provenance: 'library',
    sha256: 'abc',
    calibrationKey: 'Apple|iPhone|||',
    quickXorHash: hash,
    exif: { Make: 'Apple', DateTimeOriginal: '2026:10:02 23:26:00' },
    status: 'queued',
    attempts: 0,
    bytesOnDrive: true,
    updatedAt: '2026-10-02T23:26:00.123Z',
  };
}

function item(size: number, quickXorHash: string): unknown {
  return { size, name: 'file', file: { hashes: { quickXorHash } } };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const empty = status === 404 || status === 204;
  return new Response(empty ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function photoFetch(opts: {
  methods?: string[];
  manifest?: () => PhotosManifest | null;
  onManifest?: (body: PhotosManifest) => void | Promise<void>;
  onPatch?: (url: string, init?: RequestInit) => Response | Promise<Response>;
  onJpgPut?: (url: string) => Response | Promise<Response>;
  onItemGet?: (url: string) => Response | Promise<Response>;
}): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    opts.methods?.push(method);
    if (method === 'POST') return json(409, { error: { code: 'nameAlreadyExists' } });
    if (method === 'PATCH') return (await opts.onPatch?.(url, init)) ?? json(200, {});
    if (method === 'PUT' && url.includes('.jpg')) {
      return (await opts.onJpgPut?.(url)) ?? json(200, item(bytes.byteLength, hash));
    }
    if (method === 'GET' && url.includes('manifest.json')) {
      const current = opts.manifest?.() ?? null;
      if (!current) return json(404, {});
      if (url.includes('download.example')) return json(200, current);
      return json(200, {
        eTag: '"manifest"',
        '@microsoft.graph.downloadUrl': 'https://download.example/manifest.json',
      });
    }
    if (url.startsWith('https://download.example/manifest')) {
      return json(200, opts.manifest?.() ?? { version: 1, updatedAt: '', photos: [] });
    }
    if (method === 'PUT' && url.includes('manifest.json')) {
      const body = JSON.parse(String(init?.body)) as PhotosManifest;
      await opts.onManifest?.(body);
      return json(200, { eTag: '"manifest-next"' }, { etag: '"manifest-next"' });
    }
    if (method === 'GET') return (await opts.onItemGet?.(url)) ?? json(404, {});
    return json(500, { error: { message: `unexpected ${method} ${url}` } });
  };
}
