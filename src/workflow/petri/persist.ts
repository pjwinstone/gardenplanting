import type { PetriRunState } from './types';

export const PETRI_RUN_KEY = 'garden-survey:petri-add-point-run';

export function readPetriRun(): PetriRunState | null {
  try {
    const raw = localStorage.getItem(PETRI_RUN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PetriRunState;
  } catch {
    return null;
  }
}

export function writePetriRun(run: PetriRunState): void {
  try {
    localStorage.setItem(PETRI_RUN_KEY, JSON.stringify(run));
  } catch {
    /* quota / private mode */
  }
}

export function clearPetriRun(): void {
  try {
    localStorage.removeItem(PETRI_RUN_KEY);
  } catch {
    /* ignore */
  }
}
