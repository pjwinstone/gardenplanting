import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PETRI_ADD_POINT_KEY,
  petriAddPointEnabled,
  setPetriAddPointEnabled,
} from '../src/workflow/prefs';

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

describe('petri add point prefs', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to ON when no stored setting', () => {
    expect(petriAddPointEnabled()).toBe(true);
  });

  it('legacy flow when explicitly off', () => {
    setPetriAddPointEnabled(false);
    expect(localStorage.getItem(PETRI_ADD_POINT_KEY)).toBe('0');
    expect(petriAddPointEnabled()).toBe(false);
  });

  it('stays on when explicitly enabled', () => {
    setPetriAddPointEnabled(true);
    expect(petriAddPointEnabled()).toBe(true);
  });
});
