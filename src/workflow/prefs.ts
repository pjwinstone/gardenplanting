export const PETRI_ADD_POINT_KEY = 'garden-survey:petri-add-point';

export function petriAddPointEnabled(): boolean {
  try {
    return localStorage.getItem(PETRI_ADD_POINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setPetriAddPointEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(PETRI_ADD_POINT_KEY, '1');
    else localStorage.removeItem(PETRI_ADD_POINT_KEY);
  } catch {
    /* ignore */
  }
}
