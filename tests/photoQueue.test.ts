import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { quickXorHash } from '../src/quickXorHash';
import {
  PHOTO_DB_NAME,
  PHOTO_DB_VERSION,
  createIndexedDbPhotoQueue,
  createMemoryPhotoQueue,
  hydratePhotoQueueRow,
  normalizeQueueAfterRestart,
  photoQueueRecordToStoredRow,
  type PhotoQueueRecord,
} from '../src/photoQueue';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4]);

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(PHOTO_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
});

describe('photo queue', () => {
  it('keeps the original blob across a fresh IndexedDB connection', async () => {
    const hash = quickXorHash(jpeg).base64;
    const first = createIndexedDbPhotoQueue();
    await first.put(record({ status: 'uploading', hash }));

    const reopened = createIndexedDbPhotoQueue();
    const restored = normalizeQueueAfterRestart(await reopened.list());
    expect(restored).toHaveLength(1);
    expect(restored[0]?.status).toBe('queued');
    expect(restored[0]?.quickXorHash).toBe(hash);
    const bytes = new Uint8Array(await restored[0]!.blob.arrayBuffer());
    expect([...bytes]).toEqual([...jpeg]);
  });

  it('persists queue bytes as ArrayBuffer, not Blob (WKWebView-safe)', async () => {
    const queue = createIndexedDbPhotoQueue();
    await queue.put(record({ status: 'queued', hash: 'h' }));

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(PHOTO_DB_NAME, PHOTO_DB_VERSION);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('queue', 'readonly');
    const raw = await new Promise<unknown>((resolve, reject) => {
      const req = tx.objectStore('queue').get('ph-a');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();

    expect(raw).toBeTruthy();
    expect((raw as { blob?: Blob }).blob).toBeUndefined();
    expect((raw as { blobBytes?: ArrayBuffer }).blobBytes).toBeInstanceOf(ArrayBuffer);

    const hydrated = hydratePhotoQueueRow(raw);
    expect(hydrated.blob).toBeInstanceOf(Blob);
    expect(hydrated.blob.size).toBe(jpeg.byteLength);
  });

  it('hydrates legacy rows that still store a Blob', async () => {
    const legacy = { ...record({ status: 'queued', hash: 'h' }) };
    const hydrated = hydratePhotoQueueRow(legacy);
    expect(hydrated.blob.size).toBe(jpeg.byteLength);
  });

  it('serializes records for storage without keeping the Blob reference', async () => {
    const stored = await photoQueueRecordToStoredRow(record({ status: 'queued', hash: 'h' }));
    expect(stored.blobBytes).toBeInstanceOf(ArrayBuffer);
    expect('blob' in stored).toBe(false);
    expect(stored.contentType).toBe('image/jpeg');
  });

  it('leaves a failed item in place until a retry updates it', async () => {
    const queue = createMemoryPhotoQueue();
    await queue.put(record({ status: 'failed', hash: 'h', lastError: 'offline' }));
    const [item] = await queue.list();
    expect(item?.status).toBe('failed');
    expect(item?.lastError).toBe('offline');
    await queue.put({ ...item!, status: 'queued', lastError: undefined, attempts: item!.attempts });
    const again = await queue.get(item!.id);
    expect(again?.status).toBe('queued');
    expect(again?.blob.size).toBe(jpeg.byteLength);
  });

  it('treats only an interrupted upload as queued again', () => {
    const rows = [
      record({ status: 'uploading', hash: 'a' }),
      record({ status: 'failed', hash: 'b', id: 'ph-b' }),
      record({ status: 'queued', hash: 'c', id: 'ph-c' }),
    ];
    const next = normalizeQueueAfterRestart(rows);
    expect(next.map((row) => row.status)).toEqual(['queued', 'failed', 'queued']);
  });
});

function record(opts: {
  status: PhotoQueueRecord['status'];
  hash: string;
  id?: string;
  lastError?: string;
}): PhotoQueueRecord {
  return {
    id: opts.id ?? 'ph-a',
    photoId: opts.id ?? 'ph-a',
    stationId: 'P01',
    fileName: 'P01_20261002T232600123Z.jpg',
    blob: new Blob([jpeg], { type: 'image/jpeg' }),
    size: jpeg.byteLength,
    contentType: 'image/jpeg',
    receivedAt: '2026-10-02T23:26:00.123Z',
    capturedAt: '2026-10-02T23:26:00.123+01:00',
    quickXorHash: opts.hash,
    exif: { Make: 'Apple' },
    status: opts.status,
    attempts: opts.status === 'failed' ? 2 : 0,
    lastError: opts.lastError,
    bytesOnDrive: false,
    updatedAt: '2026-10-02T23:26:00.123Z',
  };
}
