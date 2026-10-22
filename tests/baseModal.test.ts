// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyDocument, type GardenDocument } from '../src/model';
import { upsertBasePoint } from '../src/baseGrid';
import { editBasePointRun, newPointRun, edit } from '../src/screens/pointRun';
import * as S from '../src/screens/pointScreen';

function grid(): GardenDocument {
  let d = emptyDocument('g');
  d = upsertBasePoint(d, { id: 'BAS01' });
  return upsertBasePoint(d, { id: 'BAS02', from: 'BAS01', northM: 3, eastM: 4, diagonalM: 5 });
}

describe('base point form (full-screen modal)', () => {
  it('editing opens the modal with heading, labelled prefilled fields and decimal text inputs', () => {
    let d = grid();
    S.installScreens({ getDoc: () => d, setDoc: (x: GardenDocument) => { d = x; }, rerender: () => {}, takePhoto: () => {}, openCircleTest: () => {}, drainArchive: () => {} } as never);
    S.resetScreens();
    const b = document.createElement('button');
    b.dataset.value = 'BAS02';
    S.handleScreenCommand('screen-edit-base', b);
    const m = S.renderScreens(d)!;
    expect(m.dataset.testid).toBe('base-modal');
    expect(m.querySelector('[data-testid="base-modal-title"]')!.textContent).toBe('Edit base point BAS02');
    for (const id of ['in-north', 'in-east', 'in-diagonal']) {
      const i = m.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
      expect(i.type).toBe('text');
      expect(i.inputMode).toBe('decimal');
      expect(i.readOnly).toBe(false);
      // Not a click command: a tap on it must not redraw the form.
      expect(i.dataset.cmd).toBe('screen-live');
      expect(i.closest('label')!.querySelector('.bm-label')!.textContent).toBeTruthy();
    }
    expect(m.querySelector<HTMLInputElement>('[data-testid="in-north"]')!.value).toBe('3');
    expect(m.querySelector<HTMLSelectElement>('[data-testid="in-from"]')!.value).toBe('BAS01');
  });

  it('typing updates the run live and the check line, without a redraw', () => {
    let d = grid();
    let redraws = 0;
    S.installScreens({ getDoc: () => d, setDoc: (x: GardenDocument) => { d = x; }, rerender: () => { redraws++; }, takePhoto: () => {}, openCircleTest: () => {}, drainArchive: () => {} } as never);
    S.resetScreens();
    S.handleScreenCommand('screen-add-base', document.createElement('button'));
    redraws = 0;
    const m = S.renderScreens(d)!;
    document.body.append(m);
    const sel = m.querySelector<HTMLSelectElement>('[data-testid="in-from"]')!;
    sel.value = 'BAS02';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    for (const [id, v] of [['in-north', '4'], ['in-east', '0'], ['in-diagonal', '4.2']] as const) {
      const i = m.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!;
      i.value = v;
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(redraws).toBe(0);
    expect(m.querySelector('[data-testid="diagonal-check"]')!.textContent).toMatch(/Diagonal off by/);
    expect(m.querySelector<HTMLButtonElement>('[data-testid="btn-save"]')!.disabled).toBe(false);
    S.handleScreenCommand('screen-save', m.querySelector('[data-testid="btn-save"]')!);
    expect(d.baseGrid!.ties.find((x) => x.to === 'BAS03')).toMatchObject({ from: 'BAS02', northM: 4, eastM: 0, diagonalM: 4.2 });
    m.remove();
  });

  it('save reason and check line (warning only)', () => {
    const d = grid();
    let r = edit(newPointRun(), 'choose_type', { type: 'base' });
    expect(S.modalSaveReason(d, r)).toBeTruthy();
    r = { ...r, from: 'BAS01', northM: 3, eastM: 4 };
    expect(S.modalSaveReason(d, r)).toBeNull();
    expect(S.modalCheckText(d, r).level).toBe('amber');
    expect(S.modalCheckText(d, { ...r, diagonalM: 5 }).level).toBe('ok');
    expect(S.modalCheckText(d, editBasePointRun(d, 'BAS01')).text).toBe('');
  });

  it('root cause guard: the shell click handler ignores taps on inputs', () => {
    const src = readFileSync('src/ui.ts', 'utf8');
    expect(src).toMatch(/if \(target\.matches\('input, select, textarea'\)\) return;/);
    const css = readFileSync('src/screens/screens.css', 'utf8');
    expect(css).toMatch(/\.bm-root \{[^}]*position: fixed; inset: 0; z-index: 1000/);
    expect(Number(/\.bm-input \{[^}]*font-size: (\d+)px/.exec(css)![1])).toBeGreaterThanOrEqual(16);
  });
});
