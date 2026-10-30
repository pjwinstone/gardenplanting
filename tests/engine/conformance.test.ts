// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Engine, loadNets, NetLoadError, checkNet, checkFile, describe as view, renderButtons, toMarkdown, renderHierarchy, themeClass, fnv1a } from '../../src/engine';

const Y = (s: string) => loadNets(s);
const simple = `
root: a
nets:
  a:
    entry: p
    exits: [z]
    places: [{id: p, title: Start, screen: list, summary: "{n} things"}, {id: q}, {id: z}]
    transitions:
      - {id: go, from: p, to: q, label: Go, role: primary, icon: "+", order: 1}
      - {id: alt, from: p, to: z, label: Alt, role: nav, order: 2, guard: allowed}
      - {id: done, from: q, to: z}
      - {id: tick, from: p, to: p, kind: app}
`;

describe('firing rule', () => {
  it('moves the token on a user transition and logs it', () => {
    const e = new Engine(Y(simple), { guards: { allowed: () => true } });
    expect(e.where()).toEqual({ net: 'a', place: 'p' });
    expect(e.fire('go')).toBe(true);
    expect(e.where().place).toBe('q');
    expect(e.log).toContain('a.go');
  });
  it('refuses a move whose tokens are missing; nothing changes', () => {
    const e = new Engine(Y(simple));
    expect(e.fire('done')).toBe(false);
    expect(e.where().place).toBe('p');
    expect(e.log).toContain('refused a.done');
  });
  it('app transitions run the effect but never move the token', () => {
    let ran = 0;
    const e = new Engine(Y(simple), { effects: { tick: () => { ran += 1; } } });
    expect(e.fire('tick')).toBe(true);
    expect(ran).toBe(1);
    expect(e.where().place).toBe('p');
  });
  it('rejects at load an app transition that would move a token', () => {
    expect(() => Y(simple.replace('to: p, kind: app', 'to: q, kind: app'))).toThrow(NetLoadError);
  });
  it('rejects unknown places and refinements', () => {
    expect(() => Y(simple.replace('to: z}', 'to: nowhere}'))).toThrow(/unknown place/);
    expect(() => Y(simple.replace('{id: q}', '{id: q, refines: ghost}'))).toThrow(/unknown net/);
  });
});

describe('guards', () => {
  it('a false guard disables with its reason and refuses to fire', () => {
    const e = new Engine(Y(simple), { guards: { allowed: () => ({ ok: false, why: 'Not yet' }) } });
    const alt = e.moves().find((m) => m.t.id === 'alt')!;
    expect(alt.ok).toBe(false);
    expect(alt.why).toBe('Not yet');
    expect(e.fire('alt')).toBe(false);
  });
  it('an unknown guard is false, with a reason', () => {
    const e = new Engine(Y(simple));
    expect(e.moves().find((m) => m.t.id === 'alt')!.why).toMatch(/unknown guard/);
  });
});

describe('conflict and concurrency', () => {
  it('conflict: firing one choice disables the other', () => {
    const e = new Engine(Y(simple), { guards: { allowed: () => true } });
    expect(e.enabled('go') && e.enabled('alt')).toBe(true);
    e.fire('go');
    expect(e.enabled('alt')).toBe(false);
  });
  it('fork/join: both branches must finish before the join fires', () => {
    const f = Y(`
root: f
nets:
  f:
    entry: s
    exits: [end]
    places: [{id: s}, {id: a1}, {id: a2}, {id: b1}, {id: b2}, {id: end}]
    transitions:
      - {id: fork, from: s, to: [a1, b1]}
      - {id: a, from: a1, to: a2}
      - {id: b, from: b1, to: b2}
      - {id: join, from: [a2, b2], to: end}
`);
    const e = new Engine(f);
    e.fire('fork');
    expect(e.stack()[0]!.marking).toEqual({ a1: 1, b1: 1 });
    e.fire('a');
    expect(e.fire('join')).toBe(false);
    e.fire('b');
    expect(e.fire('join')).toBe(true);
    expect(checkNet(f, f.nets.f!).problems).toEqual([]);
  });
});

const nested = `
root: top
nets:
  top:
    entry: hub
    exits: [out]
    places: [{id: hub}, {id: inside, refines: mid}, {id: out}]
    transitions:
      - {id: open, from: hub, to: inside}
      - {id: back, from: inside, to: hub, on_exit: closed}
      - {id: leave, from: hub, to: out}
  mid:
    entry: m0
    exits: [closed]
    places: [{id: m0}, {id: deep, refines: leaf}, {id: closed}]
    transitions:
      - {id: dive, from: m0, to: deep}
      - {id: deep_done, from: deep, to: m0, on_exit: fin}
      - {id: close, from: m0, to: closed}
  leaf:
    entry: l0
    exits: [fin, gone]
    places: [{id: l0}, {id: fin}, {id: gone}]
    transitions:
      - {id: finish, from: l0, to: fin}
      - {id: abandon, from: l0, to: gone}
      - {id: wait, from: l0, to: l0, kind: app}
`;

describe('refinement and the nav stack', () => {
  it('entering a refined place opens the child at its entry, to any depth', () => {
    const e = new Engine(Y(nested.replace('exits: [fin, gone]', 'exits: [fin]').replace('      - {id: abandon, from: l0, to: gone}\n', '').replace(', {id: gone}', '')));
    e.fire('open', { focus: 'row7' });
    expect(e.where()).toEqual({ net: 'mid', place: 'm0' });
    e.fire('dive');
    expect(e.depth()).toBe(3);
    expect(e.path()).toEqual(['top@inside', 'mid@deep', 'leaf@l0']);
  });
  it('reaching a child exit closes it, fires the parent on_exit, and keeps the parent focus', () => {
    const e = new Engine(Y(nested.replace('exits: [fin, gone]', 'exits: [fin]').replace('      - {id: abandon, from: l0, to: gone}\n', '').replace(', {id: gone}', '')));
    e.fire('open', { focus: 'row7' });
    e.fire('dive');
    e.fire('finish');
    expect(e.where()).toEqual({ net: 'mid', place: 'm0' });
    e.fire('close');
    expect(e.where()).toEqual({ net: 'top', place: 'hub' });
    expect(e.focus()).toBe('row7');
  });
  it('an exit with no on_exit in the parent fails loudly at load', () => {
    expect(() => Y(nested.replace('on_exit: fin', 'on_exit: nope'))).toThrow(/not an exit/);
  });
  it('app transitions in a child never pop the level', () => {
    const e = new Engine(Y(nested.replace('exits: [fin, gone]', 'exits: [fin]').replace('      - {id: abandon, from: l0, to: gone}\n', '').replace(', {id: gone}', '')));
    e.fire('open'); e.fire('dive');
    e.fire('wait');
    expect(e.depth()).toBe(3);
  });
});

describe('persistence', () => {
  const file = () => Y(nested.replace('exits: [fin, gone]', 'exits: [fin]').replace('      - {id: abandon, from: l0, to: gone}\n', '').replace(', {id: gone}', ''));
  it('round-trips the stack, marking, focus and log', () => {
    const a = new Engine(file());
    a.fire('open', { focus: 'x' }); a.fire('dive');
    const s = JSON.parse(JSON.stringify(a.snapshot()));
    const b = new Engine(file());
    b.restore(s);
    expect(b.path()).toEqual(a.path());
    expect(b.changedSince(s)).toEqual([]);
    b.fire('finish'); b.fire('close');
    expect(b.focus()).toBe('x');
  });
  it('a logic change bumps the revision; text and UI changes do not', () => {
    const base = file();
    const textOnly = Y(nested.replace('exits: [fin, gone]', 'exits: [fin]').replace('      - {id: abandon, from: l0, to: gone}\n', '').replace(', {id: gone}', '').replace('{id: open, from: hub, to: inside}', '{id: open, from: hub, to: inside, label: Open it, text: Hello}'));
    expect(textOnly.nets.top!.revision).toBe(base.nets.top!.revision);
    const logic = Y(nested.replace('{id: leave, from: hub, to: out}', '{id: leave, from: hub, to: out, guard: g}'));
    expect(logic.nets.top!.revision).not.toBe(base.nets.top!.revision);
    const old = new Engine(base).snapshot();
    expect(new Engine(logic).changedSince(old)).toContain('top');
  });
  it('a stale frame (net or place gone) lands higher up', () => {
    const e = new Engine(file());
    e.restore({ revisions: {}, frames: [{ net: 'top', marking: { inside: 1 } }, { net: 'mid', marking: { vanished: 1 } }], log: [] });
    expect(e.path()).toEqual(['top@inside']);
  });
  it('fnv1a is stable', () => { expect(fnv1a('abc')).toBe('1a47e90b'); });
});

describe('soundness checker', () => {
  it('passes a sound net and every net of a nested file', () => {
    expect(checkFile(Y(simple))).toEqual([]);
    expect(checkFile(Y(nested))).toEqual([]);
  });
  it('finds a dead end, a trap and a dead transition', () => {
    const f = Y(`
root: n
nets:
  n:
    entry: a
    exits: [z]
    places: [{id: a}, {id: b}, {id: c}, {id: d}, {id: z}]
    transitions:
      - {id: ab, from: a, to: b}
      - {id: az, from: a, to: z}
      - {id: cd, from: c, to: d}
      - {id: bb, from: b, to: b}
`);
    const p = checkNet(f, f.nets.n!).problems.map((x) => x.problem);
    expect(p.some((x) => x.startsWith('trap'))).toBe(true);
    expect(p).toContain('dead transition: never enabled');
    const g = Y(`
root: n
nets:
  n:
    entry: a
    exits: [z]
    places: [{id: a}, {id: b}, {id: z}]
    transitions:
      - {id: ab, from: a, to: b}
      - {id: az, from: a, to: z}
`);
    expect(checkNet(g, g.nets.n!).problems.map((x) => x.problem)).toContain('dead end: no user move and not an exit');
  });
  it('finds an unbounded net', () => {
    const f = Y(`
root: n
nets:
  n:
    entry: a
    exits: [z]
    places: [{id: a}, {id: z}]
    transitions:
      - {id: grow, from: a, to: [a, a]}
      - {id: az, from: a, to: z}
`);
    expect(checkNet(f, f.nets.n!).problems.some((x) => x.problem.startsWith('unbounded'))).toBe(true);
  });
});

describe('renderer contract and theme', () => {
  it('describes the screen from the marking: attributes, order, status, reasons, summary', () => {
    const e = new Engine(Y(simple), { guards: { allowed: () => ({ ok: false, why: 'Needs 3' }) } });
    const v = view(e, { values: { n: 4 }, text: (id) => (id === 'go' ? 'Go now' : undefined) });
    expect(v).toMatchObject({ net: 'a', place: 'p', screen: 'list', title: 'Start', summary: '4 things' });
    expect(v.buttons.map((b) => b.id)).toEqual(['go', 'alt']);
    expect(v.buttons[1]).toMatchObject({ enabled: false, why: 'Needs 3', role: 'nav' });
    const bar = renderButtons(document, v.buttons, { cmd: (b) => `x-${b.id}` });
    const btns = bar.querySelectorAll('button');
    expect(btns).toHaveLength(2);
    expect(btns[0]!.className).toBe('eng-btn eng-r-primary');
    expect(btns[0]!.textContent).toBe('+ GoGo now');
    expect(btns[1]!.disabled).toBe(true);
    expect(btns[1]!.textContent).toContain('Needs 3');
  });
  it('maps role and style tokens to theme classes', () => {
    expect(themeClass('danger', 'bad')).toBe('eng-btn eng-r-danger eng-s-bad');
    expect(themeClass('weird', 'nope')).toBe('eng-btn eng-r-secondary');
  });
  it('generates docs and an expandable Help view marking where you are', () => {
    const f = Y(nested);
    expect(toMarkdown(f)).toContain('| dive (user) |');
    const h = renderHierarchy(document, f, { nets: ['top', 'mid'], net: 'mid', place: 'm0' });
    expect(h.querySelector('[data-testid="eng-help-here"]')!.textContent).toContain('m0');
    expect(h.querySelectorAll('details')).toHaveLength(3);
  });
});
