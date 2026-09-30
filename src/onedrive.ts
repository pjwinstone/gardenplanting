/** OneDrive garden JSON via Microsoft Graph. Folder: /Garden Survey/ */

import type { GardenDocument } from './model';
import {
  ONEDRIVE_FILE,
  ONEDRIVE_FOLDER,
  getGardenCloudFileName,
  onedrivePathFor,
} from './cloudConfig';
import { acquireGraphToken } from './msalAuth';
import { normalizeDocument } from './model';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export type CloudSaveResult =
  | { ok: true; savedAt: string; fileName: string }
  | { ok: false; error: string; missing?: boolean };

export type CloudLoadResult =
  | { ok: true; doc: GardenDocument; loadedAt: string; fileName: string; usedLegacy?: boolean }
  | { ok: false; error: string; missing?: boolean };

export type GardenCloudFile = { name: string; lastModified?: string };

function itemContentUrl(fileName: string): string {
  const path = onedrivePathFor(fileName);
  const encoded = encodeURIComponent(path).replace(/%2F/g, '/');
  return `${GRAPH}/me/drive/root:/${encoded}:/content`;
}

function folderChildrenUrl(): string {
  const encoded = encodeURIComponent(ONEDRIVE_FOLDER).replace(/%2F/g, '/');
  return `${GRAPH}/me/drive/root:/${encoded}:/children?$select=name,lastModifiedDateTime&$top=200`;
}

async function withToken(): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  return acquireGraphToken();
}

async function ensureFolder(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${GRAPH}/me/drive/root/children`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: ONEDRIVE_FOLDER,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    }),
  });
  if (res.ok || res.status === 409) return { ok: true };
  const detail = await readGraphError(res);
  if (res.status === 405 || /nameAlreadyExists/i.test(detail)) return { ok: true };
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: plainGraphStatus(res.status, detail, ONEDRIVE_FILE) };
  }
  console.warn('Garden Survey: folder ensure', detail);
  return { ok: true };
}

export async function saveGardenToOneDrive(
  doc: GardenDocument,
  fileName = getGardenCloudFileName(),
): Promise<CloudSaveResult> {
  const auth = await withToken();
  if (!auth.ok) return { ok: false, error: auth.error };

  const folder = await ensureFolder(auth.token);
  if (!folder.ok) return { ok: false, error: folder.error };

  const body = JSON.stringify(doc, null, 2);
  const res = await fetch(itemContentUrl(fileName), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const detail = await readGraphError(res);
    return { ok: false, error: plainGraphStatus(res.status, detail, fileName) };
  }

  return { ok: true, savedAt: new Date().toISOString(), fileName };
}

async function loadNamedFile(
  token: string,
  fileName: string,
): Promise<CloudLoadResult> {
  const res = await fetch(itemContentUrl(fileName), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 404) {
    return {
      ok: false,
      missing: true,
      error: `No ${fileName} on OneDrive yet (looked for /${onedrivePathFor(fileName)}).`,
    };
  }

  if (!res.ok) {
    const detail = await readGraphError(res);
    return { ok: false, error: plainGraphStatus(res.status, detail, fileName) };
  }

  try {
    const parsed = (await res.json()) as GardenDocument;
    if (parsed?.version !== 1 || !Array.isArray(parsed.points)) {
      return { ok: false, error: `${fileName} is not a garden.json v1 document.` };
    }
    return {
      ok: true,
      doc: normalizeDocument(parsed),
      loadedAt: new Date().toISOString(),
      fileName,
    };
  } catch {
    return { ok: false, error: `Could not read ${fileName} from OneDrive (invalid JSON).` };
  }
}

/**
 * Load the chosen (or current) garden file. If missing and not legacy,
 * fall back to `garden.json` when present.
 */
export async function loadGardenFromOneDrive(
  fileName = getGardenCloudFileName(),
): Promise<CloudLoadResult> {
  const auth = await withToken();
  if (!auth.ok) return { ok: false, error: auth.error };

  const primary = await loadNamedFile(auth.token, fileName);
  if (primary.ok || !primary.missing) return primary;

  if (fileName !== ONEDRIVE_FILE) {
    const legacy = await loadNamedFile(auth.token, ONEDRIVE_FILE);
    if (legacy.ok) {
      return { ...legacy, usedLegacy: true };
    }
  }

  return {
    ok: false,
    missing: true,
    error: `No garden file on OneDrive yet (tried ${fileName}${fileName !== ONEDRIVE_FILE ? ` and ${ONEDRIVE_FILE}` : ''}). Save once from this device first.`,
  };
}

/** List JSON garden files in /Garden Survey (garden*.json preferred, all .json included). */
export async function listGardenFilesOnOneDrive(): Promise<
  { ok: true; files: GardenCloudFile[] } | { ok: false; error: string }
> {
  const auth = await withToken();
  if (!auth.ok) return { ok: false, error: auth.error };

  const res = await fetch(folderChildrenUrl(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${auth.token}` },
  });

  if (res.status === 404) {
    return { ok: true, files: [] };
  }
  if (!res.ok) {
    const detail = await readGraphError(res);
    return { ok: false, error: plainGraphStatus(res.status, detail, ONEDRIVE_FILE) };
  }

  try {
    const payload = (await res.json()) as {
      value?: Array<{ name?: string; lastModifiedDateTime?: string }>;
    };
    const files = (payload.value ?? [])
      .filter((item) => typeof item.name === 'string' && /\.json$/i.test(item.name))
      .map((item) => ({
        name: item.name!,
        lastModified: item.lastModifiedDateTime,
      }))
      .sort((a, b) => {
        const ag = /^garden/i.test(a.name) ? 0 : 1;
        const bg = /^garden/i.test(b.name) ? 0 : 1;
        if (ag !== bg) return ag - bg;
        return a.name.localeCompare(b.name);
      });
    return { ok: true, files };
  } catch {
    return { ok: false, error: 'Could not list OneDrive garden files.' };
  }
}

async function readGraphError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string; code?: string } };
    return j.error?.message || j.error?.code || res.statusText;
  } catch {
    return res.statusText || String(res.status);
  }
}

function plainGraphStatus(status: number, detail: string, fileName: string): string {
  if (isSpoLicenseError(detail)) {
    return (
      'This Microsoft account’s organisation has no OneDrive/SharePoint licence. ' +
      'Sign out, then sign in with a personal Microsoft account that has OneDrive ' +
      '(for example outlook.com / hotmail.com / live.com) — not a work account without M365.'
    );
  }
  if (status === 401) {
    return 'Microsoft says the session expired. Sign in again.';
  }
  if (status === 403) {
    return 'OneDrive access was denied. Check Files.ReadWrite permission on the Entra app registration.';
  }
  if (status === 404) {
    return `Could not find /${onedrivePathFor(fileName)} on OneDrive.`;
  }
  if (status >= 500) {
    return `OneDrive is temporarily unavailable (${status}). Try again in a moment.`;
  }
  return detail || `OneDrive request failed (${status}).`;
}

function isSpoLicenseError(detail: string): boolean {
  return /SPO\s*license|SharePointOnline|does not have a SPO|no SPO license|SPOLicense/i.test(
    detail,
  );
}
