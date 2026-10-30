/** Per-net soundness: no trap, exit reachable everywhere, bounded, no dead transitions. */
import type { Marking } from './engine';
import type { Net, NetFile } from './net';

export interface Problem { net: string; where: string; problem: string }

const key = (m: Marking): string => Object.entries(m).filter(([, v]) => v).sort().map(([p, v]) => `${p}:${v}`).join(',');

/**
 * Explore one net's markings (guards assumed true: a guard can only remove moves, and each
 * guarded move has a reason shown). Child nets are checked on their own, so a refined place is
 * treated as able to reach its parent's on_exit transitions.
 */
export function checkNet(_file: NetFile, net: Net, opts: { bound?: number; maxStates?: number } = {}): { problems: Problem[]; markings: Marking[] } {
  const bound = opts.bound ?? 1;
  const max = opts.maxStates ?? 5000;
  const problems: Problem[] = [];
  const bad = (where: string, problem: string) => problems.push({ net: net.id, where, problem });
  const start: Marking = { [net.entry]: 1 };
  const seen = new Map<string, Marking>([[key(start), start]]);
  const edges = new Map<string, string[]>();
  const fired = new Set<string>();
  const todo = [start];
  while (todo.length) {
    const m = todo.pop()!;
    const k = key(m);
    const out: string[] = [];
    if (net.exits.some((e) => m[e])) { edges.set(k, out); continue; }
    for (const t of net.transitions) {
      if (t.kind === 'app') { if (t.from.every((p) => m[p])) fired.add(t.id); continue; }
      const need: Marking = {};
      for (const p of t.from) need[p] = (need[p] ?? 0) + 1;
      if (!Object.entries(need).every(([p, v]) => (m[p] ?? 0) >= v)) continue;
      fired.add(t.id);
      const n: Marking = { ...m };
      for (const p of t.from) n[p] = (n[p] ?? 0) - 1;
      for (const p of t.to) n[p] = (n[p] ?? 0) + 1;
      for (const p of Object.keys(n)) if (!n[p]) delete n[p];
      if (Object.values(n).some((v) => v > bound)) { bad(k, `unbounded: ${t.id} exceeds ${bound} token(s)`); continue; }
      const nk = key(n);
      out.push(nk);
      if (!seen.has(nk)) {
        if (seen.size >= max) { bad(k, `more than ${max} markings`); break; }
        seen.set(nk, n);
        todo.push(n);
      }
    }
    edges.set(k, out);
    if (!out.length) bad(k, 'dead end: no user move and not an exit');
  }
  // Exit reachable from every marking (backwards closure from exit markings).
  // A net with no exits (the app's root) must always be able to get back to its entry.
  const home = (m: Marking) => (net.exits.length ? net.exits.some((e) => m[e]) : key(m) === key(start));
  const good = new Set([...seen.entries()].filter(([, m]) => home(m)).map(([k]) => k));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [k, out] of edges) if (!good.has(k) && out.some((o) => good.has(o))) { good.add(k); grew = true; }
  }
  for (const k of seen.keys()) if (!good.has(k)) bad(k, 'trap: exit not reachable');
  for (const t of net.transitions) if (!t.on_exit && !fired.has(t.id)) bad(t.id, 'dead transition: never enabled');
  for (const t of net.transitions) if (t.on_exit && !t.from.some((p) => [...seen.values()].some((m) => m[p]))) bad(t.id, 'dead transition: its child is never opened');
  return { problems, markings: [...seen.values()] };
}

export function checkFile(file: NetFile, opts?: { bound?: number }): Problem[] {
  return Object.values(file.nets).flatMap((n) => checkNet(file, n, opts).problems);
}
