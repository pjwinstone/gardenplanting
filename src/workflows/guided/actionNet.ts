/**
 * Action sub-net (workflow/action.net.yaml). One instance per field-test step: it owns the
 * colour and label of that step's row pill. The top net (field-test.net.yaml) only reads
 * `done` from it ("step complete or not").
 *
 *   idle (grey) ── start ──▶ in_progress ── photo_taken ──▶ uploading ── upload_verified ──▶ done (green)
 *                               ▲   │                          │  │
 *                               │   └─ photo_refused ─▶ error ◀┘  └─ upload_failed ─▶ error (red + reason)
 *                               └──────── retake / retry ──────┘
 *
 * Camera steps add the guard photoUploadVerified on upload_verified → done.
 * The UI derives the pill colour only from ActionState.place (actionPillClass).
 */

import type { GardenDocument, Photo } from '../../model';
import { countUploadedPhotosForStep, linkedPhotosForStep } from './engine';
import { isSettled, normalizeStatus } from './guards';
import type { WorkflowRun, WorkflowStep } from './types';

export type ActionPlace = 'idle' | 'in_progress' | 'uploading' | 'done' | 'error';
export type ActionRecovery = 'retake' | 'retry';
export type ActionEvent =
  | 'start'
  | 'photo_taken'
  | 'upload_verified'
  | 'photo_refused'
  | 'upload_failed'
  | 'retake'
  | 'retry'
  | 'settled_by_hand'
  | 'recheck';

export interface ActionState {
  place: ActionPlace;
  /** Plain-language reason, always set in `error`. */
  reason?: string;
  /** What the red pill offers. Set only in `error`. */
  recovery?: ActionRecovery;
  /** Photo the Retry pill re-sends (upload_failed). */
  photoId?: string;
  /** Usable verified photos so far, and how many the step needs (camera steps). */
  have?: number;
  need?: number;
  /** Photos taken so far incl. ones still uploading (pill text "Photo n of N"). */
  taken?: number;
  /** Taken but its tap screen not saved yet: the pill reads "Mark photo n of N" and reopens it. */
  markPhotoId?: string;
  markNumber?: number;
}

export interface ActionTransition {
  id: ActionEvent;
  from: ActionPlace[];
  to: ActionPlace;
  /** Named guard predicate (see ACTION_GUARDS). */
  guard?: keyof typeof ACTION_GUARDS;
  recovery?: ActionRecovery;
}

/** Mirrors workflow/action.net.yaml `transitions`. A test keeps the two in step. */
export const ACTION_TRANSITIONS: ActionTransition[] = [
  { id: 'start', from: ['idle'], to: 'in_progress' },
  { id: 'photo_taken', from: ['in_progress'], to: 'uploading' },
  { id: 'upload_verified', from: ['uploading'], to: 'done', guard: 'photoUploadVerified' },
  { id: 'upload_verified', from: ['uploading'], to: 'in_progress', guard: 'morePhotosNeeded' },
  { id: 'photo_refused', from: ['in_progress', 'uploading'], to: 'error', recovery: 'retake' },
  { id: 'upload_failed', from: ['uploading'], to: 'error', recovery: 'retry' },
  { id: 'retake', from: ['error'], to: 'in_progress', guard: 'recoveryIsRetake' },
  { id: 'retry', from: ['error'], to: 'uploading', guard: 'recoveryIsRetry' },
  { id: 'settled_by_hand', from: ['idle', 'in_progress', 'uploading', 'error'], to: 'done' },
  { id: 'recheck', from: ['done'], to: 'idle' },
];

export const ACTION_PLACES: ActionPlace[] = ['idle', 'in_progress', 'uploading', 'done', 'error'];

/** Named guards. `ctx` is the evidence count the app has at that moment. */
export const ACTION_GUARDS = {
  photoUploadVerified: (s: ActionState) => (s.need ?? 1) <= (s.have ?? 0) + 1,
  morePhotosNeeded: (s: ActionState) => (s.need ?? 1) > (s.have ?? 0) + 1,
  recoveryIsRetake: (s: ActionState) => s.recovery === 'retake',
  recoveryIsRetry: (s: ActionState) => s.recovery === 'retry',
} satisfies Record<string, (s: ActionState) => boolean>;

export function enabledActions(state: ActionState): ActionTransition[] {
  return ACTION_TRANSITIONS.filter(
    (t) => t.from.includes(state.place) && (!t.guard || ACTION_GUARDS[t.guard](state)),
  );
}

/** Fire one event on the sub-net. Unchanged state when the event is not enabled. */
export function fireAction(state: ActionState, event: ActionEvent, reason?: string): ActionState {
  const t = enabledActions(state).find((item) => item.id === event);
  if (!t) return state;
  const have = event === 'upload_verified' ? (state.have ?? 0) + 1 : state.have;
  const base: ActionState = { place: t.to, need: state.need, have: t.to === 'idle' ? 0 : t.to === 'done' ? state.need : have };
  if (t.to === 'error') return { ...base, recovery: t.recovery, reason: reason ?? (t.recovery === 'retry' ? 'Upload failed.' : 'Photo refused.') };
  return base;
}

// ---------------------------------------------------------------------------
// Marking from the document: where the step's token sits in its sub-net right now.
// ---------------------------------------------------------------------------

function photoNeed(step: WorkflowStep): { stationId: string; need: number } | undefined {
  const c = step.complete;
  if ('on' in c && c.on === 'photo.uploaded') return { stationId: c.stationId, need: c.minPhotos };
  return undefined;
}

/** Guard: verified on OneDrive, but the app cannot use it. Returns the reason. */
export function photoRefusedReason(photo: Photo, run: WorkflowRun): string | undefined {
  const of = photo.originalFile;
  if (!of || of.uploadStatus !== 'verified') return undefined;
  const note = of.usabilityNote ?? '';
  if (note.includes('Not usable')) return `${note} Retake.`;
  const start = run.startedAt ? Date.parse(run.startedAt) : NaN;
  const capturedRaw = of.capturedAt ?? photo.exifDateTimeOriginal;
  const captured = capturedRaw ? Date.parse(capturedRaw) : NaN;
  if (!Number.isFinite(captured)) return 'The photo has no capture time, so it cannot count. Retake in the in-app camera.';
  if (Number.isFinite(start) && captured < start) return 'This photo was taken before the run started. Retake.';
  return undefined;
}

/** Guard: the OneDrive upload gave up or is failing. */
export function uploadFailed(photo: Photo): boolean {
  return photo.originalFile?.uploadStatus === 'failed';
}

/** Guard: queued or uploading, or not yet recorded at all. */
export function uploadInFlight(photo: Photo): boolean {
  const s = photo.originalFile?.uploadStatus;
  return s === 'queued' || s === 'uploading';
}

/**
 * Current marking of the step's action sub-net, derived only from the run and the document.
 * Precedence: settled → done; refused / evidence_failed → error retake; failed upload → error
 * retry; in flight → uploading; some usable photos → in_progress; else idle.
 */
export function deriveActionState(doc: GardenDocument | null | undefined, run: WorkflowRun, step: WorkflowStep): ActionState {
  const state = run.steps[step.id];
  const status = normalizeStatus(state?.status ?? 'open');
  const req = photoNeed(step);
  const need = req?.need;
  if (isSettled(state)) return { place: 'done', need, have: need };
  if (status === 'evidence_failed') {
    return { place: 'error', recovery: 'retake', reason: state?.reason ?? 'Photo refused. Retake.', need, have: 0 };
  }
  if (!req || !doc) return { place: 'idle', need };
  const linked = linkedPhotosForStep(doc, req.stationId, run, step.id);
  const have = countUploadedPhotosForStep(doc, req.stationId, run, step.id).count;
  // Only the newest photo decides red: a good retake supersedes an earlier refused or failed one.
  const latest = [...linked].sort((a, b) => receivedMs(b) - receivedMs(a))[0];
  if (latest && have < req.need) {
    const why = photoRefusedReason(latest, run);
    if (why) return { place: 'error', recovery: 'retake', reason: why, need, have };
    if (uploadFailed(latest)) {
      const err = latest.originalFile?.uploadError ?? 'unknown error';
      return { place: 'error', recovery: 'retry', photoId: latest.id, reason: `Upload failed: ${err}`, need, have };
    }
  }
  // Taken but not marked: say so, and let the pill reopen that photo's tap screen.
  if (step.photoTaps && have < req.need) {
    const ordered = [...linked].sort((a, b) => receivedMs(a) - receivedMs(b));
    const index = ordered.findIndex((photo) => !photoMarked(photo));
    if (index >= 0) {
      return { place: 'in_progress', need, have, taken: ordered.length, markPhotoId: ordered[index]!.id, markNumber: index + 1 };
    }
  }
  const inFlight = linked.filter(uploadInFlight).length;
  // A two-photo step stays usable while photo 1 uploads: the pill offers photo 2.
  if (inFlight > 0 && have + inFlight < req.need) return { place: 'in_progress', need, have, taken: have + inFlight };
  if (inFlight > 0) return { place: 'uploading', need, have };
  if (have >= req.need) return { place: 'uploading', need, have }; // verified; the app's tick is due
  if (have > 0 || linked.length > 0) return { place: 'in_progress', need, have };
  return { place: 'idle', need, have: 0 };
}

/** Guard: the photo's tap screen was saved (taps, sleeve marks, or Save with canes Not in view). */
export function photoMarked(photo: Photo): boolean {
  return !!photo.tapsSavedAt || (photo.clicks?.length ?? 0) > 0 || (photo.measureTaps?.length ?? 0) > 0;
}

function receivedMs(photo: Photo): number {
  const t = Date.parse(photo.originalFile?.receivedAt ?? '');
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER; // no record yet = just taken
}

/** CSS class for the pill. The only source of its colour. */
export function actionPillClass(state: ActionState): string {
  return `roller-pill act-${state.place}`;
}

/** Pill text for a camera / app step in each place. */
export function actionPillLabel(step: WorkflowStep, state: ActionState): string | undefined {
  const camera = !!photoNeed(step);
  const base = step.id === 'tape-baseline' ? 'Save baseline' : step.id === 'save-to-onedrive' ? 'Save' : camera ? 'Take photos' : undefined;
  if (!base) return undefined;
  const need = state.need ?? 1;
  const have = state.have ?? 0;
  switch (state.place) {
    case 'idle':
      return base;
    case 'in_progress':
      if (state.markPhotoId) return `Mark photo ${state.markNumber ?? 1} of ${need}`;
      if (!camera) return base;
      return need > 1 ? `Take photo ${Math.min((state.taken ?? have) + 1, need)} of ${need}` : 'Take photo';
    case 'uploading':
      return 'Uploading…';
    case 'done':
      return camera ? '✓ Photos in' : '✓ Done';
    case 'error':
      return state.recovery === 'retry' ? 'Retry upload' : 'Retake';
  }
}

/** data-cmd for the pill. */
export function actionPillCommand(state: ActionState): string {
  if (state.place === 'error') return state.recovery === 'retry' ? 'photo-upload-retry' : 'workflow-retake';
  if (state.markPhotoId) return 'open-photo-mark';
  return 'workflow-go';
}

/** One line under the row when the action is not plain grey. */
export function actionReasonLine(state: ActionState): string {
  if (state.place === 'error') return state.reason ?? '';
  if (state.place === 'uploading') return 'Uploading to OneDrive. The step goes green once it is verified.';
  if (state.markPhotoId) return `Photo ${state.markNumber ?? 1} is taken. Tap the canes and Save (Not in view for any you cannot see).`;
  if (state.place === 'in_progress' && (state.need ?? 1) > 1) {
    const up = (state.taken ?? 0) - (state.have ?? 0);
    return `${state.have ?? 0} of ${state.need} photos in${up > 0 ? `, ${up} uploading` : ''}.`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Top net guard: Done fires only when every counted step's action sub-net is in `done`
// (settled; a skip with a note also counts as settled). Otherwise Done lands on the first
// step that is not, with this reason.
// ---------------------------------------------------------------------------

export interface DoneBlocker {
  stepId: string;
  n?: number;
  title: string;
  reason: string;
}

function blockerReason(step: WorkflowStep, state: ActionState): string {
  switch (state.place) {
    case 'error':
      return state.reason ?? 'Has an error.';
    case 'uploading':
      return 'Photos are still uploading to OneDrive.';
    case 'in_progress':
      return state.need ? `${state.have ?? 0} of ${state.need} photos in.` : 'Not finished.';
    default:
      return photoNeed(step) ? 'No photos yet.' : 'Not ticked yet.';
  }
}

/** First step whose action is not done, in step order, or undefined when Done may fire. */
export function doneBlocker(doc: GardenDocument | null | undefined, steps: WorkflowStep[], run: WorkflowRun): DoneBlocker | undefined {
  for (const step of steps) {
    const state = deriveActionState(doc, run, step);
    if (state.place === 'done') continue;
    return { stepId: step.id, n: step.n, title: step.title, reason: blockerReason(step, state) };
  }
  return undefined;
}

/** "Step 8 Calibration photo: Upload failed: …" */
export function doneBlockerNotice(b: DoneBlocker): string {
  return `Not finished. Step ${b.n ?? ''} ${b.title}: ${b.reason}`.replace('Step  ', 'Step ');
}
