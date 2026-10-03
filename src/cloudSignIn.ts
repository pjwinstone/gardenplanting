/**
 * A silent garden auto-save that needs a tap must still be written once a
 * Graph token exists. The flag lives in localStorage so a Microsoft redirect
 * does not forget it.
 */

const GARDEN_SAVE_OWED_KEY = 'garden-survey:garden-save-owed';

export interface OwedSaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
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

export function markGardenSaveOwed(storage?: OwedSaveStorage): void {
  storageOf(storage)?.setItem(GARDEN_SAVE_OWED_KEY, '1');
}

export function gardenSaveIsOwed(storage?: OwedSaveStorage): boolean {
  return storageOf(storage)?.getItem(GARDEN_SAVE_OWED_KEY) === '1';
}

export function clearGardenSaveOwed(storage?: OwedSaveStorage): void {
  storageOf(storage)?.removeItem(GARDEN_SAVE_OWED_KEY);
}

/**
 * The Sign in button has a token. Always resume photo uploads. Write the
 * garden only when auto-save was waiting — an empty upload queue must not
 * skip that write.
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
