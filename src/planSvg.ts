/** SVG plan renderer for adjusted points, lines, polygons, photos. */

import type { GardenDocument } from './model';

export function renderPlanSvg(doc: GardenDocument, width = 720, height = 560): string {
  const pts = doc.points.filter((p) => p.x != null && p.y != null);
  if (!pts.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Empty plan">
      <rect width="100%" height="100%" fill="#e8e2d6"/>
      <text x="50%" y="50%" text-anchor="middle" fill="#5a5348" font-family="Georgia, serif" font-size="18">No coordinates yet — run Adjust</text>
    </svg>`;
  }

  const xs = pts.map((p) => p.x!);
  const ys = pts.map((p) => p.y!);
  const minX = Math.min(...xs) - 1;
  const maxX = Math.max(...xs) + 1;
  const minY = Math.min(...ys) - 1;
  const maxY = Math.max(...ys) + 1;
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const pad = 40;
  const sx = (width - 2 * pad) / spanX;
  const sy = (height - 2 * pad) / spanY;
  const s = Math.min(sx, sy);

  const tx = (x: number) => pad + (x - minX) * s;
  // SVG Y down; survey Y up.
  const ty = (y: number) => height - pad - (y - minY) * s;

  const polyPaths = doc.polygons
    .map((poly) => {
      const coords = poly.pointIds
        .map((id) => pts.find((p) => p.id === id))
        .filter((p): p is NonNullable<typeof p> => !!p && p.x != null && p.y != null);
      if (coords.length < 3) return '';
      const d =
        coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${tx(p.x!)} ${ty(p.y!)}`).join(' ') + ' Z';
      return `<path d="${d}" fill="#c5b7a0" fill-opacity="0.45" stroke="#3d3428" stroke-width="2"/>`;
    })
    .join('\n');

  const lineEls = doc.lines
    .map((line) => {
      const a = pts.find((p) => p.id === line.a);
      const b = pts.find((p) => p.id === line.b);
      if (!a || !b || a.x == null || b.x == null) return '';
      const stroke =
        line.kind === 'rod' ? '#8b1e1e' : line.kind === 'straight' ? '#3d3428' : '#2f5d3a';
      const dash = line.kind === 'straight' ? ' stroke-dasharray="6 4"' : '';
      return `<line x1="${tx(a.x!)}" y1="${ty(a.y!)}" x2="${tx(b.x!)}" y2="${ty(b.y!)}" stroke="${stroke}" stroke-width="${line.kind === 'rod' ? 3 : 1.5}"${dash}/>`;
    })
    .join('\n');

  const pointEls = pts
    .map((p) => {
      const colour =
        p.kind === 'HSE'
          ? '#3d3428'
          : p.kind === 'ROD'
            ? '#8b1e1e'
            : p.kind === 'OCC' || p.kind === 'BED'
              ? '#1a5f7a'
              : '#5a5348';
      const r = p.kind === 'ROD' ? 5 : 4;
      return `<g>
        <circle cx="${tx(p.x!)}" cy="${ty(p.y!)}" r="${r}" fill="${colour}"/>
        <text x="${tx(p.x!) + 8}" y="${ty(p.y!) - 8}" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="11" fill="#2a241c">${escapeXml(p.id)}</text>
      </g>`;
    })
    .join('\n');

  // Camera pose ticks
  const poseEls = doc.photos
    .filter((ph) => ph.pose)
    .map((ph) => {
      const { x, y, yawRad } = ph.pose!;
      const len = 0.8 * s;
      const x2 = tx(x) + len * Math.sin(yawRad);
      const y2 = ty(y) - len * Math.cos(yawRad);
      return `<g opacity="0.7">
        <circle cx="${tx(x)}" cy="${ty(y)}" r="3" fill="#c45c26"/>
        <line x1="${tx(x)}" y1="${ty(y)}" x2="${x2}" y2="${y2}" stroke="#c45c26" stroke-width="1.5"/>
      </g>`;
    })
    .join('\n');

  // Scale bar ~2 m
  const barM = 2;
  const barX = pad;
  const barY = height - 16;
  const barW = barM * s;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Garden plan">
    <defs>
      <pattern id="grid" width="${s}" height="${s}" patternUnits="userSpaceOnUse">
        <path d="M ${s} 0 L 0 0 0 ${s}" fill="none" stroke="#d4cbb8" stroke-width="0.5"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="#f3efe6"/>
    <rect x="${pad}" y="${pad}" width="${spanX * s}" height="${spanY * s}" fill="url(#grid)" opacity="0.5"/>
    ${polyPaths}
    ${lineEls}
    ${poseEls}
    ${pointEls}
    <line x1="${barX}" y1="${barY}" x2="${barX + barW}" y2="${barY}" stroke="#2a241c" stroke-width="3"/>
    <text x="${barX}" y="${barY - 6}" font-family="IBM Plex Mono, monospace" font-size="11" fill="#2a241c">${barM} m</text>
  </svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
