/**
 * src/engine — generic hierarchical Petri net engine (docs: engine-design.md, Part A).
 * RULE: nothing in src/engine imports app code (tests/engine/noAppImports.test.ts).
 */
import { parse } from 'yaml';

export type ScreenKind = 'list' | 'popup' | 'camera' | 'form' | 'panel';
export type Role = 'primary' | 'secondary' | 'danger' | 'nav';

export interface Place {
  id: string;
  text?: string;
  /** Child net entered when a token lands here (hierarchical refinement). */
  refines?: string;
  screen?: ScreenKind;
  title?: string;
  /** Summary template, e.g. '{points} points · {pass} pass'. Filled from app values. */
  summary?: string;
}

export interface Transition {
  id: string;
  /** Input places (one token taken from each). */
  from: string[];
  /** Output places (one token put in each). */
  to: string[];
  /** user: a tap. app: background work, data only, never moves a token between places. */
  kind: 'user' | 'app';
  guard?: string;
  text?: string;
  /** Fires as part of the same user action when the child net of `from` reaches this exit. */
  on_exit?: string;
  /** Rendered control id (data-testid); defaults to the transition id. */
  control?: string;
  label?: string;
  role?: Role;
  icon?: string;
  order?: number;
  style?: string;
}

export interface Net {
  id: string;
  title: string;
  text?: string;
  entry: string;
  exits: string[];
  places: Place[];
  transitions: Transition[];
  /** Hash of the net's logic (places, arcs, guards, refinement). Text and UI do not count. */
  revision: string;
}

export interface NetFile {
  root: string;
  nets: Record<string, Net>;
}

const list = (v: unknown): string[] => (v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)]);

/** FNV-1a 32-bit, hex. Small and stable; enough to notice that logic changed. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function logicRevision(n: Omit<Net, 'revision'>): string {
  const logic = {
    entry: n.entry,
    exits: [...n.exits].sort(),
    places: n.places.map((p) => [p.id, p.refines ?? '']).sort(),
    transitions: n.transitions.map((t) => [t.id, t.from, t.to, t.kind, t.guard ?? '', t.on_exit ?? '']).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  };
  return fnv1a(JSON.stringify(logic));
}

export class NetLoadError extends Error {}

/** Parse a *.nets.yaml text. Throws NetLoadError on structural mistakes. */
export function loadNets(text: string): NetFile {
  const raw = parse(text) as { root?: string; nets?: Record<string, Record<string, unknown>> };
  if (!raw?.root || !raw.nets) throw new NetLoadError('a nets file needs root and nets');
  const nets: Record<string, Net> = {};
  for (const [id, r] of Object.entries(raw.nets)) {
    const places = ((r.places as Record<string, unknown>[]) ?? []).map((p) => ({ ...p, id: String(p.id) }) as Place);
    const transitions = ((r.transitions as Record<string, unknown>[]) ?? []).map((t) => {
      const kind = (t.kind ?? 'user') as 'user' | 'app';
      return { ...t, id: String(t.id), from: list(t.from), to: list(t.to), kind } as Transition;
    });
    const base = { id, title: String(r.title ?? id), text: r.text as string | undefined, entry: String(r.entry), exits: list(r.exits), places, transitions };
    nets[id] = { ...base, revision: logicRevision(base) };
  }
  const file = { root: raw.root, nets };
  const problems = validate(file);
  if (problems.length) throw new NetLoadError(problems.join('\n'));
  return file;
}

/** Load-time rules: names resolve, app transitions do not move tokens, ids unique. */
export function validate(file: NetFile): string[] {
  const out: string[] = [];
  if (!file.nets[file.root]) out.push(`root ${file.root} is not a net`);
  for (const n of Object.values(file.nets)) {
    const ids = new Set(n.places.map((p) => p.id));
    if (ids.size !== n.places.length) out.push(`${n.id}: duplicate place id`);
    if (!ids.has(n.entry)) out.push(`${n.id}: entry ${n.entry} is not a place`);
    for (const e of n.exits) if (!ids.has(e)) out.push(`${n.id}: exit ${e} is not a place`);
    for (const p of n.places) if (p.refines && !file.nets[p.refines]) out.push(`${n.id}.${p.id}: refines unknown net ${p.refines}`);
    const tids = new Set<string>();
    for (const t of n.transitions) {
      if (tids.has(t.id)) out.push(`${n.id}: duplicate transition ${t.id}`);
      tids.add(t.id);
      if (!t.from.length) out.push(`${n.id}.${t.id}: no input place`);
      for (const p of [...t.from, ...t.to]) if (!ids.has(p)) out.push(`${n.id}.${t.id}: unknown place ${p}`);
      if (t.kind === 'app' && JSON.stringify([...t.from].sort()) !== JSON.stringify([...t.to].sort())) out.push(`${n.id}.${t.id}: app transitions may only change data, not the place`);
      if (t.on_exit) {
        const src = n.places.find((p) => p.id === t.from[0]);
        const child = src?.refines ? file.nets[src.refines] : undefined;
        if (!child) out.push(`${n.id}.${t.id}: on_exit needs a refined input place`);
        else if (!child.exits.includes(t.on_exit)) out.push(`${n.id}.${t.id}: ${t.on_exit} is not an exit of ${child.id}`);
      }
    }
  }
  return out;
}
