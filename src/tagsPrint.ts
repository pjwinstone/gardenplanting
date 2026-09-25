/** A4 print tags: rod belts + FNC01–04 (+ how to wrap). IDs match document model. */

import type { GardenDocument } from './model';

const ROD_IDS = ['A1', 'A2', 'A0', 'B1', 'B2', 'B0'] as const;

/**
 * Rod belt: ~100 mm tall, ~140 mm + 10 mm overlap wrap.
 * Pattern: black 15 / white 20 / black 15 mm horizontal bands.
 * Label under the white belt.
 */
function rodBelt(id: string): string {
  // At 96 dpi-ish for screen; print CSS uses mm. Use mm units in SVG.
  const wrapW = 150; // 140 + 10 overlap
  const h = 100;
  return `
  <div class="tag-belt" data-id="${id}">
    <svg viewBox="0 0 ${wrapW} ${h}" width="150mm" height="100mm" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${wrapW}" height="15" fill="#000"/>
      <rect x="0" y="15" width="${wrapW}" height="20" fill="#fff" stroke="#000" stroke-width="0.5"/>
      <rect x="0" y="35" width="${wrapW}" height="15" fill="#000"/>
      <rect x="0" y="50" width="${wrapW}" height="50" fill="#fff" stroke="#000" stroke-width="0.4"/>
      <text x="${wrapW / 2}" y="28" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="14" font-weight="700" fill="#000">${id}</text>
      <text x="${wrapW / 2}" y="78" text-anchor="middle" font-family="Georgia, serif" font-size="10" fill="#000">Garden Survey · toilet-roll belt</text>
      <text x="4" y="94" font-family="monospace" font-size="7" fill="#000">← overlap 10 mm</text>
    </svg>
  </div>`;
}

function fenceDisc(id: string): string {
  return `
  <div class="tag-disc" data-id="${id}">
    <svg viewBox="0 0 60 60" width="40mm" height="40mm" xmlns="http://www.w3.org/2000/svg">
      <circle cx="30" cy="30" r="28" fill="#fff" stroke="#000" stroke-width="2"/>
      <circle cx="30" cy="30" r="22" fill="none" stroke="#000" stroke-width="1"/>
      <text x="30" y="35" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" font-weight="700" fill="#000">${id}</text>
    </svg>
  </div>`;
}

function wrapInstructions(): string {
  return `
  <section class="wrap-how">
    <h2>How to wrap a toilet roll</h2>
    <ol>
      <li>Print this sheet on A4, black and white, actual size (100%).</li>
      <li>Cut along the outer edge of one rod belt strip.</li>
      <li>Wrap around a cardboard toilet-roll tube so the black–white–black bands sit proud; use the 10 mm overlap to tape.</li>
      <li>The label (A1, A2, …) must sit in the white 20 mm belt and face outward.</li>
      <li>Slide the tube onto the rod end. A0 / B0 are optional mid checks at 2.000 m — not a third station.</li>
      <li>Fence discs: cut, tape to the post you cannot stand in; photograph with a live rod.</li>
    </ol>
  </section>`;
}

/** Collect FNC ids from document, defaulting to FNC01–04. */
export function fenceIdsFromDoc(doc: GardenDocument): string[] {
  const fromDoc = doc.points
    .filter((p) => p.kind === 'FNC' || /^FNC\d{2}$/.test(p.id))
    .map((p) => p.id);
  const unique = [...new Set(fromDoc)];
  if (unique.length >= 4) return unique.slice(0, 8);
  return ['FNC01', 'FNC02', 'FNC03', 'FNC04'];
}

export function renderTagsPrintHtml(doc: GardenDocument): string {
  const fences = fenceIdsFromDoc(doc);
  const belts = ROD_IDS.map((id) => rodBelt(id)).join('\n');
  const discs = fences.map((id) => fenceDisc(id)).join('\n');

  return `
  <div class="print-sheet" id="print-sheet">
    <header class="print-header">
      <h1>Garden Survey — printable tags</h1>
      <p>Document: <strong>${escapeHtml(doc.name)}</strong> · IDs match garden.json</p>
    </header>
    <h2 class="print-section-title">Rod belts (A1 A2 A0 B1 B2 B0)</h2>
    <div class="belt-grid">${belts}</div>
    <h2 class="print-section-title">Fence / house discs</h2>
    <div class="disc-grid">${discs}</div>
    ${wrapInstructions()}
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function triggerPrint(): void {
  window.print();
}
