/**
 * A silent garden auto-save that needs a tap must still be written once a
 * Graph token exists. The owed record lives in localStorage so a Microsoft
 * redirect does not forget which account, file, and base version it was for.
 * A redirect save runs only when that account and file are the ones now signed in.
 */

const GARDEN_SAVE_OWED_KEY = 'garden-survey:garden-save-owed';

export interface OwedSaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Identity captured when auto-save had to wait for a token. */
export interface OwedGardenSave {
  account: string;
  fileName: string;
  /** Drive item eTag last seen for this file. Empty when this browser has never read it. */
  baseETag: string;
  /** GardenDocument.updatedAt of the copy we meant to write. */
  docUpdatedAt: string;
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

export function markGardenSaveOwed(details: OwedGardenSave, storage?: OwedSaveStorage): void {
  storageOf(storage)?.setItem(GARDEN_SAVE_OWED_KEY, JSON.stringify(details));
}

export function readOwedGardenSave(storage?: OwedSaveStorage): OwedGardenSave | null {
  const store = storageOf(storage);
  const raw = store?.getItem(GARDEN_SAVE_OWED_KEY);
  if (!raw) return null;
  const parsed = parseOwedGardenSave(raw);
  if (!parsed) {
    // A bare "1" from older builds has no account or base version. Do not act on it.
    store?.removeItem(GARDEN_SAVE_OWED_KEY);
    return null;
  }
  return parsed;
}

export function gardenSaveIsOwed(storage?: OwedSaveStorage): boolean {
  return readOwedGardenSave(storage) !== null;
}

export function clearGardenSaveOwed(storage?: OwedSaveStorage): void {
  storageOf(storage)?.removeItem(GARDEN_SAVE_OWED_KEY);
}

/** Redirect save is allowed only for the same Microsoft account and garden file. */
export function owedSaveMatches(owed: OwedGardenSave, account: string, fileName: string): boolean {
  return Boolean(owed.account) && owed.account === account && owed.fileName === fileName;
}

function parseOwedGardenSave(raw: string): OwedGardenSave | null {
  try {
    const parsed = JSON.parse(raw) as Partial<OwedGardenSave> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.account !== 'string' || typeof parsed.fileName !== 'string') return null;
    if (!parsed.fileName) return null;
    return {
      account: parsed.account,
      fileName: parsed.fileName,
      baseETag: typeof parsed.baseETag === 'string' ? parsed.baseETag : '',
      docUpdatedAt: typeof parsed.docUpdatedAt === 'string' ? parsed.docUpdatedAt : '',
    };
  } catch {
    return null;
  }
}

/**
 * The Sign in button has a token. Always resume photo uploads. Write the
 * garden only when auto-save was waiting — an empty upload queue must not
 * skip that write. The caller’s save must send If-Match and refuse an empty
 * or older copy; this function does not clear the flag.
 */
export async function completeCloudSignIn(opts: {
  resumeUploads: () => Promise<void> | void;
  saveGarden: () => Promise<void> | void;
  setMessage?: (message: string) => void;
  storage?: OwedSaveStorage;
}): Promise<void> {
  const owed = gardenSaveIsOwed(opts.storage);
  opts.setMessage?.(
    owed
      ? 'Signed in. Saving the garden and uploading photos…'
      : 'Signed in. Uploading photos…',
  );
  await opts.resumeUploads();
  if (owed) await opts.saveGarden();
}
