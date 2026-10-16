import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initialMarking } from '../src/workflow/petri/loadNet';
import {
  enabledTransitions,
  fireTransition,
  newPetriRun,
  transitionEnabled,
} from '../src/workflow/petri/engine';
import { GUARDS } from '../src/workflow/petri/guards';
import type { PetriNetDoc } from '../src/workflow/petri/types';
import { emptyAddPointContext, type AddPointWorkflowContext } from '../src/workflow/addPoint/context';

const addPointYaml = readFileSync(join(process.cwd(), 'workflow/add-point.net.yaml'), 'utf8');
const net = parse(addPointYaml) as PetriNetDoc;

function ctx(partial: Partial<AddPointWorkflowContext> = {}): AddPointWorkflowContext {
  return { ...emptyAddPointContext(), ...partial };
}

describe('Petri net loader', () => {
  it('loads add-point places and initial marking', () => {
    const m = initialMarking(net);
    expect(m.ready).toBe(1);
    expect(m.layer_picked).toBe(0);
  });
});

describe('Petri engine', () => {
  it('enables pick_layer_rule only at start', () => {
    const run = newPetriRun(net);
    const enabled = enabledTransitions(net, run.marking, ctx(), 'user');
    expect(enabled.map((t) => t.id)).toEqual(['pick_layer_rule']);
  });

  it('fires user transitions and appends log in order', () => {
    let run = newPetriRun(net);
    let c = ctx({ layerRule: 'baseline' });
    const a = fireTransition(run, net, 'pick_layer_rule', c);
    expect(a.error).toBeUndefined();
    run = a.run;
    expect(run.log).toHaveLength(1);
    expect(run.log[0]!.seq).toBe(1);
    expect(run.log[0]!.transitionId).toBe('pick_layer_rule');

    c = { ...c, fixOption: 'baseline_end' };
    const b = fireTransition(run, net, 'pick_fix_option', c);
    run = b.run;
    expect(run.log[1]!.seq).toBe(2);

    c = { ...c, sideAnchorPointId: 'P01' };
    const skip = enabledTransitions(net, run.marking, c, 'app');
    expect(skip.some((t) => t.id === 'skip_side_choice')).toBe(true);
    const c2 = fireTransition(run, net, 'skip_side_choice', c);
    run = c2.run;
    expect(run.log[2]!.transitionId).toBe('skip_side_choice');
  });

  it('guards block transitions without context', () => {
    const run = newPetriRun(net);
    const marking = { ...run.marking, layer_picked: 1, ready: 0 };
    const fix = net.transitions.find((t) => t.id === 'pick_fix_option')!;
    expect(transitionEnabled(fix, marking, ctx())).toBe(false);
    expect(transitionEnabled(fix, marking, ctx({ layerRule: 'tree' }))).toBe(true);
  });

  it('strength guards only allow matching accept paths', () => {
    const marking = {
      ready: 0,
      layer_picked: 0,
      fix_picked: 0,
      side_picked: 0,
      measured: 0,
      strength_ready: 1,
      committed: 0,
    };
    const green = net.transitions.find((t) => t.id === 'accept_green')!;
    expect(transitionEnabled(green, marking, ctx({ strength: 'amber' }))).toBe(false);
    expect(transitionEnabled(green, marking, ctx({ strength: 'green', draftPointId: 'P1' }))).toBe(
      true,
    );
  });

  it('exports named guard predicates', () => {
    expect(GUARDS.has_layer_rule(ctx({ layerRule: 'baseline' }))).toBe(true);
    expect(GUARDS.side_not_required(ctx({ fixOption: 'baseline_end' }))).toBe(true);
    expect(GUARDS.strength_is_red(ctx({ strength: 'red' }))).toBe(true);
  });
});
