/**
 * IndexedDB queue of original camera files.
 * Records survive reload and tab kill. A killed upload is put back to `queued`.
 */

import type { SurveyExif } from './photoExif';
import type { PhotoUploadStatus } from './model';

export const PHOTO_DB_NAME = 'garden-survey-photos';
export const PHOTO_STORE = 'queue';

export interface PhotoQueueRecord {
  id: string;
  photoId: string;
  stationId: string;
  observationId?: string;
  fileName: string;
  blob: Blob;
  size: number;
  contentType: string;
  capturedAt: string;
  quickXorHash: string;
  exif: SurveyExif;
  status: PhotoUploadStatus;
  attempts: number;
  lastError?: string;
  /** True once OneDrive has this exact file (size + quickXorHash). */
  bytesOnDrive: boolean;
  updatedAt: string;
}

export interface PhotoQueue {
  put(record: PhotoQueueRecord): Promise<void>;
  get(id: string): Promise<PhotoQueueRecord | undefined>;
  list(): Promise<PhotoQueueRecord[]>;
  delete(id: string): Promise<void>;
}

/** Uploads left in `uploading` did not finish (tab kill). Queue them again. */
export function normalizeQueueAfterRestart(records: PhotoQueueRecord[]): PhotoQueueRecord[] {
  return records.map((record) =>
    record.status === 'uploading'
      ? { ...record, status: 'queued', lastError: undefined }
      : record,
  );
}

export function createMemoryPhotoQueue(): PhotoQueue {
  const map = new Map<string, PhotoQueueRecord>();
  return {
    async put(record) {
      map.set(record.id, cloneRecord(record));
    },
    async get(id) {
      const found = map.get(id);
      return found ? cloneRecord(found) : undefined;
    },
    async list() {
      return [...map.values()].map(cloneRecord);
    },
    async delete(id) {
      map.delete(id);
    },
  };
}

export function createIndexedDbPhotoQueue(factory?: IDBFactory): PhotoQueue {
  const idb = factory ?? globalThis.indexedDB;
  if (!idb) {
    throw new Error('IndexedDB is not available in this browser.');
  }

  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = idb.open(PHOTO_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });

  const txDone = <T>(request: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });

  return {
    async put(record) {
      const db = await open();
      try {
        const tx = db.transaction(PHOTO_STORE, 'readwrite');
        await txDone(tx.objectStore(PHOTO_STORE).put(record));
        await transactionComplete(tx);
      } finally {
        db.close();
      }
    },
    async get(id) {
      const db = await open();
      try {
        const tx = db.transaction(PHOTO_STORE, 'readonly');
        const row = await txDone(tx.objectStore(PHOTO_STORE).get(id));
        return (row as PhotoQueueRecord | undefined) ?? undefined;
      } finally {
        db.close();
      }
    },
    async list() {
      const db = await open();
      try {
        const tx = db.transaction(PHOTO_STORE, 'readonly');
        const rows = await txDone(tx.objectStore(PHOTO_STORE).getAll());
        return (rows as PhotoQueueRecord[]) ?? [];
      } finally {
        db.close();
      }
    },
    async delete(id) {
      const db = await open();
      try {
        const tx = db.transaction(PHOTO_STORE, 'readwrite');
        await txDone(tx.objectStore(PHOTO_STORE).delete(id));
        await transactionComplete(tx);
      } finally {
        db.close();
      }
    },
  };
}

function transactionComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function cloneRecord(record: PhotoQueueRecord): PhotoQueueRecord {
  const copy = structuredClone(record);
  return copy;
}
