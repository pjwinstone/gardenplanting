import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearErrorLog,
  getErrorLog,
  hasUnseenErrors,
  isErrorLogEntrySeen,
  logError,
  toggleErrorLogEntrySeen,
  unseenErrorCount,
} from '../src/errorLog';

function memoryLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe('error log seen toggle', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryLocalStorage());
    clearErrorLog();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('toggles a single error line seen and updates unseen counts', () => {
    logError('Tape failed', { source: 'window.onerror', severity: 'error' });
    logError('Coach note', { source: 'coach', severity: 'info' });
    const err = getErrorLog().find((e) => e.message === 'Tape failed');
    expect(err).toBeDefined();
    expect(hasUnseenErrors()).toBe(true);
    expect(unseenErrorCount()).toBe(1);
    expect(isErrorLogEntrySeen(err!.id)).toBe(false);

    toggleErrorLogEntrySeen(err!.id);
    expect(isErrorLogEntrySeen(err!.id)).toBe(true);
    expect(hasUnseenErrors()).toBe(false);
    expect(unseenErrorCount()).toBe(0);

    toggleErrorLogEntrySeen(err!.id);
    expect(isErrorLogEntrySeen(err!.id)).toBe(false);
    expect(hasUnseenErrors()).toBe(true);
  });

  it('persists seen ids across reload', async () => {
    logError('Load failed', { source: 'import', severity: 'error' });
    const id = getErrorLog()[0].id;
    toggleErrorLogEntrySeen(id);

    vi.resetModules();
    const reloaded = await import('../src/errorLog');
    expect(reloaded.isErrorLogEntrySeen(id)).toBe(true);
    expect(reloaded.hasUnseenErrors()).toBe(false);
  });
});
