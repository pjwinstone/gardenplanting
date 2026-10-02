/**
 * Queue an original camera file and upload it when a Graph token is available.
 * The stored Blob is the file the input delivered — not a canvas re-encode.
 */

import { PHOTOS_MANIFEST_RELATIVE } from './cloudConfig';
import type { PhotoOriginalFile, PhotoUploadStatus } from './model';
import { inspectOriginalFile, type OriginalPhotoDraft } from './photoOriginal';
import {
  createIndexedDbPhotoQueue,
  createMemoryPhotoQueue,
  normalizeQueueAfterRestart,
  type PhotoQueue,
  type PhotoQueueRecord,
} from './photoQueue';
import type { GraphRequest } from './photosManifest';
import { publishPhotoManifest, uploadAndVerifyOriginal } from './photoUpload';

export interface PhotoStatusUpdate {
  photoId: string;
  status: PhotoUploadStatus;
  fileName: string;
  size: number;
  quickXorHash: string;
  contentType: string;
  capturedAt: string;
  exifDateTimeOriginal?: string;
  error?: string;
}

export interface PhotoUploadDeps {
  queue: PhotoQueue;
  getToken: () => Promise<string | null>;
  onStatus: (update: PhotoStatusUpdate) => void;
  now?: () => string;
  /** Test hook. Defaults to the Graph 4 MB simple-upload limit. */
  simpleUploadMaxBytes?: number;
  fetchImpl?: typeof fetch;
}

let appQueue: PhotoQueue | null = null;
let loopDeps: PhotoUploadDeps | null = null;
let running = false;
let rerun = false;
let listening = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export function getAppPhotoQueue(): PhotoQueue {
  if (!appQueue) {
    try {
      appQueue = createIndexedDbPhotoQueue();
    } catch {
      appQueue = createMemoryPhotoQueue();
    }
  }
  return appQueue;
}

export function photosManifestLink(): { path: string } {
  return { path: PHOTOS_MANIFEST_RELATIVE };
}

export function originalFileFromDraft(
  draft: OriginalPhotoDraft,
  status: PhotoUploadStatus,
  error?: string,
): PhotoOriginalFile {
  return {
    fileName: draft.fileName,
    size: draft.size,
    quickXorHash: draft.quickXorHash,
    contentType: draft.contentType,
    capturedAt: draft.capturedAt,
    uploadStatus: status,
    uploadError: error,
  };
}

/** Keep the original Blob and enqueue it. Does not downscale. */
export async function rememberOriginalPhoto(
  file: Blob,
  meta: {
    name?: string;
    type?: string;
    photoId: string;
    stationId: string;
    observationId?: string;
    capturedAt?: string;
  },
  queue: PhotoQueue = getAppPhotoQueue(),
): Promise<OriginalPhotoDraft> {
  const draft = await inspectOriginalFile(file, meta);
  const record: PhotoQueueRecord = {
    id: draft.photoId,
    photoId: draft.photoId,
    stationId: draft.stationId,
    observationId: draft.observationId,
    fileName: draft.fileName,
    blob: draft.blob,
    size: draft.size,
    contentType: draft.contentType,
    capturedAt: draft.capturedAt,
    quickXorHash: draft.quickXorHash,
    exif: draft.exif,
    status: 'queued',
    attempts: 0,
    bytesOnDrive: false,
    updatedAt: draft.capturedAt,
  };
  await queue.put(record);
  return draft;
}

export function startPhotoUploadLoop(
  deps: Omit<PhotoUploadDeps, 'queue'> & { queue?: PhotoQueue },
): void {
  loopDeps = {
    queue: deps.queue ?? getAppPhotoQueue(),
    getToken: deps.getToken,
    onStatus: deps.onStatus,
    now: deps.now,
    simpleUploadMaxBytes: deps.simpleUploadMaxBytes,
    fetchImpl: deps.fetchImpl,
  };
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    window.addEventListener('online', () => {
      kickPhotoUploads();
    });
    const persist = navigator.storage?.persist?.bind(navigator.storage);
    if (persist) void persist();
  }
  kickPhotoUploads();
}

export function kickPhotoUploads(): void {
  if (!loopDeps) return;
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  const deps = loopDeps;
  void drainPhotoQueue(deps)
    .then((failed) => {
      if (failed > 0) scheduleRetry();
    })
    .finally(() => {
      running = false;
      if (rerun) {
        rerun = false;
        kickPhotoUploads();
      }
    });
}

function scheduleRetry(): void {
  if (retryTimer != null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    kickPhotoUploads();
  }, 8000);
}

/**
 * Upload queued and failed originals, then merge each one into the manifest.
 * Returns how many items failed this pass. Not signed in: leave them queued.
 */
export async function drainPhotoQueue(deps: PhotoUploadDeps): Promise<number> {
  const recovered = normalizeQueueAfterRestart(await deps.queue.list());
  for (const record of recovered) {
    const previous = await deps.queue.get(record.id);
    if (previous?.status === 'uploading') {
      await deps.queue.put({
        ...record,
        updatedAt: deps.now?.() ?? new Date().toISOString(),
      });
    }
  }

  const token = await deps.getToken();
  if (!token) return 0;

  const client: GraphRequest = { fetch: deps.fetchImpl ?? fetch, token };
  let failed = 0;
  const records = await deps.queue.list();
  for (const record of records) {
    if (record.status === 'verified') {
      await deps.queue.delete(record.id);
      deps.onStatus(statusOf(record, 'verified'));
      continue;
    }
    if (record.status !== 'queued' && record.status !== 'failed') continue;

    const stamp = deps.now?.() ?? new Date().toISOString();
    const uploading: PhotoQueueRecord = { ...record, status: 'uploading', updatedAt: stamp };
    await deps.queue.put(uploading);
    deps.onStatus(statusOf(uploading, 'uploading'));

    try {
      const outcome = await uploadOne(client, uploading, deps);
      if (outcome.ok) {
        await deps.queue.delete(record.id);
        deps.onStatus(statusOf({ ...uploading, bytesOnDrive: true }, 'verified'));
      } else {
        failed += 1;
        const failedRec: PhotoQueueRecord = {
          ...uploading,
          status: 'failed',
          attempts: record.attempts + 1,
          lastError: outcome.error,
          bytesOnDrive: outcome.bytesOnDrive,
          updatedAt: deps.now?.() ?? new Date().toISOString(),
        };
        await deps.queue.put(failedRec);
        deps.onStatus(statusOf(failedRec, 'failed', outcome.error));
      }
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : 'Upload failed.';
      const failedRec: PhotoQueueRecord = {
        ...uploading,
        status: 'failed',
        attempts: record.attempts + 1,
        lastError: message,
        updatedAt: deps.now?.() ?? new Date().toISOString(),
      };
      await deps.queue.put(failedRec);
      deps.onStatus(statusOf(failedRec, 'failed', message));
    }
  }
  return failed;
}

async function uploadOne(
  client: GraphRequest,
  record: PhotoQueueRecord,
  deps: PhotoUploadDeps,
): Promise<{ ok: true } | { ok: false; error: string; bytesOnDrive: boolean }> {
  let bytesOnDrive = record.bytesOnDrive;
  if (!bytesOnDrive) {
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    if (bytes.byteLength !== record.size) {
      return {
        ok: false,
        error: 'Queued file size changed before upload.',
        bytesOnDrive: false,
      };
    }
    const uploaded = await uploadAndVerifyOriginal({
      client,
      bytes,
      fileName: record.fileName,
      contentType: record.contentType,
      localHash: record.quickXorHash,
      simpleUploadMaxBytes: deps.simpleUploadMaxBytes,
    });
    if (!uploaded.ok) return { ok: false, error: uploaded.error, bytesOnDrive: false };
    bytesOnDrive = true;
    await deps.queue.put({ ...record, bytesOnDrive: true, status: 'uploading' });
  }
  const manifest = await publishPhotoManifest({
    client,
    record: { ...record, bytesOnDrive: true },
    now: deps.now?.() ?? new Date().toISOString(),
  });
  if (!manifest.ok) return { ok: false, error: manifest.error, bytesOnDrive: true };
  return { ok: true };
}

function statusOf(
  record: PhotoQueueRecord,
  status: PhotoUploadStatus,
  error?: string,
): PhotoStatusUpdate {
  return {
    photoId: record.photoId,
    status,
    fileName: record.fileName,
    size: record.size,
    quickXorHash: record.quickXorHash,
    contentType: record.contentType,
    capturedAt: record.capturedAt,
    exifDateTimeOriginal: record.exif.DateTimeOriginal,
    error,
  };
}

export async function listQueuedPhotos(
  queue: PhotoQueue = getAppPhotoQueue(),
): Promise<PhotoQueueRecord[]> {
  return normalizeQueueAfterRestart(await queue.list());
}
