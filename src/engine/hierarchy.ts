/** The net hierarchy is the documentation: an expandable view and context Help, from the YAML. */
import type { Net, NetFile } from './net';

export interface HelpNode { net: Net; children: HelpNode[] }

export function tree(file: NetFile, id = file.root, seen = new Set<string>()): HelpNode {
  const net = file.nets[id]!;
  seen.add(id);
  const children = net.places.filter((p) => p.refines && !seen.has(p.refines)).map((p) => tree(file, p.refines!, seen));
  return { net, children };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function netMd(n: Net, depth: number): string[] {
  const h = '#'.repeat(Math.min(depth + 2, 6));
  const out = [`${h} ${n.title} (\`${n.id}\`, rev ${n.revision})`, '', n.text ?? '', '', '| Place | Screen | What it is |', '|---|---|---|'];
  for (const p of n.places) out.push(`| ${p.id}${p.id === n.entry ? ' (entry)' : ''}${n.exits.includes(p.id) ? ' (exit)' : ''}${p.refines ? ` → ${p.refines}` : ''} | ${p.screen ?? ''} | ${p.text ?? ''} |`);
  out.push('', '| Move | Button | From → To | Guard | What it does |', '|---|---|---|---|---|');
  for (const t of n.transitions) out.push(`| ${t.id} (${t.kind}) | ${t.icon ? `${t.icon} ` : ''}${t.label ?? ''} | ${t.from.join('+')} → ${t.to.join('+')}${t.on_exit ? ` (child exit ${t.on_exit})` : ''} | ${t.guard ?? ''} | ${t.text ?? ''} |`);
  out.push('');
  return out;
}

export function toMarkdown(file: NetFile, title = 'Net hierarchy'): string {
  const out = [`# ${title}`, '', '_Generated from the nets YAML. Do not edit by hand._', ''];
  const walk = (node: HelpNode, d: number) => { out.push(...netMd(node.net, d)); node.children.forEach((c) => walk(c, d + 1)); };
  walk(tree(file), 0);
  return out.join('\n');
}

/** Expandable in-app view. `here` marks the current net/place; its branch is open. */
export function renderHierarchy(doc: Document, file: NetFile, here?: { nets: string[]; net: string; place: string }): HTMLElement {
  const root = doc.createElement('div');
  root.className = 'eng-help';
  root.dataset.testid = 'eng-help';
  const walk = (node: HelpNode, parent: HTMLElement) => {
    const n = node.net;
    const d = doc.createElement('details');
    d.dataset.net = n.id;
    if (!here || here.nets.includes(n.id)) d.open = true;
    const s = doc.createElement('summary');
    s.innerHTML = `<b>${esc(n.title)}</b> <small>rev ${n.revision}</small>`;
    d.append(s);
    if (n.text) { const p = doc.createElement('p'); p.textContent = n.text; d.append(p); }
    const ul = doc.createElement('ul');
    for (const p of n.places) {
      const li = doc.createElement('li');
      if (here && here.net === n.id && here.place === p.id) { li.className = 'eng-here'; li.dataset.testid = 'eng-help-here'; }
      li.textContent = `${p.title ?? p.id}${p.text ? ` — ${p.text}` : ''}`;
      const moves = n.transitions.filter((t) => t.from.includes(p.id) && t.kind === 'user' && !t.on_exit);
      if (moves.length) {
        const mu = doc.createElement('ul');
        for (const t of moves) {
          const mi = doc.createElement('li');
          mi.textContent = `${t.icon ? `${t.icon} ` : ''}${t.label ?? t.id}${t.text ? `: ${t.text}` : ''}${t.guard ? ` (only when ${t.guard})` : ''}`;
          mu.append(mi);
        }
        li.append(mu);
      }
      ul.append(li);
    }
    d.append(ul);
    node.children.forEach((c) => walk(c, d));
    parent.append(d);
  };
  walk(tree(file), root);
  return root;
}
