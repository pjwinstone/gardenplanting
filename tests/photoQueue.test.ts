import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { quickXorHash } from '../src/quickXorHash';
import {
  PHOTO_DB_NAME,
  createIndexedDbPhotoQueue,
  createMemoryPhotoQueue,
  normalizeQueueAfterRestart,
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
