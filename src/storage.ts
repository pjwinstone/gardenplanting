/** localStorage + export/import garden.json */

import type { GardenDocument, Photo } from './model';
import { emptyDocument, normalizeDocument } from './model';

const STORAGE_KEY = 'garden-survey:document';

/** Real camera/gallery thumbs — too large for localStorage at scale. */
const HEAVY_THUMB_RE = /^data:image\/(jpeg|jpg|png|webp)/i;

export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return typeof err === 'string' && /quota/i.test(err);
  }
  const e = err as { name?: string; code?: number; message?: string };
  if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (e.code === 22 || e.code === 1014) return true;
  return typeof e.message === 'string' && /quota/i.test(e.message);
}

export function isQuotaExceededMessage(message: string | undefined): boolean {
  return Boolean(message && /quota/i.test(message));
}

/**
 * Browser-cache copy: drop heavy photo dataUrls so localStorage stays small.
 * In-memory + OneDrive keep full thumbs; local draft is geometry/metadata only.
 */
export function slimDocumentForLocalCache(doc: GardenDocument): GardenDocument {
  const photos = (doc.photos ?? []).map((p): Photo => {
    const thumb = p.thumbnailDataUrl;
    if (thumb && HEAVY_THUMB_RE.test(thumb)) {
      return { ...p, thumbnailDataUrl: undefined };
    }
    return p;
  });
  return { ...doc, photos };
}

export function loadDocument(): GardenDocument | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GardenDocument;
    if (parsed?.version !== 1) return null;
    return normalizeDocument(parsed);
  } catch {
    return null;
  }
}

export type SaveDocumentResult = {
  ok: boolean;
  error?: string;
  quotaExceeded?: boolean;
};

/** Persist slim local draft; never throw — a storage failure must not freeze the UI. */
export function saveDocument(doc: GardenDocument): SaveDocumentResult {
  const payload = JSON.stringify(slimDocumentForLocalCache(doc));
  try {
    localStorage.setItem(STORAGE_KEY, payload);
    return { ok: true };
  } catch (e) {
    // Replacing a fat legacy value often needs remove-then-set (old+new counted together).
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_KEY, payload);
      return { ok: true };
    } catch (e2) {
      const error = e2 instanceof Error ? e2.message : 'localStorage save failed';
      console.warn('Garden Planting: could not persist document', error);
      return { ok: false, error, quotaExceeded: isQuotaExceededError(e2) || isQuotaExceededError(e) };
    }
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
  return normalizeDocument(parsed);
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
