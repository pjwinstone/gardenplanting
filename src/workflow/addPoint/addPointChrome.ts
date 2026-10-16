import type { GardenDocument } from '../../model';
import { glossaryById, glossaryHelpBlock, glossaryTooltip } from '../glossary';
import { tokensAt } from '../petri/engine';
import { addPointNet } from '../petri/loadNet';
import {
  acceptAmberWithNote,
  currentUserTransition,
  fireAddPointUserTransition,
  getAddPointPetriRun,
  getAddPointWorkflowContext,
  patchAddPointWorkflowContext,
  recordTapeMeasurement,
  selectFixOption,
} from './session';
import type { FixOptionId, SurveyLayerRule } from './context';
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

function helpForGlossaryIds(ids: string[]): HTMLElement | null {
  if (!ids.length) return null;
  const wrap = el('div', { className: 'petri-add-point__help' });
  wrap.textContent = ids.map((id) => glossaryHelpBlock(id)).filter(Boolean).join(' ');
  return wrap.textContent ? wrap : null;
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

function strengthUserStep(doc: GardenDocument) {
  const ctx = getAddPointWorkflowContext();
  const marking = getAddPointPetriRun().marking;
  if (tokensAt(marking, 'strength') <= 0) return null;
  const t = currentUserTransition(doc);
  if (t && ['accept_amber', 'redo_red', 'add_measurement_grey'].includes(t.id)) return t;
  if (ctx.strength === 'green') return null;
  return t;
}

export function renderAddPointPetriChrome(doc: GardenDocument): HTMLElement {
  const t = currentUserTransition(doc) ?? strengthUserStep(doc);
  const ctx = getAddPointWorkflowContext();
  const kind = t?.kind ?? 'user';
  const root = el('section', {
    className: `petri-add-point petri-add-point--${kind}`,
    attrs: {
      'data-testid': 'petri-add-point',
      'aria-label': glossaryById('point')?.term ?? 'Add point',
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
      text: t?.label ?? addPointNet.title,
    }),
  );

  const step = el('p', { className: 'petri-add-point__step' });
  const stepId = t?.id;

  if (!t) {
    step.textContent = 'Waiting for the app — or need at least two baseline points to list fix options.';
    root.appendChild(step);
    return root;
  }

  if (stepId === 'choose_layer') {
    step.textContent = t.does ?? glossaryById('sub-layer')?.short ?? '';
    const row = el('div', { className: 'petri-add-point__row' });
    const layers: { id: SurveyLayerRule; gloss: string }[] = [
      { id: 'baseline', gloss: 'baseline' },
      { id: 'railway', gloss: 'railway' },
      { id: 'flower_bed', gloss: 'flower-beds' },
      { id: 'tree', gloss: 'trees' },
    ];
    for (const layer of layers) {
      const g = glossaryById(layer.gloss);
      row.appendChild(
        el('button', {
          className: 'btn btn--suggested',
          text: g?.term ?? layer.id,
          attrs: {
            type: 'button',
            'data-cmd': 'petri-pick-layer',
            'data-layer-rule': layer.id,
            title: glossaryTooltip(layer.gloss),
          },
        }),
      );
    }
    root.appendChild(step);
    root.appendChild(helpForGlossaryIds(['sub-layer', 'configuration']) ?? document.createComment(''));
    root.appendChild(row);
    return root;
  }

  if (stepId === 'pick_fix_option') {
    step.textContent = glossaryById('fix-option')?.short ?? t.does ?? '';
    const row = el('div', { className: 'petri-add-point__row' });
    for (const opt of ctx.fixOptions ?? []) {
      row.appendChild(
        el('button', {
          className: 'btn btn--util',
          text: opt.label,
          attrs: {
            type: 'button',
            'data-cmd': 'petri-pick-fix',
            'data-fix-option': opt.id,
            title: glossaryTooltip('fix-option'),
          },
        }),
      );
    }
    root.appendChild(step);
    root.appendChild(helpForGlossaryIds(['fix-option', 'fix-method']) ?? document.createComment(''));
    root.appendChild(row);
    return root;
  }

  if (stepId === 'side_choice') {
    step.textContent = glossaryById('side-choice')?.short ?? t.does ?? '';
    const row = el('div', { className: 'petri-add-point__row' });
    row.appendChild(
      el('button', {
        className: 'btn btn--suggested',
        text: 'Side +',
        attrs: { type: 'button', 'data-cmd': 'petri-pick-side', 'data-side': '1' },
      }),
    );
    row.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Side −',
        attrs: { type: 'button', 'data-cmd': 'petri-pick-side', 'data-side': '-1' },
      }),
    );
    if (ctx.sideAnchorPointId) {
      row.appendChild(
        el('button', {
          className: 'btn btn--stage2',
          text: 'Continue',
          attrs: { type: 'button', 'data-cmd': 'petri-fire', 'data-transition': 'side_choice' },
        }),
      );
    }
    root.appendChild(step);
    root.appendChild(helpForGlossaryIds(['side-choice']) ?? document.createComment(''));
    root.appendChild(row);
    return root;
  }

  if (stepId === 'take_measurements') {
    step.textContent = t.does ?? glossaryById('tape-measurement')?.short ?? '';
    const tapeField = el('label', { className: 'petri-add-point__field' });
    tapeField.appendChild(
      el('span', { text: glossaryById('tape-measurement')?.term ?? 'Tape measurement (m)' }),
    );
    tapeField.appendChild(
      el('input', {
        attrs: {
          type: 'number',
          step: '0.001',
          min: '0',
          'data-field': 'petri-tape-m',
          placeholder: 'e.g. 6.42',
        },
      }),
    );
    const row = el('div', { className: 'petri-add-point__row' });
    row.appendChild(
      el('button', {
        className: 'btn btn--suggested',
        text: glossaryById('photo-click')?.term ?? 'Photo',
        attrs: { type: 'button', 'data-cmd': 'petri-camera' },
      }),
    );
    row.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Continue',
        attrs: {
          type: 'button',
          'data-cmd': 'petri-fire',
          'data-transition': 'take_measurements',
        },
      }),
    );
    root.appendChild(step);
    root.appendChild(
      helpForGlossaryIds(['tape-measurement', 'photo-click']) ?? document.createComment(''),
    );
    root.appendChild(tapeField);
    root.appendChild(row);
    return root;
  }

  if (
    stepId === 'accept_amber' ||
    stepId === 'redo_red' ||
    stepId === 'add_measurement_grey' ||
    tokensAt(getAddPointPetriRun().marking, 'strength') > 0
  ) {
    const badge = el('span', {
      className: `petri-add-point__strength ${strengthClass(ctx.strength)}`,
      text: (glossaryById(ctx.strength ?? 'grey')?.term ?? ctx.strength ?? 'grey').toUpperCase(),
    });
    step.appendChild(badge);
    step.appendChild(
      document.createTextNode(` ${ctx.strengthDetail ?? glossaryById('measurement-strength')?.short ?? ''}`),
    );
    const row = el('div', { className: 'petri-add-point__row' });

    if (ctx.strength === 'amber' || stepId === 'accept_amber') {
      const noteField = el('label', { className: 'petri-add-point__field' });
      noteField.appendChild(
        el('span', { text: glossaryById('accept-and-continue')?.term ?? 'Accept and continue' }),
      );
      noteField.appendChild(
        el('textarea', {
          attrs: {
            rows: '2',
            'data-field': 'petri-amber-note',
            placeholder: glossaryById('accepted-amber')?.short ?? '',
          },
        }),
      );
      root.appendChild(noteField);
      row.appendChild(
        el('button', {
          className: 'btn btn--suggested',
          text: glossaryById('accept-and-continue')?.term ?? 'Accept and continue',
          attrs: {
            type: 'button',
            'data-cmd': 'petri-accept-amber',
            'data-transition': 'accept_amber',
          },
        }),
      );
      row.appendChild(
        el('button', {
          className: 'btn btn--util',
          text: t.label,
          attrs: {
            type: 'button',
            'data-cmd': 'petri-fire',
            'data-transition': 'redo_red',
          },
        }),
      );
    } else if (ctx.strength === 'red' || stepId === 'redo_red') {
      row.appendChild(
        el('button', {
          className: 'btn btn--stage2',
          text: glossaryById('redo_red')?.term ?? t.label,
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
          text: t.label,
          attrs: {
            type: 'button',
            'data-cmd': 'petri-fire',
            'data-transition': 'add_measurement_grey',
          },
        }),
      );
      row.appendChild(
        el('button', {
          className: 'btn btn--suggested',
          text: glossaryById('photo-click')?.term ?? 'Photo',
          attrs: { type: 'button', 'data-cmd': 'petri-camera' },
        }),
      );
    }

    root.appendChild(step);
    root.appendChild(
      helpForGlossaryIds(['measurement-strength', 'green', 'amber', 'red', 'grey']) ??
        document.createComment(''),
    );
    root.appendChild(row);
    return root;
  }

  step.textContent = t.does ?? t.label;
  root.appendChild(step);
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
    const fired = fireAddPointUserTransition(doc, 'choose_layer');
    if (fired.error) onResult({ error: fired.error });
    else onResult({ doc: fired.doc });
    return true;
  }

  if (cmd === 'petri-pick-fix') {
    const fixOption = target.getAttribute('data-fix-option') as FixOptionId;
    selectFixOption(fixOption);
    const fired = fireAddPointUserTransition(doc, 'pick_fix_option');
    if (fired.error) onResult({ error: fired.error });
    else onResult({ doc: fired.doc });
    return true;
  }

  if (cmd === 'petri-pick-side') {
    const side = Number(target.getAttribute('data-side')) as 1 | -1;
    patchAddPointWorkflowContext({ side, sideAnchorPointId: ctxSideAnchor() });
    const fired = fireAddPointUserTransition(doc, 'side_choice');
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
    const transitionId =
      target.getAttribute('data-transition') ?? currentUserTransition(doc)?.id ?? '';
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
    const fired = fireAddPointUserTransition(doc, 'accept_amber');
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

function ctxSideAnchor(): string | undefined {
  return getAddPointWorkflowContext().sideAnchorPointId;
}

export function petriPlanTapForSide(pointId: string, doc: GardenDocument): boolean {
  const t = currentUserTransition(doc);
  if (t?.id !== 'side_choice') return false;
  patchAddPointWorkflowContext({ sideAnchorPointId: pointId });
  return true;
}
