/**
 * Renderer contract: what a screen shows comes only from the engine (current place, its UI
 * attributes, the enabled moves with status and reason). App code supplies values for summary
 * templates and per-move analysis text; layout and colour come from the theme (theme.css).
 */
import type { Engine } from './engine';
import { themeClass } from './theme';

export interface ButtonView {
  id: string;
  control: string;
  label: string;
  role: string;
  icon?: string;
  style?: string;
  order: number;
  enabled: boolean;
  why?: string;
  /** Short analysis: what it does / why now (from the app, else the transition text). */
  text?: string;
}

export interface ScreenView {
  net: string;
  place: string;
  screen: string;
  title: string;
  summary?: string;
  buttons: ButtonView[];
  crumbs: string[];
}

export function fillTemplate(tpl: string, values: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (values[k] !== undefined ? String(values[k]) : `{${k}}`));
}

export function describe(engine: Engine, app: { values?: Record<string, string | number>; text?: (id: string) => string | undefined; label?: (id: string) => string | undefined; style?: (id: string) => string | undefined } = {}): ScreenView {
  const { net: netId, place } = engine.where();
  const net = engine.net(netId);
  const p = net.places.find((x) => x.id === place);
  const buttons = engine.moves()
    .filter((m) => m.t.kind === 'user')
    .map((m) => ({
      id: m.t.id,
      control: m.t.control ?? m.t.id,
      label: app.label?.(m.t.id) ?? m.t.label ?? m.t.id,
      role: m.t.role ?? 'secondary',
      icon: m.t.icon,
      style: app.style?.(m.t.id) ?? m.t.style,
      order: m.t.order ?? 100,
      enabled: m.ok,
      why: m.why,
      text: app.text?.(m.t.id) ?? m.t.text,
    }))
    .sort((a, b) => a.order - b.order);
  return {
    net: netId,
    place,
    screen: p?.screen ?? 'panel',
    title: p?.title ?? net.title,
    summary: p?.summary ? fillTemplate(p.summary, app.values ?? {}) : undefined,
    buttons,
    crumbs: engine.stack().map((f) => engine.net(f.net).title),
  };
}

/** Generic DOM renderer for a button bar. Disabled buttons stay visible with their reason. */
export function renderButtons(doc: Document, buttons: ButtonView[], opts: { cmd?: (b: ButtonView) => string; only?: string[] } = {}): HTMLElement {
  const bar = doc.createElement('div');
  bar.className = 'eng-bar';
  for (const b of buttons) {
    if (opts.only && !opts.only.includes(b.id)) continue;
    const node = doc.createElement('button');
    node.type = 'button';
    node.className = themeClass(b.role, b.style);
    node.dataset.testid = b.control;
    node.dataset.transition = b.id;
    if (opts.cmd) node.dataset.cmd = opts.cmd(b);
    const head = doc.createElement('b');
    head.textContent = (b.icon ? `${b.icon} ` : '') + b.label;
    node.append(head);
    const line = b.enabled ? b.text : b.why ?? b.text;
    if (line) {
      const small = doc.createElement('span');
      small.className = 'eng-why';
      small.textContent = line;
      node.append(small);
    }
    if (!b.enabled) { node.disabled = true; node.setAttribute('aria-disabled', 'true'); }
    bar.append(node);
  }
  return bar;
}

/** data-place on the screen root, so tests can check the screen matches the marking. */
export function stampPlace(node: HTMLElement, engine: Engine): void {
  const w = engine.where();
  node.dataset.net = w.net;
  node.dataset.place = w.place;
}
