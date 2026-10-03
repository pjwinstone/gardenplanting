/**
 * photos/manifest.json — one entry per original camera file.
 * Writes use If-Match / If-None-Match so two devices don't drop each other's photos.
 *
 * Graph GET …:/content answers 302 to a preauthenticated download, and a browser
 * fetch follows that redirect without the ETag. Read item metadata
 * (`eTag` and `@microsoft.graph.downloadUrl`) and fetch the download URL.
 * The metadata eTag is the If-Match value.
 */

import type { AppleMakerNote, SurveyExif } from './photoExif';

/** `image.jpg` from the system camera sheet, with no Make tag. Otherwise a library pick. */
export type PhotoProvenance = 'camera-path' | 'library';

/**
 * Clicks are stored in the display preview's pixel space.
 * `full = (previewPx + 0.5) / previewScale - 0.5`.
 */
export const PIXEL_CENTRE = '+0.5' as const;

export interface ManifestPhoto {
  fileName: string;
  photoId: string;
  stationId: string;
  observationId?: string;
  size: number;
  quickXorHash: string;
  sha256: string;
  /** Wall clock when this app received the file. */
  receivedAt: string;
  /** EXIF DateTimeOriginal + SubSec + offset, when the file has one. */
  capturedAt?: string;
  provenance: PhotoProvenance;
  exif: SurveyExif;
  makerNote?: AppleMakerNote;
  /** Make|Model|LensModel|FocalLength|pixel size. */
  calibrationKey: string;
  /** Decoded bitmap size (`createImageBitmap`). */
  fullWidth?: number;
  fullHeight?: number;
  previewWidth?: number;
  previewHeight?: number;
  previewScale?: number;
  pixelCentre: typeof PIXEL_CENTRE;
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

/**
 * Item metadata, then the preauthenticated download URL.
 * A GET of `:/content` is not used: Graph responds 302 and the ETag is lost.
 */
async function readManifest(
  client: GraphRequest,
  manifestPath: string,
): Promise<
  | { ok: true; manifest: PhotosManifest; etag: string }
  | { ok: false; missing: true }
  | { ok: false; missing?: false; error: string }
> {
  const select = encodeURIComponent('eTag,@microsoft.graph.downloadUrl');
  const metaUrl = `${graphItemUrl(manifestPath)}?$select=${select}`;
  const res = await client.fetch(metaUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${client.token}` },
  });
  if (res.status === 404) return { ok: false, missing: true };
  if (!res.ok) return { ok: false, error: await graphError(res) };

  let meta: { eTag?: unknown; '@microsoft.graph.downloadUrl'?: unknown };
  try {
    meta = (await res.json()) as { eTag?: unknown; '@microsoft.graph.downloadUrl'?: unknown };
  } catch {
    return { ok: false, error: 'Could not read photos manifest metadata.' };
  }
  const etag = typeof meta.eTag === 'string' ? meta.eTag : '';
  const downloadUrl =
    typeof meta['@microsoft.graph.downloadUrl'] === 'string' ? meta['@microsoft.graph.downloadUrl'] : '';
  if (!etag) {
    return {
      ok: false,
      error: 'photos/manifest.json has no eTag, so it was not overwritten.',
    };
  }
  if (!downloadUrl) {
    return { ok: false, error: 'photos/manifest.json has no download URL.' };
  }

  const bodyRes = await client.fetch(downloadUrl, { method: 'GET' });
  if (!bodyRes.ok) return { ok: false, error: await graphError(bodyRes) };
  try {
    const body = (await bodyRes.json()) as PhotosManifest;
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
  const nextEtag = (await etagFromPut(res)) || etag || '';
  return { ok: true, etag: nextEtag };
}

async function etagFromPut(res: Response): Promise<string> {
  const header = res.headers.get('etag') || res.headers.get('ETag') || '';
  if (header) return header;
  try {
    const body = (await res.json()) as { eTag?: unknown };
    return typeof body?.eTag === 'string' ? body.eTag : '';
  } catch {
    return '';
  }
}

export async function graphError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string; code?: string } };
    return j.error?.message || j.error?.code || `${res.status}`;
  } catch {
    return res.statusText || `${res.status}`;
  }
}
