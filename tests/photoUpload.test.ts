import { describe, expect, it } from 'vitest';
import { quickXorHash } from '../src/quickXorHash';
import { createMemoryPhotoQueue, normalizeQueueAfterRestart, type PhotoQueueRecord } from '../src/photoQueue';
import { SIMPLE_UPLOAD_MAX_BYTES, parseRetryAfter, uploadAndVerifyOriginal } from '../src/photoUpload';
import {
  PHOTO_UPLOAD_MAX_ATTEMPTS,
  discardQueuedPhoto,
  drainPhotoQueue,
  photoUploadBackoffMs,
  resetPhotoUploadAttempts,
  retryWaitMs,
} from '../src/photoSync';
import type { GraphRequest } from '../src/photosManifest';

const bytes = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 11, 12]);
const hash = quickXorHash(bytes).base64;

describe('uploadAndVerifyOriginal', () => {
  it('uses a simple PUT with conflictBehavior=fail at or under 4 MB', async () => {
    expect(SIMPLE_UPLOAD_MAX_BYTES).toBe(4 * 1024 * 1024);
    const seen: string[] = [];
    const client = scripted([
      () => json(409, { error: { code: 'nameAlreadyExists' } }),
      () => json(409, { error: { code: 'nameAlreadyExists' } }),
      (url, init) => {
        seen.push(`${init?.method} ${url}`);
        expect(url).toContain('conflictBehavior');
        expect(url).toContain('fail');
        expect(url).toContain('Garden%20Survey/photos/P01_x.jpg:/content');
        return json(200, item(bytes.byteLength, hash));
      },
    ]);
    const result = await uploadAndVerifyOriginal({
      client,
      bytes,
      fileName: 'P01_x.jpg',
      contentType: 'image/jpeg',
      localHash: hash,
    });
    expect(result).toEqual({ ok: true, existed: false, remote: { size: bytes.byteLength, quickXorHash: hash } });
    expect(seen[0]).toMatch(/PUT /);
  });

  it('rejects a hash that does not match the local file', async () => {
    const client = scripted([
      () => json(409, {}),
      () => json(409, {}),
      () => json(200, item(bytes.byteLength, 'not-the-hash')),
    ]);
    const result = await uploadAndVerifyOriginal({
      client,
      bytes,
      fileName: 'P01_x.jpg',
      contentType: 'image/jpeg',
      localHash: hash,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/quickXorHash/);
      expect(result.permanent).toBe(true);
      expect(result.conflict).toBe(false);
    }
  });

  it('marks a 409 whose hash does not match as a name conflict', async () => {
    const client = scripted([
      () => json(409, {}),
      () => json(409, {}),
      () => json(409, { error: { code: 'nameAlreadyExists' } }),
      () => json(200, item(bytes.byteLength, 'other-file')),
    ]);
    const result = await uploadAndVerifyOriginal({
      client,
      bytes,
      fileName: 'P01_x.jpg',
      contentType: 'image/jpeg',
      localHash: hash,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.permanent).toBe(true);
      expect(result.conflict).toBe(true);
    }
  });

  it('accepts a conflict when the existing item matches', async () => {
    const client = scripted([
      () => json(409, {}),
      () => json(409, {}),
      () => json(409, { error: { code: 'nameAlreadyExists' } }),
      () => json(200, item(bytes.byteLength, hash)),
    ]);
    const result = await uploadAndVerifyOriginal({
      client,
      bytes,
      fileName: 'P01_x.jpg',
      contentType: 'image/jpeg',
      localHash: hash,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.existed).toBe(true);
  });

  it('uses an upload session above the simple limit', async () => {
    const ranges: string[] = [];
    const client = scripted([
      () => json(409, {}),
      () => json(409, {}),
      (url, init) => {
        expect(url).toContain(':/createUploadSession');
        expect(String(init?.body)).toContain('"fail"');
        return json(200, { uploadUrl: 'https://upload.example/session' });
      },
      (_url, init) => {
        ranges.push(new Headers(init?.headers).get('Content-Range') ?? '');
        return json(202, {});
      },
      (_url, init) => {
        ranges.push(new Headers(init?.headers).get('Content-Range') ?? '');
        return json(201, item(bytes.byteLength, hash));
      },
    ]);
    const result = await uploadAndVerifyOriginal({
      client,
      bytes,
      fileName: 'big.heic',
      contentType: 'image/heic',
      localHash: hash,
      simpleUploadMaxBytes: 8,
      chunkBytes: 8,
    });
    expect(result.ok).toBe(true);
    expect(ranges[0]).toBe(`bytes 0-7/${bytes.byteLength}`);
    expect(ranges[1]).toBe(`bytes 8-${bytes.byteLength - 1}/${bytes.byteLength}`);
  });
});

describe('drainPhotoQueue', () => {
  it('uploads, merges the manifest, and drops the queue record', async () => {
    const queue = createMemoryPhotoQueue();
    const record = queuedRecord();
    await queue.put(record);
    const statuses: string[] = [];
    let manifestBody = '';
    const clientFetch = scripted([
      () => json(409, {}),
      () => json(409, {}),
      () => json(200, item(bytes.byteLength, hash)),
      () => json(404, {}),
      (_url, init) => {
        manifestBody = String(init?.body);
        expect(new Headers(init?.headers).get('If-None-Match')).toBe('*');
        return json(200, {}, { etag: '"m1"' });
      },
    ]).fetch;

    const failed = await drainPhotoQueue({
      queue,
      getToken: async () => 'tok',
      fetchImpl: clientFetch,
      now: () => '2026-10-02T23:30:00.000Z',
      onStatus: (update) => statuses.push(update.status),
    });
    expect(failed).toBe(0);
    expect(statuses).toEqual(['uploading', 'verified']);
    expect(await queue.list()).toEqual([]);
    expect(manifestBody).toContain(record.fileName);
    expect(manifestBody).toContain('"stationId": "P01"');
    expect(manifestBody).toContain('"receivedAt"');
    expect(manifestBody).toContain('"p/scale"');
    expect(manifestBody).toContain(hash);
  });

  it('does not ask for a token when the queue is empty or every failure is permanent', async () => {
    const empty = createMemoryPhotoQueue();
    let tokens = 0;
    const getToken = async () => {
      tokens += 1;
      return 'tok';
    };
    expect(await drainPhotoQueue({ queue: empty, getToken, onStatus: () => undefined })).toBe(0);
    expect(tokens).toBe(0);

    const capped = createMemoryPhotoQueue();
    await capped.put({
      ...queuedRecord(),
      status: 'failed',
      attempts: PHOTO_UPLOAD_MAX_ATTEMPTS,
      permanent: true,
      lastError: 'quickXorHash does not match the local file.',
    });
    expect(await drainPhotoQueue({ queue: capped, getToken, onStatus: () => undefined })).toBe(0);
    expect(tokens).toBe(0);
  });

  it('leaves the queue untouched when sign-in interaction is required', async () => {
    const queue = createMemoryPhotoQueue();
    await queue.put(queuedRecord());
    let taps = 0;
    const failed = await drainPhotoQueue({
      queue,
      getToken: async () => ({ token: null, interactionRequired: true }),
      onInteractionRequired: () => {
        taps += 1;
      },
      onStatus: () => undefined,
    });
    expect(failed).toBe(0);
    expect(taps).toBe(1);
    const [left] = await queue.list();
    expect(left?.status).toBe('queued');
    expect(left?.attempts).toBe(0);
  });

  it('stops a hash mismatch instead of retrying the same name, and uploads a suffixed name', async () => {
    const queue = createMemoryPhotoQueue();
    await queue.put(queuedRecord());
    const names: string[] = [];
    const failed = await drainPhotoQueue({
      queue,
      getToken: async () => 'tok',
      now: () => '2026-10-02T23:30:00.000Z',
      onStatus: () => undefined,
      fetchImpl: scripted([
        () => json(409, {}),
        () => json(409, {}),
        (url) => {
          names.push(url);
          return json(409, { error: { code: 'nameAlreadyExists' } });
        },
        () => json(200, item(bytes.byteLength, 'different-hash')),
        () => json(409, {}),
        () => json(409, {}),
        (url) => {
          names.push(url);
          return json(200, item(bytes.byteLength, hash));
        },
        () => json(404, {}),
        () => json(200, { eTag: '"m1"' }),
      ]).fetch,
    });
    expect(failed).toBe(0);
    expect(names[0]).toContain('P01_20261002T232600123Z.jpg');
    expect(names[1]).toContain('P01_20261002T232600123Z-2.jpg');
    expect(await queue.list()).toEqual([]);
    expect(photoUploadBackoffMs(1)).toBe(2000);
    expect(photoUploadBackoffMs(2)).toBe(4000);
    expect(photoUploadBackoffMs(8)).toBe(60_000);
  });

  it('keeps a failed upload for a later retry', async () => {
    const queue = createMemoryPhotoQueue();
    await queue.put(queuedRecord());
    await drainPhotoQueue({
      queue,
      getToken: async () => 'tok',
      fetchImpl: scripted([
        () => json(409, {}),
        () => json(409, {}),
        () => json(500, { error: { message: 'unavailable' } }),
      ]).fetch,
      onStatus: () => undefined,
    });
    const [left] = await queue.list();
    expect(left?.status).toBe('failed');
    expect(left?.attempts).toBe(1);
    expect(left?.blob.size).toBe(bytes.byteLength);
    expect(left?.lastError).toMatch(/unavailable/);
    expect(left?.permanent).toBeFalsy();
  });

  it('does not make a network failure permanent after the attempt pause', async () => {
    const queue = createMemoryPhotoQueue();
    await queue.put({ ...queuedRecord(), attempts: PHOTO_UPLOAD_MAX_ATTEMPTS - 1, status: 'failed' });
    await drainPhotoQueue({
      queue,
      getToken: async () => 'tok',
      fetchImpl: scripted([
        () => json(409, {}),
        () => json(409, {}),
        () => json(500, { error: { message: 'unavailable' } }),
      ]).fetch,
      onStatus: () => undefined,
    });
    const [paused] = await queue.list();
    expect(paused?.attempts).toBe(PHOTO_UPLOAD_MAX_ATTEMPTS);
    expect(paused?.permanent).toBeFalsy();
    let tokens = 0;
    expect(
      await drainPhotoQueue({
        queue,
        getToken: async () => {
          tokens += 1;
          return 'tok';
        },
        onStatus: () => undefined,
      }),
    ).toBe(0);
    expect(tokens).toBe(0);
    await resetPhotoUploadAttempts(queue, '2026-10-03T00:00:00.000Z');
    const [reset] = await queue.list();
    expect(reset?.status).toBe('queued');
    expect(reset?.attempts).toBe(0);
  });

  it('does not count an attempt while offline', async () => {
    const queue = createMemoryPhotoQueue();
    await queue.put(queuedRecord());
    let tokens = 0;
    const failed = await drainPhotoQueue({
      queue,
      online: () => false,
      getToken: async () => {
        tokens += 1;
        return 'tok';
      },
      onStatus: () => undefined,
    });
    expect(failed).toBe(0);
    expect(tokens).toBe(0);
    const [left] = await queue.list();
    expect(left?.status).toBe('queued');
    expect(left?.attempts).toBe(0);
  });

  it('honours Retry-After and does not treat a missing quickXorHash as permanent', async () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    const later = Date.parse('Wed, 21 Oct 2026 07:28:00 GMT');
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', later - 15_000)).toBe(15_000);

    const missing = await uploadAndVerifyOriginal({
      client: scripted([
        () => json(409, {}),
        () => json(409, {}),
        () => json(200, { size: bytes.byteLength, file: {} }),
        () => json(200, { size: bytes.byteLength, file: {} }),
      ]),
      bytes,
      fileName: 'P01_x.jpg',
      contentType: 'image/jpeg',
      localHash: hash,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.permanent).toBeFalsy();

    const queue = createMemoryPhotoQueue();
    await queue.put(queuedRecord());
    const before = Date.now();
    await drainPhotoQueue({
      queue,
      getToken: async () => 'tok',
      fetchImpl: scripted([
        () => json(409, {}),
        () => json(409, {}),
        () => json(503, { error: { message: 'busy' } }, { 'Retry-After': '30' }),
      ]).fetch,
      onStatus: () => undefined,
    });
    const [left] = await queue.list();
    expect(left?.permanent).toBeFalsy();
    expect(left?.attempts).toBe(1);
    expect(Date.parse(left?.retryNotBefore ?? '') - before).toBeGreaterThan(20_000);
    expect(retryWaitMs({ attempts: 1, retryNotBefore: left?.retryNotBefore }, before)).toBeGreaterThan(20_000);
  });

  it('marks a name that is still taken at -4 as permanent', async () => {
    const queue = createMemoryPhotoQueue();
    await queue.put({ ...queuedRecord(), fileName: 'P01_20261002T232600123Z-4.jpg' });
    await drainPhotoQueue({
      queue,
      getToken: async () => 'tok',
      onStatus: () => undefined,
      fetchImpl: scripted([
        () => json(409, {}),
        () => json(409, {}),
        () => json(409, { error: { code: 'nameAlreadyExists' } }),
        () => json(200, item(bytes.byteLength, 'other-file')),
      ]).fetch,
    });
    const [left] = await queue.list();
    expect(left?.permanent).toBe(true);
    expect(left?.fileName).toBe('P01_20261002T232600123Z-4.jpg');
  });

  it('keeps a Retry-After wait when attempts are reset the way visibility does', async () => {
    const queue = createMemoryPhotoQueue();
    await queue.put({
      ...queuedRecord(),
      status: 'failed',
      attempts: 2,
      retryNotBefore: '2026-10-03T00:10:00.000Z',
    });
    await resetPhotoUploadAttempts(queue, '2026-10-03T00:00:00.000Z', { keepRetryAfter: true });
    let tokens = 0;
    const failed = await drainPhotoQueue({
      queue,
      now: () => '2026-10-03T00:00:00.000Z',
      getToken: async () => {
        tokens += 1;
        return 'tok';
      },
      onStatus: () => undefined,
    });
    expect(failed).toBe(0);
    expect(tokens).toBe(0);
    const [held] = await queue.list();
    expect(held?.attempts).toBe(0);
    expect(held?.status).toBe('queued');
    expect(held?.retryNotBefore).toBe('2026-10-03T00:10:00.000Z');

    await resetPhotoUploadAttempts(queue, '2026-10-03T00:00:00.000Z');
    const [cleared] = await queue.list();
    expect(cleared?.retryNotBefore).toBeUndefined();
  });

  it('does not upload a photo removed from the survey', async () => {
    const queue = createMemoryPhotoQueue();
    await queue.put(queuedRecord());
    await discardQueuedPhoto('ph-1', queue);
    let tokens = 0;
    const failed = await drainPhotoQueue({
      queue,
      getToken: async () => {
        tokens += 1;
        return 'tok';
      },
      onStatus: () => undefined,
    });
    expect(failed).toBe(0);
    expect(tokens).toBe(0);
    expect(await queue.list()).toEqual([]);
  });

  it('moves a photo deleted during upload and keeps the manifest row', async () => {
    const queue = createMemoryPhotoQueue();
    await queue.put(queuedRecord());
    const methods: string[] = [];
    let manifestBody = '';
    const failed = await drainPhotoQueue({
      queue,
      getToken: async () => 'tok',
      onStatus: () => undefined,
      now: () => '2026-10-02T23:30:00.000Z',
      fetchImpl: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const method = init?.method ?? 'GET';
        methods.push(method);
        if (method === 'POST') return json(409, {});
        if (method === 'PUT' && url.includes('.jpg')) {
          await discardQueuedPhoto('ph-1', queue);
          return json(200, item(bytes.byteLength, hash));
        }
        if (method === 'PATCH') return json(200, {});
        if (method === 'GET') return json(404, {});
        if (method === 'PUT' && url.includes('manifest.json')) {
          manifestBody = String(init?.body ?? '');
          return json(200, { eTag: '"m1"' }, { etag: '"m1"' });
        }
        return json(500, { error: { message: `unexpected ${method} ${url}` } });
      },
    });
    expect(failed).toBe(0);
    expect(methods).not.toContain('DELETE');
    expect(methods).toContain('PATCH');
    expect(manifestBody).toContain('"deletedAt"');
    expect(manifestBody).toContain(queuedRecord().fileName);
    expect(await queue.list()).toEqual([]);
  });

  it('relabels a queued 7a4e268 pixel map without moving to the old formula', () => {
    const scale = 640 / 4032;
    const [migrated] = normalizeQueueAfterRestart([
      {
        ...queuedRecord(),
        pixels: {
          fullWidth: 4032,
          fullHeight: 3024,
          previewWidth: 640,
          previewHeight: 480,
          previewScale: scale,
          pixelCentre: '+0.5',
        } as unknown as PhotoQueueRecord['pixels'],
      },
    ]);
    expect(migrated?.pixels?.clickMap).toBe('p/scale');
    expect(migrated?.pixels?.clickMapMigratedFrom).toBe('+0.5');
    expect(migrated?.pixels?.previewScaleX).toBeCloseTo(scale);
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
    pixels: {
      fullWidth: 4032,
      fullHeight: 3024,
      previewWidth: 640,
      previewHeight: 480,
      previewScaleX: 640 / 4032,
      previewScaleY: 480 / 3024,
      clickMap: 'p/scale',
      clickSpace: 'upright',
    },
    quickXorHash: hash,
    exif: { Make: 'Apple', DateTimeOriginal: '2026:10:02 23:26:00' },
    status: 'queued',
    attempts: 0,
    bytesOnDrive: false,
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

function scripted(
  steps: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>,
): GraphRequest & { fetch: typeof fetch } {
  let n = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const step = steps[n];
    n += 1;
    if (!step) throw new Error(`Unexpected request ${n}: ${init?.method} ${url}`);
    return step(url, init);
  };
  return { token: 'tok', fetch: fetchImpl };
}
