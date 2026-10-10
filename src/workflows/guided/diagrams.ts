/** Sheet diagrams. 16px type in a 360-wide viewBox, so it stays 16px at the bar's width. */

import type { WorkflowDiagram } from './types';

function svg(body: string, label: string, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 ${height}" role="img" aria-label="${label}" class="workflow-diagram">${body}</svg>`;
}

const text = 'font-family="Source Sans 3, sans-serif" font-size="16" fill="currentColor"';
const bold = 'font-family="Source Sans 3, sans-serif" font-size="16" font-weight="700" fill="currentColor"';

export function diagramSvg(id: WorkflowDiagram): string {
  if (id === 'circle-plan') return circlePlan();
  if (id === 'stn01') return stn01();
  return sleeveJoin();
}

function circlePlan(): string {
  return svg(
    `
    <text x="8" y="22" ${bold}>LEFT</text>
    <text x="352" y="22" text-anchor="end" ${bold}>RIGHT · peg</text>
    <line x1="150" y1="40" x2="150" y2="200" stroke="currentColor" stroke-width="3"/>
    <circle cx="150" cy="200" r="5" fill="currentColor"/>
    <text x="138" y="220" text-anchor="end" ${bold}>BAS01</text>
    <circle cx="150" cy="40" r="5" fill="currentColor"/>
    <text x="138" y="36" text-anchor="end" ${bold}>BAS02</text>
    <text x="158" y="124" ${text}>8.000 m</text>
    <line x1="150" y1="40" x2="250" y2="40" stroke="currentColor" stroke-width="2"/>
    <text x="168" y="34" ${text}>4.30 m</text>
    <circle cx="250" cy="40" r="70" fill="none" stroke="currentColor" stroke-width="2"/>
    <circle cx="250" cy="40" r="4" fill="currentColor"/>
    <text x="258" y="36" ${bold}>peg</text>
    <text x="168" y="78" ${text}>4.000 m</text>
    <circle cx="40" cy="120" r="5" fill="currentColor"/>
    <text x="8" y="112" ${bold}>STN01</text>
    <text x="8" y="132" ${text}>8.00 / 8.00</text>
    `,
    'Plan. BAS01 at the bottom, BAS02 at the top. The peg is on the right. STN01 is on the left.',
    240,
  );
}

function stn01(): string {
  return svg(
    `
    <text x="8" y="22" ${bold}>LEFT</text>
    <text x="352" y="22" text-anchor="end" ${bold}>RIGHT</text>
    <circle cx="70" cy="90" r="6" fill="currentColor"/>
    <text x="8" y="78" ${bold}>STN01</text>
    <text x="8" y="118" ${text}>8.00 / 8.00</text>
    <line x1="180" y1="48" x2="180" y2="150" stroke="currentColor" stroke-width="3"/>
    <text x="188" y="48" ${bold}>BAS02</text>
    <text x="188" y="154" ${bold}>BAS01</text>
    <text x="8" y="176" ${text}>Photo 1: both ends, CRC01–CRC05.</text>
    <text x="8" y="200" ${text}>Photo 2: turn, keep BAS02, add CRC06.</text>
    <text x="8" y="224" ${bold}>On the pole. Do not step.</text>
    `,
    'STN01 on the left, 8.00 m from each baseline end. Two photos, no step.',
    240,
  );
}

function sleeveJoin(): string {
  return svg(
    `
    <rect x="16" y="28" width="200" height="36" fill="currentColor"/>
    <rect x="16" y="64" width="200" height="28" fill="none" stroke="currentColor" stroke-width="2"/>
    <rect x="16" y="92" width="200" height="36" fill="currentColor"/>
    <text x="24" y="84" ${bold}>CUT HERE</text>
    <rect x="216" y="28" width="48" height="100" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/>
    <text x="220" y="84" ${text}>tab</text>
    <circle cx="300" cy="78" r="28" fill="none" stroke="currentColor" stroke-width="3"/>
    <text x="276" y="128" ${text}>dowel</text>
    <text x="8" y="156" ${text}>1. Cut the left edge on CUT HERE.</text>
    <text x="8" y="180" ${text}>2. Fix the tab to the dowel.</text>
    <text x="8" y="204" ${text}>3. Wrap, stick the left edge down.</text>
    <text x="8" y="228" ${text}>4. Turn the seam away.</text>
    `,
    'Sleeve join. Cut on CUT HERE, fix the blank tab to the dowel, wrap, stick the edge, turn the seam away.',
    248,
  );
}
