/**
 * Garden JSON writes that refuse to clobber a newer or real OneDrive file.
 * Ordinary saves send If-Match whenever an eTag is known. A 412 reloads the
 * remote copy and asks which timestamps to keep. An empty garden, or one
 * whose updatedAt is older than the remote, is never written.
 */

import type { OwedSaveStorage } from './cloudSignIn';
import {
  clearGardenSaveOwed,
  owedSaveMatches,
  readOwedGardenSave,
} from './cloudSignIn';
import { getGardenCloudFileName } from './cloudConfig';
import type { GardenDocument } from './model';
import {
  loadGardenFromOneDrive,
  saveGardenToOneDrive,
  type CloudLoadResult,
} from './onedrive';

const ETAG_KEY = 'garden-survey:drive-etags';

export interface GardenCopyChoice {
  fileName: string;
  localUpdatedAt: string;
  remoteUpdatedAt: string;
  localDoc: GardenDocument;
  remoteDoc: GardenDocument;
  remoteETag: string;
  /** Plain-language prompt. Both timestamps are in the text. */
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
      reason: 'stale' | 'empty' | 'chose-remote' | 'older-than-remote';
      message: string;
    }
  | { ok: false; error: string; conflict?: boolean; refused?: 'empty' | 'stale' };

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

export function localCopyMustNotOverwrite(
  local: GardenDocument,
  remoteUpdatedAt: string,
): 'empty' | 'stale' | null {
  if (isEmptySurveyGarden(local)) return 'empty';
  if (!remoteUpdatedAt) return null;
  const localAt = local.updatedAt ?? '';
  if (!localAt) return 'stale';
  const localMs = Date.parse(localAt);
  const remoteMs = Date.parse(remoteUpdatedAt);
  if (Number.isFinite(localMs) && Number.isFinite(remoteMs) && localMs < remoteMs) return 'stale';
  return null;
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
    'OK keeps the OneDrive copy. Cancel keeps this browser’s copy.',
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

function keptRemoteMessage(fileName: string, localUpdatedAt: string, remoteUpdatedAt: string, reason: string): string {
  if (reason === 'empty') {
    return `Not saving an empty garden over ${fileName}.`;
  }
  return `Kept the OneDrive copy of ${fileName}. This browser: ${localUpdatedAt || 'unknown time'}. OneDrive: ${remoteUpdatedAt || 'unknown time'}.`;
}

export async function commitGardenSave(opts: {
  doc: GardenDocument;
  fileName?: string;
  token: string;
  /** Preferred If-Match value. The live eTag is used when this is empty. */
  ifMatch?: string;
  fetchImpl?: typeof fetch;
  choose?: GardenCopyChooser;
  account?: string;
  storage?: OwedSaveStorage;
}): Promise<GardenCommitResult> {
  const fileName = opts.fileName || getGardenCloudFileName();
  const fetchImpl = opts.fetchImpl;
  const localUpdatedAt = opts.doc.updatedAt ?? '';

  if (isEmptySurveyGarden(opts.doc)) {
    return {
      ok: false,
      refused: 'empty',
      error: `Not saving an empty garden over ${fileName}.`,
    };
  }

  const probed = await loadGardenFromOneDrive(fileName, { token: opts.token, fetchImpl });
  if (!probed.ok && !probed.missing) {
    return { ok: false, error: probed.error };
  }

  if (probed.ok) {
    const remoteUpdatedAt = probed.remoteUpdatedAt || probed.doc.updatedAt || '';
    const block = localCopyMustNotOverwrite(opts.doc, remoteUpdatedAt);
    if (block) {
      return keptRemote(probed, fileName, localUpdatedAt, remoteUpdatedAt, block);
    }
  }

  const ifMatch = opts.ifMatch || (probed.ok ? probed.eTag : undefined) || undefined;
  const put = await saveGardenToOneDrive(opts.doc, fileName, opts.token, {
    ifMatch: probed.ok ? ifMatch : undefined,
    fetchImpl,
  });
  if (put.ok) {
    if (put.eTag && opts.account) rememberDriveETag(opts.account, fileName, put.eTag, opts.storage);
    return { ok: true, wrote: true, savedAt: put.savedAt, fileName: put.fileName, eTag: put.eTag };
  }
  if (!put.conflict) return { ok: false, error: put.error, conflict: false };

  const again = await loadGardenFromOneDrive(fileName, { token: opts.token, fetchImpl });
  if (!again.ok) {
    return { ok: false, error: again.error || put.error, conflict: true };
  }
  const remoteUpdatedAt = again.remoteUpdatedAt || again.doc.updatedAt || '';
  const block = localCopyMustNotOverwrite(opts.doc, remoteUpdatedAt);
  const choice = choiceFor(opts.doc, again, fileName, localUpdatedAt, remoteUpdatedAt);
  const pick = opts.choose ? await opts.choose(choice) : 'remote';
  if (pick === 'remote' || block) {
    const reason = block === 'empty' ? 'empty' : block === 'stale' ? 'stale' : 'chose-remote';
    return keptRemote(again, fileName, localUpdatedAt, remoteUpdatedAt, reason === 'chose-remote' && block ? block : reason);
  }

  const overwrite = await saveGardenToOneDrive(opts.doc, fileName, opts.token, {
    ifMatch: again.eTag,
    fetchImpl,
  });
  if (!overwrite.ok) {
    return { ok: false, error: overwrite.error, conflict: overwrite.conflict };
  }
  if (overwrite.eTag && opts.account) {
    rememberDriveETag(opts.account, fileName, overwrite.eTag, opts.storage);
  }
  return {
    ok: true,
    wrote: true,
    savedAt: overwrite.savedAt,
    fileName: overwrite.fileName,
    eTag: overwrite.eTag,
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

function keptRemote(
  remote: Extract<CloudLoadResult, { ok: true }>,
  fileName: string,
  localUpdatedAt: string,
  remoteUpdatedAt: string,
  reason: 'stale' | 'empty' | 'chose-remote' | 'older-than-remote',
): GardenCommitResult {
  return {
    ok: true,
    wrote: false,
    kept: 'remote',
    doc: remote.doc,
    fileName: remote.fileName || fileName,
    eTag: remote.eTag,
    localUpdatedAt,
    remoteUpdatedAt,
    reason,
    message: keptRemoteMessage(fileName, localUpdatedAt, remoteUpdatedAt, reason),
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
      message: string;
    }
  | { kind: 'failed'; error: string };

/**
 * After a Microsoft redirect, write the owed garden only when the signed-in
 * account and file still match the record. Otherwise clear the flag and do nothing.
 */
export async function applyRedirectOwedSave(opts: {
  account: string;
  fileName: string;
  localDoc: GardenDocument;
  token: string;
  storage?: OwedSaveStorage;
  fetchImpl?: typeof fetch;
  choose?: GardenCopyChooser;
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
  });

  if (!result.ok) {
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
    message: result.message,
  };
}
