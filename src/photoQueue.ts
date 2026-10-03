/**
 * IndexedDB queue of original camera files.
 * Records survive reload and tab kill. A killed upload is put back to `queued`.
 */

import type { AppleMakerNote, SurveyExif } from './photoExif';
import type { PhotoUploadStatus } from './model';
import type { PhotoProvenance } from './photosManifest';
import { migratePreviewPixels, type PreviewPixelMap } from './photoOriginal';

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
  /** Wall clock when the app received the file. */
  receivedAt: string;
  /** EXIF capture time when present. Older rows stored the receive time here and omit receivedAt — see receivedAtOf. */
  capturedAt?: string;
  provenance?: PhotoProvenance;
  sha256?: string;
  calibrationKey?: string;
  makerNote?: AppleMakerNote;
  pixels?: PreviewPixelMap;
  usabilityNote?: string;
  quickXorHash: string;
  exif: SurveyExif;
  /**
   * `retire`: the survey dropped this original. The queue retries a move to
   * `photos/deleted/` instead of uploading it again.
   */
  status: PhotoUploadStatus | 'retire';
  attempts: number;
  lastError?: string;
  /** Hash mismatch, or the name was still taken after -4. Do not retry. */
  permanent?: boolean;
  /** Do not start another attempt before this ISO time (Retry-After). */
  retryNotBefore?: string;
  /** True once OneDrive has this exact file (size + quickXorHash). */
  bytesOnDrive: boolean;
  updatedAt: string;
  /** Set once the survey dropped this original. */
  deletedAt?: string;
}

export interface PhotoQueue {
  put(record: PhotoQueueRecord): Promise<void>;
  get(id: string): Promise<PhotoQueueRecord | undefined>;
  list(): Promise<PhotoQueueRecord[]>;
  delete(id: string): Promise<void>;
}

/**
 * Uploads left in `uploading` did not finish (tab kill). Queue them again.
 * Rows from 7a4e268 that published `pixelCentre: '+0.5'` are relabelled
 * `p/scale`. Their stored clicks were already edge coordinates, so px/py stay.
 */
export function normalizeQueueAfterRestart(records: PhotoQueueRecord[]): PhotoQueueRecord[] {
  return records.map((record) => {
    const pixels = migratePreviewPixels(record.pixels);
    const next: PhotoQueueRecord =
      pixels && pixels !== record.pixels ? { ...record, pixels: pixels as PreviewPixelMap } : record;
    // A killed tab must not upload an original the survey already dropped.
    if (next.status === 'retire' || next.deletedAt) {
      return { ...next, status: 'retire' };
    }
    return next.status === 'uploading'
      ? { ...next, status: 'queued', lastError: undefined }
      : next;
  });
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
