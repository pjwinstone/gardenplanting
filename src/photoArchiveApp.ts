/**
 * App glue for the photo archive (docs/photo-archive.md): runs the async photo work behind the
 * Set-up buttons, the archive drain after a Retake, and the photo check on opening a run.
 * Errors go to the error log only (bindErrorLogView patches the log roller in place).
 */
import type { GardenDocument } from './model';
import { logError } from './errorLog';
import {
  archiveCleanOutCandidates,
  archiveOrphans,
  checkPhotoConsistency,
  deleteArchivedFiles,
  drainArchiveJobs,
  formatBytes,
  listArchivedFiles,
  listLivePhotoFiles,
  PHOTO_ARCHIVE_MAX_AGE_DAYS,
  type ArchiveDeps,
  type ConsistencyResult,
} from './photoArchive';
import type { GraphRequest } from './photosManifest';
import type { PhotoQueue } from './photoQueue';
import { appGraphClient, getAppPhotoQueue, retryPhotoUpload } from './photoSync';
import { applyArchiveDrain, pendingArchiveJobs, readProgress } from './workflows/guided/engine';
import { setPhotoPanel, type PhotoPanelView } from './workflows/guided/guidedChrome';
import { photoStepFor } from './workflows/guided/photoTaps';

export interface PhotoAppDeps {
  getDoc: () => GardenDocument;
  /** Commit a changed document (a normal app render). */
  setDoc: (doc: GardenDocument) => void;
  /** Re-render the Set-up photo panel only. */
  refreshPanel: () => void;
  confirm: (message: string) => boolean;
  client?: () => Promise<GraphRequest | null>;
  queue?: PhotoQueue;
  retryUpload?: (photoId: string) => Promise<void> | void;
  log?: (message: string) => void;
  now?: () => string;
}

const SOURCE = 'photo-archive';

function d(deps: PhotoAppDeps) {
  return {
    client: deps.client ?? appGraphClient,
    queue: deps.queue ?? getAppPhotoQueue(),
    retry: deps.retryUpload ?? ((id: string) => retryPhotoUpload(id)),
    log: deps.log ?? ((m: string) => logError(m, { source: SOURCE, severity: 'error' })),
    now: deps.now ?? (() => new Date().toISOString()),
  };
}

function panel(deps: PhotoAppDeps, view: PhotoPanelView | null) {
  setPhotoPanel(view);
  deps.refreshPanel();
}

function archiveAge(doc: GardenDocument): number {
  const v = readProgress(doc).runs['circle-field-test']?.setup?.values?.photo_archive_age_days;
  return typeof v === 'number' && v > 0 ? v : PHOTO_ARCHIVE_MAX_AGE_DAYS;
}

/** Move retake-superseded photos to the archive. Failures stay pending and are retried on the next call. */
export async function drainPhotoArchive(deps: PhotoAppDeps): Promise<void> {
  const x = d(deps);
  const jobs = pendingArchiveJobs(deps.getDoc());
  if (!jobs.length) return;
  const client = await x.client();
  if (!client) return; // offline / signed out: retried on the next trigger
  const archiveDeps: ArchiveDeps = { client, queue: x.queue, now: x.now, logError: x.log };
  const result = await drainArchiveJobs(jobs, archiveDeps);
  if (result.done.length) deps.setDoc(applyArchiveDrain(deps.getDoc(), result));
}

let lastCheck: ConsistencyResult | null = null;

/** Photo consistency check: errors to the error log by step and photo, local-only uploads retried. */
export async function runPhotoCheck(deps: PhotoAppDeps): Promise<ConsistencyResult> {
  const x = d(deps);
  const doc = deps.getDoc();
  const local = (await x.queue.list()).filter((r) => r.status !== 'retire').map((r) => ({ photoId: r.photoId, fileName: r.fileName }));
  const client = await x.client();
  let driveFileNames: string[] | undefined;
  if (client) {
    const listed = await listLivePhotoFiles(client);
    if (listed.ok) driveFileNames = listed.files.map((f) => f.name);
    else x.log(`Photo check: could not list OneDrive photos: ${listed.error}`);
  }
  const result = checkPhotoConsistency({
    doc,
    local,
    driveFileNames,
    stepOf: (photo) => {
      const hit = photoStepFor(doc, photo);
      return hit ? { id: hit.step.id, label: `Step ${hit.step.n} ${hit.step.title}` } : undefined;
    },
  });
  for (const e of result.errors) x.log(e.message);
  for (const w of result.warnings) if (w.where === 'local-only') await x.retry(w.photoId);
  lastCheck = result;
  const lines: PhotoPanelView['lines'] = [
    ...result.errors.map((e) => ({ kind: 'error' as const, text: e.message })),
    ...result.warnings.map((w) => ({ kind: 'warning' as const, text: w.message })),
  ];
  if (!result.driveChecked) lines.push({ kind: 'info', text: 'OneDrive was not checked (offline or signed out); only the phone side was.' });
  if (result.orphans.local.length) lines.push({ kind: 'info', text: `${result.orphans.local.length} photo${result.orphans.local.length === 1 ? '' : 's'} on the phone that the survey does not use. Left on the phone.` });
  if (!lines.length) lines.push({ kind: 'info', text: 'Photos check out: every photo the survey uses is on the phone and in OneDrive.' });
  panel(deps, { lines, orphanCount: result.orphans.drive.length });
  return result;
}

/** Move the unreferenced OneDrive photos to photos/archive/unreferenced/. No deletion. */
export async function archiveUnreferenced(deps: PhotoAppDeps): Promise<void> {
  const x = d(deps);
  const names = lastCheck?.orphans.drive ?? [];
  if (!names.length) return;
  const client = await x.client();
  if (!client) { x.log('Archive unreferenced photos: sign in to OneDrive first.'); return; }
  panel(deps, { lines: [], orphanCount: 0, busy: `Archiving ${names.length} unreferenced photos…` });
  const r = await archiveOrphans(names, { client, queue: x.queue, now: x.now, logError: x.log });
  lastCheck = lastCheck ? { ...lastCheck, orphans: { ...lastCheck.orphans, drive: r.failed.map((f) => f.fileName) } } : null;
  panel(deps, { lines: [{ kind: r.failed.length ? 'warning' : 'info', text: `Archived ${r.done.length}; ${r.failed.length} failed (see the error log).` }], orphanCount: r.failed.length });
}

/** Clean out archive: the photo check first, then list old archived files, confirm, delete. */
export async function cleanOutArchive(deps: PhotoAppDeps): Promise<{ deleted: number; bytes: number } | null> {
  const x = d(deps);
  await runPhotoCheck(deps);
  const client = await x.client();
  if (!client) { x.log('Clean out archive: sign in to OneDrive first.'); return null; }
  const listed = await listArchivedFiles(client);
  if (!listed.ok) { x.log(`Clean out archive: could not list photos/archive: ${listed.error}`); return null; }
  const days = archiveAge(deps.getDoc());
  const old = archiveCleanOutCandidates(listed.files, x.now(), days);
  if (!old.files.length) {
    panel(deps, { lines: [{ kind: 'info', text: `No archived photos older than ${days} days.` }], orphanCount: lastCheck?.orphans.drive.length ?? 0 });
    return { deleted: 0, bytes: 0 };
  }
  const list = old.files.map((f) => `${f.path.split('/').slice(-2).join('/')} (${formatBytes(f.size)})`).join('\n');
  const ok = deps.confirm(`Delete ${old.files.length} archived photo${old.files.length === 1 ? '' : 's'} older than ${days} days, ${formatBytes(old.totalBytes)} in total? This cannot be undone. Live photos are not touched.\n\n${list}`);
  if (!ok) return { deleted: 0, bytes: 0 };
  const r = await deleteArchivedFiles(client, old.files);
  for (const f of r.failed) x.log(`Clean out archive: could not delete ${f.file.name}: ${f.error}`);
  const bytes = r.deleted.reduce((s, f) => s + f.size, 0);
  panel(deps, { lines: [{ kind: 'info', text: `Deleted ${r.deleted.length} archived photos (${formatBytes(bytes)}).${r.failed.length ? ` ${r.failed.length} failed (see the error log).` : ''}` }], orphanCount: lastCheck?.orphans.drive.length ?? 0 });
  return { deleted: r.deleted.length, bytes };
}

export function runPhotoAction(action: 'check-photos' | 'clean-archive' | 'archive-orphans' | 'archive-drain', deps: PhotoAppDeps): Promise<unknown> {
  if (action === 'check-photos') return runPhotoCheck(deps);
  if (action === 'clean-archive') return cleanOutArchive(deps);
  if (action === 'archive-orphans') return archiveUnreferenced(deps);
  return drainPhotoArchive(deps);
}
