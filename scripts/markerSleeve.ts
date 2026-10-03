/**
 * Bank-1 barcode sleeves for the circle field test.
 *
 * Geometry and the 61-word list are MARKER_VISION_DESIGN.md (Bank 1 only).
 * The list is rebuilt with the note's greedy rule and refused if it drifts.
 * Payload bits are printed MSB at the top, directly under the sync.
 *
 * Sheet, from the bottom of an A4 page (PDF y):
 *   0–5 mm bottom trim, 5–20 bottom legend, 20–28 quiet,
 *   28–275 code (19 × 13 mm), 275–283 quiet, 283–292 top legend,
 *   292–297 top trim.
 * Trim the right edge at 205 mm. The left 16.5 mm is the glue flap
 * (outer 5 mm left blank). Bands cover x = 12.2–205 mm so the inner
 * flap repeats the pattern; the outer flap holds the ruler and the name.
 * The 250 mm ruler sits in that outer flap, so it crosses the flap's
 * share of the quiet-zone heights. A continuous 250 mm line does not fit
 * in the 247 mm code stack. The quiet strips of the visible pattern
 * (x ≥ 16.5 mm) stay empty.
 */

export const PUBLISHED_CODEBOOK =
  '222 22D 244 24B 271 28E 293 2B4 2DD 2E7 315 31A 36E 389 447 459 46A 474 48B 495 4A6 4CC 4D2 513 51C 525 5B9 637 6BA 6E9 72B 74D 756 88D 896 8A3 8CA 8D1 919 926 94C 952 96B 975 9BA 9C7 A3B A57 B9C BA5 C6D C73 DAC DB7 DC9 DD4 E24 E4E E99 EC5 EE2';

/**
 * Circle-test assignment. Not the first eight words: those share a top nibble
 * and several pairs differ only in four adjacent bands. These eight are in
 * the Bank-1 list, at least distance 6 apart, and no pair differs only inside
 * a 4-band burst.
 */
export const CIRCLE_SLEEVES = [
  { point: 'BAS01', id: '315' },
  { point: 'BAS02', id: '36E' },
  { point: 'CRC01', id: '459' },
  { point: 'CRC02', id: '6BA' },
  { point: 'CRC03', id: '8A3' },
  { point: 'CRC04', id: '952' },
  { point: 'CRC05', id: 'DAC' },
  { point: 'CRC06', id: 'EC5' },
];

const SYNC = '11110';
const STOP = '01';

function reverse12(word: number) {
  let reversed = 0;
  for (let i = 0; i < 12; i++) reversed = (reversed << 1) | ((word >> i) & 1);
  return reversed & 0xfff;
}

function complement12(word: number) {
  return (~word) & 0xfff;
}

function hamming(a: number, b: number) {
  let x = (a ^ b) & 0xfff;
  let n = 0;
  while (x) {
    n += x & 1;
    x >>= 1;
  }
  return n;
}

function bitsMsb(word: number) {
  const bits = [];
  for (let i = 11; i >= 0; i--) bits.push((word >> i) & 1);
  return bits;
}

/** No run longer than 3, and at most two white bands at either end. */
function runLimited(word: number) {
  const bits = bitsMsb(word);
  let lead = 0;
  while (lead < 12 && bits[lead] === 0) lead++;
  if (lead > 2) return false;
  let trail = 0;
  while (trail < 12 && bits[11 - trail] === 0) trail++;
  if (trail > 2) return false;
  let run = 1;
  for (let i = 1; i < 12; i++) {
    if (bits[i] === bits[i - 1]) {
      run += 1;
      if (run > 3) return false;
    } else {
      run = 1;
    }
  }
  return true;
}

export function issuedWords() {
  const kept: number[] = [];
  for (let word = 0; word < 4096; word++) {
    if (!runLimited(word)) continue;
    const reversed = reverse12(word);
    const complement = complement12(word);
    if (kept.includes(reversed) || kept.includes(complement)) continue;
    if (kept.some((keptWord) => hamming(keptWord, word) < 4)) continue;
    kept.push(word);
  }
  return kept;
}

function hex3(word: number) {
  return word.toString(16).toUpperCase().padStart(3, '0');
}

const issuedHex = issuedWords().map(hex3);
if (issuedHex.join(' ') !== PUBLISHED_CODEBOOK) {
  throw new Error('Bank-1 codebook does not match MARKER_VISION_DESIGN.md');
}

export function payloadBits(id: string) {
  const word = Number.parseInt(id, 16);
  if (!issuedHex.includes(id)) throw new Error(`ID ${id} is not an issued Bank-1 word`);
  return bitsMsb(word).join('');
}

export function sleeveBits(id: string) {
  return SYNC + payloadBits(id) + STOP;
}

function pt(mm: number) {
  return Math.round(((mm * 72) / 25.4) * 10000) / 10000;
}

function fmt(n: number) {
  const rounded = Math.round(n * 10000) / 10000;
  let text = rounded.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  if (text === '-0') text = '0';
  return text;
}

function pdfStr(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function rect(x: number, y: number, w: number, h: number) {
  return `${fmt(pt(x))} ${fmt(pt(y))} ${fmt(pt(w))} ${fmt(pt(h))} re`;
}

function seg(x1: number, y1: number, x2: number, y2: number) {
  return `${fmt(pt(x1))} ${fmt(pt(y1))} m\n${fmt(pt(x2))} ${fmt(pt(y2))} l\nS`;
}

function textAt(x: number, y: number, size: number, text: string) {
  return `BT\n/F1 ${fmt(size)} Tf\n1 0 0 1 ${fmt(pt(x))} ${fmt(pt(y))} Tm\n(${pdfStr(text)}) Tj\nET`;
}

/** Text that reads upward. The glyphs sit to the left of x. */
function textUp(x: number, y: number, size: number, text: string) {
  return `q\n0 1 -1 0 ${fmt(pt(x))} ${fmt(pt(y))} cm\nBT\n/F1 ${fmt(size)} Tf\n1 0 0 1 0 0 Tm\n(${pdfStr(text)}) Tj\nET\nQ`;
}

function cross(x: number, y: number, arm: number) {
  return `${seg(x - arm, y, x + arm, y)}\n${seg(x, y - arm, x, y + arm)}`;
}

function arrowUp(x: number, y0: number, y1: number) {
  const head = 1.8;
  const wing = 1.1;
  return `${seg(x, y0, x, y1)}\n${seg(x, y1, x - wing, y1 - head)}\n${seg(x, y1, x + wing, y1 - head)}`;
}

function arrowDown(x: number, y0: number, y1: number) {
  const head = 1.8;
  const wing = 1.1;
  return `${seg(x, y1, x, y0)}\n${seg(x, y0, x - wing, y0 + head)}\n${seg(x, y0, x + wing, y0 + head)}`;
}

function hRuler(x: number, y: number, length: number) {
  const parts = [seg(x, y, x + length, y)];
  for (let d = 0; d <= length; d += 10) {
    const tick = d % 50 === 0 ? 2.0 : 1.1;
    parts.push(seg(x + d, y, x + d, y + tick));
  }
  return parts.join('\n');
}

function vRuler(x: number, y: number, length: number) {
  const parts = [seg(x, y, x, y + length)];
  for (let d = 0; d <= length; d += 10) {
    const tick = d % 50 === 0 ? 1.2 : 0.7;
    parts.push(seg(x, y + d, x + tick, y + d));
  }
  return parts.join('\n');
}

const CODE_TOP = 275;
const MODULE = 13;
const BAND_LEFT = 12.2;
const TRIM_X = 205;

export function sleeveContent(sleeve: { point: string; id: string }) {
  const bits = sleeveBits(sleeve.id);
  if (bits.length !== 19) throw new Error('sleeve is not 19 bands');
  const parts = [];
  parts.push(`% SLEEVE ${sleeve.point} ${sleeve.id}`);
  parts.push('0 0 0 rg');
  parts.push('0 0 0 RG');
  parts.push('0 J');
  parts.push('0 j');

  let i = 0;
  while (i < bits.length) {
    if (bits[i] !== '1') {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < bits.length && bits[j] === '1') j += 1;
    const top = CODE_TOP - i * MODULE;
    const bottom = CODE_TOP - j * MODULE;
    parts.push(`% RUN ${i} ${j}`);
    parts.push(rect(BAND_LEFT, bottom, TRIM_X - BAND_LEFT, top - bottom));
    parts.push('f');
    i = j;
  }

  // 100 mm horizontal bar in the bottom legend. 50 mm vertical bar in the flap.
  parts.push('% SCALE100');
  parts.push(rect(22, 10.5, 100, 1.4));
  parts.push('f');
  parts.push('% SCALE50');
  parts.push(rect(6.9, 128, 0.8, 50));
  parts.push('f');

  parts.push('0.8 w');
  parts.push('% TRIM205');
  // Stop before the bands and the quiet zones. A full-height stroke centred
  // on x=205 leaves a hairline in the quiet strips.
  parts.push(seg(TRIM_X, 0, TRIM_X, 20));
  parts.push(seg(TRIM_X, 283, TRIM_X, 297));
  parts.push(seg(0, 5, 210, 5));
  parts.push(seg(0, 292, 210, 292));
  parts.push(seg(198, 287.6, TRIM_X, 287.6));
  parts.push(seg(198, 12.2, TRIM_X, 12.2));

  parts.push('0.6 w');
  parts.push(cross(16.5, 287.6, 1.8));
  parts.push(cross(16.5, 12.2, 1.8));
  parts.push(cross(TRIM_X, 287.6, 1.8));
  parts.push(cross(TRIM_X, 12.2, 1.8));
  parts.push(cross(190, 287.6, 1.6));
  parts.push(arrowUp(64, 284.4, 290.6));
  parts.push(arrowDown(9.6, 7.2, 17.2));

  parts.push('0.9 w');
  parts.push(vRuler(5.4, 23, 250));
  parts.push(hRuler(22, 7.2, 180));
  parts.push(seg(22, 10.5, 22, 13.4));
  parts.push(seg(122, 10.5, 122, 13.4));

  parts.push(textAt(26, 286.2, 11, sleeve.point));
  parts.push(textAt(48, 286.2, 11, sleeve.id));
  parts.push(textAt(68, 286.2, 8, 'TOP'));
  parts.push(textAt(84, 286.2, 7, 'PRINT AT 100% / ACTUAL SIZE'));
  parts.push(textAt(158, 286.2, 7, 'TRIM 205 mm'));
  parts.push(textAt(6.2, 284.6, 6, 'SEAM'));

  parts.push(textAt(24, 16.0, 8, 'BOTTOM'));
  parts.push(textAt(46, 16.0, 10, sleeve.point));
  parts.push(textAt(68, 16.0, 10, sleeve.id));
  parts.push(textAt(148, 16.0, 7, '180 mm ruler'));
  parts.push(textAt(124, 10.7, 7, '100 mm'));

  parts.push(textUp(10.2, 36, 7, `${sleeve.point}   ${sleeve.id}   GLUE UNDER`));
  parts.push(textUp(10.2, 132, 6.5, '50 mm'));
  parts.push(textUp(10.2, 198, 6.5, '250 mm'));

  return `${parts.join('\n')}\n`;
}

export function buildPdf(streams: string[]) {
  const kids = streams.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${streams.length} /Kids [${kids}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const pageW = fmt(pt(210));
  const pageH = fmt(pt(297));
  for (const stream of streams) {
    const contentId = bodies.length + 2;
    const length = Buffer.byteLength(stream, 'latin1');
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    bodies.push(`<< /Length ${length} >>\nstream\n${stream}endstream`);
  }

  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets = [0];
  for (let i = 0; i < bodies.length; i++) {
    offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    chunks.push(Buffer.from(`${i + 1} 0 obj\n${bodies[i]}\nendobj\n`, 'latin1'));
  }
  const xrefAt = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  let xref = `xref\n0 ${bodies.length + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i <= bodies.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}

export function renderSleevePdf(sleeve: { point: string; id: string }) {
  return buildPdf([sleeveContent(sleeve)]);
}

export function renderAllSleevesPdf() {
  return buildPdf(CIRCLE_SLEEVES.map(sleeveContent));
}
