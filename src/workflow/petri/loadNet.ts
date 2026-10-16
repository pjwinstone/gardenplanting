import { parse } from 'yaml';
import addPointYaml from '../../../workflow/add-point.net.yaml?raw';
import type { PetriNetDoc } from './types';

function assertNet(doc: PetriNetDoc): PetriNetDoc {
  if (!doc.activity || !doc.transitions?.length) {
    throw new Error('Invalid Petri net document');
  }
  return doc;
}

export const addPointNet: PetriNetDoc = assertNet(parse(addPointYaml) as PetriNetDoc);

export function initialMarking(net: PetriNetDoc): Record<string, number> {
  const m: Record<string, number> = {};
  for (const p of net.places) m[p.id] = 0;
  for (const [id, tokens] of Object.entries(net.initial ?? {})) {
    m[id] = tokens;
  }
  return m;
}
