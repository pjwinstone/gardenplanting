/**
 * Queue an original camera file and upload it when a silent Graph token is available.
 * The stored Blob is the file the input delivered — not a canvas re-encode.
 *
 * Background sync never redirects. If Microsoft needs interaction, the caller shows
 * “Sign in to upload” and waits for a tap. An empty queue does not ask for a token.
 */

import { PHOTOS_MANIFEST_RELATIVE } from './cloudConfig';
import type { PhotoOriginalFile, PhotoUploadStatus } from './model';
import { inspectOriginalFile, suffixedPhotoFileName, type OriginalPhotoDraft } from './photoOriginal';
import {
  createIndexedDbPhotoQueue,
  createMemoryPhotoQueue,
  normalizeQueueAfterRestart,
  type PhotoQueue,
  type PhotoQueueRecord,
} from './photoQueue';
import type { GraphRequest, PhotoProvenance } from './photosManifest';
import { publishPhotoManifest, uploadAndVerifyOriginal } from './photoUpload';

/** Stop retrying a photo after this many failed passes. Permanent errors stop sooner. */
export const PHOTO_UPLOAD_MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60_000;

export function photoUploadBackoffMs(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
}

export interface PhotoStatusUpdate {
  photoId: string;
  status: PhotoUploadStatus;
  fileName: string;
  size: number;
  quickXorHash: string;
  sha256?: string;
  contentType: string;
  receivedAt: string;
  capturedAt?: string;
  provenance?: PhotoProvenance;
  calibrationKey?: string;
  exifDateTimeOriginal?: string;
  usabilityNote?: string;
  fullWidth?: number;
  fullHeight?: number;
  previewWidth?: number;
  previewHeight?: number;
  previewScale?: number;
  pixelCentre?: '+0.5';
  error?: string;
}

/** String token (tests) or a silent-auth result. interactionRequired must not mark the photo failed. */
export type PhotoTokenResult =
  | string
  | null
  | { token: string | null; interactionRequired?: boolean };

export interface PhotoUploadDeps {
  queue: PhotoQueue;
  getToken: () => Promise<PhotoTokenResult>;
  onStatus: (update: PhotoStatusUpdate) => void;
  /** User must tap Sign in. Do not redirect from here. */
  onInteractionRequired?: () => void;
  onStorageWarning?: (message: string) => void;
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
  return originalFields(draft, status, error);
}

function originalFields(
  source: {
    fileName: string;
    size: number;
    quickXorHash: string;
    sha256?: string;
    contentType: string;
    receivedAt: string;
    capturedAt?: string;
    provenance?: PhotoProvenance;
    calibrationKey?: string;
    usabilityNote?: string;
    pixels?: OriginalPhotoDraft['pixels'];
  },
  status: PhotoUploadStatus,
  error?: string,
): PhotoOriginalFile {
  return {
    fileName: source.fileName,
    size: source.size,
    quickXorHash: source.quickXorHash,
    sha256: source.sha256,
    contentType: source.contentType,
    receivedAt: source.receivedAt,
    capturedAt: source.capturedAt,
    provenance: source.provenance,
    calibrationKey: source.calibrationKey,
    fullWidth: source.pixels?.fullWidth,
    fullHeight: source.pixels?.fullHeight,
    previewWidth: source.pixels?.previewWidth,
    previewHeight: source.pixels?.previewHeight,
    previewScale: source.pixels?.previewScale,
    pixelCentre: source.pixels?.pixelCentre,
    usabilityNote: source.usabilityNote,
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
    receivedAt?: string;
    pixels?: OriginalPhotoDraft['pixels'];
    sessionStartedAt?: string;
    sessionEndedAt?: string;
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
    receivedAt: draft.receivedAt,
    capturedAt: draft.capturedAt,
    provenance: draft.provenance,
    sha256: draft.sha256,
    calibrationKey: draft.calibrationKey,
    makerNote: draft.makerNote,
    pixels: draft.pixels,
    usabilityNote: draft.usabilityNote,
    quickXorHash: draft.quickXorHash,
    exif: draft.exif,
    status: 'queued',
    attempts: 0,
    bytesOnDrive: false,
    updatedAt: draft.receivedAt,
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
    onInteractionRequired: deps.onInteractionRequired,
    onStorageWarning: deps.onStorageWarning,
    now: deps.now,
    simpleUploadMaxBytes: deps.simpleUploadMaxBytes,
    fetchImpl: deps.fetchImpl,
  };
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    window.addEventListener('online', () => {
      const active = loopDeps;
      if (!active) return;
      void requeueFailedAfterOnline(active).then(() => kickPhotoUploads());
    });
    const persist = navigator.storage?.persist?.bind(navigator.storage);
    if (persist) {
      void persist().then((granted) => {
        if (granted) return;
        loopDeps?.onStorageWarning?.(
          'This browser has not made storage persistent. Original photos waiting to upload may be evicted. Add Garden Survey to the Home Screen.',
        );
      });
    }
  }
  kickPhotoUploads();
}

async function requeueFailedAfterOnline(deps: PhotoUploadDeps): Promise<void> {
  const records = await deps.queue.list();
  for (const record of records) {
    if (record.status === 'failed' && !record.permanent) {
      await deps.queue.put({
        ...record,
        status: 'queued',
        attempts: 0,
        lastError: undefined,
        updatedAt: deps.now?.() ?? new Date().toISOString(),
      });
    }
  }
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
    .then(async (failed) => {
      if (failed > 0) await scheduleRetryIfNeeded(deps);
    })
    .finally(() => {
      running = false;
      if (rerun) {
        rerun = false;
        kickPhotoUploads();
      }
    });
}

async function scheduleRetryIfNeeded(deps: PhotoUploadDeps): Promise<void> {
  const records = await deps.queue.list();
  const retryable = records.filter(isRetryable);
  if (!retryable.length) return;
  const wait = Math.min(...retryable.map((r) => photoUploadBackoffMs(r.attempts)));
  if (retryTimer != null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    kickPhotoUploads();
  }, wait);
}

function isRetryable(record: PhotoQueueRecord): boolean {
  if (record.permanent) return false;
  if (record.status === 'queued') return true;
  if (record.status === 'failed' && record.attempts < PHOTO_UPLOAD_MAX_ATTEMPTS) return true;
  return false;
}

/**
 * Upload queued and failed originals, then merge each one into the manifest.
 * Returns how many items failed this pass. Not signed in: leave them queued.
 * Does not call getToken when nothing is waiting.
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

  const listed = await deps.queue.list();
  for (const record of listed) {
    if (record.status !== 'verified') continue;
    await deps.queue.delete(record.id);
    deps.onStatus(statusOf(record, 'verified'));
  }

  const pending = (await deps.queue.list()).filter(isRetryable);
  if (!pending.length) return 0;

  const tokenResult = readToken(await deps.getToken());
  if (tokenResult.interactionRequired) {
    deps.onInteractionRequired?.();
    return 0;
  }
  if (!tokenResult.token) return 0;

  const client: GraphRequest = { fetch: deps.fetchImpl ?? fetch, token: tokenResult.token };
  let failed = 0;
  const records = await deps.queue.list();
  for (const record of records) {
    if (!isRetryable(record)) continue;

    const stamp = deps.now?.() ?? new Date().toISOString();
    const uploading: PhotoQueueRecord = { ...record, status: 'uploading', updatedAt: stamp };
    await deps.queue.put(uploading);
    deps.onStatus(statusOf(uploading, 'uploading'));

    try {
      const outcome = await uploadOne(client, uploading, deps);
      if (outcome.ok) {
        const done = outcome.record ?? uploading;
        await deps.queue.delete(record.id);
        deps.onStatus(statusOf({ ...done, bytesOnDrive: true }, 'verified'));
      } else {
        failed += 1;
        const attempts = record.attempts + 1;
        const permanent = outcome.permanent || attempts >= PHOTO_UPLOAD_MAX_ATTEMPTS;
        const failedRec: PhotoQueueRecord = {
          ...(outcome.record ?? uploading),
          status: 'failed',
          attempts,
          permanent,
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
      const attempts = record.attempts + 1;
      const failedRec: PhotoQueueRecord = {
        ...uploading,
        status: 'failed',
        attempts,
        permanent: attempts >= PHOTO_UPLOAD_MAX_ATTEMPTS,
        lastError: message,
        updatedAt: deps.now?.() ?? new Date().toISOString(),
      };
      await deps.queue.put(failedRec);
      deps.onStatus(statusOf(failedRec, 'failed', message));
    }
  }
  return failed;
}

function readToken(result: PhotoTokenResult): { token: string | null; interactionRequired: boolean } {
  if (result && typeof result === 'object') {
    return { token: result.token, interactionRequired: Boolean(result.interactionRequired) };
  }
  return { token: result, interactionRequired: false };
}

async function uploadOne(
  client: GraphRequest,
  record: PhotoQueueRecord,
  deps: PhotoUploadDeps,
): Promise<
  | { ok: true; record?: PhotoQueueRecord }
  | { ok: false; error: string; bytesOnDrive: boolean; permanent?: boolean; record?: PhotoQueueRecord }
> {
  return uploadNamed(client, record, deps, 0);
}

async function uploadNamed(
  client: GraphRequest,
  record: PhotoQueueRecord,
  deps: PhotoUploadDeps,
  suffixTry: number,
): Promise<
  | { ok: true; record?: PhotoQueueRecord }
  | { ok: false; error: string; bytesOnDrive: boolean; permanent?: boolean; record?: PhotoQueueRecord }
> {
  let bytesOnDrive = record.bytesOnDrive;
  if (!bytesOnDrive) {
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    if (bytes.byteLength !== record.size) {
      return {
        ok: false,
        error: 'Queued file size changed before upload.',
        bytesOnDrive: false,
        permanent: true,
        record,
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
    if (!uploaded.ok) {
      if (uploaded.conflict && suffixTry < 3) {
        const fileName = suffixedPhotoFileName(record.fileName);
        if (fileName) {
          const renamed: PhotoQueueRecord = { ...record, fileName, bytesOnDrive: false, status: 'uploading' };
          await deps.queue.put(renamed);
          return uploadNamed(client, renamed, deps, suffixTry + 1);
        }
      }
      return {
        ok: false,
        error: uploaded.error,
        bytesOnDrive: false,
        permanent: Boolean(uploaded.permanent),
        record,
      };
    }
    bytesOnDrive = true;
    record = { ...record, bytesOnDrive: true, status: 'uploading' };
    await deps.queue.put(record);
  }
  const manifest = await publishPhotoManifest({
    client,
    record: { ...record, bytesOnDrive: true },
    now: deps.now?.() ?? new Date().toISOString(),
  });
  if (!manifest.ok) return { ok: false, error: manifest.error, bytesOnDrive: true, record };
  return { ok: true, record };
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
    sha256: record.sha256,
    contentType: record.contentType,
    receivedAt: record.receivedAt || record.capturedAt || '',
    capturedAt: record.receivedAt ? record.capturedAt : undefined,
    provenance: record.provenance,
    calibrationKey: record.calibrationKey,
    exifDateTimeOriginal: record.exif.DateTimeOriginal,
    usabilityNote: record.usabilityNote,
    fullWidth: record.pixels?.fullWidth,
    fullHeight: record.pixels?.fullHeight,
    previewWidth: record.pixels?.previewWidth,
    previewHeight: record.pixels?.previewHeight,
    previewScale: record.pixels?.previewScale,
    pixelCentre: record.pixels?.pixelCentre,
    error,
  };
}

export async function listQueuedPhotos(
  queue: PhotoQueue = getAppPhotoQueue(),
): Promise<PhotoQueueRecord[]> {
  return normalizeQueueAfterRestart(await queue.list());
}
