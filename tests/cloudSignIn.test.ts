import { describe, expect, it } from 'vitest';
import {
  clearGardenSaveOwed,
  completeCloudSignIn,
  gardenSaveIsOwed,
  markGardenSaveOwed,
  type OwedSaveStorage,
} from '../src/cloudSignIn';

function memoryStorage(): OwedSaveStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe('completeCloudSignIn', () => {
  it('saves the garden after sign-in when auto-save was blocked, even with nothing queued', async () => {
    const storage = memoryStorage();
    markGardenSaveOwed(
      {
        account: 'acct',
        fileName: 'garden-v1.json',
        baseETag: '"etag"',
        docUpdatedAt: '2026-10-03T10:00:00.000Z',
      },
      storage,
    );
    expect(gardenSaveIsOwed(storage)).toBe(true);

    let resumes = 0;
    let saves = 0;
    await completeCloudSignIn({
      storage,
      resumeUploads: () => {
        resumes += 1;
      },
      saveGarden: () => {
        saves += 1;
      },
    });
    expect(resumes).toBe(1);
    expect(saves).toBe(1);
    // A failed write leaves the flag, so the next sign-in tries again.
    expect(gardenSaveIsOwed(storage)).toBe(true);

    clearGardenSaveOwed(storage);
    await completeCloudSignIn({
      storage,
      resumeUploads: () => {
        resumes += 1;
      },
      saveGarden: () => {
        saves += 1;
      },
    });
    expect(resumes).toBe(2);
    expect(saves).toBe(1);
    expect(gardenSaveIsOwed(storage)).toBe(false);
  });
});
