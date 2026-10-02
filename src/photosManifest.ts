/**
 * photos/manifest.json — one entry per original camera file.
 * Writes use If-Match / If-None-Match so two devices don't drop each other's photos.
 */

import type { SurveyExif } from './photoExif';

export interface ManifestPhoto {
  fileName: string;
  photoId: string;
  stationId: string;
  observationId?: string;
  size: number;
  quickXorHash: string;
  capturedAt: string;
  exif: SurveyExif;
}

export interface PhotosManifest {
  version: 1;
  updatedAt: string;
  photos: ManifestPhoto[];
}

export interface GraphRequest {
  fetch: typeof fetch;
  token: string;
}

const GRAPH = 'https://graph.microsoft.com/v1.0';

export function mergeManifestEntry(
  existing: PhotosManifest | null | undefined,
  entry: ManifestPhoto,
  now: string,
): PhotosManifest {
  const prior = (existing?.photos ?? []).filter(
    (p) => p && typeof p.fileName === 'string' && typeof p.photoId === 'string',
  );
  const photos = [...prior];
  const idx = photos.findIndex((p) => p.fileName === entry.fileName || p.photoId === entry.photoId);
  if (idx >= 0) photos[idx] = entry;
  else photos.push(entry);
  return { version: 1, updatedAt: now, photos };
}

export function graphItemUrl(drivePath: string, suffix: '' | ':/content' | ':/createUploadSession' = ''): string {
  const encoded = drivePath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${GRAPH}/me/drive/root:/${encoded}${suffix}`;
}

export async function upsertManifestPhoto(opts: {
  client: GraphRequest;
  /** Full drive path, e.g. `Garden Survey/photos/manifest.json`. */
  manifestPath: string;
  entry: ManifestPhoto;
  now: string;
  maxAttempts?: number;
}): Promise<{ ok: true; etag: string; manifest: PhotosManifest } | { ok: false; error: string }> {
  const attempts = opts.maxAttempts ?? 4;
  let lastError = 'Manifest update did not finish.';
  for (let i = 0; i < attempts; i++) {
    const current = await readManifest(opts.client, opts.manifestPath);
    if (!current.ok && !current.missing) return { ok: false, error: current.error };
    const next = mergeManifestEntry(current.ok ? current.manifest : null, opts.entry, opts.now);
    const put = await writeManifest(opts.client, opts.manifestPath, next, current.ok ? current.etag : null);
    if (put.ok) return { ok: true, etag: put.etag, manifest: next };
    if (put.conflict) {
      lastError = put.error;
      continue;
    }
    return { ok: false, error: put.error };
  }
  return { ok: false, error: lastError };
}

async function readManifest(
  client: GraphRequest,
  manifestPath: string,
): Promise<
  | { ok: true; manifest: PhotosManifest; etag: string }
  | { ok: false; missing: true }
  | { ok: false; missing?: false; error: string }
> {
  const res = await client.fetch(graphItemUrl(manifestPath, ':/content'), {
    method: 'GET',
    headers: { Authorization: `Bearer ${client.token}` },
  });
  if (res.status === 404) return { ok: false, missing: true };
  if (!res.ok) return { ok: false, error: await graphError(res) };
  const etag = res.headers.get('etag') || res.headers.get('ETag') || '';
  try {
    const body = (await res.json()) as PhotosManifest;
    const manifest: PhotosManifest = {
      version: 1,
      updatedAt: typeof body?.updatedAt === 'string' ? body.updatedAt : '',
      photos: Array.isArray(body?.photos) ? body.photos : [],
    };
    return { ok: true, manifest, etag };
  } catch {
    return { ok: false, error: 'photos/manifest.json is not valid JSON.' };
  }
}

async function writeManifest(
  client: GraphRequest,
  manifestPath: string,
  manifest: PhotosManifest,
  etag: string | null,
): Promise<{ ok: true; etag: string } | { ok: false; conflict?: boolean; error: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${client.token}`,
    'Content-Type': 'application/json',
  };
  if (etag) headers['If-Match'] = etag;
  else headers['If-None-Match'] = '*';

  const res = await client.fetch(graphItemUrl(manifestPath, ':/content'), {
    method: 'PUT',
    headers,
    body: JSON.stringify(manifest, null, 2),
  });
  if (res.status === 412 || res.status === 409) {
    return { ok: false, conflict: true, error: 'Manifest changed while saving. Retrying.' };
  }
  if (!res.ok) return { ok: false, error: await graphError(res) };
  const nextEtag = res.headers.get('etag') || res.headers.get('ETag') || etag || '';
  return { ok: true, etag: nextEtag };
}

export async function graphError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string; code?: string } };
    return j.error?.message || j.error?.code || `${res.status}`;
  } catch {
    return res.statusText || `${res.status}`;
  }
}
