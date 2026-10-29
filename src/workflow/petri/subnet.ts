/**
 * Nested sub-nets (workflow/nets/*.nets.yaml). Any place can be refined by a child net with an
 * entry place and exit places, to any depth. One token per net (the place you are on); a
 * navigation stack holds one frame per open level, so Back pops one level and focus goes back to
 * what you were on. Only `user` transitions move you; `auto` ones are background work.
 */
import { parse } from 'yaml';

export interface SubNetPlace {
  id: string;
  /** Child net that refines this place (entered at its entry, left from one of its exits). */
  refines?: string;
  /** Black box (camera, tap screen, the rest of the app): controls live outside this branch. */
  external?: boolean;
}

export interface SubNetTransition {
  id: string;
  from: string;
  to: string;
  user?: boolean;
  auto?: boolean;
  external?: boolean;
  /** data-testid of the button that fires it; `{id}` stands for any point id. */
  control?: string;
  guard?: string;
  /** Fires when the child net of `from` reaches this exit place. */
  child_exit?: string;
}

export interface SubNet {
  id: string;
  title: string;
  level: number;
  entry: string;
  exits: string[];
  places: SubNetPlace[];
  transitions: SubNetTransition[];
}

export interface SubNetFile {
  root: string;
  nets: Record<string, SubNet>;
}

export function loadSubNets(text: string): SubNetFile {
  const raw = parse(text) as { root: string; nets: Record<string, Omit<SubNet, 'id'>> };
  const nets: Record<string, SubNet> = {};
  for (const [id, n] of Object.entries(raw.nets)) nets[id] = { ...n, id };
  return { root: raw.root, nets };
}

/** Transitions leaving `place` whose guard holds (guards default to true). */
export function enabledAt(net: SubNet, place: string, guard: (name: string) => boolean = () => true): SubNetTransition[] {
  return net.transitions.filter((t) => t.from === place && (!t.guard || guard(t.guard)));
}

/** Fire one transition. Only user transitions move the token; auto ones never navigate. */
export function fire(net: SubNet, place: string, id: string): string {
  const t = net.transitions.find((x) => x.id === id && x.from === place);
  if (!t) throw new Error(`${net.id}: ${id} is not enabled at ${place}`);
  return t.auto ? place : t.to;
}

/** Every place reachable from the entry (one token per net, so a marking is a place). */
export function reachablePlaces(net: SubNet): string[] {
  const seen = new Set([net.entry]);
  const todo = [net.entry];
  while (todo.length) {
    const p = todo.pop()!;
    for (const t of net.transitions.filter((x) => x.from === p && !x.auto)) {
      if (!seen.has(t.to)) { seen.add(t.to); todo.push(t.to); }
    }
  }
  return [...seen];
}

export interface NetProblem { net: string; place: string; problem: string }

/**
 * Structural check of one net: every refinement names a net, every reachable place can reach an
 * exit, a non-exit place has a user way out, every user transition has a control (or is a black
 * box / a child exit), and no auto transition moves the token.
 */
export function checkSubNet(file: SubNetFile, net: SubNet): NetProblem[] {
  const out: NetProblem[] = [];
  const ids = new Set(net.places.map((p) => p.id));
  const bad = (place: string, problem: string) => out.push({ net: net.id, place, problem });
  for (const p of net.places) if (p.refines && !file.nets[p.refines]) bad(p.id, `refines unknown net ${p.refines}`);
  for (const t of net.transitions) {
    if (!ids.has(t.from) || !ids.has(t.to)) bad(t.from, `${t.id} uses an unknown place`);
    if (t.auto && t.from !== t.to) bad(t.from, `auto ${t.id} navigates (${t.from} -> ${t.to})`);
    if (!t.auto && !t.user) bad(t.from, `${t.id} moves you but is not fired by you`);
    if (t.user && !t.external && !t.control && !t.child_exit) bad(t.from, `${t.id} has no control`);
    if (t.child_exit) {
      const child = file.nets[net.places.find((p) => p.id === t.from)?.refines ?? ''];
      if (!child) bad(t.from, `${t.id}: ${t.from} has no child net`);
      else if (!child.exits.includes(t.child_exit)) bad(t.from, `${t.id}: ${t.child_exit} is not an exit of ${child.id}`);
    }
  }
  for (const e of [net.entry, ...net.exits]) if (!ids.has(e)) bad(e, 'entry/exit not a place');
  for (const p of reachablePlaces(net)) {
    const outs = net.transitions.filter((t) => t.from === p && t.user);
    if (!net.exits.includes(p) && outs.length === 0) bad(p, 'dead end: no user transition out');
    const seen = new Set([p]);
    const todo = [p];
    let ok = net.exits.includes(p);
    while (todo.length && !ok) {
      const q = todo.pop()!;
      for (const t of net.transitions.filter((x) => x.from === q && !x.auto)) {
        if (net.exits.includes(t.to)) ok = true;
        if (!seen.has(t.to)) { seen.add(t.to); todo.push(t.to); }
      }
    }
    if (!ok) bad(p, 'no way back to an exit');
  }
  return out;
}

/** All nets below `id` (itself included), depth first. */
export function netsBelow(file: SubNetFile, id = file.root, seen = new Set<string>()): SubNet[] {
  const net = file.nets[id];
  if (!net || seen.has(id)) return [];
  seen.add(id);
  return [net, ...net.places.flatMap((p) => (p.refines ? netsBelow(file, p.refines, seen) : []))];
}

export interface NavFrame { net: string; place: string; focus?: string }

/** One frame per open level. Push on entering a child, pop on Back / exit; focus comes back. */
export class NavStack {
  private frames: NavFrame[] = [];
  push(frame: NavFrame): void { this.frames.push(frame); }
  pop(): NavFrame | undefined { return this.frames.pop(); }
  top(): NavFrame | undefined { return this.frames[this.frames.length - 1]; }
  depth(): number { return this.frames.length; }
  /** Pop down to (and including) the newest frame of `net`; returns that frame. */
  popTo(net: string): NavFrame | undefined {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i]!.net === net) {
        const f = this.frames[i];
        this.frames = this.frames.slice(0, i);
        return f;
      }
    }
    return undefined;
  }
  snapshot(): NavFrame[] { return this.frames.map((f) => ({ ...f })); }
  clear(): void { this.frames = []; }
}
