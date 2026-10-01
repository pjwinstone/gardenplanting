/** Toolbox: document create / local persist / import-export — no coach copy. */

import type { GardenDocument } from '../model';
import { emptyDocument, syntheticDocument } from '../model';
import {
  saveDocument,
  exportGardenJson,
  importGardenJson,
  loadDocument,
  clearDocument,
  isQuotaExceededMessage,
} from '../storage';

export function loadCachedGarden(): GardenDocument | null {
  return loadDocument();
}

export function createEmptyGarden(name?: string): GardenDocument {
  return emptyDocument(name);
}

export function createSyntheticGarden(): GardenDocument {
  return syntheticDocument();
}

export function persistGardenLocal(
  doc: GardenDocument,
): { ok: true } | { ok: false; error: string; quotaExceeded?: boolean } {
  const result = saveDocument(doc);
  if (result.ok) return { ok: true };
  return {
    ok: false,
    error: result.error ?? 'localStorage save failed',
    quotaExceeded: result.quotaExceeded || isQuotaExceededMessage(result.error),
  };
}

/** Drop the slim local draft (does not touch OneDrive or in-memory work). */
export function clearCachedGarden(): void {
  clearDocument();
}

export function exportGarden(doc: GardenDocument): void {
  exportGardenJson(doc);
}

export async function importGarden(file: File): Promise<GardenDocument> {
  return importGardenJson(file);
}
