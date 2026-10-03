/**
 * Garden JSON writes decided by the OneDrive eTag.
 * Write only when the remote eTag equals the base eTag. Anything else is a
 * conflict that asks the user. Timestamps are shown in the prompt and are
 * never used to choose. Cancel writes nothing and adopts nothing.
 * Adopting the remote first stores this browser’s copy as
 * `/Garden Survey/garden-conflict-<time>.json`. A failed upload does not adopt;
 * a browser download is only a spare copy. An empty garden is never PUT.
 * A first save with no eTag uses If-None-Match: *.
 * Sign-in loads OneDrive only when this browser is empty, or the stored eTag
 * matches and the local garden is not dirty.
 * A successful write clears the dirty flag only when the garden revision is
 * still the one captured when that save started, and only when no adopt or
 * load has replaced the working garden since that save began.
 * One save runs at a time in the UI. A conflict copy is built from the garden
 * at the moment it is filed, and the remote is adopted only when that copy
 * still matches the current revision.
 */

import type { OwedSaveStorage } from './cloudSignIn';
import {
  clearGardenSaveOwed,
  owedSaveMatches,
  readOwedGardenSave,
} from './cloudSignIn';
import { deletedPhotosFolderPath, getGardenCloudFileName, onedrivePathFor, photosManifestPath } from './cloudConfig';
import type { GardenDocument, Photo } from './model';
import { loadDeletedPhotoKeys } from './photosManifest';
import {
  loadGardenFromOneDrive,
  saveGardenToOneDrive,
  type CloudLoadResult,
  type CloudSaveResult,
} from './onedrive';

const ETAG_KEY = 'garden-survey:drive-etags';
const PROMPTED_KEY = 'garden-survey:conflict-prompted';
const DIRTY_KEY = 'garden-survey:garden-dirty';
/** Bumped on every local edit. A save compares this with the value it started with. */
const REVISION_KEY = 'garden-survey:garden-revision';

/** Shown while this browser has edits that are not the OneDrive copy. */
export const GARDEN_UNSAVED_STATUS = 'Not saved — tap Save';

export interface GardenCopyChoice {
  fileName: string;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
  localDoc: GardenDocument;
  remoteDoc: GardenDocument;
  remoteETag: string;
  /** Plain-language prompt. Both timestamps are in the text as information. */
  message: string;
}

export type GardenCopyChooser = (choice: GardenCopyChoice) => Promise<'local' | 'remote'>;

export type GardenCommitResult =
  | {
      ok: true;
      wrote: true;
      savedAt: string;
      fileName: string;
      eTag?: string;
      /**
       * An adopt or load replaced the working garden while this upload was in
       * flight. The eTag was not stored and dirty was not cleared.
       */
      superseded?: boolean;
    }
  | {
      ok: true;
      wrote: false;
      kept: 'remote';
      doc: GardenDocument;
      fileName: string;
      eTag?: string;
      localUpdatedAt: string;
      remoteUpdatedAt: string;
      reason: 'chose-remote';
      /** Where this browser’s copy was kept before the remote was adopted. */
      preservedAs: string;
      message: string;
      /** Photo rows in the filed local copy that the OneDrive garden does not have. */
      localOnlyPhotos: Photo[];
      /**
       * Revision of the filed copy. The garden is replaced only when this still
       * matches, in the same turn as the dirty clear and the eTag store.
       */
      preservedRevision: number;
    }
  | {
      ok: false;
      error: string;
      conflict?: boolean;
      refused?: 'empty';
      /** User left both copies alone, or the auto-save prompt is waiting. */
      cancelled?: boolean;
      /** Auto-save already asked about this remote eTag. The save stays owed. */
      deferred?: boolean;
    };

interface PromptedConflict {
  account: string;
  fileName: string;
  remoteETag: string;
}

function storageOf(storage?: OwedSaveStorage): OwedSaveStorage | null {
  if (storage) return storage;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* private mode */
  }
  return null;
}

export function rememberedDriveETag(
  account: string,
  fileName: string,
  storage?: OwedSaveStorage,
): string {
  const store = storageOf(storage);
  if (!store || !account || !fileName) return '';
  try {
    const map = JSON.parse(store.getItem(ETAG_KEY) || '{}') as Record<string, string>;
    return map[etagMapKey(account, fileName)] || '';
  } catch {
    return '';
  }
}

export function rememberDriveETag(
  account: string,
  fileName: string,
  eTag: string,
  storage?: OwedSaveStorage,
): void {
  const store = storageOf(storage);
  if (!store || !account || !fileName || !eTag) return;
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(store.getItem(ETAG_KEY) || '{}') as Record<string, string>;
  } catch {
    map = {};
  }
  map[etagMapKey(account, fileName)] = eTag;
  store.setItem(ETAG_KEY, JSON.stringify(map));
}

function etagMapKey(account: string, fileName: string): string {
  return `${account}\n${fileName}`;
}

interface RevisionMemory {
  revision: number;
  /** `null` until this process has marked or cleared dirty for this storage. */
  dirty: boolean | null;
  /** removeItem failed, so a stored '1' may still be there even if getItem throws. */
  clearFailed: boolean;
}

const revisionMemory = new WeakMap<object, RevisionMemory>();
const noStoreRevision: RevisionMemory = { revision: 0, dirty: null, clearFailed: false };

function revisionMemoryFor(storage?: OwedSaveStorage): RevisionMemory {
  const store = storageOf(storage);
  if (!store) return noStoreRevision;
  let memory = revisionMemory.get(store);
  if (!memory) {
    memory = { revision: 0, dirty: null, clearFailed: false };
    revisionMemory.set(store, memory);
  }
  return memory;
}

function storedRevision(storage?: OwedSaveStorage): number {
  const store = storageOf(storage);
  if (!store) return 0;
  try {
    const raw = store.getItem(REVISION_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Monotonic count of local edits. Kept in memory as well as localStorage, so a
 * failed write does not make the next save look clean. Zero when this browser
 * has never edited.
 */
export function gardenRevision(storage?: OwedSaveStorage): number {
  return Math.max(revisionMemoryFor(storage).revision, storedRevision(storage));
}

/** Every local edit, including while signed out and before a redirect. Returns the new revision. */
export function noteLocalGardenEdit(storage?: OwedSaveStorage): number {
  const next = gardenRevision(storage) + 1;
  const memory = revisionMemoryFor(storage);
  memory.revision = next;
  memory.dirty = true;
  memory.clearFailed = false;
  try {
    storageOf(storage)?.setItem(REVISION_KEY, String(next));
  } catch {
    /* quota — the in-memory revision still moved */
  }
  markGardenDirty(storage);
  return next;
}

export function markGardenDirty(storage?: OwedSaveStorage): void {
  const memory = revisionMemoryFor(storage);
  memory.dirty = true;
  memory.clearFailed = false;
  try {
    storageOf(storage)?.setItem(DIRTY_KEY, '1');
  } catch {
    /* quota — memory stays dirty */
  }
}

export function clearGardenDirty(storage?: OwedSaveStorage): void {
  const memory = revisionMemoryFor(storage);
  memory.dirty = false;
  try {
    storageOf(storage)?.removeItem(DIRTY_KEY);
    memory.clearFailed = false;
  } catch {
    memory.clearFailed = true;
  }
}

export function gardenIsDirty(storage?: OwedSaveStorage): boolean {
  const memory = revisionMemoryFor(storage);
  if (memory.dirty === true || memory.clearFailed) return true;
  try {
    return storageOf(storage)?.getItem(DIRTY_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Bumped when the working garden is replaced (adopt or load). An upload that
 * started earlier must not store its eTag or clear dirty.
 */
let saveGeneration = 0;

export function currentSaveGeneration(): number {
  return saveGeneration;
}

export function noteRemoteGardenApplied(): number {
  saveGeneration += 1;
  return saveGeneration;
}

function readPrompted(storage?: OwedSaveStorage): PromptedConflict | null {
  const store = storageOf(storage);
  if (!store) return null;
  try {
    const parsed = JSON.parse(store.getItem(PROMPTED_KEY) || 'null') as PromptedConflict | null;
    if (!parsed || typeof parsed.account !== 'string' || typeof parsed.fileName !== 'string') return null;
    if (typeof parsed.remoteETag !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function rememberPrompted(
  account: string,
  fileName: string,
  remoteETag: string,
  storage?: OwedSaveStorage,
): void {
  const store = storageOf(storage);
  if (!store) return;
  const record: PromptedConflict = { account, fileName, remoteETag };
  store.setItem(PROMPTED_KEY, JSON.stringify(record));
}

function clearPrompted(storage?: OwedSaveStorage): void {
  storageOf(storage)?.removeItem(PROMPTED_KEY);
}

function alreadyPrompted(
  account: string,
  fileName: string,
  remoteETag: string,
  storage?: OwedSaveStorage,
): boolean {
  const prev = readPrompted(storage);
  if (!prev) return false;
  return prev.account === account && prev.fileName === fileName && prev.remoteETag === remoteETag;
}

/** A garden with no survey content. createEmptyGarden() matches this. */
export function isEmptySurveyGarden(doc: GardenDocument): boolean {
  return (
    doc.points.length === 0 &&
    (doc.baselines?.length ?? 0) === 0 &&
    (doc.lines?.length ?? 0) === 0 &&
    (doc.polygons?.length ?? 0) === 0 &&
    (doc.observations?.length ?? 0) === 0 &&
    (doc.photos?.length ?? 0) === 0 &&
    (doc.objects?.length ?? 0) === 0
  );
}

/** `garden-conflict-2026-10-03T10-00-00.000Z.json` — colons are illegal in OneDrive names. */
export function conflictGardenFileName(iso: string): string {
  return `garden-conflict-${iso.replace(/:/g, '-')}.json`;
}

/**
 * Photos whose id and original file name are absent from the OneDrive garden.
 * Ids recorded as deleted (manifest `deletedAt`, or a file now in `photos/deleted/`)
 * are left out: another device may have dropped them on purpose.
 */
export function photosOnlyInLocal(
  local: GardenDocument,
  remote: GardenDocument,
  deleted?: { photoIds?: Iterable<string>; fileNames?: Iterable<string> },
): Photo[] {
  const ids = new Set(remote.photos.map((photo) => photo.id));
  const names = new Set(
    remote.photos.map((photo) => photo.originalFile?.fileName).filter((name): name is string => Boolean(name)),
  );
  const deletedIds = new Set(deleted?.photoIds ?? []);
  const deletedNames = new Set(deleted?.fileNames ?? []);
  return local.photos.filter((photo) => {
    if (ids.has(photo.id) || deletedIds.has(photo.id)) return false;
    const name = photo.originalFile?.fileName;
    if (name && (names.has(name) || deletedNames.has(name))) return false;
    return true;
  });
}

export function reattachPhotosPrompt(count: number): string {
  if (count === 1) {
    return "1 photo from this device isn't in the OneDrive version (it may have been deleted on another device). Re-attach it?";
  }
  return `${count} photos from this device aren't in the OneDrive version (they may have been deleted on another device). Re-attach them?`;
}

/** Shown when a local-only photo's point is not on the adopted OneDrive garden. The point is not recreated. */
export function photosWithoutPointsNote(count: number, conflictFile: string): string {
  if (count === 1) {
    return `1 photo belongs to a point not in the OneDrive version; it's kept in ${conflictFile}`;
  }
  return `${count} photos belong to points not in the OneDrive version; they're kept in ${conflictFile}`;
}

/** Runs a critical section while this tab holds the cross-tab save lock. The conflict prompt stays outside it. */
export type GardenSaveLock = <T>(fn: () => Promise<T>) => Promise<T>;

async function runUnlocked<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

export function gardenConflictPrompt(choice: {
  fileName: string;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
}): string {
  return [
    `${choice.fileName} on OneDrive does not match this browser.`,
    `This browser: ${formatWhen(choice.localUpdatedAt)} (${choice.localUpdatedAt || 'unknown time'}).`,
    `OneDrive: ${formatWhen(choice.remoteUpdatedAt)} (${choice.remoteUpdatedAt || 'unknown time'}).`,
    'Times are only a guide. OK keeps the OneDrive copy and files this browser’s copy beside it. Cancel leaves both as they are.',
  ].join('\n');
}

function formatWhen(iso: string): string {
  if (!iso) return 'unknown time';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export async function commitGardenSave(opts: {
  doc: GardenDocument;
  fileName?: string;
  token: string;
  /** ETag this browser last saved or loaded. Empty on a first save. */
  ifMatch?: string;
  fetchImpl?: typeof fetch;
  choose?: GardenCopyChooser;
  account?: string;
  storage?: OwedSaveStorage;
  /**
   * `auto` asks at most once per remote eTag. `user` (Save, or the sign-in
   * redirect) always asks.
   */
  prompt?: 'auto' | 'user';
  now?: () => string;
  /** Used when the conflict file cannot be uploaded. */
  downloadLocal?: (doc: GardenDocument, fileName: string) => void;
  /**
   * Revision of `doc` when this save was captured. Dirty is cleared only when
   * the garden is still that revision after the upload. Defaults to the
   * revision at the moment this function is called, before any network wait.
   */
  revision?: number;
  /**
   * Current garden and revision. The conflict prompt and the conflict file
   * are taken from this immediately before they are used, so an edit made
   * while the 412 was downloading, while the prompt is open, or while the
   * conflict file uploads is the copy that gets filed.
   */
  readLocal?: () => LocalGardenView;
  /**
   * Holds the cross-tab save lock around the probe, the PUT, and the conflict
   * file. The chooser runs outside it, then the remote eTag is read again.
   */
  usingLock?: GardenSaveLock;
}): Promise<GardenCommitResult> {
  const fileName = opts.fileName || getGardenCloudFileName();
  const fetchImpl = opts.fetchImpl;
  const localUpdatedAt = opts.doc.updatedAt ?? '';
  const promptMode = opts.prompt ?? 'user';
  const revisionAtStart = opts.revision ?? gardenRevision(opts.storage);
  const generationAtStart = currentSaveGeneration();
  const lock = opts.usingLock ?? runUnlocked;

  if (isEmptySurveyGarden(opts.doc)) {
    return {
      ok: false,
      refused: 'empty',
      error: `Not saving an empty garden over ${fileName}.`,
    };
  }

  const probed = await lock(() =>
    probeGardenWrite(opts, fileName, fetchImpl, revisionAtStart, generationAtStart),
  );
  if (probed.kind === 'done') return probed.result;
  return resolveConflict(opts, probed.remote, fileName, localUpdatedAt, promptMode, lock);
}

async function probeGardenWrite(
  opts: {
    doc: GardenDocument;
    token: string;
    ifMatch?: string;
    account?: string;
    storage?: OwedSaveStorage;
  },
  fileName: string,
  fetchImpl: typeof fetch | undefined,
  revisionAtStart: number,
  generationAtStart: number,
): Promise<
  | { kind: 'done'; result: GardenCommitResult }
  | { kind: 'conflict'; remote: Extract<CloudLoadResult, { ok: true }> }
> {
  const probed = await loadGardenFromOneDrive(fileName, {
    token: opts.token,
    fetchImpl,
    exact: true,
  });
  if (!probed.ok && !probed.missing) {
    return { kind: 'done', result: { ok: false, error: probed.error } };
  }

  const baseETag = opts.ifMatch || '';

  if (!probed.ok) {
    const put = await saveGardenToOneDrive(opts.doc, fileName, opts.token, {
      ifNoneMatch: '*',
      fetchImpl,
    });
    if (put.ok) {
      return {
        kind: 'done',
        result: wroteResult(put, opts.account, fileName, opts.storage, revisionAtStart, generationAtStart),
      };
    }
    if (!put.conflict) return { kind: 'done', result: { ok: false, error: put.error } };
    const again = await loadGardenFromOneDrive(fileName, {
      token: opts.token,
      fetchImpl,
      exact: true,
    });
    if (!again.ok) return { kind: 'done', result: { ok: false, error: again.error || put.error, conflict: true } };
    return { kind: 'conflict', remote: again };
  }

  const remoteETag = probed.eTag || '';
  if (baseETag && remoteETag && baseETag === remoteETag) {
    const put = await saveGardenToOneDrive(opts.doc, fileName, opts.token, {
      ifMatch: baseETag,
      fetchImpl,
    });
    if (put.ok) {
      return {
        kind: 'done',
        result: wroteResult(put, opts.account, fileName, opts.storage, revisionAtStart, generationAtStart),
      };
    }
    if (!put.conflict) return { kind: 'done', result: { ok: false, error: put.error } };
    const again = await loadGardenFromOneDrive(fileName, {
      token: opts.token,
      fetchImpl,
      exact: true,
    });
    if (!again.ok) return { kind: 'done', result: { ok: false, error: again.error || put.error, conflict: true } };
    return { kind: 'conflict', remote: again };
  }

  return { kind: 'conflict', remote: probed };
}

function wroteResult(
  put: Extract<CloudSaveResult, { ok: true }>,
  account: string | undefined,
  fileName: string,
  storage: OwedSaveStorage | undefined,
  revisionAtStart: number,
  generationAtStart: number,
): GardenCommitResult {
  // Adopt or load replaced the working garden. This upload's eTag belongs to a garden we no longer have.
  if (currentSaveGeneration() !== generationAtStart) {
    return {
      ok: true,
      wrote: true,
      savedAt: put.savedAt,
      fileName: put.fileName,
      eTag: put.eTag,
      superseded: true,
    };
  }
  clearPrompted(storage);
  // An edit during the upload bumps the revision. That garden is still unsaved.
  if (gardenRevision(storage) === revisionAtStart) clearGardenDirty(storage);
  if (put.eTag && account) rememberDriveETag(account, fileName, put.eTag, storage);
  return { ok: true, wrote: true, savedAt: put.savedAt, fileName: put.fileName, eTag: put.eTag };
}

export interface LocalGardenView {
  doc: GardenDocument;
  dirty?: boolean;
  revision?: number;
}

function currentLocal(opts: {
  doc: GardenDocument;
  storage?: OwedSaveStorage;
  readLocal?: () => LocalGardenView;
}): { doc: GardenDocument; revision: number } {
  const live = opts.readLocal?.();
  if (!live) return { doc: opts.doc, revision: gardenRevision(opts.storage) };
  return {
    doc: live.doc,
    revision: live.revision ?? gardenRevision(opts.storage),
  };
}

async function resolveConflict(
  opts: {
    doc: GardenDocument;
    token: string;
    fetchImpl?: typeof fetch;
    choose?: GardenCopyChooser;
    account?: string;
    storage?: OwedSaveStorage;
    now?: () => string;
    downloadLocal?: (doc: GardenDocument, fileName: string) => void;
    readLocal?: () => LocalGardenView;
  },
  remote: Extract<CloudLoadResult, { ok: true }>,
  fileName: string,
  localUpdatedAt: string,
  promptMode: 'auto' | 'user',
  lock: GardenSaveLock,
): Promise<GardenCommitResult> {
  let current = remote;
  for (let attempt = 0; attempt < 4; attempt++) {
    const remoteUpdatedAt = current.remoteUpdatedAt || current.doc.updatedAt || '';
    const remoteETag = current.eTag ?? '';
    const account = opts.account ?? '';

    if (promptMode === 'auto' && alreadyPrompted(account, fileName, remoteETag, opts.storage)) {
      return {
        ok: false,
        cancelled: true,
        deferred: true,
        conflict: true,
        error: `Still waiting on your choice for ${fileName}. Nothing was written.`,
      };
    }

    rememberPrompted(account, fileName, remoteETag, opts.storage);
    const atPrompt = currentLocal(opts);
    const choice = choiceFor(
      atPrompt.doc,
      current,
      fileName,
      atPrompt.doc.updatedAt ?? localUpdatedAt,
      remoteUpdatedAt,
    );
    if (!opts.choose) {
      return {
        ok: false,
        cancelled: true,
        conflict: true,
        error: `${fileName} on OneDrive does not match this browser. Nothing was written.`,
      };
    }
    // The prompt is outside the lock so a frozen tab does not stall the others.
    const pick = await opts.choose(choice);
    if (pick !== 'remote') {
      return {
        ok: false,
        cancelled: true,
        conflict: true,
        error: `Left ${fileName} on OneDrive as it is. This browser’s save is still waiting.`,
      };
    }

    const settled = await lock(() => settleRemoteChoice(opts, fileName, remoteETag, localUpdatedAt));
    if (settled.kind === 'moved') {
      current = settled.remote;
      continue;
    }
    return settled.result;
  }
  return {
    ok: false,
    cancelled: true,
    conflict: true,
    error: `${fileName} changed on OneDrive again while you were choosing. Nothing was replaced.`,
  };
}

async function settleRemoteChoice(
  opts: {
    doc: GardenDocument;
    token: string;
    fetchImpl?: typeof fetch;
    account?: string;
    storage?: OwedSaveStorage;
    now?: () => string;
    downloadLocal?: (doc: GardenDocument, fileName: string) => void;
    readLocal?: () => LocalGardenView;
  },
  fileName: string,
  promptedETag: string,
  localUpdatedAt: string,
): Promise<
  | { kind: 'moved'; remote: Extract<CloudLoadResult, { ok: true }> }
  | { kind: 'result'; result: GardenCommitResult }
> {
  const again = await loadGardenFromOneDrive(fileName, {
    token: opts.token,
    fetchImpl: opts.fetchImpl,
    exact: true,
  });
  if (!again.ok) {
    return {
      kind: 'result',
      result: { ok: false, error: again.error || `Could not re-check ${fileName}. Nothing was replaced.`, conflict: true },
    };
  }
  if ((again.eTag ?? '') !== promptedETag) {
    return { kind: 'moved', remote: again };
  }

  // Network I/O finishes before the conflict copy. An edit during this read is
  // still in the garden when the copy is built, so it is not dropped.
  // No local-only photos means there is nothing to filter, so skip the round trip.
  const beforeCopy = currentLocal(opts);
  const deleted =
    photosOnlyInLocal(beforeCopy.doc, again.doc).length === 0
      ? { photoIds: [] as string[], fileNames: [] as string[] }
      : await loadDeletedPhotoKeys({
          client: { fetch: opts.fetchImpl ?? fetch, token: opts.token },
          manifestPath: photosManifestPath(),
          deletedFolderPath: deletedPhotosFolderPath(),
        });

  let preserved = await preserveMatchingCopy(opts, fileName);
  if (!preserved.ok) return { kind: 'result', result: preserveFailure(preserved) };

  let adopted = finishRemoteAdopt(opts, preserved, again, fileName, localUpdatedAt, deleted);
  if (!adopted) {
    // The garden moved after the copy was matched. File the newer garden.
    // A fresh name avoids If-None-Match colliding with the copy just written.
    preserved = await preserveMatchingCopy(opts, fileName, 2);
    if (!preserved.ok) return { kind: 'result', result: preserveFailure(preserved) };
    adopted = finishRemoteAdopt(opts, preserved, again, fileName, localUpdatedAt, deleted);
  }
  if (!adopted) {
    return {
      kind: 'result',
      result: {
        ok: false,
        cancelled: true,
        conflict: true,
        error: `This browser changed while its copy was being filed. Nothing was replaced.`,
      },
    };
  }
  return { kind: 'result', result: adopted };
}

function preserveFailure(preserved: { error: string; aborted?: boolean }): GardenCommitResult {
  if (preserved.aborted) {
    return { ok: false, cancelled: true, conflict: true, error: preserved.error };
  }
  return { ok: false, error: preserved.error, conflict: true };
}

/**
 * Build the kept-remote result when the filed copy is still current.
 * Does not clear dirty or store the eTag: the Web Locks callback resolves in a
 * later task, and the garden is replaced only after that. The UI repeats this
 * revision check in the same turn as setState.
 * Returns null when the garden moved, so the caller files another copy.
 */
function finishRemoteAdopt(
  opts: {
    account?: string;
    storage?: OwedSaveStorage;
    doc: GardenDocument;
    readLocal?: () => LocalGardenView;
  },
  preserved: { revision: number; where: string; message: string; updatedAt: string; doc: GardenDocument },
  again: Extract<CloudLoadResult, { ok: true }>,
  fileName: string,
  localUpdatedAt: string,
  deleted: { photoIds: string[]; fileNames: string[] },
): GardenCommitResult | null {
  const still = currentLocal(opts);
  if (still.revision !== preserved.revision) return null;
  clearPrompted(opts.storage);
  const remoteFile = again.fileName || fileName;
  const remoteUpdatedAt = again.remoteUpdatedAt || again.doc.updatedAt || '';
  return {
    ok: true,
    wrote: false,
    kept: 'remote',
    doc: again.doc,
    fileName: remoteFile,
    eTag: again.eTag,
    localUpdatedAt: preserved.updatedAt || localUpdatedAt,
    remoteUpdatedAt,
    reason: 'chose-remote',
    preservedAs: preserved.where,
    message: preserved.message,
    localOnlyPhotos: photosOnlyInLocal(preserved.doc, again.doc, deleted),
    preservedRevision: preserved.revision,
  };
}

/**
 * File this browser’s garden, then adopt only if that file is still current.
 * The body is the whole document, including photo rows whose originals are
 * still uploading in IndexedDB. Adopting the remote does not delete
 * `photos/manifest.json` entries; the upload queue keeps those files, and the
 * rows stay referenced because they are in this copy.
 * A second attempt uses a different file name so If-None-Match: * can succeed
 * when the clock has not moved. If the garden is still changing after that,
 * the remote is left alone.
 */
async function preserveMatchingCopy(
  opts: {
    doc: GardenDocument;
    token: string;
    fetchImpl?: typeof fetch;
    storage?: OwedSaveStorage;
    now?: () => string;
    downloadLocal?: (doc: GardenDocument, fileName: string) => void;
    readLocal?: () => LocalGardenView;
  },
  gardenFileName: string,
  startAttempt = 0,
): Promise<
  | { ok: true; where: string; message: string; revision: number; updatedAt: string; doc: GardenDocument }
  | { ok: false; error: string; aborted?: boolean }
> {
  const maxAttempts = 2;
  for (let n = 0; n < maxAttempts; n++) {
    const attempt = startAttempt + n;
    const live = currentLocal(opts);
    if (isEmptySurveyGarden(live.doc)) {
      return {
        ok: false,
        aborted: true,
        error: `Not replacing ${gardenFileName}. This browser’s garden is empty, so nothing was filed and nothing was adopted.`,
      };
    }
    const iso = opts.now?.() ?? new Date().toISOString();
    const conflictName = conflictNameForAttempt(iso, attempt);
    const put = await saveGardenToOneDrive(live.doc, conflictName, opts.token, {
      ifNoneMatch: '*',
      fetchImpl: opts.fetchImpl,
    });
    const path = `/${onedrivePathFor(conflictName)}`;
    if (!put.ok) {
      try {
        opts.downloadLocal?.(live.doc, conflictName);
      } catch {
        /* A download is a spare copy. It does not prove the local garden was kept. */
      }
      return {
        ok: false,
        error: `Could not keep this browser’s copy before using OneDrive (${put.error}). Nothing was replaced.`,
      };
    }
    const after = currentLocal(opts);
    if (after.revision === live.revision) {
      return {
        ok: true,
        where: path,
        revision: live.revision,
        updatedAt: live.doc.updatedAt ?? '',
        doc: live.doc,
        message: `Kept the OneDrive copy of ${gardenFileName}. This browser’s copy is saved as ${path}.`,
      };
    }
  }
  return {
    ok: false,
    aborted: true,
    error: `This browser changed while its copy was being filed. Nothing was replaced.`,
  };
}

function conflictNameForAttempt(iso: string, attempt: number): string {
  const base = conflictGardenFileName(iso);
  if (attempt === 0) return base;
  return base.replace(/\.json$/i, `-r${attempt}.json`);
}

function choiceFor(
  local: GardenDocument,
  remote: Extract<CloudLoadResult, { ok: true }>,
  fileName: string,
  localUpdatedAt: string,
  remoteUpdatedAt: string,
): GardenCopyChoice {
  return {
    fileName,
    localUpdatedAt,
    remoteUpdatedAt,
    localDoc: local,
    remoteDoc: remote.doc,
    remoteETag: remote.eTag ?? '',
    message: gardenConflictPrompt({ fileName, localUpdatedAt, remoteUpdatedAt }),
  };
}

export type RedirectOwedResult =
  | { kind: 'absent' }
  | { kind: 'mismatch' }
  | { kind: 'empty' }
  | { kind: 'saved'; fileName: string; savedAt: string; eTag?: string; superseded?: boolean }
  | {
      kind: 'kept-remote';
      doc: GardenDocument;
      fileName: string;
      eTag?: string;
      localUpdatedAt: string;
      remoteUpdatedAt: string;
      preservedAs: string;
      message: string;
      localOnlyPhotos: Photo[];
      preservedRevision: number;
    }
  | { kind: 'cancelled'; message: string }
  | { kind: 'failed'; error: string };

/**
 * After a Microsoft redirect, write the owed garden only when the signed-in
 * account and file still match the record. Otherwise clear the flag and do nothing.
 * Cancel leaves the flag set.
 */
export async function applyRedirectOwedSave(opts: {
  account: string;
  fileName: string;
  localDoc: GardenDocument;
  token: string;
  storage?: OwedSaveStorage;
  fetchImpl?: typeof fetch;
  choose?: GardenCopyChooser;
  now?: () => string;
  downloadLocal?: (doc: GardenDocument, fileName: string) => void;
  /** Revision of `localDoc` when it was captured. See `commitGardenSave`. */
  revision?: number;
  /** Current garden. The conflict prompt and conflict file use this, not the snapshot. */
  readLocal?: () => LocalGardenView;
  usingLock?: GardenSaveLock;
}): Promise<RedirectOwedResult> {
  const owed = readOwedGardenSave(opts.storage);
  if (!owed) return { kind: 'absent' };
  if (!owedSaveMatches(owed, opts.account, opts.fileName)) {
    clearGardenSaveOwed(opts.storage);
    return { kind: 'mismatch' };
  }
  if (isEmptySurveyGarden(opts.localDoc)) {
    clearGardenSaveOwed(opts.storage);
    return { kind: 'empty' };
  }

  const result = await commitGardenSave({
    doc: opts.localDoc,
    fileName: opts.fileName,
    token: opts.token,
    ifMatch: owed.baseETag || undefined,
    fetchImpl: opts.fetchImpl,
    choose: opts.choose,
    account: opts.account,
    storage: opts.storage,
    prompt: 'user',
    now: opts.now,
    downloadLocal: opts.downloadLocal,
    revision: opts.revision,
    readLocal: opts.readLocal,
    usingLock: opts.usingLock,
  });

  if (!result.ok) {
    if (result.cancelled) return { kind: 'cancelled', message: result.error };
    if (result.refused === 'empty') {
      clearGardenSaveOwed(opts.storage);
      return { kind: 'empty' };
    }
    return { kind: 'failed', error: result.error };
  }
  if (result.wrote) {
    clearGardenSaveOwed(opts.storage);
    return {
      kind: 'saved',
      fileName: result.fileName,
      savedAt: result.savedAt,
      eTag: result.eTag,
      superseded: result.superseded,
    };
  }
  // Dirty, the owed flag, and the base eTag stay until the UI replaces the garden.
  return {
    kind: 'kept-remote',
    doc: result.doc,
    fileName: result.fileName,
    eTag: result.eTag,
    localUpdatedAt: result.localUpdatedAt,
    remoteUpdatedAt: result.remoteUpdatedAt,
    preservedAs: result.preservedAs,
    message: result.message,
    localOnlyPhotos: result.localOnlyPhotos,
    preservedRevision: result.preservedRevision,
  };
}

export type GardenReconcileResult =
  | { kind: 'missing'; message: string }
  | { kind: 'failed'; error: string }
  | {
      kind: 'adopted';
      silent: true;
      doc: GardenDocument;
      fileName: string;
      eTag?: string;
      usedLegacy?: boolean;
      fallbackFrom?: string;
      message: string;
    }
  | {
      kind: 'kept-remote';
      silent: false;
      doc: GardenDocument;
      fileName: string;
      eTag?: string;
      preservedAs: string;
      message: string;
      localOnlyPhotos: Photo[];
      preservedRevision: number;
    }
  | { kind: 'cancelled'; message: string };

/**
 * Sign-in and Load. Adopt OneDrive with no prompt only when this browser's
 * garden is empty, or the stored base eTag equals the remote eTag and the
 * local garden is not dirty. Anything else uses the save conflict prompt.
 * Cancel leaves the local garden in place.
 */
export async function reconcileGardenOnLoad(opts: {
  localDoc: GardenDocument;
  fileName?: string;
  token: string;
  account: string;
  storage?: OwedSaveStorage;
  fetchImpl?: typeof fetch;
  choose?: GardenCopyChooser;
  now?: () => string;
  downloadLocal?: (doc: GardenDocument, fileName: string) => void;
  prompt?: 'auto' | 'user';
  /**
   * Garden and dirty flag once the load has returned. Sign-in and Load pass
   * this so an edit made while OneDrive was loading is part of the decision.
   * When omitted, `localDoc` and the stored dirty flag are used.
   * `revision` lets the conflict file track edits made after this first read.
   */
  readLocal?: () => { doc: GardenDocument; dirty: boolean; revision?: number };
  usingLock?: GardenSaveLock;
}): Promise<GardenReconcileResult> {
  const fileName = opts.fileName || getGardenCloudFileName();
  const lock = opts.usingLock ?? runUnlocked;
  const loaded = await lock(() =>
    loadGardenFromOneDrive(fileName, {
      token: opts.token,
      fetchImpl: opts.fetchImpl,
    }),
  );
  if (!loaded.ok) {
    if (loaded.missing) return { kind: 'missing', message: loaded.error };
    return { kind: 'failed', error: loaded.error };
  }

  const remoteFile = loaded.fileName || fileName;
  const remoteETag = loaded.eTag || '';
  const live = opts.readLocal?.() ?? {
    doc: opts.localDoc,
    dirty: gardenIsDirty(opts.storage),
  };
  if (isEmptySurveyGarden(live.doc)) {
    return adopted(opts, loaded, remoteFile, remoteETag);
  }

  const baseETag = rememberedDriveETag(opts.account, remoteFile, opts.storage);
  if (!live.dirty && baseETag && remoteETag && baseETag === remoteETag) {
    return adopted(opts, loaded, remoteFile, remoteETag);
  }

  const resolved = await resolveConflict(
    { ...opts, doc: live.doc },
    loaded,
    remoteFile,
    live.doc.updatedAt ?? '',
    opts.prompt ?? 'user',
    lock,
  );
  if (!resolved.ok) {
    if (resolved.cancelled) {
      markGardenDirty(opts.storage);
      return { kind: 'cancelled', message: resolved.error };
    }
    markGardenDirty(opts.storage);
    return { kind: 'failed', error: resolved.error };
  }
  if (resolved.wrote) {
    return {
      kind: 'failed',
      error: `Could not choose a copy of ${remoteFile}.`,
    };
  }
  return {
    kind: 'kept-remote',
    silent: false,
    doc: resolved.doc,
    fileName: resolved.fileName,
    eTag: resolved.eTag,
    preservedAs: resolved.preservedAs,
    message: resolved.message,
    localOnlyPhotos: resolved.localOnlyPhotos,
    preservedRevision: resolved.preservedRevision,
  };
}

function adopted(
  opts: { account: string; storage?: OwedSaveStorage },
  loaded: Extract<CloudLoadResult, { ok: true }>,
  remoteFile: string,
  remoteETag: string,
): GardenReconcileResult {
  noteRemoteGardenApplied();
  clearGardenDirty(opts.storage);
  clearGardenSaveOwed(opts.storage);
  if (remoteETag && opts.account) rememberDriveETag(opts.account, remoteFile, remoteETag, opts.storage);
  return {
    kind: 'adopted',
    silent: true,
    doc: loaded.doc,
    fileName: remoteFile,
    eTag: loaded.eTag,
    usedLegacy: loaded.usedLegacy,
    fallbackFrom: loaded.fallbackFrom,
    message: `Loaded ${remoteFile} from OneDrive.`,
  };
}
