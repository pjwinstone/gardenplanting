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
import { deleteDrivePhoto, publishPhotoManifest, uploadAndVerifyOriginal } from './photoUpload';

/**
 * Pause automatic retries after this many counted failures.
 * This is not permanent: app start, online, becoming visible, sign-in, and Retry clear it.
 * Offline skips and hash mismatches do not use this counter the same way —
 * a hash mismatch is permanent on its own.
 */
export const PHOTO_UPLOAD_MAX_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60_000;

export function photoUploadBackoffMs(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1));
}

/** Wait at least the exponential backoff, and at least until Retry-After. */
export function retryWaitMs(record: { attempts: number; retryNotBefore?: string }, now = Date.now()): number {
  const backoff = photoUploadBackoffMs(record.attempts);
  const until = record.retryNotBefore ? Date.parse(record.retryNotBefore) - now : 0;
  return Math.max(backoff, Number.isFinite(until) ? until : 0, 0);
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
  previewScaleX?: number;
  previewScaleY?: number;
  clickMap?: 'p/scale';
  /** Hash mismatch or a name still taken after -4. Retry will not clear this. */
  permanent?: boolean;
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
  /** Test hook. Production uses navigator.onLine. */
  online?: () => boolean;
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
    previewScaleX: source.pixels?.previewScaleX,
    previewScaleY: source.pixels?.previewScaleY,
    clickMap: source.pixels?.clickMap,
    clickSpace: source.pixels?.clickSpace,
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
    online: deps.online,
  };
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    window.addEventListener('online', () => {
      void resumePhotoUploads();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      // Coming back must not drop a 429 Retry-After wait.
      void resumePhotoUploads({ keepRetryAfter: true });
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
  void resumePhotoUploads();
}

/**
 * Clear the attempt counter on every non-permanent row and queue failed ones again.
 * Used on app start, online, visibility, sign-in, and the Retry button.
 * `keepRetryAfter` leaves `retryNotBefore` in place (visibilitychange).
 */
export async function resetPhotoUploadAttempts(
  queue: PhotoQueue,
  now = new Date().toISOString(),
  opts: { keepRetryAfter?: boolean } = {},
): Promise<void> {
  const records = await queue.list();
  for (const record of records) {
    if (record.permanent) continue;
    if (record.status !== 'failed' && record.attempts === 0 && !record.retryNotBefore) continue;
    await queue.put({
      ...record,
      status: record.status === 'failed' || record.status === 'uploading' ? 'queued' : record.status,
      attempts: 0,
      retryNotBefore: opts.keepRetryAfter ? record.retryNotBefore : undefined,
      lastError: record.status === 'failed' ? undefined : record.lastError,
      updatedAt: now,
    });
  }
}

/** Reset attempts, then upload. Does not clear a hash mismatch. */
export async function resumePhotoUploads(opts: { keepRetryAfter?: boolean } = {}): Promise<void> {
  const active = loopDeps;
  if (!active) return;
  await resetPhotoUploadAttempts(active.queue, active.now?.() ?? new Date().toISOString(), opts);
  kickPhotoUploads();
}

/** User tapped Retry. One photo, or every non-permanent failure when photoId is omitted. */
export async function retryPhotoUpload(photoId?: string): Promise<void> {
  const active = loopDeps;
  if (!active) return;
  const now = active.now?.() ?? new Date().toISOString();
  const records = await active.queue.list();
  for (const record of records) {
    if (photoId && record.photoId !== photoId) continue;
    if (record.permanent) continue;
    if (record.status !== 'failed' && record.status !== 'queued') continue;
    await active.queue.put({
      ...record,
      status: 'queued',
      attempts: 0,
      retryNotBefore: undefined,
      lastError: undefined,
      updatedAt: now,
    });
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
    .then(async (failed) => {
      if (failed > 0 || (await queueHasHeldRetry(deps))) await scheduleRetryIfNeeded(deps);
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
  const now = nowMs(deps);
  const open = records.filter(attemptStillOpen);
  if (!open.length) return;
  const wait = Math.min(...open.map((r) => retryWaitMs(r, now)));
  if (retryTimer != null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    kickPhotoUploads();
  }, wait);
}

function attemptStillOpen(record: PhotoQueueRecord): boolean {
  if (record.permanent) return false;
  if (record.status === 'queued') return true;
  if (record.status === 'failed' && record.attempts < PHOTO_UPLOAD_MAX_ATTEMPTS) return true;
  return false;
}

function retryHeld(record: PhotoQueueRecord, now: number): boolean {
  if (!record.retryNotBefore) return false;
  const until = Date.parse(record.retryNotBefore);
  return Number.isFinite(until) && until > now;
}

function isRetryable(record: PhotoQueueRecord, now: number): boolean {
  return attemptStillOpen(record) && !retryHeld(record, now);
}

async function queueHasHeldRetry(deps: PhotoUploadDeps): Promise<boolean> {
  const now = nowMs(deps);
  const records = await deps.queue.list();
  return records.some((record) => attemptStillOpen(record) && retryHeld(record, now));
}

function nowMs(deps: PhotoUploadDeps): number {
  if (!deps.now) return Date.now();
  const parsed = Date.parse(deps.now());
  return Number.isFinite(parsed) ? parsed : Date.now();
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
    if (!previous) continue;
    const pixelsChanged =
      previous.pixels?.clickMap !== record.pixels?.clickMap ||
      previous.pixels?.clickMapMigratedFrom !== record.pixels?.clickMapMigratedFrom;
    if (previous.status === 'uploading' || pixelsChanged) {
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

  const now = nowMs(deps);
  const pending = (await deps.queue.list()).filter((record) => isRetryable(record, now));
  if (!pending.length) return 0;
  if (!isOnline(deps)) return 0;

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
    if (!isRetryable(record, now)) continue;
    if (!isOnline(deps)) return failed;

    const live = await deps.queue.get(record.id);
    if (!live) continue;

    const stamp = deps.now?.() ?? new Date().toISOString();
    const uploading: PhotoQueueRecord = { ...live, status: 'uploading', updatedAt: stamp };
    await deps.queue.put(uploading);
    deps.onStatus(statusOf(uploading, 'uploading'));

    try {
      const outcome = await uploadOne(client, uploading, deps);
      if (outcome.ok && outcome.cancelled) continue;
      if (!(await deps.queue.get(record.id))) continue;
      if (outcome.ok) {
        const done = outcome.record ?? uploading;
        await deps.queue.delete(record.id);
        deps.onStatus(statusOf({ ...done, bytesOnDrive: true }, 'verified'));
      } else {
        failed += 1;
        const attempts = record.attempts + 1;
        const permanent = Boolean(outcome.permanent);
        const retryNotBefore =
          outcome.retryAfterMs != null
            ? new Date(Date.now() + outcome.retryAfterMs).toISOString()
            : undefined;
        const failedRec: PhotoQueueRecord = {
          ...(outcome.record ?? uploading),
          status: 'failed',
          attempts,
          permanent,
          retryNotBefore,
          lastError: outcome.error,
          bytesOnDrive: outcome.bytesOnDrive,
          updatedAt: deps.now?.() ?? new Date().toISOString(),
        };
        await deps.queue.put(failedRec);
        deps.onStatus(statusOf(failedRec, 'failed', outcome.error));
      }
    } catch (err) {
      if (!(await deps.queue.get(record.id))) continue;
      failed += 1;
      const message = err instanceof Error ? err.message : 'Upload failed.';
      const attempts = record.attempts + 1;
      const failedRec: PhotoQueueRecord = {
        ...uploading,
        status: 'failed',
        attempts,
        permanent: false,
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
  | { ok: true; cancelled?: boolean; record?: PhotoQueueRecord }
  | {
      ok: false;
      error: string;
      bytesOnDrive: boolean;
      permanent?: boolean;
      retryAfterMs?: number;
      record?: PhotoQueueRecord;
    }
> {
  return uploadNamed(client, record, deps, 0);
}

async function uploadNamed(
  client: GraphRequest,
  record: PhotoQueueRecord,
  deps: PhotoUploadDeps,
  suffixTry: number,
): Promise<
  | { ok: true; cancelled?: boolean; record?: PhotoQueueRecord }
  | {
      ok: false;
      error: string;
      bytesOnDrive: boolean;
      permanent?: boolean;
      retryAfterMs?: number;
      record?: PhotoQueueRecord;
    }
> {
  const dropped = await droppedFromQueue(deps, record.id);
  if (dropped) return { ok: true, cancelled: true };
  let bytesOnDrive = record.bytesOnDrive;
  if (!bytesOnDrive) {
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    if (bytes.byteLength !== record.size) {
      return {
        ok: false,
        error: 'Queued file size changed before upload.',
        bytesOnDrive: false,
        permanent: false,
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
      if (uploaded.conflict && uploaded.permanent) {
        const fileName = suffixedPhotoFileName(record.fileName);
        if (fileName && suffixTry < 3) {
          const renamed: PhotoQueueRecord = { ...record, fileName, bytesOnDrive: false, status: 'uploading' };
          await deps.queue.put(renamed);
          return uploadNamed(client, renamed, deps, suffixTry + 1);
        }
        return {
          ok: false,
          error: uploaded.error,
          bytesOnDrive: false,
          permanent: true,
          record,
        };
      }
      return {
        ok: false,
        error: uploaded.error,
        bytesOnDrive: false,
        permanent: Boolean(uploaded.permanent),
        retryAfterMs: uploaded.retryAfterMs,
        record,
      };
    }
    bytesOnDrive = true;
    record = { ...record, bytesOnDrive: true, status: 'uploading' };
    if (await droppedFromQueue(deps, record.id)) {
      await deleteDrivePhoto(client, record.fileName);
      return { ok: true, cancelled: true };
    }
    await deps.queue.put(record);
  }
  if (await droppedFromQueue(deps, record.id)) {
    if (bytesOnDrive) await deleteDrivePhoto(client, record.fileName);
    return { ok: true, cancelled: true };
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
    previewScaleX: record.pixels?.previewScaleX,
    previewScaleY: record.pixels?.previewScaleY,
    clickMap: record.pixels?.clickMap,
    permanent: record.permanent,
    error,
  };
}

function isOnline(deps: PhotoUploadDeps): boolean {
  if (deps.online) return deps.online();
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

export async function listQueuedPhotos(
  queue: PhotoQueue = getAppPhotoQueue(),
): Promise<PhotoQueueRecord[]> {
  return normalizeQueueAfterRestart(await queue.list());
}

/** The survey dropped this photo. Do not upload it or add it to the manifest. */
export async function discardQueuedPhoto(
  photoId: string,
  queue: PhotoQueue = getAppPhotoQueue(),
): Promise<void> {
  const records = await queue.list();
  for (const record of records) {
    if (record.photoId === photoId) await queue.delete(record.id);
  }
}

async function droppedFromQueue(deps: PhotoUploadDeps, id: string): Promise<boolean> {
  return (await deps.queue.get(id)) == null;
}
