import { parse } from 'yaml';
import glossaryYaml from '../../workflow/glossary.yaml?raw';

export interface GlossaryTerm {
  id: string;
  term: string;
  short: string;
  long: string;
  category?: string;
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

export function glossaryTooltip(id: string): string {
  const g = glossaryById(id);
  if (!g) return '';
  return g.short;
}

export function glossaryHelpBlock(id: string): string {
  const g = glossaryById(id);
  if (!g) return '';
  return `${g.short} ${g.long}`;
}

/** Menu accordion: term + long help (not edited — from glossary.yaml). */
export function glossaryPairsForMenu(): Array<[string, string]> {
  return allGlossaryTerms()
    .filter((t) => t.category !== 'workflow-model')
    .slice(0, 40)
    .map((t) => [t.term, t.long]);
}
