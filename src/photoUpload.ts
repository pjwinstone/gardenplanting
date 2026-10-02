/**
 * Upload an original camera file to `/Garden Survey/photos/` and record it
 * on photos/manifest.json.
 *
 * Files at or under 4 MB use a single PUT. Larger files use a Graph upload
 * session (chunks are multiples of 320 KiB). conflictBehavior=fail: an existing
 * name is kept, then accepted only when size and quickXorHash match.
 */

import { photosFolderPath, photosManifestPath, ONEDRIVE_FOLDER } from './cloudConfig';
import type { PhotoQueueRecord } from './photoQueue';
import {
  graphError,
  graphItemUrl,
  upsertManifestPhoto,
  type GraphRequest,
  type ManifestPhoto,
} from './photosManifest';

/** Graph simple-upload limit. */
export const SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** Upload-session fragments must be a multiple of 320 KiB, except the last. */
export const UPLOAD_CHUNK_BYTES = 320 * 1024 * 10;

const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface RemoteFileInfo {
  size: number;
  quickXorHash: string;
}

export function verifyRemoteFile(
  local: { size: number; quickXorHash: string },
  remote: { size?: number; quickXorHash?: string },
): { ok: true } | { ok: false; reason: string } {
  if (typeof remote.size !== 'number' || remote.size !== local.size) {
    return {
      ok: false,
      reason: `Size mismatch (local ${local.size}, OneDrive ${remote.size ?? 'missing'}).`,
    };
  }
  if (!remote.quickXorHash) {
    return { ok: false, reason: 'OneDrive did not return quickXorHash.' };
  }
  if (remote.quickXorHash !== local.quickXorHash) {
    return { ok: false, reason: 'quickXorHash does not match the local file.' };
  }
  return { ok: true };
}

export function manifestEntryFromRecord(record: PhotoQueueRecord): ManifestPhoto {
  return {
    fileName: record.fileName,
    photoId: record.photoId,
    stationId: record.stationId,
    observationId: record.observationId,
    size: record.size,
    quickXorHash: record.quickXorHash,
    capturedAt: record.capturedAt,
    exif: record.exif,
  };
}

/**
 * Upload bytes and require the returned size + quickXorHash to match `localHash`.
 * On name conflict, accept the existing item only when it matches.
 */
export async function uploadAndVerifyOriginal(opts: {
  client: GraphRequest;
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
  localHash: string;
  simpleUploadMaxBytes?: number;
  /** Test hook. Production chunks are multiples of 320 KiB. */
  chunkBytes?: number;
}): Promise<{ ok: true; remote: RemoteFileInfo; existed: boolean } | { ok: false; error: string }> {
  const folder = await ensurePhotosFolder(opts.client);
  if (!folder.ok) return folder;

  const limit = opts.simpleUploadMaxBytes ?? SIMPLE_UPLOAD_MAX_BYTES;
  const itemPath = `${photosFolderPath()}/${opts.fileName}`;
  const uploaded =
    opts.bytes.byteLength <= limit
      ? await simpleUpload(opts.client, itemPath, opts.bytes, opts.contentType)
      : await sessionUpload(opts.client, itemPath, opts.fileName, opts.bytes, opts.chunkBytes);
  if (!uploaded.ok) return uploaded;

  const check = verifyRemoteFile(
    { size: opts.bytes.byteLength, quickXorHash: opts.localHash },
    uploaded.remote,
  );
  if (!check.ok) return { ok: false, error: check.reason };
  return { ok: true, remote: uploaded.remote, existed: uploaded.existed };
}

export async function publishPhotoManifest(opts: {
  client: GraphRequest;
  record: PhotoQueueRecord;
  now: string;
}): Promise<{ ok: true; etag: string } | { ok: false; error: string }> {
  const saved = await upsertManifestPhoto({
    client: opts.client,
    manifestPath: photosManifestPath(),
    entry: manifestEntryFromRecord(opts.record),
    now: opts.now,
  });
  if (!saved.ok) return saved;
  return { ok: true, etag: saved.etag };
}

async function simpleUpload(
  client: GraphRequest,
  itemPath: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ ok: true; remote: RemoteFileInfo; existed: boolean } | { ok: false; error: string }> {
  const url = conflictFailUrl(graphItemUrl(itemPath, ':/content'));
  const res = await client.fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${client.token}`,
      'Content-Type': contentType || 'application/octet-stream',
    },
    body: new Blob([bytes], { type: contentType || 'application/octet-stream' }),
  });
  if (res.status === 409) return readExistingAndReturn(client, itemPath);
  if (!res.ok) return { ok: false, error: await graphError(res) };
  const remote = await remoteFromResponse(client, itemPath, res);
  if (!remote.ok) return remote;
  return { ok: true, remote: remote.info, existed: false };
}

async function sessionUpload(
  client: GraphRequest,
  itemPath: string,
  fileName: string,
  bytes: Uint8Array,
  chunkBytes = UPLOAD_CHUNK_BYTES,
): Promise<{ ok: true; remote: RemoteFileInfo; existed: boolean } | { ok: false; error: string }> {
  const createUrl = graphItemUrl(itemPath, ':/createUploadSession');
  const created = await client.fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${client.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      item: {
        '@microsoft.graph.conflictBehavior': 'fail',
        name: fileName,
      },
    }),
  });
  if (created.status === 409) return readExistingAndReturn(client, itemPath);
  if (!created.ok) return { ok: false, error: await graphError(created) };
  const session = (await created.json()) as { uploadUrl?: string };
  if (!session.uploadUrl) return { ok: false, error: 'OneDrive did not return an upload session.' };

  let start = 0;
  let last: Response | null = null;
  while (start < bytes.byteLength) {
    const end = Math.min(bytes.byteLength, start + chunkBytes);
    const slice = bytes.subarray(start, end);
    last = await client.fetch(session.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes ${start}-${end - 1}/${bytes.byteLength}`,
      },
      body: new Blob([slice]),
    });
    const finished = end === bytes.byteLength;
    if (finished) {
      if (!last.ok) return { ok: false, error: await graphError(last) };
      break;
    }
    if (last.status !== 202 && !last.ok) return { ok: false, error: await graphError(last) };
    start = end;
  }
  if (!last) return { ok: false, error: 'Upload session sent no bytes.' };
  const remote = await remoteFromResponse(client, itemPath, last);
  if (!remote.ok) return remote;
  return { ok: true, remote: remote.info, existed: false };
}

function conflictFailUrl(contentUrl: string): string {
  const join = contentUrl.includes('?') ? '&' : '?';
  return `${contentUrl}${join}${encodeURIComponent('@microsoft.graph.conflictBehavior')}=fail`;
}

async function readExistingAndReturn(
  client: GraphRequest,
  itemPath: string,
): Promise<{ ok: true; remote: RemoteFileInfo; existed: boolean } | { ok: false; error: string }> {
  const info = await fetchRemoteInfo(client, itemPath);
  if (!info.ok) return { ok: false, error: info.error };
  return { ok: true, remote: info.info, existed: true };
}

async function remoteFromResponse(
  client: GraphRequest,
  itemPath: string,
  res: Response,
): Promise<{ ok: true; info: RemoteFileInfo } | { ok: false; error: string }> {
  try {
    const body = (await res.json()) as GraphItem;
    const parsed = parseGraphItem(body);
    if (parsed.quickXorHash && typeof parsed.size === 'number') {
      return { ok: true, info: { size: parsed.size, quickXorHash: parsed.quickXorHash } };
    }
  } catch {
    /* body may be empty — fall through to a metadata read */
  }
  return fetchRemoteInfo(client, itemPath);
}

async function fetchRemoteInfo(
  client: GraphRequest,
  itemPath: string,
): Promise<{ ok: true; info: RemoteFileInfo } | { ok: false; error: string }> {
  const url = `${graphItemUrl(itemPath)}?$select=size,file,name,eTag`;
  const res = await client.fetch(url, {
    headers: { Authorization: `Bearer ${client.token}` },
  });
  if (!res.ok) return { ok: false, error: await graphError(res) };
  try {
    const body = (await res.json()) as GraphItem;
    const parsed = parseGraphItem(body);
    if (typeof parsed.size !== 'number') {
      return { ok: false, error: 'OneDrive item has no size.' };
    }
    return {
      ok: true,
      info: { size: parsed.size, quickXorHash: parsed.quickXorHash ?? '' },
    };
  } catch {
    return { ok: false, error: 'Could not read the OneDrive item.' };
  }
}

interface GraphItem {
  size?: number;
  file?: { hashes?: { quickXorHash?: string } };
}

function parseGraphItem(body: GraphItem): { size?: number; quickXorHash?: string } {
  return {
    size: typeof body.size === 'number' ? body.size : undefined,
    quickXorHash: body.file?.hashes?.quickXorHash,
  };
}

async function ensurePhotosFolder(
  client: GraphRequest,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const root = await ensureFolder(client, null, ONEDRIVE_FOLDER);
  if (!root.ok) return root;
  return ensureFolder(client, ONEDRIVE_FOLDER, 'photos');
}

async function ensureFolder(
  client: GraphRequest,
  parentPath: string | null,
  name: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = parentPath
    ? `${graphItemUrl(parentPath)}:/children`
    : `${GRAPH}/me/drive/root/children`;
  const res = await client.fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${client.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    }),
  });
  if (res.ok || res.status === 409) return { ok: true };
  const detail = await graphError(res);
  if (res.status === 405 || /nameAlreadyExists/i.test(detail)) return { ok: true };
  return { ok: false, error: detail };
}
