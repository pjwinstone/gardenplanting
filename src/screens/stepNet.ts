/**
 * Small step net for the rebuilt screens (workflow/point.net.yaml). Each user step is one roller
 * row. A step fires when its input place has a token and its guard gives no reason; firing moves
 * the token on. The fired list is the log: the marking is always a replay of it, so editing an
 * earlier step drops the later ones (they show again as not done).
 */
import { parse } from 'yaml';
import pointYaml from '../../workflow/point.net.yaml?raw';

export type Branch = 'any' | 'base' | 'photo';

export interface NetStep {
  id: string;
  branch: Branch;
  title: string;
  needs: string;
  consume: string[];
  produce?: string[];
  choice?: Record<string, string[]>;
  reasons: Record<string, string>;
}

export interface StepNet {
  id: string;
  title: string;
  revision: number;
  places: { id: string; label?: string }[];
  steps: NetStep[];
  text: Record<string, string>;
  hints: Record<string, string>;
}

export function loadStepNet(yaml: string): StepNet {
  const raw = parse(yaml) as Partial<StepNet>;
  return {
    id: raw.id ?? 'net',
    title: raw.title ?? '',
    revision: raw.revision ?? 1,
    places: raw.places ?? [],
    steps: (raw.steps ?? []).map((s) => ({ ...s, branch: s.branch ?? 'any', reasons: s.reasons ?? {} })),
    text: raw.text ?? {},
    hints: raw.hints ?? {},
  };
}

export const pointNet: StepNet = loadStepNet(pointYaml);

/** Wording from the net only. Unknown keys show the key so a test can catch them. */
export function t(net: StepNet, key: string, vars: Record<string, string | number> = {}): string {
  const s = net.text[key] ?? net.hints[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export interface FiredStep {
  id: string;
  choice?: string;
}

export type Marking = Record<string, number>;

export function replay(net: StepNet, fired: FiredStep[]): Marking {
  const m: Marking = { ready: 1 };
  for (const f of fired) {
    const step = net.steps.find((s) => s.id === f.id);
    if (!step) continue;
    for (const p of step.consume) m[p] = (m[p] ?? 0) - 1;
    const out = step.choice ? step.choice[f.choice ?? ''] ?? [] : step.produce ?? [];
    for (const p of out) m[p] = (m[p] ?? 0) + 1;
  }
  return m;
}

export function hasTokens(net: StepNet, fired: FiredStep[], stepId: string): boolean {
  const step = net.steps.find((s) => s.id === stepId);
  if (!step) return false;
  const m = replay(net, fired);
  return step.consume.every((p) => (m[p] ?? 0) > 0);
}

/** Roller rows for the chosen branch (before a choice only the common steps show, then the branch). */
export function rowsFor(net: StepNet, branch: Branch | undefined): NetStep[] {
  return net.steps.filter((s) => s.branch === 'any' || (branch && s.branch === branch));
}

/** Fire (or re-fire) a step: drops any later fired steps, then appends this one. */
export function fireStep(net: StepNet, fired: FiredStep[], stepId: string, choice?: string): FiredStep[] {
  const at = fired.findIndex((f) => f.id === stepId);
  const before = at >= 0 ? fired.slice(0, at) : fired;
  if (!hasTokens(net, before, stepId)) return fired;
  return [...before, choice ? { id: stepId, choice } : { id: stepId }];
}

/** Undo a step and everything after it (an input on it was edited). */
export function unfireFrom(fired: FiredStep[], stepId: string): FiredStep[] {
  const at = fired.findIndex((f) => f.id === stepId);
  return at >= 0 ? fired.slice(0, at) : fired;
}
