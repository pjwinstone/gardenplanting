/** localStorage + export/import garden.json */

import type { GardenDocument } from './model';
import { emptyDocument } from './model';

const STORAGE_KEY = 'garden-survey:document';

export function loadDocument(): GardenDocument | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GardenDocument;
    if (parsed?.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist document; never throw — a storage failure must not freeze the UI. */
export function saveDocument(doc: GardenDocument): { ok: boolean; error?: string } {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'localStorage save failed';
    console.warn('Garden Survey: could not persist document', error);
    return { ok: false, error };
  }
}

export function clearDocument(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function exportGardenJson(doc: GardenDocument): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug(doc.name) || 'garden'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importGardenJson(file: File): Promise<GardenDocument> {
  const text = await file.text();
  const parsed = JSON.parse(text) as GardenDocument;
  if (parsed?.version !== 1 || !Array.isArray(parsed.points)) {
    throw new Error('Not a garden.json v1 document.');
  }
  return parsed;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function ensureDocument(): GardenDocument {
  return loadDocument() ?? emptyDocument();
}
