import type { GardenDocument } from '../../model';
import { glossaryById } from '../glossary';
import {
  acceptAmberWithNote,
  currentUserTransition,
  fireAddPointUserTransition,
  getAddPointWorkflowContext,
  patchAddPointWorkflowContext,
  recordTapeMeasurement,
} from './session';
import type { FixOption, SurveyLayerRule } from './context';
import './addPointChrome.css';

function el(
  tag: string,
  opts: {
    className?: string;
    text?: string;
    attrs?: Record<string, string>;
  } = {},
): HTMLElement {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  }
  return node;
}

function helpForGlossaryIds(ids: string[] | undefined): HTMLElement | null {
  if (!ids?.length) return null;
  const wrap = el('div', { className: 'petri-add-point__help' });
  const parts: string[] = [];
  for (const id of ids) {
    const g = glossaryById(id);
    if (g) parts.push(`${g.term}: ${g.definition}`);
  }
  if (!parts.length) return null;
  wrap.textContent = parts.join(' ');
  return wrap;
}

function strengthClass(strength: string | undefined): string {
  switch (strength) {
    case 'green':
      return 'petri-add-point__strength--green';
    case 'amber':
      return 'petri-add-point__strength--amber';
    case 'red':
      return 'petri-add-point__strength--red';
    default:
      return 'petri-add-point__strength--grey';
  }
}

export function renderAddPointPetriChrome(_doc: GardenDocument): HTMLElement {
  const t = currentUserTransition();
  const ctx = getAddPointWorkflowContext();
  const kind = t?.kind ?? 'user';
  const root = el('section', {
    className: `petri-add-point petri-add-point--${kind}`,
    attrs: {
      'data-testid': 'petri-add-point',
      'aria-label': 'Add point workflow',
    },
  });

  root.appendChild(
    el('button', {
      className: 'btn btn--util petri-add-point__close',
      text: '✕',
      attrs: {
        type: 'button',
        'data-cmd': 'petri-close',
        'aria-label': 'Close Add point workflow',
      },
    }),
  );

  root.appendChild(
    el('h2', {
      className: 'petri-add-point__title',
      text: t?.label ?? '+ Point workflow',
    }),
  );

  const step = el('p', { className: 'petri-add-point__step' });
  const screen = t?.screen ?? 'idle';

  if (!t) {
    step.textContent = 'No user step is enabled — check guards or restart + Point.';
    root.appendChild(step);
    return root;
  }

  if (screen === 'pick_layer') {
    step.textContent = 'Pick the survey layer. This sets tolerances and fix rules.';
    const row = el('div', { className: 'petri-add-point__row' });
    const layers: { id: SurveyLayerRule; label: string; gloss: string }[] = [
      { id: 'baseline', label: 'Baseline', gloss: 'layer_baseline' },
      { id: 'railway', label: 'Railway', gloss: 'layer_railway' },
      { id: 'flower_bed', label: 'Flower bed', gloss: 'layer_flower_bed' },
      { id: 'tree', label: 'Tree', gloss: 'layer_tree' },
    ];
    for (const layer of layers) {
      const g = glossaryById(layer.gloss);
      row.appendChild(
        el('button', {
          className: 'btn btn--suggested',
          text: layer.label,
          attrs: {
            type: 'button',
            'data-cmd': 'petri-pick-layer',
            'data-layer-rule': layer.id,
            title: g?.definition ?? layer.label,
          },
        }),
      );
    }
    root.appendChild(step);
    root.appendChild(helpForGlossaryIds(t.glossary ?? []) ?? document.createComment(''));
    root.appendChild(row);
    return root;
  }

  if (screen === 'pick_fix') {
    step.textContent = 'How should this point be fixed?';
    const row = el('div', { className: 'petri-add-point__row' });
    const fixes: { id: FixOption; label: string; gloss: string }[] = [
      { id: 'free_point', label: 'Free point', gloss: 'fix_free' },
      { id: 'baseline_end', label: 'Baseline end', gloss: 'fix_baseline_end' },
      { id: 'camera_station', label: 'Camera station', gloss: 'fix_camera_station' },
    ];
    for (const fix of fixes) {
      const g = glossaryById(fix.gloss);
      row.appendChild(
        el('button', {
          className: 'btn btn--util',
          text: fix.label,
          attrs: {
            type: 'button',
            'data-cmd': 'petri-pick-fix',
            'data-fix-option': fix.id,
            title: g?.definition ?? fix.label,
          },
        }),
      );
    }
    root.appendChild(step);
    root.appendChild(helpForGlossaryIds(t.glossary ?? []) ?? document.createComment(''));
    root.appendChild(row);
    return root;
  }

  if (screen === 'pick_side') {
    step.textContent =
      ctx.sideAnchorPointId
        ? `Side anchor: ${ctx.sideAnchorPointId}. Tap another plan point or confirm.`
        : 'Tap the plan on the side where this point lies (relative to the baseline).';
    const row = el('div', { className: 'petri-add-point__row' });
    row.appendChild(
      el('button', {
        className: 'btn btn--suggested',
        text: 'Side + (left)',
        attrs: { type: 'button', 'data-cmd': 'petri-pick-side', 'data-side': '1' },
      }),
    );
    row.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Side − (right)',
        attrs: { type: 'button', 'data-cmd': 'petri-pick-side', 'data-side': '-1' },
      }),
    );
    if (ctx.sideAnchorPointId) {
      row.appendChild(
        el('button', {
          className: 'btn btn--stage2',
          text: 'Continue',
          attrs: { type: 'button', 'data-cmd': 'petri-fire', 'data-transition': t.id },
        }),
      );
    }
    root.appendChild(step);
    root.appendChild(helpForGlossaryIds(t.glossary ?? []) ?? document.createComment(''));
    root.appendChild(row);
    return root;
  }

  if (screen === 'capture_measurement') {
    step.textContent = 'Add a tape reading (m) and/or take a photo with marks.';
    const tapeField = el('label', { className: 'petri-add-point__field' });
    tapeField.appendChild(el('span', { text: glossaryById('tape')?.term ?? 'Tape (m)' }));
    tapeField.appendChild(
      el('input', {
        attrs: {
          type: 'number',
          step: '0.001',
          min: '0',
          'data-field': 'petri-tape-m',
          placeholder: 'e.g. 2.450',
        },
      }),
    );
    const row = el('div', { className: 'petri-add-point__row' });
    row.appendChild(
      el('button', {
        className: 'btn btn--suggested',
        text: 'Take photo',
        attrs: { type: 'button', 'data-cmd': 'petri-camera' },
      }),
    );
    row.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Continue with tape',
        attrs: { type: 'button', 'data-cmd': 'petri-fire', 'data-transition': t.id },
      }),
    );
    root.appendChild(step);
    root.appendChild(helpForGlossaryIds(t.glossary ?? []) ?? document.createComment(''));
    root.appendChild(tapeField);
    root.appendChild(row);
    return root;
  }

  if (screen === 'strength_result') {
    const badge = el('span', {
      className: `petri-add-point__strength ${strengthClass(ctx.strength)}`,
      text: (ctx.strength ?? 'grey').toUpperCase(),
    });
    step.appendChild(badge);
    step.appendChild(document.createTextNode(` ${ctx.strengthDetail ?? ''}`));
    const row = el('div', { className: 'petri-add-point__row' });

    if (ctx.strength === 'green') {
      row.appendChild(
        el('button', {
          className: 'btn btn--suggested',
          text: 'Accept',
          attrs: {
            type: 'button',
            'data-cmd': 'petri-fire',
            'data-transition': 'accept_green',
          },
        }),
      );
    } else if (ctx.strength === 'amber') {
      const noteField = el('label', { className: 'petri-add-point__field' });
      noteField.appendChild(
        el('span', { text: glossaryById('accept_continue')?.term ?? 'Note (optional)' }),
      );
      noteField.appendChild(
        el('textarea', {
          attrs: { rows: '2', 'data-field': 'petri-amber-note', placeholder: 'Why accept?' },
        }),
      );
      root.appendChild(noteField);
      row.appendChild(
        el('button', {
          className: 'btn btn--suggested',
          text: glossaryById('accept_continue')?.term ?? 'Accept and continue',
          attrs: {
            type: 'button',
            'data-cmd': 'petri-accept-amber',
            'data-transition': 'accept_amber',
          },
        }),
      );
    } else if (ctx.strength === 'red') {
      row.appendChild(
        el('button', {
          className: 'btn btn--stage2',
          text: glossaryById('redo_measurement')?.term ?? 'Redo measurement',
          attrs: {
            type: 'button',
            'data-cmd': 'petri-fire',
            'data-transition': 'redo_red',
          },
        }),
      );
    } else {
      row.appendChild(
        el('button', {
          className: 'btn btn--util',
          text: glossaryById('add_measurement')?.term ?? 'Add measurement',
          attrs: {
            type: 'button',
            'data-cmd': 'petri-fire',
            'data-transition': 'add_more_grey',
          },
        }),
      );
      row.appendChild(
        el('button', {
          className: 'btn btn--suggested',
          text: 'Take photo',
          attrs: { type: 'button', 'data-cmd': 'petri-camera' },
        }),
      );
    }

    root.appendChild(step);
    root.appendChild(helpForGlossaryIds(t.glossary ?? []) ?? document.createComment(''));
    root.appendChild(row);
    return root;
  }

  step.textContent = `Step: ${screen}`;
  root.appendChild(step);
  root.appendChild(helpForGlossaryIds(t.glossary) ?? document.createComment(''));
  return root;
}

export type PetriChromeHandler = (patch: {
  doc?: GardenDocument;
  close?: boolean;
  launchCamera?: boolean;
  error?: string;
}) => void;

export function handleAddPointPetriDomEvent(
  target: HTMLElement,
  doc: GardenDocument,
  onResult: PetriChromeHandler,
): boolean {
  const cmd = target.getAttribute('data-cmd');
  if (!cmd?.startsWith('petri-')) return false;

  if (cmd === 'petri-close') {
    onResult({ close: true });
    return true;
  }

  if (cmd === 'petri-pick-layer') {
    const layerRule = target.getAttribute('data-layer-rule') as SurveyLayerRule;
    patchAddPointWorkflowContext({ layerRule });
    const fired = fireAddPointUserTransition(doc, 'pick_layer_rule');
    if (fired.error) onResult({ error: fired.error });
    else onResult({ doc: fired.doc });
    return true;
  }

  if (cmd === 'petri-pick-fix') {
    const fixOption = target.getAttribute('data-fix-option') as FixOption;
    patchAddPointWorkflowContext({ fixOption });
    const fired = fireAddPointUserTransition(doc, 'pick_fix_option');
    if (fired.error) onResult({ error: fired.error });
    else onResult({ doc: fired.doc });
    return true;
  }

  if (cmd === 'petri-pick-side') {
    const side = Number(target.getAttribute('data-side')) as 1 | -1;
    patchAddPointWorkflowContext({ side });
    const fired = fireAddPointUserTransition(doc, 'pick_side_on_plan');
    if (fired.error) onResult({ error: fired.error });
    else onResult({ doc: fired.doc });
    return true;
  }

  if (cmd === 'petri-fire') {
    const tapeInput = document.querySelector('[data-field="petri-tape-m"]') as HTMLInputElement | null;
    if (tapeInput?.value) {
      const v = Number(tapeInput.value);
      if (Number.isFinite(v) && v > 0) recordTapeMeasurement(v);
    }
    const transitionId = target.getAttribute('data-transition') ?? currentUserTransition()?.id;
    if (!transitionId) {
      onResult({ error: 'No transition to fire.' });
      return true;
    }
    const fired = fireAddPointUserTransition(doc, transitionId);
    if (fired.error) onResult({ error: fired.error });
    else onResult({ doc: fired.doc });
    return true;
  }

  if (cmd === 'petri-accept-amber') {
    const noteEl = document.querySelector('[data-field="petri-amber-note"]') as HTMLTextAreaElement | null;
    acceptAmberWithNote(noteEl?.value ?? '');
    const transitionId = target.getAttribute('data-transition') ?? 'accept_amber';
    const fired = fireAddPointUserTransition(doc, transitionId);
    if (fired.error) onResult({ error: fired.error });
    else onResult({ doc: fired.doc });
    return true;
  }

  if (cmd === 'petri-camera') {
    onResult({ launchCamera: true });
    return true;
  }

  return false;
}

/** Plan tap while choosing side — stores anchor and default side from tap. */
export function petriPlanTapForSide(pointId: string): boolean {
  const t = currentUserTransition();
  if (t?.screen !== 'pick_side') return false;
  patchAddPointWorkflowContext({ sideAnchorPointId: pointId });
  return true;
}
