export const PETRI_ADD_POINT_KEY = 'garden-survey:petri-add-point';

/** Default ON when unset (fresh install). Explicit `0` selects legacy + Point dialog. */
export function petriAddPointEnabled(): boolean {
  try {
    const v = localStorage.getItem(PETRI_ADD_POINT_KEY);
    if (v === '0') return false;
    return true;
  } catch {
    return true;
  }
}

export function setPetriAddPointEnabled(on: boolean): void {
  try {
    localStorage.setItem(PETRI_ADD_POINT_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}
