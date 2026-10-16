import { beforeEach, describe, expect, it } from 'vitest';
import {
  PETRI_ADD_POINT_KEY,
  petriAddPointEnabled,
  setPetriAddPointEnabled,
} from '../src/workflow/prefs';

describe('petri add point prefs', () => {
  beforeEach(() => {
    localStorage.removeItem(PETRI_ADD_POINT_KEY);
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
