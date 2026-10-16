import { parse } from 'yaml';
import addPointYaml from '../../../workflow/add-point.net.yaml?raw';
import type { PetriNetDoc, PetriTransition, TransitionKind } from './types';

interface RawTransition {
  id: string;
  title: string;
  user?: boolean;
  consume?: string[];
  produce?: string[];
  reads?: string[];
  guard?: string;
  does?: string;
}

interface RawNet {
  id: string;
  title: string;
  revision: number;
  places: Array<{ id: string; label?: string }>;
  transitions: RawTransition[];
}

function arcs(list: string[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of list ?? []) out[id] = (out[id] ?? 0) + 1;
  return out;
}

function normalizeTransition(raw: RawTransition): PetriTransition {
  const kind: TransitionKind = raw.user ? 'user' : 'app';
  return {
    id: raw.id,
    inputs: arcs(raw.consume),
    outputs: arcs(raw.produce),
    kind,
    label: raw.title,
    guardNote: typeof raw.guard === 'string' ? raw.guard : undefined,
    does: raw.does,
  } satisfies PetriTransition;
}

function normalizeNet(raw: RawNet): PetriNetDoc {
  const placeIds = new Set(raw.places.map((p) => p.id));
  const initial: Record<string, number> = {};
  for (const p of raw.places) initial[p.id] = 0;
  if (placeIds.has('ready')) initial.ready = 1;

  return {
    id: raw.id,
    title: raw.title,
    revision: raw.revision,
    places: raw.places.map((p) => ({ id: p.id, label: p.label })),
    initial,
    transitions: raw.transitions.map(normalizeTransition),
  };
}

export const addPointNet: PetriNetDoc = normalizeNet(parse(addPointYaml) as RawNet);

export function initialMarking(net: PetriNetDoc): Record<string, number> {
  const m: Record<string, number> = {};
  for (const p of net.places) m[p.id] = 0;
  for (const [id, tokens] of Object.entries(net.initial ?? {})) {
    m[id] = tokens;
  }
  return m;
}
