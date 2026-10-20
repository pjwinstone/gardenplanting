/**
 * Photo archive (Paul's decisions, docs/photo-archive.md).
 *
 * - Live photos stay on the phone (the original in the photo queue) and in OneDrive (photos/).
 * - A photo superseded by a Retake is moved in OneDrive to photos/archive/<run>/ (Graph move,
 *   never a DELETE), its manifest row gets archivedAt + archivePath, the phone copy is deleted,
 *   and a log record is kept on the run. A failure goes to the error log (patched in place, no
 *   full redraw) and is retried later with backoff.
 * - Set-up "Clean out archive" lists archived files older than the archive age (default 90 days,
 *   tolerances.json photoArchiveMaxAgeDays, editable in Set-up) with their total size and deletes
 *   them only after confirmation. Live photos, including finished runs', are never touched.
 * - Photo consistency check: every referenced photo must be on the phone and/or in OneDrive.
 */
import type { GardenDocument, Photo } from './model';
import { archivePhotosFolderPath, archiveRunFolderName, ONEDRIVE_PHOTOS_ARCHIVE_DIR, photosFolderPath, photosManifestPath } from './cloudConfig';
import { graphError, graphItemUrl, readManifest, writeManifest, type GraphRequest, type PhotosManifest } from './photosManifest';
import { ensureFolder, ensurePhotosFolder } from './photoUpload';
import type { PhotoQueue } from './photoQueue';
import tolerances from '../workflow/tolerances.json';

export const PHOTO_ARCHIVE_MAX_AGE_DAYS: number = tolerances.photoArchiveMaxAgeDays;

const DAY_MS = 86_400_000;

export interface ArchiveJob {
  photoId: string;
  fileName: string;
  stepId: string;
  runStartedAt: string;
  supersededAt: string;
  /** 'retake': superseded by a Retake; 'orphan': in photos/ but not referenced by the survey. */
  reason: 'retake' | 'orphan';
}

export interface ArchiveLogEntry {
  at: string;
  action: 'archived' | 'deleted';
  photoId?: string;
  fileName: string;
  stepId?: string;
  /** Drive path relative to the garden folder. */
  path: string;
  reason?: ArchiveJob['reason'] | 'clean-out';
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

function auth(client: GraphRequest, json = false): Record<string, string> {
  return json ? { Authorization: `Bearer ${client.token}`, 'Content-Type': 'application/json' } : { Authorization: `Bearer ${client.token}` };
}

/** Graph move of photos/<fileName> into photos/archive/<runFolder>/. 404 = not in photos/ (already moved). */
export async function movePhotoToArchive(client: GraphRequest, fileName: string, runFolder: string): Promise<Result<{ path: string; missing?: boolean }>> {
  const photos = await ensurePhotosFolder(client);
  if (!photos.ok) return photos;
  const archive = await ensureFolder(client, photosFolderPath(), ONEDRIVE_PHOTOS_ARCHIVE_DIR);
  if (!archive.ok) return archive;
  const run = await ensureFolder(client, archivePhotosFolderPath(), runFolder);
  if (!run.ok) return run;
  const target = `${archivePhotosFolderPath()}/${runFolder}`;
  const path = `photos/${ONEDRIVE_PHOTOS_ARCHIVE_DIR}/${runFolder}/${fileName}`;
  let res: Response;
  try {
    res = await client.fetch(graphItemUrl(`${photosFolderPath()}/${fileName}`), {
      method: 'PATCH',
      headers: auth(client, true),
      body: JSON.stringify({ parentReference: { path: `/drive/root:/${target}` }, '@microsoft.graph.conflictBehavior': 'rename' }),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Move failed.' };
  }
  if (res.status === 404) return { ok: true, path, missing: true };
  if (res.ok) return { ok: true, path };
  return { ok: false, error: await graphError(res) };
}

/** Manifest row keeps its data and gets archivedAt + archivePath. A missing row is left alone. */
export async function setManifestPhotoArchived(
  client: GraphRequest,
  opts: { photoId?: string; fileName: string; archivePath: string; at: string; maxAttempts?: number },
): Promise<Result> {
  let last = 'Could not mark the photo archived in the manifest.';
  for (let i = 0; i < (opts.maxAttempts ?? 4); i += 1) {
    const current = await readManifest(client, photosManifestPath());
    if (!current.ok) return current.missing ? { ok: true } : { ok: false, error: current.error };
    const photos = [...current.manifest.photos];
    const idx = photos.findIndex((p) => (opts.photoId && p.photoId === opts.photoId) || p.fileName === opts.fileName);
    if (idx < 0) return { ok: true };
    photos[idx] = { ...photos[idx]!, archivedAt: opts.at, archivePath: opts.archivePath };
    const next: PhotosManifest = { version: 1, updatedAt: opts.at, photos };
    const put = await writeManifest(client, photosManifestPath(), next, current.etag);
    if (put.ok) return { ok: true };
    if (put.conflict) { last = put.error; continue; }
    return { ok: false, error: put.error };
  }
  return { ok: false, error: last };
}

export interface DriveFile { name: string; path: string; size: number; modifiedAt: string; folder?: boolean }

async function listChildren(client: GraphRequest, drivePath: string): Promise<Result<{ items: DriveFile[]; missing?: boolean }>> {
  const items: DriveFile[] = [];
  let url: string | undefined = `${graphItemUrl(drivePath)}:/children?$select=name,size,lastModifiedDateTime,createdDateTime,folder,file&$top=200`;
  while (url) {
    let res: Response;
    try {
      res = await client.fetch(url, { headers: auth(client) });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'List failed.' };
    }
    if (res.status === 404) return { ok: true, items: [], missing: true };
    if (!res.ok) return { ok: false, error: await graphError(res) };
    const body = (await res.json()) as { value?: Array<{ name?: string; size?: number; lastModifiedDateTime?: string; createdDateTime?: string; folder?: object }>; '@odata.nextLink'?: string };
    for (const v of body.value ?? []) {
      if (typeof v.name !== 'string') continue;
      items.push({ name: v.name, path: `${drivePath}/${v.name}`, size: v.size ?? 0, modifiedAt: v.lastModifiedDateTime ?? v.createdDateTime ?? '', folder: !!v.folder });
    }
    url = body['@odata.nextLink'];
  }
  return { ok: true, items };
}

/** Files directly in photos/ (originals of live photos). Not the manifest, not sub-folders. */
export async function listLivePhotoFiles(client: GraphRequest): Promise<Result<{ files: DriveFile[] }>> {
  const r = await listChildren(client, photosFolderPath());
  if (!r.ok) return r;
  return { ok: true, files: r.items.filter((f) => !f.folder && f.name !== 'manifest.json') };
}

/** Every archived file, in every run folder of photos/archive/. */
export async function listArchivedFiles(client: GraphRequest): Promise<Result<{ files: DriveFile[] }>> {
  const top = await listChildren(client, archivePhotosFolderPath());
  if (!top.ok) return top;
  const files: DriveFile[] = top.items.filter((f) => !f.folder);
  for (const folder of top.items.filter((f) => f.folder)) {
    const inner = await listChildren(client, folder.path);
    if (!inner.ok) return inner;
    files.push(...inner.items.filter((f) => !f.folder));
  }
  return { ok: true, files };
}

/** Archived files older than `maxAgeDays` (by OneDrive modified time, i.e. when they were moved), and their total size. */
export function archiveCleanOutCandidates(files: DriveFile[], now: string, maxAgeDays = PHOTO_ARCHIVE_MAX_AGE_DAYS): { files: DriveFile[]; totalBytes: number } {
  const cutoff = Date.parse(now) - maxAgeDays * DAY_MS;
  const old = files.filter((f) => {
    const t = Date.parse(f.modifiedAt);
    return Number.isFinite(t) && t < cutoff;
  });
  return { files: old, totalBytes: old.reduce((s, f) => s + (f.size || 0), 0) };
}

/** Hard delete of archived files. Callers confirm first; only paths under photos/archive/ are accepted. */
export async function deleteArchivedFiles(client: GraphRequest, files: DriveFile[]): Promise<{ deleted: DriveFile[]; failed: { file: DriveFile; error: string }[] }> {
  const deleted: DriveFile[] = [];
  const failed: { file: DriveFile; error: string }[] = [];
  for (const file of files) {
    if (!file.path.startsWith(`${archivePhotosFolderPath()}/`)) {
      failed.push({ file, error: 'Not in the photo archive; not deleted.' });
      continue;
    }
    try {
      const res = await client.fetch(graphItemUrl(file.path), { method: 'DELETE', headers: auth(client) });
      if (res.ok || res.status === 404) deleted.push(file);
      else failed.push({ file, error: await graphError(res) });
    } catch (err) {
      failed.push({ file, error: err instanceof Error ? err.message : 'Delete failed.' });
    }
  }
  return { deleted, failed };
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// Archive jobs (retake-superseded photos and orphans)
// ---------------------------------------------------------------------------

export interface ArchiveDeps {
  client: GraphRequest;
  queue: PhotoQueue;
  now: () => string;
  /** Error log line (source 'photo-archive'). Must not trigger a full redraw. */
  logError: (message: string) => void;
}

/** Failures are kept in memory (not on the document), so a retry storm never redraws the app. */
const backoff = new Map<string, { attempts: number; notBefore: number }>();
export const ARCHIVE_RETRY_BASE_MS = 30_000;

export function resetArchiveBackoff(): void {
  backoff.clear();
}

/** One job: move, manifest, phone copy. */
export async function archiveOne(job: ArchiveJob, deps: ArchiveDeps): Promise<Result<{ entry: ArchiveLogEntry }>> {
  const at = deps.now();
  const folder = archiveRunFolderName(job.runStartedAt);
  const moved = await movePhotoToArchive(deps.client, job.fileName, folder);
  if (!moved.ok) return { ok: false, error: `Could not move ${job.fileName} to photos/archive: ${moved.error}` };
  if (!moved.missing) {
    const marked = await setManifestPhotoArchived(deps.client, { photoId: job.photoId, fileName: job.fileName, archivePath: moved.path, at });
    if (!marked.ok) return { ok: false, error: `Moved ${job.fileName} to the archive, but the manifest was not updated: ${marked.error}` };
  }
  for (const record of await deps.queue.list()) {
    if (record.photoId === job.photoId || record.fileName === job.fileName) await deps.queue.delete(record.id);
  }
  return { ok: true, entry: { at, action: 'archived', photoId: job.photoId, fileName: job.fileName, stepId: job.stepId, path: moved.path, reason: job.reason } };
}

/**
 * Run the pending jobs that are due. Returns the jobs still pending and the log entries to add.
 * Each failure is logged once per attempt and retried after 30 s, 1 min, 2 min … (max 30 min).
 */
export async function drainArchiveJobs(jobs: ArchiveJob[], deps: ArchiveDeps): Promise<{ pending: ArchiveJob[]; done: ArchiveLogEntry[] }> {
  const pending: ArchiveJob[] = [];
  const done: ArchiveLogEntry[] = [];
  const nowMs = Date.parse(deps.now());
  for (const job of jobs) {
    const key = `${job.photoId}|${job.fileName}`;
    const b = backoff.get(key);
    if (b && nowMs < b.notBefore) { pending.push(job); continue; }
    const r = await archiveOne(job, deps);
    if (r.ok) {
      backoff.delete(key);
      done.push(r.entry);
      continue;
    }
    const attempts = (b?.attempts ?? 0) + 1;
    backoff.set(key, { attempts, notBefore: nowMs + Math.min(30 * 60_000, ARCHIVE_RETRY_BASE_MS * 2 ** (attempts - 1)) });
    deps.logError(`${job.stepId ? `${job.stepId}: ` : ''}${r.error} Will retry.`);
    pending.push(job);
  }
  return { pending, done };
}

// ---------------------------------------------------------------------------
// Photo consistency check
// ---------------------------------------------------------------------------

export interface ConsistencyInput {
  doc: GardenDocument;
  /** Originals on the phone: photo queue rows with their bytes. */
  local: { photoId: string; fileName: string }[];
  /** File names directly in OneDrive photos/. Undefined when OneDrive could not be listed (offline). */
  driveFileNames?: string[];
  /** Step for a photo, for plain messages. */
  stepOf?: (photo: Photo) => { id: string; label: string } | undefined;
}

export interface ConsistencyResult {
  /** Referenced, but neither on the phone nor in OneDrive. */
  errors: { photoId: string; fileName: string; stepId?: string; message: string }[];
  /** Referenced, on only one side. `local-only` uploads are retried. */
  warnings: { photoId: string; fileName: string; stepId?: string; where: 'local-only' | 'drive-only'; message: string }[];
  /** Not referenced by the survey. Drive orphans can be archived (moved); nothing is deleted. */
  orphans: { drive: string[]; local: { photoId: string; fileName: string }[] };
  /** False when OneDrive was not listed: only the phone side was checked. */
  driveChecked: boolean;
}

/** Photos the survey still uses: an original on record, not dropped, not superseded by a retake. */
export function referencedPhotos(doc: GardenDocument): Photo[] {
  return doc.photos.filter((p) => p.originalFile?.fileName && !p.supersededAt && !p.originalFile.archivePath);
}

/** Every photo the survey knows by file name (incl. superseded ones waiting to be archived). */
function knownFileNames(doc: GardenDocument): Set<string> {
  return new Set(doc.photos.map((p) => p.originalFile?.fileName).filter((n): n is string => !!n));
}

export function checkPhotoConsistency(input: ConsistencyInput): ConsistencyResult {
  const { doc } = input;
  const localByPhoto = new Set(input.local.map((l) => l.photoId));
  const localByName = new Set(input.local.map((l) => l.fileName));
  const drive = input.driveFileNames ? new Set(input.driveFileNames) : undefined;
  const out: ConsistencyResult = { errors: [], warnings: [], orphans: { drive: [], local: [] }, driveChecked: !!drive };
  for (const photo of referencedPhotos(doc)) {
    const name = photo.originalFile!.fileName;
    const onPhone = localByPhoto.has(photo.id) || localByName.has(name);
    const onDrive = drive ? drive.has(name) : undefined;
    const step = input.stepOf?.(photo);
    const where = step ? `${step.label}: ` : '';
    if (!onPhone && onDrive === false) {
      out.errors.push({ photoId: photo.id, fileName: name, stepId: step?.id, message: `${where}photo ${name} is missing on the phone and in OneDrive. Retake it: open the step's Photos and tap Retake.` });
    } else if (onPhone && onDrive === false) {
      out.warnings.push({ photoId: photo.id, fileName: name, stepId: step?.id, where: 'local-only', message: `${where}photo ${name} is only on the phone. Uploading it again.` });
    } else if (!onPhone && onDrive) {
      out.warnings.push({ photoId: photo.id, fileName: name, stepId: step?.id, where: 'drive-only', message: `${where}photo ${name} is only in OneDrive, not on the phone.` });
    }
  }
  const known = knownFileNames(doc);
  const knownIds = new Set(doc.photos.map((p) => p.id));
  if (drive) out.orphans.drive = [...drive].filter((n) => !known.has(n)).sort();
  out.orphans.local = input.local.filter((l) => !knownIds.has(l.photoId) && !known.has(l.fileName));
  return out;
}

export const ORPHAN_ARCHIVE_FOLDER = 'unreferenced';

/** Jobs that move the OneDrive orphans to photos/archive/unreferenced/ (no deletion). */
export function orphanArchiveJobs(fileNames: string[], now: string): ArchiveJob[] {
  return fileNames.map((fileName) => ({ photoId: '', fileName, stepId: '', runStartedAt: '', supersededAt: now, reason: 'orphan' as const }));
}

/** Orphans go to a shared folder rather than a run folder. */
export async function archiveOrphans(fileNames: string[], deps: ArchiveDeps): Promise<{ done: ArchiveLogEntry[]; failed: { fileName: string; error: string }[] }> {
  const done: ArchiveLogEntry[] = [];
  const failed: { fileName: string; error: string }[] = [];
  for (const fileName of fileNames) {
    const moved = await movePhotoToArchive(deps.client, fileName, ORPHAN_ARCHIVE_FOLDER);
    if (!moved.ok) {
      failed.push({ fileName, error: moved.error });
      deps.logError(`Could not archive unreferenced ${fileName}: ${moved.error}`);
      continue;
    }
    const at = deps.now();
    if (!moved.missing) await setManifestPhotoArchived(deps.client, { fileName, archivePath: moved.path, at });
    done.push({ at, action: 'archived', fileName, path: moved.path, reason: 'orphan' });
  }
  return { done, failed };
}

