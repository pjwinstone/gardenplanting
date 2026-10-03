#!/usr/bin/env node
/**
 * Build docs/FIELD_CHECKLIST_CIRCLE.pdf from docs/FIELD_CHECKLIST_CIRCLE.md.
 * A4 portrait. Regenerates the committed PDF; does not change the checklist text.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mdPath = join(root, 'docs/FIELD_CHECKLIST_CIRCLE.md');
const pdfPath = join(root, 'docs/FIELD_CHECKLIST_CIRCLE.pdf');
const chrome = process.env.CHROME_PATH || 'google-chrome';

const md = readFileSync(mdPath, 'utf8');
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Circle field test</title>
<style>
  @page { size: A4 portrait; margin: 7mm 8mm 7mm 8mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Liberation Sans", Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.22;
    color: #000;
    columns: 2;
    column-gap: 5mm;
    column-fill: auto;
  }
  h1, svg.plan, .full { column-span: all; }
  h1 {
    font-size: 18pt;
    line-height: 1.05;
    margin: 0 0 1.2mm;
  }
  h2 {
    font-size: 13pt;
    line-height: 1.1;
    margin: 2.2mm 0 0.8mm;
    break-after: avoid;
  }
  p { margin: 0 0 1.1mm; }
  ul, ol { margin: 0 0 1.2mm; padding-left: 4.8mm; }
  li { margin: 0 0 0.45mm; }
  li.tick { list-style: none; margin-left: -4.8mm; padding-left: 5.6mm; position: relative; }
  li.tick::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.45mm;
    width: 3.8mm;
    height: 3.8mm;
    border: 0.4mm solid #000;
    background: #fff;
  }
  svg.plan {
    display: block;
    width: 91mm;
    height: 73mm;
    margin: 0 auto 1mm;
    break-inside: avoid;
  }
  table.write {
    width: 100%;
    border-collapse: collapse;
    margin: 1mm 0 1.6mm;
    break-inside: avoid;
    font-size: 10pt;
  }
  table.write th, table.write td {
    border: 0.3mm solid #000;
    padding: 0.6mm 1mm;
    text-align: left;
    vertical-align: middle;
    height: 7.2mm;
  }
  table.canes th, table.canes td {
    text-align: center;
    padding: 0.5mm 0.4mm;
    font-size: 9.5pt;
  }
  table.canes th:first-child, table.canes td:first-child {
    text-align: left;
    width: 22mm;
    font-size: 10pt;
  }
  table.write th { font-weight: 700; background: #fff; }
  strong { font-weight: 700; }
</style>
</head>
<body>
${markdownToHtml(md)}
</body>
</html>
`;

const dir = mkdtempSync(join(tmpdir(), 'checklist-pdf-'));
const htmlPath = join(dir, 'checklist.html');
writeFileSync(htmlPath, html);
try {
  const profile = join(dir, 'chrome-profile');
  try {
    execFileSync(
      'timeout',
      [
        '20',
        chrome,
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--virtual-time-budget=8000',
        '--no-pdf-header-footer',
        `--user-data-dir=${profile}`,
        `--print-to-pdf=${pdfPath}`,
        `file://${htmlPath}`,
      ],
      { stdio: 'inherit' },
    );
  } catch (err) {
    if (!existsSync(pdfPath)) throw err;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const pages = pdfPageCount(readFileSync(pdfPath));
console.log(`${pdfPath} (${pages} page${pages === 1 ? '' : 's'})`);
if (pages < 1 || pages > 2) {
  console.error(`Expected 1 or 2 A4 pages, got ${pages}.`);
  process.exit(1);
}

function markdownToHtml(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (line.startsWith('<div')) {
      out.push(line);
      i += 1;
      continue;
    }
    if (line.trim() === '</div>') {
      out.push('</div>');
      i += 1;
      continue;
    }
    if (line.startsWith('<svg')) {
      const chunk = [line];
      i += 1;
      while (i < lines.length && !lines[i - 1].includes('</svg>')) {
        chunk.push(lines[i]);
        i += 1;
      }
      const svg = chunk.join('\n').replace('<svg ', '<svg class="plan" ');
      out.push(svg);
      continue;
    }
    if (line.startsWith('<table')) {
      const chunk = [line];
      i += 1;
      while (i < lines.length && !chunk[chunk.length - 1].includes('</table>')) {
        chunk.push(lines[i]);
        i += 1;
      }
      out.push(chunk.join('\n'));
      continue;
    }
    if (line.startsWith('# ')) {
      out.push(`<h1>${inline(line.slice(2))}</h1>`);
      i += 1;
      continue;
    }
    if (line.startsWith('## ')) {
      out.push(`<h2>${inline(line.slice(3))}</h2>`);
      i += 1;
      continue;
    }
    if (line.startsWith('- ')) {
      const items = [];
      while (i < lines.length && lines[i].startsWith('- ')) {
        const raw = lines[i].slice(2);
        const tick = raw.startsWith('[ ] ');
        const body = tick ? raw.slice(4) : raw;
        items.push(`<li${tick ? ' class="tick"' : ''}>${inline(body)}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\d+\. /, ''))}</li>`);
        i += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    const para = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('- ') &&
      !lines[i].startsWith('<') &&
      !/^\d+\. /.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<strong>$1</strong>');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function pdfPageCount(buf) {
  const matches = buf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 0;
}
