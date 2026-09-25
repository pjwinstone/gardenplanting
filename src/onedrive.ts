/** OneDrive garden.json via Microsoft Graph. Path: /Garden Survey/garden.json */

import type { GardenDocument } from './model';
import { ONEDRIVE_FOLDER, ONEDRIVE_PATH } from './cloudConfig';
import { acquireGraphToken } from './msalAuth';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export type CloudSaveResult =
  | { ok: true; savedAt: string }
  | { ok: false; error: string; missing?: boolean };

export type CloudLoadResult =
  | { ok: true; doc: GardenDocument; loadedAt: string }
  | { ok: false; error: string; missing?: boolean };

function itemContentUrl(): string {
  const encoded = encodeURIComponent(ONEDRIVE_PATH).replace(/%2F/g, '/');
  return `${GRAPH}/me/drive/root:/${encoded}:/content`;
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
  // Already exists under another conflict code, or race — try upload anyway if not auth.
  if (res.status === 405 || /nameAlreadyExists/i.test(detail)) return { ok: true };
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: plainGraphStatus(res.status, detail) };
  }
  // Non-fatal: PUT may still create the path on personal OneDrive.
  console.warn('Garden Survey: folder ensure', detail);
  return { ok: true };
}

export async function saveGardenToOneDrive(doc: GardenDocument): Promise<CloudSaveResult> {
  const auth = await withToken();
  if (!auth.ok) return { ok: false, error: auth.error };

  const folder = await ensureFolder(auth.token);
  if (!folder.ok) return { ok: false, error: folder.error };

  const body = JSON.stringify(doc, null, 2);
  const res = await fetch(itemContentUrl(), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const detail = await readGraphError(res);
    return { ok: false, error: plainGraphStatus(res.status, detail) };
  }

  return { ok: true, savedAt: new Date().toISOString() };
}

export async function loadGardenFromOneDrive(): Promise<CloudLoadResult> {
  const auth = await withToken();
  if (!auth.ok) return { ok: false, error: auth.error };

  const res = await fetch(itemContentUrl(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${auth.token}` },
  });

  if (res.status === 404) {
    return {
      ok: false,
      missing: true,
      error: `No garden.json on OneDrive yet (looked for /${ONEDRIVE_PATH}). Save once from this device first.`,
    };
  }

  if (!res.ok) {
    const detail = await readGraphError(res);
    return { ok: false, error: plainGraphStatus(res.status, detail) };
  }

  try {
    const parsed = (await res.json()) as GardenDocument;
    if (parsed?.version !== 1 || !Array.isArray(parsed.points)) {
      return { ok: false, error: 'OneDrive file is not a garden.json v1 document.' };
    }
    return { ok: true, doc: parsed, loadedAt: new Date().toISOString() };
  } catch {
    return { ok: false, error: 'Could not read garden.json from OneDrive (invalid JSON).' };
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

function plainGraphStatus(status: number, detail: string): string {
  if (status === 401) {
    return 'Microsoft says the session expired. Sign in again.';
  }
  if (status === 403) {
    return 'OneDrive access was denied. Check Files.ReadWrite permission on the Entra app registration.';
  }
  if (status === 404) {
    return `Could not find /${ONEDRIVE_PATH} on OneDrive.`;
  }
  if (status >= 500) {
    return `OneDrive is temporarily unavailable (${status}). Try again in a moment.`;
  }
  return detail || `OneDrive request failed (${status}).`;
}
