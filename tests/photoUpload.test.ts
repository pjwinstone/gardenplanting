import { describe, expect, it } from 'vitest';
import { quickXorHash } from '../src/quickXorHash';
import { createMemoryPhotoQueue, type PhotoQueueRecord } from '../src/photoQueue';
import { SIMPLE_UPLOAD_MAX_BYTES, uploadAndVerifyOriginal } from '../src/photoUpload';
import { PHOTO_UPLOAD_MAX_ATTEMPTS, drainPhotoQueue, photoUploadBackoffMs } from '../src/photoSync';
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
    expect(manifestBody).toContain('"+0.5"');
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
      previewScale: 640 / 4032,
      pixelCentre: '+0.5',
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
  steps: Array<(url: string, init?: RequestInit) => Response>,
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
