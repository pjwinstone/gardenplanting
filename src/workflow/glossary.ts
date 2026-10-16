import { parse } from 'yaml';
import glossaryYaml from '../../workflow/glossary.yaml?raw';

export interface GlossaryTerm {
  id: string;
  term: string;
  definition: string;
}

interface GlossaryDoc {
  terms: GlossaryTerm[];
}

const doc = parse(glossaryYaml) as GlossaryDoc;

const byId = new Map<string, GlossaryTerm>();
const byTerm = new Map<string, GlossaryTerm>();

for (const t of doc.terms ?? []) {
  byId.set(t.id, t);
  byTerm.set(t.term, t);
}

export function glossaryById(id: string): GlossaryTerm | undefined {
  return byId.get(id);
}

export function glossaryByTerm(term: string): GlossaryTerm | undefined {
  return byTerm.get(term);
}

export function allGlossaryTerms(): GlossaryTerm[] {
  return [...byId.values()];
}

export function glossaryPairsForMenu(): Array<[string, string]> {
  return allGlossaryTerms().map((t) => [t.term, t.definition]);
}
