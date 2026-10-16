import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addPointNet, initialMarking } from '../src/workflow/petri/loadNet';
import {
  enabledTransitions,
  fireTransition,
  newPetriRun,
  transitionEnabled,
} from '../src/workflow/petri/engine';
import { TRANSITION_GUARDS } from '../src/workflow/petri/guards';
import { emptyAddPointContext, type AddPointWorkflowContext } from '../src/workflow/addPoint/context';
import { emptyDocument } from '../src/model';

const addPointYaml = readFileSync(join(process.cwd(), 'workflow/add-point.net.yaml'), 'utf8');
const parsed = parse(addPointYaml) as { id: string; places: { id: string }[] };

function ctx(partial: Partial<AddPointWorkflowContext> = {}): AddPointWorkflowContext {
  return { ...emptyAddPointContext(), ...partial };
}

function docWithTwoBaselineEnds() {
  const doc = emptyDocument('Test');
  doc.baselines = [
    { id: 'bl-1', a: 'C1', b: 'C2', lengthM: 5, kind: 'tape' },
  ];
  doc.points = [
    { id: 'C1', kind: 'BL', x: 0, y: 0 },
    { id: 'C2', kind: 'BL', x: 5, y: 0 },
  ];
  return doc;
}

describe('Petri net loader', () => {
  it('loads review-add-point net with ready token', () => {
    expect(addPointNet.id).toBe('review-add-point');
    const m = initialMarking(addPointNet);
    expect(m.ready).toBe(1);
    expect(m.layer_chosen).toBe(0);
    expect(parsed.places.some((p) => p.id === 'strength')).toBe(true);
  });
});

describe('Petri engine', () => {
  it('enables choose_layer only at start', () => {
    const run = newPetriRun(addPointNet);
    const enabled = enabledTransitions(addPointNet, run.marking, ctx(), 'user');
    expect(enabled.map((t) => t.id)).toEqual(['choose_layer']);
  });

  it('fires user transitions and appends log in order', () => {
    const doc = docWithTwoBaselineEnds();
    let run = newPetriRun(addPointNet);
    let c = ctx({ layerRule: 'baseline' });
    const a = fireTransition(run, addPointNet, 'choose_layer', c, { doc });
    expect(a.error).toBeUndefined();
    run = a.run;
    expect(run.log[0]!.transitionId).toBe('choose_layer');

    const list = fireTransition(run, addPointNet, 'list_fix_options', c, { doc });
    expect(list.error).toBeUndefined();
    run = list.run;
    expect(run.log[1]!.transitionId).toBe('list_fix_options');
    expect(run.marking.fix_options).toBe(1);

    c = { ...c, fixOptionId: 'two_tapes_plus_check', sideResolved: true, twoSolutions: false };
    const pick = fireTransition(run, addPointNet, 'pick_fix_option', c, { doc });
    expect(pick.error).toBeUndefined();
    run = pick.run;
    expect(run.log[2]!.transitionId).toBe('pick_fix_option');
    expect(run.log[2]!.seq).toBe(3);
  });

  it('list_fix_options guard needs two baseline points', () => {
    const run = newPetriRun(addPointNet);
    const marking = { ...run.marking, ready: 0, layer_chosen: 1 };
    const t = addPointNet.transitions.find((x) => x.id === 'list_fix_options')!;
    expect(transitionEnabled(t, marking, ctx(), { doc: emptyDocument() })).toBe(false);
    expect(transitionEnabled(t, marking, ctx(), { doc: docWithTwoBaselineEnds() })).toBe(true);
  });

  it('strength transitions only match colour guards', () => {
    const marking = {
      ready: 0,
      layer_chosen: 0,
      fix_options: 0,
      chosen_option: 0,
      needs_side_choice: 0,
      observations: 0,
      strength: 1,
      baseline_warning: 0,
      point_done: 0,
      existing_baseline_points: 0,
    };
    const keep = addPointNet.transitions.find((t) => t.id === 'keep_green')!;
    expect(transitionEnabled(keep, marking, ctx({ strength: 'amber' }), {})).toBe(false);
    expect(transitionEnabled(keep, marking, ctx({ strength: 'green' }), {})).toBe(true);
  });

  it('exports transition guard predicates', () => {
    expect(TRANSITION_GUARDS.choose_layer(ctx(), {})).toBe(true);
    expect(TRANSITION_GUARDS.take_measurements(ctx({ fixOptionId: 'two_tapes_plus_check', sideResolved: true }), {})).toBe(
      true,
    );
    expect(TRANSITION_GUARDS.redo_red(ctx({ strength: 'red' }), {})).toBe(true);
  });
});
