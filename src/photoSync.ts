/**
 * Queue an original camera file and upload it when a silent Graph token is available.
 * The stored Blob is the file the input delivered — not a canvas re-encode.
 *
 * Background sync never redirects. If Microsoft needs interaction, the caller shows
 * “Sign in to upload” and waits for a tap. An empty queue does not ask for a token.
 */

import { PHOTOS_MANIFEST_RELATIVE } from './cloudConfig';
import type { Photo, PhotoOriginalFile, PhotoUploadStatus } from './model';
import { inspectOriginalFile, suffixedPhotoFileName, type OriginalPhotoDraft } from './photoOriginal';
import {
  createIndexedDbPhotoQueue,
  createMemoryPhotoQueue,
  normalizeQueueAfterRestart,
  type PhotoQueue,
  type PhotoQueueRecord,
} from './photoQueue';
import type { GraphRequest, PhotoProvenance } from './photosManifest';
import { publishPhotoManifest, retireDrivePhoto, uploadAndVerifyOriginal } from './photoUpload';

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
    if (record.status !== 'failed' && record.status !== 'retire' && record.attempts === 0 && !record.retryNotBefore) continue;
    await queue.put({
      ...record,
      status:
        record.status === 'retire'
          ? 'retire'
          : record.status === 'failed' || record.status === 'uploading'
            ? 'queued'
            : record.status,
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
    if (record.status !== 'failed' && record.status !== 'queued' && record.status !== 'retire') continue;
    await active.queue.put({
      ...record,
      status: record.status === 'retire' ? 'retire' : 'queued',
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
  if (record.status === 'retire') return record.attempts < PHOTO_UPLOAD_MAX_ATTEMPTS;
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
    if (live.status === 'retire' || live.deletedAt) {
      if (!live.bytesOnDrive) {
        await deps.queue.delete(live.id);
        continue;
      }
      try {
        const retired = await retireUploaded(client, { ...live, status: 'retire', bytesOnDrive: true }, deps);
        if (retired.ok) continue;
        failed += 1;
        await rememberRetireFailure(deps, live, retired.error);
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : 'Could not move the photo to photos/deleted.';
        await rememberRetireFailure(deps, live, message);
      }
      continue;
    }

    const uploading: PhotoQueueRecord = { ...live, status: 'uploading', updatedAt: stamp };
    await deps.queue.put(uploading);
    deps.onStatus(statusOf(uploading, 'uploading'));

    try {
      const outcome = await uploadOne(client, uploading, deps);
      if (outcome.ok && outcome.cancelled) continue;
      if (!outcome.ok && outcome.retire) {
        failed += 1;
        await rememberRetireFailure(deps, outcome.record ?? uploading, outcome.error);
        continue;
      }
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
      const message = err instanceof Error ? err.message : 'Upload failed.';
      const liveAfter = await deps.queue.get(record.id);
      const retireThis =
        record.bytesOnDrive ||
        Boolean(record.deletedAt) ||
        liveAfter?.status === 'retire' ||
        Boolean(liveAfter?.deletedAt);
      if (retireThis) {
        failed += 1;
        await rememberRetireFailure(deps, liveAfter ?? { ...uploading, bytesOnDrive: true }, message);
        continue;
      }
      if (!liveAfter) continue;
      failed += 1;
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

async function rememberRetireFailure(
  deps: PhotoUploadDeps,
  record: PhotoQueueRecord,
  error: string,
): Promise<void> {
  const deletedAt = record.deletedAt ?? deps.now?.() ?? new Date().toISOString();
  const retireRec: PhotoQueueRecord = {
    ...record,
    status: 'retire',
    deletedAt,
    bytesOnDrive: true,
    attempts: record.attempts + 1,
    permanent: false,
    lastError: error,
    updatedAt: deps.now?.() ?? new Date().toISOString(),
  };
  await deps.queue.put(retireRec);
  deps.onStatus(statusOf(retireRec, 'failed', error));
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
): Promise<UploadOutcome> {
  return uploadNamed(client, record, deps, 0);
}

type UploadOutcome =
  | { ok: true; cancelled?: boolean; record?: PhotoQueueRecord }
  | {
      ok: false;
      error: string;
      bytesOnDrive: boolean;
      permanent?: boolean;
      retryAfterMs?: number;
      retire?: boolean;
      record?: PhotoQueueRecord;
    };

async function uploadNamed(
  client: GraphRequest,
  record: PhotoQueueRecord,
  deps: PhotoUploadDeps,
  suffixTry: number,
): Promise<UploadOutcome> {
  const early = await pendingDeletion(deps, record.id);
  if (early.gone) return { ok: true, cancelled: true };
  if (early.deletedAt && !record.bytesOnDrive) {
    await deps.queue.delete(record.id);
    return { ok: true, cancelled: true };
  }
  if (early.deletedAt && record.bytesOnDrive) {
    return retireUploaded(client, { ...record, deletedAt: early.deletedAt, bytesOnDrive: true }, deps);
  }
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
    const afterBytes = await pendingDeletion(deps, record.id);
    if (afterBytes.gone || afterBytes.deletedAt) {
      return retireUploaded(
        client,
        { ...record, bytesOnDrive: true, deletedAt: afterBytes.deletedAt ?? stampOf(deps) },
        deps,
      );
    }
    await deps.queue.put(record);
  }
  const beforeManifest = await pendingDeletion(deps, record.id);
  if (beforeManifest.gone || beforeManifest.deletedAt) {
    if (bytesOnDrive) {
      return retireUploaded(
        client,
        { ...record, bytesOnDrive: true, deletedAt: beforeManifest.deletedAt ?? stampOf(deps) },
        deps,
      );
    }
    return { ok: true, cancelled: true };
  }
  const manifest = await publishPhotoManifest({
    client,
    record: { ...record, bytesOnDrive: true },
    now: stampOf(deps),
  });
  if (!manifest.ok) return { ok: false, error: manifest.error, bytesOnDrive: true, record };
  const afterManifest = await pendingDeletion(deps, record.id);
  if (afterManifest.gone || afterManifest.deletedAt) {
    return retireUploaded(
      client,
      { ...record, bytesOnDrive: true, deletedAt: afterManifest.deletedAt ?? stampOf(deps) },
      deps,
    );
  }
  return { ok: true, record };
}

function stampOf(deps: PhotoUploadDeps): string {
  return deps.now?.() ?? new Date().toISOString();
}

async function pendingDeletion(
  deps: PhotoUploadDeps,
  id: string,
): Promise<{ gone: boolean; deletedAt?: string }> {
  const live = await deps.queue.get(id);
  if (!live) return { gone: true };
  if (live.status === 'retire' || live.deletedAt) return { gone: false, deletedAt: live.deletedAt ?? stampOf(deps) };
  return { gone: false };
}

/** Move the uploaded original and keep the manifest row with deletedAt. Failure stays a retire row. */
async function retireUploaded(
  client: GraphRequest,
  record: PhotoQueueRecord,
  deps: PhotoUploadDeps,
): Promise<UploadOutcome> {
  const deletedAt = record.deletedAt ?? stampOf(deps);
  const retired = await retireDrivePhoto({
    client,
    record: { ...record, deletedAt, bytesOnDrive: true },
    deletedAt,
  });
  if (!retired.ok) {
    return {
      ok: false,
      error: retired.error,
      bytesOnDrive: true,
      retire: true,
      record: { ...record, status: 'retire', deletedAt, bytesOnDrive: true },
    };
  }
  await deps.queue.delete(record.id);
  return { ok: true, cancelled: true };
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

export interface PhotoReleaseResult {
  ok: boolean;
  error?: string;
}

export interface DiscardPhotoOptions {
  /** Set when the original is already on OneDrive and the queue row is gone. */
  driveFileName?: string;
  original?: PhotoOriginalFile;
  stationId?: string;
  client?: GraphRequest;
  now?: string;
}

/**
 * The survey dropped this photo.
 * A file that is not on OneDrive loses its queue row.
 * A file already on OneDrive is moved to photos/deleted/ and kept in the manifest with deletedAt.
 * An upload still in flight is marked and finished by that upload.
 */
export async function discardQueuedPhoto(
  photoId: string,
  queue: PhotoQueue = getAppPhotoQueue(),
  opts: DiscardPhotoOptions = {},
): Promise<PhotoReleaseResult> {
  const now = opts.now ?? new Date().toISOString();
  try {
    const records = (await queue.list()).filter((record) => record.photoId === photoId);
    if (!records.length) {
      if (!opts.driveFileName) return { ok: true };
      return retireVerifiedPhoto(photoId, opts.driveFileName, queue, opts, now);
    }
    const errors: string[] = [];
    let kick = false;
    for (const record of records) {
      if (!record.bytesOnDrive && record.status !== 'uploading') {
        await queue.delete(record.id);
        continue;
      }
      if (record.status === 'uploading') {
        await queue.put({ ...record, deletedAt: record.deletedAt ?? now });
        continue;
      }
      const marked: PhotoQueueRecord = {
        ...record,
        status: 'retire',
        deletedAt: now,
        bytesOnDrive: true,
      };
      if (opts.client) {
        const moved = await retireDrivePhoto({ client: opts.client, record: marked, deletedAt: now });
        if (moved.ok) await queue.delete(record.id);
        else {
          await queue.put({ ...marked, attempts: record.attempts + 1, lastError: moved.error, updatedAt: now });
          errors.push(moved.error);
        }
      } else {
        await queue.put({ ...marked, updatedAt: now });
        kick = true;
      }
    }
    if (kick) kickPhotoUploads();
    if (errors.length) return { ok: false, error: errors.join(' ') };
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Could not release the photo.';
    return { ok: false, error };
  }
}

async function retireVerifiedPhoto(
  photoId: string,
  fileName: string,
  queue: PhotoQueue,
  opts: DiscardPhotoOptions,
  now: string,
): Promise<PhotoReleaseResult> {
  const row = retireRowFromOriginal(photoId, fileName, opts.original, opts.stationId, now);
  if (!opts.client) {
    await queue.put(row);
    kickPhotoUploads();
    return { ok: true };
  }
  const moved = await retireDrivePhoto({ client: opts.client, record: row, deletedAt: now });
  if (moved.ok) return { ok: true };
  await queue.put({ ...row, attempts: 1, lastError: moved.error });
  return { ok: false, error: moved.error };
}

function retireRowFromOriginal(
  photoId: string,
  fileName: string,
  original: PhotoOriginalFile | undefined,
  stationId: string | undefined,
  deletedAt: string,
): PhotoQueueRecord {
  return {
    id: photoId,
    photoId,
    stationId: stationId ?? '',
    fileName,
    blob: new Blob(),
    size: original?.size ?? 0,
    contentType: original?.contentType ?? 'application/octet-stream',
    receivedAt: original?.receivedAt ?? deletedAt,
    capturedAt: original?.capturedAt,
    provenance: original?.provenance,
    sha256: original?.sha256,
    calibrationKey: original?.calibrationKey,
    usabilityNote: original?.usabilityNote,
    pixels: original?.fullWidth
      ? {
          fullWidth: original.fullWidth ?? 0,
          fullHeight: original.fullHeight ?? 0,
          previewWidth: original.previewWidth ?? 0,
          previewHeight: original.previewHeight ?? 0,
          previewScaleX: original.previewScaleX ?? 1,
          previewScaleY: original.previewScaleY ?? 1,
          clickMap: 'p/scale',
          clickSpace: 'upright',
        }
      : undefined,
    quickXorHash: original?.quickXorHash ?? '',
    exif: {},
    status: 'retire',
    attempts: 0,
    bytesOnDrive: true,
    deletedAt,
    updatedAt: deletedAt,
  };
}

/** Photo ids removed with a point: the point's list plus any photo whose addPointId matches. */
export function surveyPhotoIdsForPoint(
  doc: { points: { id: string; photoIds?: string[] }[]; photos: { id: string; addPointId?: string }[] },
  pointId: string,
): string[] {
  const point = doc.points.find((p) => p.id === pointId);
  return [
    ...new Set([
      ...(point?.photoIds ?? []),
      ...doc.photos.filter((photo) => photo.addPointId === pointId).map((photo) => photo.id),
    ]),
  ];
}

/** Point-delete cascade: release every original that left with the point. */
export async function releaseSurveyPhotos(
  photos: Photo[],
  photoIds: string[],
  queue?: PhotoQueue,
  opts: { client?: GraphRequest; now?: string } = {},
): Promise<PhotoReleaseResult> {
  const errors: string[] = [];
  for (const id of photoIds) {
    const photo = photos.find((item) => item.id === id);
    const onDrive = photo?.originalFile?.uploadStatus === 'verified';
    const result = await discardQueuedPhoto(id, queue, {
      driveFileName: onDrive ? photo?.originalFile?.fileName : undefined,
      original: photo?.originalFile,
      stationId: photo?.addPointId,
      client: opts.client,
      now: opts.now,
    });
    if (!result.ok && result.error) errors.push(result.error);
  }
  if (errors.length) return { ok: false, error: errors.join(' ') };
  return { ok: true };
}
