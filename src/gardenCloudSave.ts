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
 */

import type { OwedSaveStorage } from './cloudSignIn';
import {
  clearGardenSaveOwed,
  owedSaveMatches,
  readOwedGardenSave,
} from './cloudSignIn';
import { getGardenCloudFileName, onedrivePathFor } from './cloudConfig';
import type { GardenDocument } from './model';
import {
  loadGardenFromOneDrive,
  saveGardenToOneDrive,
  type CloudLoadResult,
  type CloudSaveResult,
} from './onedrive';

const ETAG_KEY = 'garden-survey:drive-etags';
const PROMPTED_KEY = 'garden-survey:conflict-prompted';
const DIRTY_KEY = 'garden-survey:garden-dirty';

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
  | { ok: true; wrote: true; savedAt: string; fileName: string; eTag?: string }
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

/** Every local edit, including while signed out and before a redirect. */
export function noteLocalGardenEdit(storage?: OwedSaveStorage): void {
  markGardenDirty(storage);
}

export function markGardenDirty(storage?: OwedSaveStorage): void {
  try {
    storageOf(storage)?.setItem(DIRTY_KEY, '1');
  } catch {
    /* quota */
  }
}

export function clearGardenDirty(storage?: OwedSaveStorage): void {
  try {
    storageOf(storage)?.removeItem(DIRTY_KEY);
  } catch {
    /* ignore */
  }
}

export function gardenIsDirty(storage?: OwedSaveStorage): boolean {
  try {
    return storageOf(storage)?.getItem(DIRTY_KEY) === '1';
  } catch {
    return false;
  }
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
}): Promise<GardenCommitResult> {
  const fileName = opts.fileName || getGardenCloudFileName();
  const fetchImpl = opts.fetchImpl;
  const localUpdatedAt = opts.doc.updatedAt ?? '';
  const promptMode = opts.prompt ?? 'user';

  if (isEmptySurveyGarden(opts.doc)) {
    return {
      ok: false,
      refused: 'empty',
      error: `Not saving an empty garden over ${fileName}.`,
    };
  }

  const probed = await loadGardenFromOneDrive(fileName, {
    token: opts.token,
    fetchImpl,
    exact: true,
  });
  if (!probed.ok && !probed.missing) {
    return { ok: false, error: probed.error };
  }

  const baseETag = opts.ifMatch || '';

  if (!probed.ok) {
    const put = await saveGardenToOneDrive(opts.doc, fileName, opts.token, {
      ifNoneMatch: '*',
      fetchImpl,
    });
    if (put.ok) return wroteResult(put, opts.account, fileName, opts.storage);
    if (!put.conflict) return { ok: false, error: put.error };
    const again = await loadGardenFromOneDrive(fileName, {
      token: opts.token,
      fetchImpl,
      exact: true,
    });
    if (!again.ok) return { ok: false, error: again.error || put.error, conflict: true };
    return resolveConflict(opts, again, fileName, localUpdatedAt, promptMode);
  }

  const remoteETag = probed.eTag || '';
  if (baseETag && remoteETag && baseETag === remoteETag) {
    const put = await saveGardenToOneDrive(opts.doc, fileName, opts.token, {
      ifMatch: baseETag,
      fetchImpl,
    });
    if (put.ok) return wroteResult(put, opts.account, fileName, opts.storage);
    if (!put.conflict) return { ok: false, error: put.error };
    const again = await loadGardenFromOneDrive(fileName, {
      token: opts.token,
      fetchImpl,
      exact: true,
    });
    if (!again.ok) return { ok: false, error: again.error || put.error, conflict: true };
    return resolveConflict(opts, again, fileName, localUpdatedAt, promptMode);
  }

  return resolveConflict(opts, probed, fileName, localUpdatedAt, promptMode);
}

function wroteResult(
  put: Extract<CloudSaveResult, { ok: true }>,
  account: string | undefined,
  fileName: string,
  storage?: OwedSaveStorage,
): GardenCommitResult {
  clearPrompted(storage);
  clearGardenDirty(storage);
  if (put.eTag && account) rememberDriveETag(account, fileName, put.eTag, storage);
  return { ok: true, wrote: true, savedAt: put.savedAt, fileName: put.fileName, eTag: put.eTag };
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
  },
  remote: Extract<CloudLoadResult, { ok: true }>,
  fileName: string,
  localUpdatedAt: string,
  promptMode: 'auto' | 'user',
): Promise<GardenCommitResult> {
  const remoteUpdatedAt = remote.remoteUpdatedAt || remote.doc.updatedAt || '';
  const remoteETag = remote.eTag ?? '';
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
  const choice = choiceFor(opts.doc, remote, fileName, localUpdatedAt, remoteUpdatedAt);
  if (!opts.choose) {
    return {
      ok: false,
      cancelled: true,
      conflict: true,
      error: `${fileName} on OneDrive does not match this browser. Nothing was written.`,
    };
  }
  const pick = await opts.choose(choice);
  if (pick !== 'remote') {
    return {
      ok: false,
      cancelled: true,
      conflict: true,
      error: `Left ${fileName} on OneDrive as it is. This browser’s save is still waiting.`,
    };
  }

  const preserved = await preserveLocalCopy(opts, fileName);
  if (!preserved.ok) {
    return { ok: false, error: preserved.error, conflict: true };
  }
  clearPrompted(opts.storage);
  clearGardenDirty(opts.storage);
  return {
    ok: true,
    wrote: false,
    kept: 'remote',
    doc: remote.doc,
    fileName: remote.fileName || fileName,
    eTag: remote.eTag,
    localUpdatedAt,
    remoteUpdatedAt,
    reason: 'chose-remote',
    preservedAs: preserved.where,
    message: preserved.message,
  };
}

async function preserveLocalCopy(
  opts: {
    doc: GardenDocument;
    token: string;
    fetchImpl?: typeof fetch;
    now?: () => string;
    downloadLocal?: (doc: GardenDocument, fileName: string) => void;
  },
  gardenFileName: string,
): Promise<{ ok: true; where: string; message: string } | { ok: false; error: string }> {
  const iso = opts.now?.() ?? new Date().toISOString();
  const conflictName = conflictGardenFileName(iso);
  const put = await saveGardenToOneDrive(opts.doc, conflictName, opts.token, {
    ifNoneMatch: '*',
    fetchImpl: opts.fetchImpl,
  });
  const path = `/${onedrivePathFor(conflictName)}`;
  if (put.ok) {
    return {
      ok: true,
      where: path,
      message: `Kept the OneDrive copy of ${gardenFileName}. This browser’s copy is saved as ${path}.`,
    };
  }
  try {
    opts.downloadLocal?.(opts.doc, conflictName);
  } catch {
    /* A download is a spare copy. It does not prove the local garden was kept. */
  }
  return {
    ok: false,
    error: `Could not keep this browser’s copy before using OneDrive (${put.error}). Nothing was replaced.`,
  };
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
  | { kind: 'saved'; fileName: string; savedAt: string; eTag?: string }
  | {
      kind: 'kept-remote';
      doc: GardenDocument;
      fileName: string;
      eTag?: string;
      localUpdatedAt: string;
      remoteUpdatedAt: string;
      preservedAs: string;
      message: string;
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
    return { kind: 'saved', fileName: result.fileName, savedAt: result.savedAt, eTag: result.eTag };
  }
  clearGardenSaveOwed(opts.storage);
  if (result.eTag) rememberDriveETag(opts.account, result.fileName, result.eTag, opts.storage);
  return {
    kind: 'kept-remote',
    doc: result.doc,
    fileName: result.fileName,
    eTag: result.eTag,
    localUpdatedAt: result.localUpdatedAt,
    remoteUpdatedAt: result.remoteUpdatedAt,
    preservedAs: result.preservedAs,
    message: result.message,
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
}): Promise<GardenReconcileResult> {
  const fileName = opts.fileName || getGardenCloudFileName();
  const loaded = await loadGardenFromOneDrive(fileName, {
    token: opts.token,
    fetchImpl: opts.fetchImpl,
  });
  if (!loaded.ok) {
    if (loaded.missing) return { kind: 'missing', message: loaded.error };
    return { kind: 'failed', error: loaded.error };
  }

  const remoteFile = loaded.fileName || fileName;
  const remoteETag = loaded.eTag || '';
  if (isEmptySurveyGarden(opts.localDoc)) {
    return adopted(opts, loaded, remoteFile, remoteETag);
  }

  const baseETag = rememberedDriveETag(opts.account, remoteFile, opts.storage);
  if (!gardenIsDirty(opts.storage) && baseETag && remoteETag && baseETag === remoteETag) {
    return adopted(opts, loaded, remoteFile, remoteETag);
  }

  const resolved = await resolveConflict(
    { ...opts, doc: opts.localDoc },
    loaded,
    remoteFile,
    opts.localDoc.updatedAt ?? '',
    opts.prompt ?? 'user',
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
  if (resolved.eTag && opts.account) {
    rememberDriveETag(opts.account, resolved.fileName, resolved.eTag, opts.storage);
  }
  clearGardenSaveOwed(opts.storage);
  return {
    kind: 'kept-remote',
    silent: false,
    doc: resolved.doc,
    fileName: resolved.fileName,
    eTag: resolved.eTag,
    preservedAs: resolved.preservedAs,
    message: resolved.message,
  };
}

function adopted(
  opts: { account: string; storage?: OwedSaveStorage },
  loaded: Extract<CloudLoadResult, { ok: true }>,
  remoteFile: string,
  remoteETag: string,
): GardenReconcileResult {
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
