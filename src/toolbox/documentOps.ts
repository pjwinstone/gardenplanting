/** Toolbox: document create / local persist / import-export — no coach copy. */

import type { GardenDocument } from '../model';
import { emptyDocument, syntheticDocument } from '../model';
import {
  saveDocument,
  exportGardenJson,
  importGardenJson,
  loadDocument,
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
): { ok: true } | { ok: false; error: string } {
  const result = saveDocument(doc);
  if (result.ok) return { ok: true };
  return { ok: false, error: result.error ?? 'localStorage save failed' };
}

export function exportGarden(doc: GardenDocument): void {
  exportGardenJson(doc);
}

export async function importGarden(file: File): Promise<GardenDocument> {
  return importGardenJson(file);
}
