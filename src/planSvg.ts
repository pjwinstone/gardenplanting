/** SVG plan renderer — points, fuzzy shapes, trust-ordered baselines. */

import type { GardenDocument } from './model';
import {
  activeBaselineEnds,
  baselinesByTrust,
  photoEstimateAt,
  preferredBaseline,
} from './layers';

export function renderPlanSvg(doc: GardenDocument, width = 720, height = 560): string {
  const pts = doc.points.filter((p) => p.x != null && p.y != null);
  if (!pts.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Empty plan">
      <rect width="100%" height="100%" fill="#e8e2d6"/>
      <text x="50%" y="50%" text-anchor="middle" fill="#5a5348" font-family="Georgia, serif" font-size="18">No coordinates yet — + Point or run Adjust</text>
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
  const ty = (y: number) => height - pad - (y - minY) * s;

  const active = preferredBaseline(doc);
  const ends = activeBaselineEnds(doc);
  const inspecting = doc.session.inspectingPointId;

  const fuzzyShapes = (doc.objects ?? [])
    .map((obj) => {
      if (obj.solvedCircle) {
        const { cx, cy, r } = obj.solvedCircle;
        const opacity = Math.max(0.12, Math.min(0.35, 0.35 - (obj.residualMm ?? 0) / 400));
        return `<circle cx="${tx(cx)}" cy="${ty(cy)}" r="${r * s}" fill="#6b8f71" fill-opacity="${opacity}" stroke="#2f5d3a" stroke-width="2" stroke-dasharray="4 3"/>`;
      }
      if (obj.solvedRectangle) {
        const { minX: a, minY: b, maxX: c, maxY: d } = obj.solvedRectangle;
        const x = tx(a);
        const y = ty(d);
        const w = (c - a) * s;
        const h = (d - b) * s;
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#c45c26" fill-opacity="0.15" stroke="#c45c26" stroke-width="2" stroke-dasharray="5 3"/>`;
      }
      if (obj.solvedPolygonIds?.length) {
        const coords = obj.solvedPolygonIds
          .map((id) => pts.find((p) => p.id === id))
          .filter((p): p is NonNullable<typeof p> => !!p && p.x != null);
        if (coords.length < 2) return '';
        const d =
          coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${tx(p.x!)} ${ty(p.y!)}`).join(' ') +
          (coords.length >= 3 ? ' Z' : '');
        return `<path d="${d}" fill="#1a5f7a" fill-opacity="0.12" stroke="#1a5f7a" stroke-width="2" stroke-dasharray="3 3"/>`;
      }
      return '';
    })
    .join('\n');

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

  // Baselines: low trust first (under), high trust + used last (on top). Distinct style when used.
  const baselineEls = baselinesByTrust(doc)
    .slice()
    .reverse()
    .map((bl) => {
      const a = pts.find((p) => p.id === bl.a);
      const b = pts.find((p) => p.id === bl.b);
      if (!a || !b || a.x == null || b.x == null) return '';
      const isActive = active?.id === bl.id;
      const used = (bl.usedForMeasurementCount ?? 0) > 0;
      const trust = bl.trust ?? 50;
      const width = isActive ? 5 : used ? 3.5 : 2;
      const colour = isActive ? '#c45c26' : used ? '#1a3a2a' : '#8a7f6e';
      const dash = used || isActive ? '' : ' stroke-dasharray="8 5"';
      const midX = (tx(a.x!) + tx(b.x!)) / 2;
      const midY = (ty(a.y!) + ty(b.y!)) / 2;
      const tick = used
        ? `<circle cx="${midX}" cy="${midY}" r="4" fill="${colour}"/><text x="${midX + 6}" y="${midY - 6}" font-family="IBM Plex Mono, monospace" font-size="10" fill="${colour}">T${trust}</text>`
        : `<text x="${midX + 4}" y="${midY - 4}" font-family="IBM Plex Mono, monospace" font-size="9" fill="#8a7f6e">T${trust}</text>`;
      return `<g data-baseline-id="${escapeXml(bl.id)}">
        <line x1="${tx(a.x!)}" y1="${ty(a.y!)}" x2="${tx(b.x!)}" y2="${ty(b.y!)}" stroke="${colour}" stroke-width="${width}"${dash} stroke-linecap="round"/>
        ${tick}
      </g>`;
    })
    .join('\n');

  // Active ends highlight (even if not a known Baseline yet)
  let activeEndsEl = '';
  if (ends.a && ends.b) {
    const a = pts.find((p) => p.id === ends.a);
    const b = pts.find((p) => p.id === ends.b);
    if (a?.x != null && b?.x != null) {
      activeEndsEl = `<line x1="${tx(a.x)}" y1="${ty(a.y!)}" x2="${tx(b.x)}" y2="${ty(b.y!)}" stroke="#c45c26" stroke-width="2" stroke-dasharray="2 2" opacity="0.9"/>`;
    }
  }

  const pointEls = pts
    .map((p) => {
      const isScatter = p.kind === 'OCC' || p.kind === 'BED';
      const colour =
        p.kind === 'HSE'
          ? '#3d3428'
          : p.kind === 'ROD'
            ? '#8b1e1e'
            : isScatter
              ? '#1a5f7a'
              : '#5a5348';
      const isActiveEnd = p.id === ends.a || p.id === ends.b;
      const isInspect = p.id === inspecting;
      const r = isInspect ? 8 : isActiveEnd ? 7 : isScatter ? 6 : p.kind === 'ROD' ? 5 : 4;
      const ring = isInspect
        ? `<circle cx="${tx(p.x!)}" cy="${ty(p.y!)}" r="${r + 5}" fill="none" stroke="#c45c26" stroke-width="2.5"/>`
        : isActiveEnd
          ? `<circle cx="${tx(p.x!)}" cy="${ty(p.y!)}" r="${r + 3}" fill="none" stroke="#c45c26" stroke-width="1.5"/>`
          : isScatter
            ? `<circle cx="${tx(p.x!)}" cy="${ty(p.y!)}" r="${r + 2}" fill="none" stroke="#fffdf8" stroke-width="1.5" opacity="0.95"/>`
            : '';
      const label = isScatter
        ? `<text x="${tx(p.x!) + 9}" y="${ty(p.y!) - 9}" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="11" font-weight="700" fill="#1a5f7a">${escapeXml(p.id)}</text>`
        : `<text x="${tx(p.x!) + 8}" y="${ty(p.y!) - 8}" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="11" fill="#2a241c">${escapeXml(p.id)}</text>`;

      // Per-photo contributions (grey) when this point has multiple photos — outliers readable.
      const photoIds = p.photoIds ?? [];
      let photoScatter = '';
      if (photoIds.length > 1) {
        const showStrong = isInspect;
        photoScatter = photoIds
          .map((id, i) => {
            const ph = doc.photos.find((x) => x.id === id);
            if (!ph) return '';
            const est = photoEstimateAt(ph, p, i);
            const opacity = showStrong ? 0.85 : 0.45;
            const pr = showStrong ? 4 : 3;
            const selected = showStrong && doc.session.selectedPhotoId === id;
            return `<circle class="plan-photo-est" cx="${tx(est.x)}" cy="${ty(est.y)}" r="${selected ? pr + 1.5 : pr}" fill="#9a958c" fill-opacity="${opacity}" stroke="${selected ? '#5a5348' : 'none'}" stroke-width="1.5" data-photo-id="${escapeXml(id)}"/>`;
          })
          .join('\n');
      }

      // Combined / average point is bold (darker stroke, full opacity).
      return `<g class="plan-point${isScatter ? ' plan-point--scatter' : ''}${isInspect ? ' plan-point--inspect' : ''}" data-point-id="${escapeXml(p.id)}" data-cmd="inspect-point" style="cursor:pointer">
        ${photoScatter}
        ${ring}
        <circle cx="${tx(p.x!)}" cy="${ty(p.y!)}" r="${r + 10}" fill="transparent"/>
        <circle class="plan-point__avg" cx="${tx(p.x!)}" cy="${ty(p.y!)}" r="${r}" fill="${colour}" stroke="${isScatter ? '#0d3a4a' : '#2a241c'}" stroke-width="${isInspect || isScatter ? 2 : 1}"/>
        ${label}
      </g>`;
    })
    .join('\n');

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
    ${fuzzyShapes}
    ${lineEls}
    ${baselineEls}
    ${activeEndsEl}
    ${poseEls}
    ${pointEls}
    <line x1="${barX}" y1="${barY}" x2="${barX + barW}" y2="${barY}" stroke="#2a241c" stroke-width="3"/>
    <text x="${barX}" y="${barY - 6}" font-family="IBM Plex Mono, monospace" font-size="11" fill="#2a241c">${barM} m</text>
  </svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
