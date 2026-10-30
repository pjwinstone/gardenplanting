/**
 * The one engine: token markings per open net, guards with reasons, the firing rule, hierarchical
 * refinement with a nav stack and focus restore, and persistence. No automatic navigation: only
 * fire() of a user transition moves you; app transitions change data and leave the marking alone.
 */
import type { Net, NetFile, Transition } from './net';

export type Marking = Record<string, number>;
export interface GuardResult { ok: boolean; why?: string }
export type Guard = (ctx: { net: string; transition: string; arg?: string }) => GuardResult | boolean;
export type Effect = (ctx: { net: string; transition: string; arg?: string }) => void;

export interface Frame {
  net: string;
  marking: Marking;
  /** What had focus when this level opened a child (restored when the child exits). */
  focus?: string;
}

export interface Snapshot {
  revisions: Record<string, string>;
  frames: Frame[];
  log: string[];
}

export interface EnabledMove { net: string; t: Transition; ok: boolean; why?: string }

export class EngineError extends Error {}

const add = (m: Marking, p: string, k: number): void => {
  const v = (m[p] ?? 0) + k;
  if (v) m[p] = v; else delete m[p];
};

export class Engine {
  readonly file: NetFile;
  private guards: Record<string, Guard>;
  private effects: Record<string, Effect>;
  private frames: Frame[] = [];
  readonly log: string[] = [];
  private listeners = new Set<() => void>();

  constructor(file: NetFile, opts: { guards?: Record<string, Guard>; effects?: Record<string, Effect> } = {}) {
    this.file = file;
    this.guards = opts.guards ?? {};
    this.effects = opts.effects ?? {};
    this.reset();
  }

  /** Start at the root net's entry (and down through any refinement of the entry). */
  reset(): void {
    this.frames = [];
    this.open(this.file.root);
  }

  private open(netId: string): void {
    const net = this.net(netId);
    this.frames.push({ net: netId, marking: { [net.entry]: 1 } });
    this.descend();
  }

  /** If the top marking holds a refined place, open its child (one level per call chain). */
  private descend(): void {
    const top = this.top();
    const net = this.net(top.net);
    const refined = net.places.find((p) => p.refines && top.marking[p.id] && !net.exits.includes(p.id));
    if (refined) this.open(refined.refines!);
  }

  net(id: string): Net {
    const n = this.file.nets[id];
    if (!n) throw new EngineError(`no net ${id}`);
    return n;
  }

  top(): Frame { return this.frames[this.frames.length - 1]!; }
  depth(): number { return this.frames.length; }
  stack(): Frame[] { return this.frames.map((f) => ({ ...f, marking: { ...f.marking } })); }
  /** The current net and its single marked place (screens are one-token levels). */
  where(): { net: string; place: string } {
    const top = this.top();
    return { net: top.net, place: Object.keys(top.marking)[0] ?? '' };
  }
  path(): string[] { return this.frames.map((f) => `${f.net}@${Object.keys(f.marking).join('+')}`); }
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  private guard(net: string, t: Transition, arg?: string): GuardResult {
    if (!t.guard) return { ok: true };
    const g = this.guards[t.guard];
    if (!g) return { ok: false, why: `unknown guard ${t.guard}` };
    const r = g({ net, transition: t.id, arg });
    return typeof r === 'boolean' ? { ok: r } : r;
  }

  private tokensFor(m: Marking, t: Transition): boolean {
    const need: Marking = {};
    for (const p of t.from) add(need, p, 1);
    return Object.entries(need).every(([p, k]) => (m[p] ?? 0) >= k);
  }

  /** Every transition of the top net with its tokens present, with guard status and reason. */
  moves(arg?: string): EnabledMove[] {
    const top = this.top();
    const net = this.net(top.net);
    return net.transitions
      .filter((t) => !t.on_exit && this.tokensFor(top.marking, t))
      .map((t) => ({ net: net.id, t, ...this.guard(net.id, t, arg) }));
  }

  enabled(id: string, arg?: string): boolean {
    return this.moves(arg).some((m) => m.t.id === id && m.ok);
  }

  /**
   * Fire a transition of the top net. Refused (returns false, nothing changes) when it is not
   * enabled. A user move that lands the child on an exit closes the child and fires the parent's
   * on_exit transition in the same action, restoring the parent's focus.
   */
  fire(id: string, opts: { arg?: string; focus?: string } = {}): boolean {
    const top = this.top();
    const net = this.net(top.net);
    const t = net.transitions.find((x) => x.id === id && !x.on_exit);
    if (!t || !this.tokensFor(top.marking, t) || !this.guard(net.id, t, opts.arg).ok) {
      this.log.push(`refused ${net.id}.${id}`);
      return false;
    }
    this.effects[t.id]?.({ net: net.id, transition: t.id, arg: opts.arg });
    this.log.push(`${net.id}.${t.id}${opts.arg ? `(${opts.arg})` : ''}`);
    if (t.kind === 'app') { this.emit(); return true; }
    for (const p of t.from) add(top.marking, p, -1);
    for (const p of t.to) add(top.marking, p, 1);
    if (opts.focus !== undefined) top.focus = opts.focus;
    this.settle();
    this.emit();
    return true;
  }

  /** Close finished children (exit reached) and open refined places. Part of one user action. */
  private settle(): void {
    for (let guard = 0; guard < 64; guard += 1) {
      const top = this.top();
      const net = this.net(top.net);
      const exit = net.exits.find((e) => top.marking[e]);
      if (exit && this.frames.length > 1) {
        this.frames.pop();
        const parent = this.top();
        const pnet = this.net(parent.net);
        const back = pnet.transitions.find((x) => x.on_exit === exit && x.from.every((p) => parent.marking[p] && pnet.places.find((q) => q.id === p)?.refines === net.id));
        if (!back) throw new EngineError(`${pnet.id}: no on_exit for ${net.id}.${exit}`);
        this.effects[back.id]?.({ net: pnet.id, transition: back.id });
        this.log.push(`${pnet.id}.${back.id}`);
        for (const p of back.from) add(parent.marking, p, -1);
        for (const p of back.to) add(parent.marking, p, 1);
        continue;
      }
      const refined = net.places.find((p) => p.refines && top.marking[p.id]);
      if (refined && !net.exits.includes(refined.id)) { this.open(refined.refines!); continue; }
      return;
    }
    throw new EngineError('settle did not converge');
  }

  /** The focus to restore at the current level (set when it opened a child). */
  focus(): string | undefined { return this.top().focus; }
  setFocus(focus: string | undefined): void { this.top().focus = focus; }

  private emit(): void { for (const fn of this.listeners) fn(); }

  snapshot(): Snapshot {
    const revisions: Record<string, string> = {};
    for (const n of Object.values(this.file.nets)) revisions[n.id] = n.revision;
    return { revisions, frames: this.stack(), log: [...this.log] };
  }

  /** Nets whose logic changed since the snapshot was taken (warn, then Continue or Cancel). */
  changedSince(s: Snapshot): string[] {
    return Object.values(this.file.nets).filter((n) => s.revisions[n.id] !== undefined && s.revisions[n.id] !== n.revision).map((n) => n.id);
  }

  /** Put a saved run back. Frames naming unknown nets or places are dropped (land higher up). */
  restore(s: Snapshot): void {
    const frames: Frame[] = [];
    for (const f of s.frames) {
      const n = this.file.nets[f.net];
      if (!n || !Object.keys(f.marking).every((p) => n.places.some((q) => q.id === p))) break;
      frames.push({ ...f, marking: { ...f.marking } });
    }
    if (!frames.length) { this.reset(); return; }
    this.frames = frames;
    this.log.splice(0, this.log.length, ...s.log);
    this.emit();
  }
}
