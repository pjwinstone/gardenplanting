/**
 * The garden's base grid: base points (BAS01 at 0,0) and their taped N/E/diagonal ties on grid
 * north. One source for Add point, the circle test and the photo point solve. Base points are
 * only added or edited through Add point > Base point; the circle test reads them from here.
 */
import type { BaseGridDoc, GardenDocument } from './model';
import { adjustGridNetwork, type GridDiagonalWarning, type GridNetworkResult } from './solver/controlCluster';
import { readProgress } from './workflows/guided/engine';

export interface BaseGridView {
  ids: string[];
  ties: BaseGridDoc['ties'];
  postSeparation: Record<string, number>;
  /**
   * Deleted base points: no longer markers (not in `ids`, not offered for photo matching), but
   * still virtual nodes in the adjustment, so every point measured through them keeps its
   * position and uncertainty. BAS01 deleted still defines 0,0.
   */
  deletedIds: string[];
}

/** Fewer than this many base points: photo points and the circle test are tucked away (tip only). */
export const MIN_BASE_POINTS_FOR_PHOTOS = 3;

/**
 * Base grid = the garden's base points, plus any tied earlier on the circle test run (same BAS
 * ids). A point saved or edited through Add point replaces the circle run's ties to it.
 */
export function baseGridOf(doc: GardenDocument, circleRun?: { baseTies?: BaseGridDoc['ties']; basePostSeparationM?: Record<string, number> }): BaseGridView {
  const grid = doc.baseGrid ?? { points: [], ties: [] };
  const circle = circleRun ?? readProgress(doc).runs['circle-field-test'];
  const gone = new Set((grid.deleted ?? []).map((d) => d.id));
  // Ties stay in the network whether or not their ends are deleted (the underlying truth grid).
  const ties = [...grid.ties];
  const owned = new Set(grid.ties.map((t) => t.to));
  for (const tie of circle?.baseTies ?? []) {
    if (owned.has(tie.to)) continue;
    if (!ties.some((x) => x.from === tie.from && x.to === tie.to)) ties.push(tie);
  }
  const ids = new Set<string>(grid.points.map((p) => p.id));
  if (ties.length) ids.add('BAS01');
  for (const tie of ties) {
    ids.add(tie.from);
    ids.add(tie.to);
  }
  const deletedIds = [...gone].filter((id) => ids.has(id) || grid.points.some((p) => p.id === id)).sort();
  for (const id of gone) ids.delete(id);
  const postSeparation: Record<string, number> = { ...(circle?.basePostSeparationM ?? {}) };
  // A point saved through Add point decides its own post type.
  for (const p of grid.points) {
    if (p.postSeparationM) postSeparation[p.id] = p.postSeparationM;
    else delete postSeparation[p.id];
  }
  return { ids: [...ids].sort(), ties, postSeparation, deletedIds };
}

/** Points reachable from BAS01 through ties whose ends both still exist. */
function reachable(ties: BaseGridDoc['ties']): Set<string> {
  const seen = new Set<string>(['BAS01']);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of ties) {
      if (seen.has(t.from) && !seen.has(t.to)) { seen.add(t.to); grew = true; }
    }
  }
  return seen;
}

export function basePointCount(doc: GardenDocument): number {
  return baseGridOf(doc).ids.length;
}

export function nextBaseId(doc: GardenDocument): string {
  // Deleted ids stay used, so a new point never takes a deleted point's name.
  const v = baseGridOf(doc);
  const ids = [...v.ids, ...v.deletedIds, ...(doc.baseGrid?.deleted ?? []).map((d) => d.id)];
  if (!ids.length) return 'BAS01';
  const n = Math.max(...ids.map((id) => Number(id.replace(/\D/g, '')) || 0)) + 1;
  return `BAS${String(n).padStart(2, '0')}`;
}

export function networkOf(ties: BaseGridDoc['ties']): GridNetworkResult | undefined {
  // Solve what hangs off BAS01 (deleted points included, as virtual nodes).
  const live = reachable(ties);
  const used = ties.filter((t) => live.has(t.from) && live.has(t.to));
  if (!used.length) return undefined;
  try {
    return adjustGridNetwork('BAS01', used);
  } catch {
    return undefined;
  }
}

export function baseNetworkForDoc(doc: GardenDocument, circleRun?: Parameters<typeof baseGridOf>[1]): GridNetworkResult | undefined {
  return networkOf(baseGridOf(doc, circleRun).ties);
}

/** Per base point: the diagonal warning, if any (list highlight). */
export function baseWarnings(doc: GardenDocument): Record<string, GridDiagonalWarning> {
  const out: Record<string, GridDiagonalWarning> = {};
  for (const w of baseNetworkForDoc(doc)?.warnings ?? []) out[w.point] = w;
  return out;
}

/** The tie that placed a base point (for editing). */
export function primaryTie(doc: GardenDocument, id: string): BaseGridDoc['ties'][number] | undefined {
  return baseGridOf(doc).ties.find((t) => t.to === id && t.eastM != null && t.northM != null);
}

export interface BasePointEdit {
  id: string;
  from?: string;
  northM?: number;
  eastM?: number;
  diagonalM?: number;
  /** Two-sleeve post separation, m; undefined = single sleeve. */
  postSeparationM?: number;
}

/**
 * Save a base point (new or edited) with its tie and post setting together, then re-solve the
 * whole grid from all ties and refresh every base point's position on the plan. An edit replaces
 * the point's tie (no duplicate points or ties).
 */
export function upsertBasePoint(doc: GardenDocument, e: BasePointEdit, now = new Date().toISOString()): GardenDocument {
  const grid: BaseGridDoc = doc.baseGrid ?? { points: [], ties: [] };
  const points = [...grid.points.filter((p) => p.id !== e.id), { id: e.id, savedAt: now, ...(e.postSeparationM ? { postSeparationM: e.postSeparationM } : {}) }];
  let ties = grid.ties.filter((t) => t.to !== e.id);
  if (e.id !== 'BAS01' && e.from) ties = [...ties, { id: `tie-${e.id}`, from: e.from, to: e.id, northM: e.northM, eastM: e.eastM, diagonalM: e.diagonalM, savedAt: now }];
  // Editing a deleted point's ties is allowed; it stays deleted until Restore.
  return refreshBasePoints({ ...doc, baseGrid: { ...grid, points, ties }, updatedAt: now });
}

/** Re-solve the whole grid and refresh every base point on the plan (a replay of all ties). */
function refreshBasePoints(next: GardenDocument): GardenDocument {
  const view = baseGridOf(next);
  const gone = new Set((next.baseGrid?.deleted ?? []).map((d) => d.id));
  const net = networkOf(view.ties);
  const others = next.points.filter((p) => !view.ids.includes(p.id) && !(gone.has(p.id) && p.layerId === 'base'));
  // Deleted points leave the plan (no marker to match) but stay in the solve.
  const base = view.ids.map((id) => {
    const xy = id === 'BAS01' ? { x: 0, y: 0 } : net?.points[id];
    const old = next.points.find((p) => p.id === id);
    return { ...(old ?? {}), id, kind: 'BL' as const, layerId: 'base', fixed: true, label: id, ...(xy ? { x: xy.x, y: xy.y } : {}) };
  });
  return { ...next, points: [...others, ...base] };
}

/**
 * Delete a base point: it stops being a marker (not offered for photo matching, greyed in the
 * list) but its ties stay in the adjustment as a virtual node, so points measured through it keep
 * the same coordinates and uncertainty. BAS01 too: the origin stays at 0,0. Restore undoes it.
 */
export function deleteBasePoint(doc: GardenDocument, id: string, now = new Date().toISOString()): GardenDocument {
  const grid: BaseGridDoc = doc.baseGrid ?? { points: [], ties: [] };
  if (!baseGridOf(doc).ids.includes(id)) return doc;
  const deleted = [...(grid.deleted ?? []).filter((d) => d.id !== id), { id, deletedAt: now }];
  return refreshBasePoints({ ...doc, updatedAt: now, baseGrid: { ...grid, deleted } });
}

/** Bring a deleted base point back as a usable marker (its ties never left the grid). */
export function restoreBasePoint(doc: GardenDocument, id: string, now = new Date().toISOString()): GardenDocument {
  const grid = doc.baseGrid;
  if (!grid?.deleted?.some((d) => d.id === id)) return doc;
  return refreshBasePoints({ ...doc, updatedAt: now, baseGrid: { ...grid, deleted: grid.deleted.filter((d) => d.id !== id) } });
}

export function isDeletedBasePoint(doc: GardenDocument, id: string): boolean {
  return !!doc.baseGrid?.deleted?.some((d) => d.id === id);
}
