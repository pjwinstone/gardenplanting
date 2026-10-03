/** OneDrive garden JSON via Microsoft Graph. Folder: /Garden Survey/ */

import type { GardenDocument } from './model';
import {
  ONEDRIVE_FILE,
  ONEDRIVE_FOLDER,
  getGardenCloudFileName,
  onedrivePathFor,
} from './cloudConfig';
import { acquireGraphToken, acquireGraphTokenSilent } from './msalAuth';
import { normalizeDocument } from './model';

const GRAPH = 'https://graph.microsoft.com/v1.0';

export type CloudSaveResult =
  | { ok: true; savedAt: string; fileName: string; eTag?: string }
  | { ok: false; error: string; missing?: boolean; conflict?: boolean };

export type CloudLoadResult =
  | {
      ok: true;
      doc: GardenDocument;
      loadedAt: string;
      fileName: string;
      /** Item eTag. Send it back as If-Match on the next save. */
      eTag?: string;
      /** Document `updatedAt`, or the drive item's lastModifiedDateTime. */
      remoteUpdatedAt?: string;
      /** Opened legacy `garden.json` because the preferred file was missing. */
      usedLegacy?: boolean;
      /** Preferred name that was missing when a fallback file was opened. */
      fallbackFrom?: string;
    }
  | { ok: false; error: string; missing?: boolean };

export type GardenCloudFile = { name: string; lastModified?: string };

function itemBaseUrl(fileName: string): string {
  const path = onedrivePathFor(fileName);
  const encoded = encodeURIComponent(path).replace(/%2F/g, '/');
  return `${GRAPH}/me/drive/root:/${encoded}`;
}

function itemContentUrl(fileName: string): string {
  return `${itemBaseUrl(fileName)}:/content`;
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

/** Silent token for background saves. Never redirects. */
export async function silentGraphToken(): Promise<
  { ok: true; token: string } | { ok: false; interactionRequired: boolean; error: string }
> {
  return acquireGraphTokenSilent();
}

async function ensureFolder(
  token: string,
  fetchImpl: typeof fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetchImpl(`${GRAPH}/me/drive/root/children`, {
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
  console.warn('Garden Planting: folder ensure', detail);
  return { ok: true };
}

export interface SaveGardenOptions {
  /** When set, Graph rejects the write with 412 if the file has moved on. */
  ifMatch?: string;
  fetchImpl?: typeof fetch;
}

export async function saveGardenToOneDrive(
  doc: GardenDocument,
  fileName = getGardenCloudFileName(),
  token?: string,
  opts?: SaveGardenOptions,
): Promise<CloudSaveResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const auth = token ? { ok: true as const, token } : await withToken();
  if (!auth.ok) return { ok: false, error: auth.error };

  const folder = await ensureFolder(auth.token, fetchImpl);
  if (!folder.ok) return { ok: false, error: folder.error };

  const body = JSON.stringify(doc, null, 2);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
    'Content-Type': 'application/json',
  };
  if (opts?.ifMatch) headers['If-Match'] = opts.ifMatch;
  const res = await fetchImpl(itemContentUrl(fileName), {
    method: 'PUT',
    headers,
    body,
  });

  if (res.status === 412) {
    return {
      ok: false,
      conflict: true,
      error: `${fileName} changed on OneDrive. Choose which copy to keep.`,
    };
  }

  if (!res.ok) {
    const detail = await readGraphError(res);
    return { ok: false, error: plainGraphStatus(res.status, detail, fileName) };
  }

  return { ok: true, savedAt: new Date().toISOString(), fileName, eTag: await etagFromResponse(res) };
}

async function loadNamedFile(
  token: string,
  fileName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CloudLoadResult> {
  // Item metadata keeps the eTag. A GET of `:/content` follows a 302 and drops it.
  const select = encodeURIComponent('eTag,lastModifiedDateTime,@microsoft.graph.downloadUrl');
  const metaRes = await fetchImpl(`${itemBaseUrl(fileName)}?$select=${select}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (metaRes.status === 404) {
    return {
      ok: false,
      missing: true,
      error: `No ${fileName} on OneDrive yet (looked for /${onedrivePathFor(fileName)}).`,
    };
  }

  if (!metaRes.ok) {
    const detail = await readGraphError(metaRes);
    return { ok: false, error: plainGraphStatus(metaRes.status, detail, fileName) };
  }

  let eTag: string | undefined;
  let lastModified: string | undefined;
  let downloadUrl = '';
  try {
    const meta = (await metaRes.json()) as {
      eTag?: unknown;
      lastModifiedDateTime?: unknown;
      '@microsoft.graph.downloadUrl'?: unknown;
    };
    eTag = typeof meta.eTag === 'string' ? meta.eTag : undefined;
    lastModified = typeof meta.lastModifiedDateTime === 'string' ? meta.lastModifiedDateTime : undefined;
    downloadUrl =
      typeof meta['@microsoft.graph.downloadUrl'] === 'string' ? meta['@microsoft.graph.downloadUrl'] : '';
  } catch {
    return { ok: false, error: `Could not read ${fileName} from OneDrive.` };
  }

  const bodyRes = downloadUrl
    ? await fetchImpl(downloadUrl, { method: 'GET' })
    : await fetchImpl(itemContentUrl(fileName), {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

  if (bodyRes.status === 404) {
    return {
      ok: false,
      missing: true,
      error: `No ${fileName} on OneDrive yet (looked for /${onedrivePathFor(fileName)}).`,
    };
  }
  if (!bodyRes.ok) {
    const detail = await readGraphError(bodyRes);
    return { ok: false, error: plainGraphStatus(bodyRes.status, detail, fileName) };
  }

  const bodyEtag = bodyRes.headers.get('etag') || bodyRes.headers.get('ETag') || undefined;
  try {
    const parsed = (await bodyRes.json()) as GardenDocument;
    if (parsed?.version !== 1 || !Array.isArray(parsed.points)) {
      return { ok: false, error: `${fileName} is not a garden.json v1 document.` };
    }
    const doc = normalizeDocument(parsed);
    if (!doc.updatedAt && lastModified) doc.updatedAt = lastModified;
    const remoteUpdatedAt = doc.updatedAt || lastModified;
    return {
      ok: true,
      doc,
      loadedAt: new Date().toISOString(),
      fileName,
      eTag: eTag || bodyEtag,
      remoteUpdatedAt,
    };
  } catch {
    return { ok: false, error: `Could not read ${fileName} from OneDrive (invalid JSON).` };
  }
}

/**
 * Load the last-loaded / chosen garden file.
 * If missing: try other garden*.json from the folder (newest first), then legacy
 * `garden.json`, else report empty (caller keeps local cache).
 */
export async function loadGardenFromOneDrive(
  fileName = getGardenCloudFileName(),
  opts?: { token?: string; fetchImpl?: typeof fetch },
): Promise<CloudLoadResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const auth = opts?.token ? { ok: true as const, token: opts.token } : await withToken();
  if (!auth.ok) return { ok: false, error: auth.error };

  const primary = await loadNamedFile(auth.token, fileName, fetchImpl);
  if (primary.ok || !primary.missing) return primary;

  const tried = new Set<string>([fileName]);
  const listed = await listGardenFilesWithToken(auth.token);
  const candidates: string[] = [];

  if (listed.ok) {
    const gardenish = listed.files
      .filter((f) => /^garden/i.test(f.name) && !tried.has(f.name))
      .sort((a, b) => {
        const at = a.lastModified ? Date.parse(a.lastModified) : 0;
        const bt = b.lastModified ? Date.parse(b.lastModified) : 0;
        return bt - at;
      });
    for (const f of gardenish) candidates.push(f.name);
  }

  if (!tried.has(ONEDRIVE_FILE) && !candidates.includes(ONEDRIVE_FILE)) {
    candidates.push(ONEDRIVE_FILE);
  }

  for (const alt of candidates) {
    if (tried.has(alt)) continue;
    tried.add(alt);
    const next = await loadNamedFile(auth.token, alt, fetchImpl);
    if (next.ok) {
      return {
        ...next,
        usedLegacy: alt === ONEDRIVE_FILE,
        fallbackFrom: fileName,
      };
    }
    if (!next.missing) return next;
  }

  return {
    ok: false,
    missing: true,
    error: `No garden file on OneDrive yet (tried ${[...tried].join(', ')}). Save once from this device first.`,
  };
}

async function listGardenFilesWithToken(
  token: string,
): Promise<{ ok: true; files: GardenCloudFile[] } | { ok: false; error: string }> {
  const res = await fetch(folderChildrenUrl(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
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

/** List JSON garden files in /Garden Survey (garden*.json preferred, all .json included). */
export async function listGardenFilesOnOneDrive(): Promise<
  { ok: true; files: GardenCloudFile[] } | { ok: false; error: string }
> {
  const auth = await withToken();
  if (!auth.ok) return { ok: false, error: auth.error };
  return listGardenFilesWithToken(auth.token);
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

async function etagFromResponse(res: Response): Promise<string | undefined> {
  const header = res.headers.get('etag') || res.headers.get('ETag') || '';
  if (header) return header;
  try {
    const body = (await res.clone().json()) as { eTag?: unknown };
    return typeof body.eTag === 'string' ? body.eTag : undefined;
  } catch {
    return undefined;
  }
}

function isSpoLicenseError(detail: string): boolean {
  return /SPO\s*license|SharePointOnline|does not have a SPO|no SPO license|SPOLicense/i.test(
    detail,
  );
}
