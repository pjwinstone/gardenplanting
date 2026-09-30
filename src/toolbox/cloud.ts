/** Toolbox: OneDrive save/load — no coach copy. */

import type { GardenDocument } from '../model';
import {
  listGardenFilesOnOneDrive,
  loadGardenFromOneDrive,
  saveGardenToOneDrive,
  type CloudLoadResult,
  type CloudSaveResult,
  type GardenCloudFile,
} from '../onedrive';
import { getGardenCloudFileName } from '../cloudConfig';

export async function saveGardenCloud(
  doc: GardenDocument,
  fileName = getGardenCloudFileName(),
): Promise<CloudSaveResult> {
  return saveGardenToOneDrive(doc, fileName);
}

export async function loadGardenCloud(
  fileName = getGardenCloudFileName(),
): Promise<CloudLoadResult> {
  return loadGardenFromOneDrive(fileName);
}

export async function listGardenCloudFiles(): Promise<
  { ok: true; files: GardenCloudFile[] } | { ok: false; error: string }
> {
  return listGardenFilesOnOneDrive();
}

export type { CloudLoadResult, CloudSaveResult, GardenCloudFile };
