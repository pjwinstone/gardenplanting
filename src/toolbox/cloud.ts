/** Toolbox: OneDrive save/load — no coach copy. */

import type { GardenDocument } from '../model';
import {
  loadGardenFromOneDrive,
  saveGardenToOneDrive,
  type CloudLoadResult,
  type CloudSaveResult,
} from '../onedrive';

export async function saveGardenCloud(doc: GardenDocument): Promise<CloudSaveResult> {
  return saveGardenToOneDrive(doc);
}

export async function loadGardenCloud(): Promise<CloudLoadResult> {
  return loadGardenFromOneDrive();
}

export type { CloudLoadResult, CloudSaveResult };
