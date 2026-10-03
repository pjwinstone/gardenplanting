/** Main UI: plan-first layout, hamburger drawer, print tags. Calls toolbox + workflows. */

import type { GardenDocument, Photo } from './model';
import {
  confirmAbTogether,
  baselineReady,
  baselineTieReady,
  houseCornerCount,
  housePolygon,
  currentBaseline,
  currentSetup,
  applyCannedBaselineTie,
} from './model';
import { buildCoach, speakCoachLine } from './coach';
import { renderPlanSvg } from './planSvg';
import { renderTagsPrintHtml, triggerPrint } from './tagsPrint';
import {
  acquireGraphToken,
  acquireGraphTokenSilent,
  isSignedIn,
  signIn,
  signOut,
  subscribeAuth,
  type AuthInitResult,
} from './msalAuth';
import {
  getCloudStatus,
  notifyCloudPrefsChanged,
  refreshGardenFileList,
  setCloudBusy,
  setCloudMessage,
  setLastSaveIso,
  subscribeCloud,
} from './cloudStatus';
import {
  getGardenCloudFileName,
  getGardenCloudVersion,
  setGardenCloudFileName,
  setGardenCloudVersion,
} from './cloudConfig';
import { appBuild, appVersion, buildMenuTitle, buildStamp } from './buildInfo';
import { STAGE2_FIELD_STEPS } from './stage2Checklist';
import {
  clearErrorLog,
  getErrorLog,
  hasUnseenErrors,
  logError,
  markErrorsSeen,
  subscribeErrorLog,
  unseenErrorCount,
} from './errorLog';
import {
  ALL_ACTIONS,
  actionLabel,
  applyTransition,
  canTransition,
  legalActions,
  persistGardenLocal,
  clearCachedGarden,
  exportGarden,
  importGarden,
  loadCachedGarden,
  createEmptyGarden,
  runAdjust as toolboxRunAdjust,
  saveGardenCloud,
  loadGardenCloud,
  type ModeAction,
} from './toolbox';
import {
  startStage2FieldWorkflow,
  loadSyntheticWorkflow,
  runMilestoneDemoWorkflow,
  saveBaselineLengthWorkflow,
  addHouseCornerWorkflow,
  closeHouseWorkflow,
  workflowAddPoint,
} from './workflows';
import {
  appendPhotoToPoint,
  applyPhotoMarks,
  baselinesByTrust,
  createLayer,
  createObject,
  deleteLayerMeasurement,
  deleteObjectMeasurement,
  deletePhotoFromPoint,
  deletePointMeasurement,
  objectsOnLayer,
  photoEstimateAt,
  preferredBaseline,
  setBaselineTrust,
  setStickyPanel,
  stickyGeometry,
  stickyLayer,
  stickyObject,
  updatePointMeasurement,
} from './layers';
import { GEOMETRY_CHOICES, placeholderThumb, type GeometryType, type PhotoClick } from './model';
import { imageNaturalSize, suggestTagBlobs, type TagSuggestion } from './tagSuggest';
import { dngRejectionMessage, type PreviewPixelMap } from './photoOriginal';
import {
  kickPhotoUploads,
  listQueuedPhotos,
  photosManifestLink,
  rememberOriginalPhoto,
  resumePhotoUploads,
  retryPhotoUpload,
  startPhotoUploadLoop,
  type PhotoStatusUpdate,
} from './photoSync';
import { silentGraphToken } from './onedrive';

export type View = 'survey' | 'tags';

/** One hamburger accordion open at a time (point dialogue is separate, on-plan). */
export type MenuSection =
  | null
  | 'mode'
  | 'version'
  | 'recommend'
  | 'coach'
  | 'baseline'
  | 'tie'
  | 'house'
  | 'leapfrog'
  | 'adjust'
  | 'error-log'
  | 'tools'
  | 'cloud'
  | 'glossary';

/** Unified + Point / inspect dialogue (on the plan, not in the menu). */
export type PointDialogMode = null | 'add' | 'inspect';

export interface UiState {
  doc: GardenDocument;
  view: View;
  refuseMessage: string | null;
  /** Show Stage 2 field checklist summary in the survey layout. */
  showStage2Checklist: boolean;
  /** Hamburger drawer open. */
  menuOpen: boolean;
  /** Open drawer scrolled to Error log and mark unseen cleared. */
  openErrorLog: boolean;
  /** Which menu accordion section is expanded (one at a time). */
  menuFocus: MenuSection;
  /** On-plan + Point / inspect dialogue (null = closed). */
  pointDialog: PointDialogMode;
  /** Pending camera capture for + Point (not yet attached to a Photo). */
  pendingPointThumb: string | null;
  /** Photo open in full-screen mark / tag-suggest overlay. */
  markPhotoId: string | null;
}

type MarkRole = 'A' | 'B' | 'TARGET';

type MarkDraft = {
  photoId: string;
  clicks: PhotoClick[];
  assignRole: MarkRole;
  suggestions: TagSuggestion[];
  hint: string;
  busy: boolean;
};

/** Working state for the photo-mark overlay (survives re-renders). */
let markDraft: MarkDraft | null = null;

type Listener = () => void;

/** Drag offset for the point dialogue — survives re-renders without setState thrash.
 *  Default keeps clear of the bottom-right hamburger. */
let pointDialogPos = { x: 12, y: 56 };

/** Plan canvas pan/zoom — applied only to `.plan__viewport`, never to fixed chrome. */
let planView = { scale: 1, x: 0, y: 0 };
const PLAN_SCALE_MIN = 0.55;
const PLAN_SCALE_MAX = 6;

/** Floating + Point dialog UI scale (font + controls). Persisted. */
const POINT_UI_SCALE_KEY = 'garden-survey-point-ui-scale';
const POINT_UI_SCALE_MIN = 0.85;
const POINT_UI_SCALE_MAX = 1.25;
const POINT_UI_SCALE_STEP = 0.05;

function loadPointUiScale(): number {
  try {
    const v = Number(localStorage.getItem(POINT_UI_SCALE_KEY));
    if (Number.isFinite(v)) {
      return Math.min(POINT_UI_SCALE_MAX, Math.max(POINT_UI_SCALE_MIN, v));
    }
  } catch {
    /* ignore */
  }
  return 1;
}

let pointUiScale = loadPointUiScale();

function persistPointUiScale(scale: number): void {
  pointUiScale = Math.min(POINT_UI_SCALE_MAX, Math.max(POINT_UI_SCALE_MIN, scale));
  try {
    localStorage.setItem(POINT_UI_SCALE_KEY, String(pointUiScale));
  } catch {
    /* ignore */
  }
  const live = document.querySelector('.point-dialog') as HTMLElement | null;
  if (live) live.style.setProperty('--point-ui-scale', String(pointUiScale));
}

function bumpPointUiScale(delta: number): void {
  persistPointUiScale(Math.round((pointUiScale + delta) * 100) / 100);
}

/**
 * Survey photos are the file the system picker returns. We do not re-encode that Blob.
 *
 * iOS Safari (WebKit WKFileUploadPanel, main 7fc2aaf): Take Photo
 * (`capture=environment`) uses UIImageJPEGRepresentation(image, 0.8) and the
 * name image.jpg. That drops Make, Model, LensModel, FocalLength,
 * DateTimeOriginal, GPS and MakerNote. Library uses PHPicker Compatible mode
 * (a converted JPEG) unless PhotoPickerPrefersOriginalImageFormat is set, and
 * it defaults to false. Actual Size is offered via _setAllowsDownscaling:YES.
 * WebKit bug 207088 comments 24–25 say EXIF is kept after that conversion;
 * that is a user report only. Shoot in Camera.app and pick Library at Actual Size.
 * The getUserMedia view is aiming only.
 */
/** Set when a background upload needs a tap before it may redirect. */
let photoUploadNeedsSignIn = false;
let systemCameraInput: HTMLInputElement | null = null;
let libraryPhotoInput: HTMLInputElement | null = null;
let cameraOverlay: HTMLElement | null = null;
let cameraStream: MediaStream | null = null;
const captureHandlers = new WeakMap<HTMLInputElement, (file: File) => void>();

function ensureHiddenCaptureInput(
  existing: HTMLInputElement | null,
  onFile: (file: File) => void,
  capture: boolean,
): HTMLInputElement {
  if (existing && existing.isConnected) {
    captureHandlers.set(existing, onFile);
    return existing;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  if (capture) input.setAttribute('capture', 'environment');
  input.hidden = true;
  input.setAttribute('aria-hidden', 'true');
  captureHandlers.set(input, onFile);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) captureHandlers.get(input)?.(file);
  });
  document.body.appendChild(input);
  return input;
}

function openCaptureInput(kind: 'camera' | 'library', onFile: (file: File) => void): void {
  const capture = kind === 'camera';
  const existing = capture ? systemCameraInput : libraryPhotoInput;
  const input = ensureHiddenCaptureInput(existing, onFile, capture);
  if (capture) systemCameraInput = input;
  else libraryPhotoInput = input;
  input.click();
}

function stopInAppCamera(): void {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  cameraOverlay?.remove();
  cameraOverlay = null;
}

/**
 * Live view is an aiming preview. It does not store a frame: a canvas grab has
 * no EXIF and is not the camera file. Take photo opens the system camera sheet
 * (aim-only / camera-path, no lens data). Library opens the photo picker.
 * The File is kept byte-for-byte, whatever the picker actually delivered.
 */
const SURVEY_PHOTO_NOTE =
  'Aiming preview only. For a survey photo, shoot in Camera.app (12 MP, HEIF Max and ProRAW off, location off) and pick it from Library at Actual Size. Take photo is aim-only / camera-path (no lens data).';
async function openAimingPreview(
  onSystemCamera: () => void,
  onLibrary: () => void,
): Promise<void> {
  stopInAppCamera();
  if (!navigator.mediaDevices?.getUserMedia) {
    onSystemCamera();
    return;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1440 },
      },
    });
  } catch {
    // Permission denied / no camera — the next tap opens the file input (gesture restored).
    showCameraFallbackSheet(onSystemCamera, onLibrary);
    return;
  }

  cameraStream = stream;
  const overlay = document.createElement('div');
  overlay.className = 'camera-overlay';
  overlay.setAttribute('data-testid', 'camera-overlay');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Aiming preview');

  const video = document.createElement('video');
  video.className = 'camera-overlay__video';
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  video.muted = true;
  video.autoplay = true;
  video.srcObject = stream;

  const bar = document.createElement('div');
  bar.className = 'camera-overlay__bar';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn--util camera-overlay__cancel';
  cancel.textContent = 'Cancel';
  cancel.setAttribute('data-testid', 'camera-cancel');
  cancel.addEventListener('click', () => {
    stopInAppCamera();
  });

  const note = document.createElement('p');
  note.className = 'camera-overlay__note';
  note.setAttribute('data-testid', 'camera-aim-note');
  note.textContent = SURVEY_PHOTO_NOTE;

  const shutter = document.createElement('button');
  shutter.type = 'button';
  shutter.className = 'camera-overlay__shutter';
  shutter.setAttribute('aria-label', 'Take photo — aim-only / camera-path (no lens data)');
  shutter.setAttribute('data-testid', 'camera-shutter');
  shutter.addEventListener('click', () => {
    stopInAppCamera();
    onSystemCamera();
  });

  const library = document.createElement('button');
  library.type = 'button';
  library.className = 'btn btn--util camera-overlay__cancel';
  library.textContent = 'Library';
  library.setAttribute('data-testid', 'camera-library');
  library.addEventListener('click', () => {
    stopInAppCamera();
    onLibrary();
  });

  bar.appendChild(cancel);
  bar.appendChild(library);
  bar.appendChild(shutter);
  overlay.appendChild(video);
  overlay.appendChild(note);
  overlay.appendChild(bar);
  document.body.appendChild(overlay);
  cameraOverlay = overlay;

  try {
    await video.play();
  } catch {
    /* autoplay with playsinline usually OK once stream is attached */
  }
}

function showCameraFallbackSheet(onSystemCamera: () => void, onLibrary: () => void): void {
  stopInAppCamera();
  const sheet = document.createElement('div');
  sheet.className = 'camera-fallback';
  sheet.setAttribute('data-testid', 'camera-fallback');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Camera unavailable');

  const msg = document.createElement('p');
  msg.className = 'camera-fallback__msg';
  msg.textContent = SURVEY_PHOTO_NOTE;

  const row = document.createElement('div');
  row.className = 'camera-fallback__row';

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'btn btn--suggested';
  pick.textContent = 'Take photo';
  pick.title = 'aim-only / camera-path (no lens data)';
  pick.setAttribute('aria-label', 'Take photo — aim-only / camera-path (no lens data)');
  pick.setAttribute('data-testid', 'camera-fallback-photo');
  pick.addEventListener('click', () => {
    sheet.remove();
    onSystemCamera();
  });

  const library = document.createElement('button');
  library.type = 'button';
  library.className = 'btn btn--util';
  library.textContent = 'Library';
  library.setAttribute('data-testid', 'camera-fallback-library');
  library.addEventListener('click', () => {
    sheet.remove();
    onLibrary();
  });

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn--util';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => sheet.remove());

  row.appendChild(pick);
  row.appendChild(library);
  row.appendChild(cancel);
  sheet.appendChild(msg);
  sheet.appendChild(row);
  document.body.appendChild(sheet);
  cameraOverlay = sheet;
}

function launchNewPointCamera(): void {
  const take = (file: File) => {
    void handleNewPointCapture(file);
  };
  void openAimingPreview(
    () => openCaptureInput('camera', take),
    () => openCaptureInput('library', take),
  );
}

function launchAgainPhotoCamera(pointId: string): void {
  const take = (file: File) => {
    void handleAgainPhotoCapture(pointId, file);
  };
  void openAimingPreview(
    () => openCaptureInput('camera', take),
    () => openCaptureInput('library', take),
  );
}

async function handleNewPointCapture(file: File): Promise<void> {
  try {
    if (await rejectIfDng(file)) return;
    const preview = await buildDisplayPreview(file);
    await applyNewPointThumb(preview.dataUrl, file, preview.pixels);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not read photo.';
    surfaceFail(msg, 'photo');
  }
}

async function applyNewPointThumb(
  thumb: string,
  original?: File,
  pixels?: PreviewPixelMap,
): Promise<void> {
  try {
    // Ensure + Point dialog / ADD_POINT mode is active before placing.
    if (state.pointDialog !== 'add') {
      const base =
        state.doc.session.inspectingPointId != null
          ? {
              ...state.doc,
              session: { ...state.doc.session, inspectingPointId: undefined },
            }
          : state.doc;
      const doc =
        base.session.mode === 'ADD_POINT' || base.session.mode === 'ADD_POINT_EXTRA_YAW'
          ? base
          : { ...base, session: { ...base.session, mode: 'ADD_POINT' as const } };
      setState({
        doc,
        pointDialog: 'add',
        menuOpen: false,
        openErrorLog: false,
        refuseMessage: null,
        pendingPointThumb: null,
      });
    }
    let width: number | undefined;
    let height: number | undefined;
    try {
      const nat = await imageNaturalSize(thumb);
      width = nat.width;
      height = nat.height;
    } catch {
      /* keep defaults in measurement */
    }
    const result = workflowAddPoint(state.doc, {
      thumbnailDataUrl: thumb,
      width,
      height,
    });
    if (!result.ok) {
      surfaceFail(result.reason, 'add-point');
      setDoc(result.doc, result.reason);
      setState({ pointDialog: 'add', menuOpen: false, pendingPointThumb: null });
      return;
    }
    const photoId = result.doc.session.selectedPhotoId;
    setDoc(result.doc, null);
    setState({
      pointDialog: 'add',
      menuOpen: false,
      openErrorLog: false,
      pendingPointThumb: null,
    });
    speakCoachLine(result.doc.session.lastAction ?? 'Point added.', result.doc.session.speakSteps);
    if (original) await queueCapturedOriginal(original, pixels);
    if (photoId) void openPhotoMark(photoId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not use photo.';
    surfaceFail(msg, 'photo');
  }
}

async function handleAgainPhotoCapture(pointId: string, file: File): Promise<void> {
  try {
    if (await rejectIfDng(file)) return;
    const preview = await buildDisplayPreview(file);
    await applyAgainPhotoThumb(pointId, preview.dataUrl, file, preview.pixels);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not read photo.';
    surfaceFail(msg, 'photo');
  }
}

async function applyAgainPhotoThumb(
  pointId: string,
  thumb: string,
  original?: File,
  pixels?: PreviewPixelMap,
): Promise<void> {
  try {
    let width: number | undefined;
    let height: number | undefined;
    try {
      const nat = await imageNaturalSize(thumb);
      width = nat.width;
      height = nat.height;
    } catch {
      /* defaults */
    }
    const result = appendPhotoToPoint(state.doc, pointId, {
      thumbnailDataUrl: thumb,
      yawOnly: true,
      width,
      height,
    });
    if (result.reason) {
      surfaceFail(result.reason, 'photo');
      return;
    }
    const photoId = result.doc.session.selectedPhotoId;
    setDoc(result.doc, null);
    setState({
      pointDialog: 'inspect',
      pendingPointThumb: null,
      menuOpen: false,
    });
    speakCoachLine(
      result.doc.session.lastAction ?? `+ Photo on ${pointId}.`,
      result.doc.session.speakSteps,
    );
    if (original) await queueCapturedOriginal(original, pixels);
    if (photoId) void openPhotoMark(photoId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not use photo.';
    surfaceFail(msg, 'photo');
  }
}

/** Display-only JPEG. The stored survey photo is the original File, queued separately. */
async function displayPreviewDataUrl(file: File): Promise<string> {
  return (await buildDisplayPreview(file)).dataUrl;
}

async function buildDisplayPreview(
  file: File,
): Promise<{ dataUrl: string; pixels?: PreviewPixelMap }> {
  try {
    return await fileToPreview(file, 640);
  } catch {
    return { dataUrl: placeholderThumb('#1a5f7a') };
  }
}

async function rejectIfDng(file: File): Promise<boolean> {
  const message = dngRejectionMessage(new Uint8Array(await file.arrayBuffer()), file.name, file.type);
  if (!message) return false;
  surfaceFail(message, 'photo');
  return true;
}

async function queueCapturedOriginal(file: File, pixels?: PreviewPixelMap): Promise<void> {
  const photoId = state.doc.session.selectedPhotoId;
  const photo = photoId ? state.doc.photos.find((p) => p.id === photoId) : undefined;
  const stationId = photo?.addPointId;
  if (!photoId || !photo || !stationId) {
    surfaceFail('Photo was not tied to a station, so the original was not queued.', 'photo');
    return;
  }
  try {
    const observationId = state.doc.observations.find((o) => o.photoId === photoId)?.id;
    const setup = state.doc.setups.find((s) => s.id === photo.setupId);
    const draft = await rememberOriginalPhoto(file, {
      name: file.name,
      type: file.type,
      photoId,
      stationId,
      observationId,
      pixels,
      sessionStartedAt: setup?.startedAt,
      sessionEndedAt: setup?.endedAt,
    });
    applyPhotoUploadStatus(statusFromDraft(photoId, draft));
    kickPhotoUploads();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not queue the original photo.';
    surfaceFail(msg, 'photo');
  }
}

function statusFromDraft(photoId: string, draft: Awaited<ReturnType<typeof rememberOriginalPhoto>>): PhotoStatusUpdate {
  return {
    photoId,
    status: 'queued',
    fileName: draft.fileName,
    size: draft.size,
    quickXorHash: draft.quickXorHash,
    sha256: draft.sha256,
    contentType: draft.contentType,
    receivedAt: draft.receivedAt,
    capturedAt: draft.capturedAt,
    provenance: draft.provenance,
    calibrationKey: draft.calibrationKey,
    exifDateTimeOriginal: draft.exif.DateTimeOriginal,
    usabilityNote: draft.usabilityNote,
    fullWidth: draft.pixels?.fullWidth,
    fullHeight: draft.pixels?.fullHeight,
    previewWidth: draft.pixels?.previewWidth,
    previewHeight: draft.pixels?.previewHeight,
    previewScaleX: draft.pixels?.previewScaleX,
    previewScaleY: draft.pixels?.previewScaleY,
    clickMap: draft.pixels?.clickMap,
  };
}

function applyPhotoUploadStatus(update: PhotoStatusUpdate): void {
  const photos = state.doc.photos.map((p) => {
    if (p.id !== update.photoId) return p;
    return {
      ...p,
      exifDateTimeOriginal: p.exifDateTimeOriginal ?? update.exifDateTimeOriginal,
      originalFile: {
        fileName: update.fileName,
        size: update.size,
        quickXorHash: update.quickXorHash,
        sha256: update.sha256 ?? p.originalFile?.sha256,
        contentType: update.contentType,
        receivedAt: update.receivedAt || p.originalFile?.receivedAt,
        capturedAt: update.capturedAt ?? p.originalFile?.capturedAt,
        provenance: update.provenance ?? p.originalFile?.provenance,
        calibrationKey: update.calibrationKey ?? p.originalFile?.calibrationKey,
        fullWidth: update.fullWidth ?? p.originalFile?.fullWidth,
        fullHeight: update.fullHeight ?? p.originalFile?.fullHeight,
        previewWidth: update.previewWidth ?? p.originalFile?.previewWidth,
        previewHeight: update.previewHeight ?? p.originalFile?.previewHeight,
        previewScaleX: update.previewScaleX ?? p.originalFile?.previewScaleX,
        previewScaleY: update.previewScaleY ?? p.originalFile?.previewScaleY,
        clickMap: update.clickMap ?? p.originalFile?.clickMap,
        uploadPermanent: update.permanent ?? p.originalFile?.uploadPermanent,
        usabilityNote: update.usabilityNote ?? p.originalFile?.usabilityNote,
        uploadStatus: update.status,
        uploadError: update.error,
      },
    };
  });
  if (!photos.some((p) => p.id === update.photoId)) return;
  setDoc(
    {
      ...state.doc,
      photos,
      photosManifest: state.doc.photosManifest ?? photosManifestLink(),
    },
    null,
  );
  if (update.status === 'queued') {
    setCloudMessage(`Photo ${update.fileName} queued for OneDrive.`);
  } else if (update.status === 'uploading') {
    setCloudMessage(`Uploading ${update.fileName}…`);
  } else if (update.status === 'verified') {
    setCloudMessage(`Photo ${update.fileName} verified on OneDrive.`);
  } else if (update.status === 'failed') {
    const msg = `Photo upload failed: ${update.error ?? 'unknown error'}`;
    setCloudMessage(msg);
    logError(msg, { source: 'photo-upload' });
  }
}

async function hydratePhotoUploadStatus(): Promise<void> {
  let records;
  try {
    records = await listQueuedPhotos();
  } catch {
    return;
  }
  if (!records.length) return;
  let changed = false;
  const photos = await Promise.all(
    state.doc.photos.map(async (p) => {
      const rec = records.find((r) => r.photoId === p.id);
      if (!rec) return p;
      changed = true;
      let thumbnailDataUrl = p.thumbnailDataUrl;
      if (!thumbnailDataUrl?.startsWith('data:image/')) {
        try {
          const file = new File([rec.blob], rec.fileName, { type: rec.contentType });
          thumbnailDataUrl = await displayPreviewDataUrl(file);
        } catch {
          /* display preview is optional; the queued original is unchanged */
        }
      }
      return {
        ...p,
        thumbnailDataUrl,
        originalFile: {
          fileName: rec.fileName,
          size: rec.size,
          quickXorHash: rec.quickXorHash,
          sha256: rec.sha256,
          contentType: rec.contentType,
          receivedAt: rec.receivedAt || rec.capturedAt,
          capturedAt: rec.receivedAt ? rec.capturedAt : undefined,
          provenance: rec.provenance,
          calibrationKey: rec.calibrationKey,
          fullWidth: rec.pixels?.fullWidth,
          fullHeight: rec.pixels?.fullHeight,
          previewWidth: rec.pixels?.previewWidth,
          previewHeight: rec.pixels?.previewHeight,
          previewScaleX: rec.pixels?.previewScaleX,
          previewScaleY: rec.pixels?.previewScaleY,
          clickMap: rec.pixels?.clickMap,
          uploadPermanent: rec.permanent,
          usabilityNote: rec.usabilityNote,
          uploadStatus: rec.status === 'uploading' ? 'queued' : rec.status,
          uploadError: rec.lastError,
        },
      };
    }),
  );
  if (!changed) return;
  setDoc(
    {
      ...state.doc,
      photos,
      photosManifest: state.doc.photosManifest ?? photosManifestLink(),
    },
    null,
  );
}

async function openPhotoMark(photoId: string): Promise<void> {
  const photo = state.doc.photos.find((p) => p.id === photoId);
  if (!photo?.thumbnailDataUrl?.startsWith('data:image/')) {
    surfaceFail('Photo has no image to mark.', 'photo');
    return;
  }
  const bl = preferredBaseline(state.doc);
  let width = photo.width;
  let height = photo.height;
  try {
    const nat = await imageNaturalSize(photo.thumbnailDataUrl);
    width = nat.width;
    height = nat.height;
    if (photo.width !== width || photo.height !== height) {
      setDoc(
        {
          ...state.doc,
          photos: state.doc.photos.map((p) =>
            p.id === photoId ? { ...p, width, height } : p,
          ),
        },
        null,
      );
    }
  } catch {
    /* keep stored size */
  }

  const existing: PhotoClick[] = (photo.clicks ?? []).map((c) => {
    if (bl && c.pointId === bl.a) return { ...c, pointId: 'A' };
    if (bl && c.pointId === bl.b) return { ...c, pointId: 'B' };
    if (c.pointId !== 'A' && c.pointId !== 'B') return { ...c, pointId: 'TARGET' };
    return { ...c };
  });
  const hasA = existing.some((c) => c.pointId === 'A');
  const hasB = existing.some((c) => c.pointId === 'B');
  const assignRole: MarkRole = !hasA ? 'A' : !hasB ? 'B' : 'TARGET';

  markDraft = {
    photoId,
    clicks: existing,
    assignRole,
    suggestions: [],
    hint: bl
      ? `Mark baseline ${bl.a} (A) then ${bl.b} (B). This point = camera station.`
      : 'Establish a baseline before marking ends.',
    busy: true,
  };
  setState({
    markPhotoId: photoId,
    menuOpen: false,
    doc: {
      ...state.doc,
      session: { ...state.doc.session, selectedPhotoId: photoId },
    },
  });

  try {
    const suggestions = await suggestTagBlobs(photo.thumbnailDataUrl, width, height);
    if (markDraft?.photoId !== photoId) return;
    markDraft = {
      ...markDraft,
      suggestions,
      busy: false,
      hint: suggestions.length
        ? `${suggestions.length} tag suggestion(s) — tap a dashed ring or the photo. Placing ${markDraft.assignRole}.`
        : `No auto tags — tap the photo to place ${markDraft.assignRole}.`,
    };
    for (const fn of [...listeners]) fn();
  } catch {
    if (markDraft?.photoId !== photoId) return;
    markDraft = {
      ...markDraft,
      busy: false,
      hint: 'Suggest unavailable — tap the photo to place marks.',
    };
    for (const fn of [...listeners]) fn();
  }
}

function closePhotoMark(): void {
  markDraft = null;
  setState({ markPhotoId: null });
}

function placeMarkAt(px: number, py: number): void {
  if (!markDraft) return;
  const role = markDraft.assignRole;
  const clicks = markDraft.clicks.filter((c) => c.pointId !== role);
  clicks.push({ pointId: role, px, py });
  const hasA = clicks.some((c) => c.pointId === 'A');
  const hasB = clicks.some((c) => c.pointId === 'B');
  let nextRole: MarkRole = 'TARGET';
  if (!hasA) nextRole = 'A';
  else if (!hasB) nextRole = 'B';
  markDraft = {
    ...markDraft,
    clicks,
    assignRole: nextRole,
    hint:
      role === 'TARGET'
        ? 'Extra mark saved — a separate object point needs a second sighting or tape distance.'
        : hasA && hasB
          ? 'A and B set — Confirm to place the camera station (or mark an optional target).'
          : `Placed ${role}. Next: ${nextRole}.`,
  };
  for (const fn of [...listeners]) fn();
}

function confirmPhotoMarks(): void {
  if (!markDraft) return;
  const result = applyPhotoMarks(state.doc, markDraft.photoId, markDraft.clicks);
  markDraft = null;
  setDoc(result.doc, null);
  setState({ markPhotoId: null });
  speakCoachLine(result.message, result.doc.session.speakSteps);
  setCloudMessage(result.message);
  if (result.reason && !result.stationApplied) {
    // Soft — marks may still have saved; do not block with refuse overlay.
    logError(result.reason, { source: 'photo' });
  }
}

const SEEN_BUILD_KEY = 'garden-survey-seen-build';

function currentBuildKey(): string {
  return `${appVersion()}·${appBuild()}`;
}

function hasSeenCurrentBuild(): boolean {
  try {
    return localStorage.getItem(SEEN_BUILD_KEY) === currentBuildKey();
  } catch {
    return true;
  }
}

function markCurrentBuildSeen(): void {
  try {
    localStorage.setItem(SEEN_BUILD_KEY, currentBuildKey());
  } catch {
    /* ignore quota / private mode */
  }
}

let state: UiState = {
  doc: loadCachedGarden() ?? createEmptyGarden(),
  view: 'survey',
  refuseMessage: null,
  showStage2Checklist: false,
  menuOpen: false,
  openErrorLog: false,
  menuFocus: 'recommend',
  pointDialog: null,
  pendingPointThumb: null,
  markPhotoId: null,
};

function openMenuSection(section: MenuSection): void {
  setState({
    menuOpen: true,
    menuFocus: section,
    openErrorLog: section === 'error-log',
    refuseMessage: state.refuseMessage,
  });
  // Error log: do not auto-acknowledge — tap a red error line (or Mark seen).
}

function openPointDialog(mode: 'add' | 'inspect'): void {
  setState({
    pointDialog: mode,
    menuOpen: false,
    openErrorLog: false,
    refuseMessage: state.refuseMessage,
  });
}

function closePointDialog(): void {
  // Closing + Point / inspect returns chrome to Menu — do not leave mode stuck on ADD_POINT.
  setState({
    doc: {
      ...state.doc,
      session: {
        ...state.doc.session,
        mode: 'MENU',
        inspectingPointId: undefined,
        selectedPhotoId: undefined,
      },
    },
    pointDialog: null,
    pendingPointThumb: null,
    refuseMessage: null,
  });
}

/** Enter ADD_POINT when legal, then open the on-plan dialogue with sticky defaults.
 *  `launchCamera` (default true) opens the rear camera in the same user gesture. */
function startAddPointDialog(opts: { launchCamera?: boolean } = {}): void {
  const launchCamera = opts.launchCamera !== false;
  const legal = new Set(legalActions(state.doc));
  if (
    legal.has('add_point') &&
    state.doc.session.mode !== 'ADD_POINT' &&
    state.doc.session.mode !== 'ADD_POINT_EXTRA_YAW'
  ) {
    const probe = canTransition(state.doc, 'add_point');
    if (probe.ok) {
      const { doc: next, result } = applyTransition(state.doc, 'add_point');
      if (result.ok) {
        const cleared = {
          ...next,
          session: { ...next.session, inspectingPointId: undefined },
        };
        setState({
          doc: cleared,
          refuseMessage: null,
          menuOpen: false,
          pointDialog: 'add',
          openErrorLog: false,
          pendingPointThumb: null,
        });
        speakCoachLine(buildCoach(cleared).body[0] ?? '', cleared.session.speakSteps);
        if (launchCamera) launchNewPointCamera();
        return;
      }
    }
  }
  // Soft-set ADD_POINT for chrome when already legal/active, or dialog-only open.
  const base =
    state.doc.session.inspectingPointId != null
      ? {
          ...state.doc,
          session: { ...state.doc.session, inspectingPointId: undefined },
        }
      : state.doc;
  const doc =
    base.session.mode === 'ADD_POINT' || base.session.mode === 'ADD_POINT_EXTRA_YAW'
      ? base
      : { ...base, session: { ...base.session, mode: 'ADD_POINT' as const } };
  setState({
    doc,
    pointDialog: 'add',
    menuOpen: false,
    openErrorLog: false,
    refuseMessage: null,
    pendingPointThumb: null,
  });
  if (launchCamera) launchNewPointCamera();
}

/** Mode shown in the Mode picker — Menu when no workflow dialog is active. */
function displayedChromeMode(): string {
  if (state.pointDialog === 'add') return 'ADD_POINT';
  if (state.pointDialog === 'inspect') return 'REVIEW';
  const m = state.doc.session.mode;
  if (m === 'START' || m === 'MENU') return 'MENU';
  if (m === 'ADD_POINT' || m === 'ADD_POINT_EXTRA_YAW') return 'MENU';
  if (m === 'HOUSE_BASELINE') return 'BASELINE';
  if (m === 'PLACE_ROD_A') return 'HOUSE_EDGES';
  if (m === 'PHOTO_TIE_HOUSE_ROD') return 'PHOTO_TIE_BASELINE';
  if ((m as string) === 'OCCUPY') return 'MENU';
  return m;
}

/** Picker entries — real session modes + Menu idle chrome. */
const MODE_PICKER: { value: string; label: string }[] = [
  { value: 'MENU', label: 'Menu' },
  { value: 'BASELINE', label: 'Baseline' },
  { value: 'PHOTO_TIE_BASELINE', label: 'Baseline photo tie' },
  { value: 'HOUSE_EDGES', label: 'Measure house edges' },
  { value: 'ADD_POINT', label: '+ Point' },
  { value: 'LEAPFROG', label: 'Leapfrog' },
  { value: 'RODS_MOVED', label: 'Rods moved' },
  { value: 'FENCE_TAG', label: 'Fence mark' },
  { value: 'ADJUST', label: 'Adjust' },
  { value: 'REVIEW', label: 'Review' },
];

function modeSectionStatus(): { tone: 'idle'; inline: string } {
  const current = displayedChromeMode();
  return {
    tone: 'idle',
    // Closed: Mode  Menu / Mode  + Point …
    inline: MODE_PICKER.find((m) => m.value === current)?.label ?? current,
  };
}

function buildModePicker(doc: GardenDocument): HTMLElement {
  const body = el('div', { className: 'menu-acc__body', attrs: { 'data-testid': 'mode-panel' } });
  const current = displayedChromeMode();
  const sel = el('select', {
    className: 'menu-mode-select',
    attrs: {
      'data-cmd': 'select-chrome-mode',
      'data-testid': 'mode-picker',
      'aria-label': 'Survey mode',
    },
  }) as HTMLSelectElement;
  for (const opt of MODE_PICKER) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === current) o.selected = true;
    sel.appendChild(o);
  }
  body.appendChild(sel);
  body.appendChild(
    el('p', {
      className: 'menu-acc__meta',
      text: buildCoach(doc).banner,
    }),
  );
  return body;
}

function selectChromeMode(value: string): void {
  if (value === 'MENU') {
    setState({
      doc: {
        ...state.doc,
        session: { ...state.doc.session, mode: 'MENU', inspectingPointId: undefined },
      },
      pointDialog: null,
      menuOpen: true,
      menuFocus: 'recommend',
      openErrorLog: false,
    });
    return;
  }
  if (value === 'ADD_POINT') {
    startAddPointDialog();
    return;
  }
  if (value === 'BASELINE') {
    // Reuse Establish baseline open path
    if (state.doc.session.mode === 'START' || state.doc.session.mode === 'MENU') {
      const result = startStage2FieldWorkflow(state.doc);
      if (result.ok) {
        setState({
          doc: result.doc,
          view: 'survey',
          refuseMessage: null,
          showStage2Checklist: result.showChecklist,
          menuOpen: true,
          menuFocus: 'baseline',
          pointDialog: null,
          openErrorLog: false,
        });
        return;
      }
    }
    setState({
      doc: { ...state.doc, session: { ...state.doc.session, mode: 'BASELINE' } },
      pointDialog: null,
      menuOpen: true,
      menuFocus: 'baseline',
    });
    return;
  }
  if (value === 'PHOTO_TIE_BASELINE') {
    setState({
      pointDialog: null,
      menuOpen: true,
      menuFocus: 'tie',
    });
    if (canTransition(state.doc, 'take_baseline_tie').ok) {
      onModeAction('take_baseline_tie');
    }
    return;
  }
  if (value === 'HOUSE_EDGES') {
    setState({ pointDialog: null, menuOpen: true, menuFocus: 'house' });
    if (canTransition(state.doc, 'measure_house_edges').ok) {
      onModeAction('measure_house_edges');
    } else {
      setDoc({ ...state.doc, session: { ...state.doc.session, mode: 'HOUSE_EDGES' } }, null);
    }
    return;
  }
  if (value === 'LEAPFROG') {
    setState({ pointDialog: null, menuOpen: true, menuFocus: 'leapfrog' });
    if (canTransition(state.doc, 'start_leapfrog').ok) {
      onModeAction('start_leapfrog');
    }
    return;
  }
  if (value === 'RODS_MOVED') {
    onModeAction('rods_moved');
    return;
  }
  if (value === 'FENCE_TAG') {
    onModeAction('fence_mark');
    return;
  }
  if (value === 'ADJUST') {
    onModeAction('adjust');
    return;
  }
  if (value === 'REVIEW') {
    setState({
      doc: {
        ...state.doc,
        session: { ...state.doc.session, mode: 'REVIEW', inspectingPointId: undefined },
      },
      pointDialog: null,
      menuOpen: true,
      menuFocus: 'coach',
    });
  }
}

/** Surface a coach/refuse failure and append to the in-app error log. */
function surfaceFail(message: string, source = 'coach'): void {
  logError(message, { source });
  setState({ refuseMessage: message });
}

const listeners: Listener[] = [];

/** Debounce silent OneDrive backup after local edits when signed in. */
let cloudSaveTimer: ReturnType<typeof setTimeout> | null = null;

export function getState(): UiState {
  return state;
}

export function subscribe(fn: Listener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function setState(partial: Partial<UiState>): void {
  state = { ...state, ...partial };
  // Always notify listeners even if persistence fails — otherwise the UI freezes
  // on legal transitions while illegal refusals (no save) still appear to work.
  if (partial.doc) {
    const saved = persistGardenLocal(partial.doc);
    if (!saved.ok) {
      handleLocalPersistFailure(partial.doc, saved);
    } else if (state.refuseMessage && /browser|quota|storage/i.test(state.refuseMessage)) {
      state = { ...state, refuseMessage: null };
    }
    scheduleCloudBackup(partial.doc);
  }
  for (const fn of [...listeners]) fn();
}

/**
 * Local draft is best-effort; OneDrive is source of truth when signed in.
 * Never sets refuseMessage / overlay — that covers + Point Close/A±.
 * Persist problems go to Error log + Sign-in status only.
 */
function handleLocalPersistFailure(
  doc: GardenDocument,
  saved: { error: string; quotaExceeded?: boolean },
): void {
  const quota = Boolean(saved.quotaExceeded);
  if (quota && isSignedIn()) {
    setCloudMessage(
      'Photos filled this browser’s storage. Saving to OneDrive (cloud is source of truth)…',
    );
    logError(
      'Photos filled this browser’s storage. Saving to OneDrive instead (local cache skipped).',
      { source: 'persist-quota' },
    );
    if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
    cloudSaveTimer = null;
    void quietCloudSave(doc, { afterLocalQuota: true });
    return;
  }
  if (quota) {
    const msg =
      'Photos filled this browser’s storage. Export garden.json, sign in for OneDrive, or Sign in → Clear local cache. (+ Point stays usable.)';
    logError(msg, { source: 'persist-quota' });
    setCloudMessage(msg);
    return;
  }
  const msg = `Could not save draft to this browser (${saved.error}). Export garden.json or use OneDrive — working copy in memory is fine.`;
  logError(msg, { source: 'persist-quota' });
  setCloudMessage(msg);
}

function setDoc(doc: GardenDocument, refuse: string | null = null): void {
  setState({ doc, refuseMessage: refuse });
}

function scheduleCloudBackup(doc: GardenDocument): void {
  if (!isSignedIn()) return;
  if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    void quietCloudSave(doc);
  }, 2500);
}

async function quietCloudSave(
  doc: GardenDocument,
  opts: { afterLocalQuota?: boolean } = {},
): Promise<void> {
  if (!isSignedIn()) return;
  const auth = await silentGraphToken();
  if (!auth.ok) {
    if (auth.interactionRequired) {
      notePhotoSignIn(true);
      setCloudMessage('Sign in to save.');
      return;
    }
    setCloudMessage(
      opts.afterLocalQuota
        ? `Browser storage full, and OneDrive save failed: ${auth.error}. Export garden.json now.`
        : `Could not auto-save to OneDrive: ${auth.error}`,
    );
    return;
  }
  const result = await saveGardenCloud(doc, undefined, auth.token);
  if (result.ok) {
    setLastSaveIso(result.savedAt);
    if (opts.afterLocalQuota) {
      setCloudMessage(
        `Browser storage full (photos) — saved ${result.fileName} to OneDrive. Load from OneDrive on other devices; Clear local cache if this browser stays full.`,
      );
      if (state.refuseMessage && /browser|quota|storage/i.test(state.refuseMessage)) {
        state = { ...state, refuseMessage: null };
        for (const fn of [...listeners]) fn();
      }
    } else {
      setCloudMessage(`Saved ${result.fileName} to OneDrive.`);
    }
  } else {
    setCloudMessage(
      opts.afterLocalQuota
        ? `Browser storage full, and OneDrive save failed: ${result.error}. Export garden.json now.`
        : `Could not auto-save to OneDrive: ${result.error}`,
    );
  }
}

export function mount(root: HTMLElement): void {
  const shell = document.createElement('div');
  shell.className = 'app-shell';
  root.appendChild(shell);

  // Stable event delegation — survives innerHTML re-renders.
  shell.addEventListener('click', onShellClick);
  shell.addEventListener('change', onShellChange);

  const render = () => {
    shell.innerHTML = '';
    shell.appendChild(buildApp());
  };
  subscribe(render);
  subscribeAuth(render);
  subscribeCloud(render);
  subscribeErrorLog(render);
  render();
  startPhotoUploadLoop({
    getToken: async () => {
      const auth = await acquireGraphTokenSilent();
      if (auth.ok) {
        notePhotoSignIn(false);
        return auth.token;
      }
      if (auth.interactionRequired) {
        notePhotoSignIn(true);
        return { token: null, interactionRequired: true };
      }
      return null;
    },
    onInteractionRequired: () => notePhotoSignIn(true),
    onStorageWarning: (message) => setCloudMessage(message),
    onStatus: applyPhotoUploadStatus,
  });
  void hydratePhotoUploadStatus();
}

/**
 * After MSAL init: show real errors, welcome signed-in users, and auto-load the
 * last-loaded garden file from OneDrive (redirect or restored session).
 */
export function applyAuthReady(init: AuthInitResult): void {
  if (!init.configured) return;

  if (init.error) {
    const msg = `Microsoft sign-in problem: ${init.error}`;
    logError(msg, { source: 'msal' });
    setCloudMessage(msg);
    return;
  }

  if (!init.signedIn) {
    // Keep the default “Not signed in…” line; no silent failure after a redirect attempt.
    return;
  }

  const who = init.accountLabel ? ` as ${init.accountLabel}` : '';
  const last = getGardenCloudFileName();
  setCloudMessage(
    init.fromRedirect
      ? `Signed in${who}. Loading ${last} from OneDrive…`
      : `Signed in${who}. Loading last garden (${last})…`,
  );
  void restoreFromOneDriveAfterSignIn();
}

async function restoreFromOneDriveAfterSignIn(): Promise<void> {
  if (!isSignedIn()) return;
  const preferred = getGardenCloudFileName();
  setCloudBusy(true);
  const result = await loadGardenCloud(preferred);
  setCloudBusy(false);
  void refreshGardenFileList();
  if (!result.ok) {
    // Missing file is normal on first save — keep local cache / empty.
    if (result.missing) {
      setCloudMessage(
        `Signed in. No garden file on OneDrive yet (wanted ${preferred}) — set Version and Save when ready.`,
      );
      return;
    }
    const msg = `Signed in, but could not load from OneDrive: ${result.error}`;
    logError(msg, { source: 'onedrive' });
    setCloudMessage(msg);
    return;
  }
  // Remember what was actually opened so the next startup auto-loads it.
  setGardenCloudFileName(result.fileName);
  notifyCloudPrefsChanged();
  setDoc(result.doc, null);
  const via =
    result.fallbackFrom && result.fallbackFrom !== result.fileName
      ? result.usedLegacy
        ? ` (fallback legacy; ${result.fallbackFrom} missing)`
        : ` (fallback; ${result.fallbackFrom} missing)`
      : '';
  setCloudMessage(`Signed in. Loaded ${result.fileName}${via}.`);
}

function onShellClick(e: Event): void {
  const target = (e.target as HTMLElement | null)?.closest?.('[data-cmd]') as HTMLElement | null;
  if (!target) return;
  const cmd = target.getAttribute('data-cmd');
  if (!cmd) return;
  e.preventDefault();

  if (cmd === 'mode') {
    const action = target.getAttribute('data-action') as ModeAction | null;
    if (action) onModeAction(action);
    return;
  }
  if (cmd === 'toggle-menu') {
    if (state.menuOpen) {
      setState({ menuOpen: false, openErrorLog: false, refuseMessage: state.refuseMessage });
      return;
    }
    // Opening: first open after a new Build stamp → expand Version.
    // Also: if + Point dialog is closed, don't leave session stuck on ADD_POINT.
    let focus: MenuSection = state.menuFocus ?? 'recommend';
    if (!hasSeenCurrentBuild()) {
      focus = 'version';
      markCurrentBuildSeen();
    } else if (!focus) {
      focus = 'recommend';
    }
    let doc = state.doc;
    if (
      !state.pointDialog &&
      (doc.session.mode === 'ADD_POINT' || doc.session.mode === 'ADD_POINT_EXTRA_YAW')
    ) {
      doc = { ...doc, session: { ...doc.session, mode: 'MENU' } };
    }
    setState({
      doc,
      menuOpen: true,
      openErrorLog: false,
      menuFocus: focus,
      refuseMessage: state.refuseMessage,
    });
    return;
  }
  if (cmd === 'close-menu') {
    setState({ menuOpen: false, openErrorLog: false });
    return;
  }
  if (cmd === 'menu-accordion') {
    const section = (target.getAttribute('data-section') as MenuSection) || null;
    // Toggle: same section closes; otherwise one open at a time.
    const next = state.menuFocus === section ? null : section;
    setState({
      menuOpen: true,
      menuFocus: next,
      openErrorLog: next === 'error-log',
    });
    return;
  }
  if (cmd === 'open-menu-section') {
    const section = (target.getAttribute('data-section') as MenuSection) || 'recommend';
    if (section === 'baseline') {
      if (state.doc.session.mode === 'START') {
        const result = startStage2FieldWorkflow(state.doc);
        if (result.ok) {
          setState({
            doc: result.doc,
            view: 'survey',
            refuseMessage: null,
            showStage2Checklist: result.showChecklist,
            menuOpen: true,
            menuFocus: 'baseline',
            openErrorLog: false,
          });
          speakCoachLine(
            buildCoach(result.doc).body[0] ?? '',
            result.doc.session.speakSteps,
          );
          return;
        }
      }
      openMenuSection('baseline');
      return;
    }
    openMenuSection(section);
    return;
  }
  if (cmd === 'open-point-dialog') {
    startAddPointDialog();
    return;
  }
  if (cmd === 'close-point-dialog') {
    closePointDialog();
    return;
  }
  if (cmd === 'open-error-log') {
    openMenuSection('error-log');
    return;
  }
  if (cmd === 'clear-error-log') {
    clearErrorLog();
    setState({ openErrorLog: true, menuOpen: true });
    return;
  }
  if (cmd === 'mark-errors-seen') {
    markErrorsSeen();
    return;
  }
  if (cmd === 'acknowledge-error') {
    // Tap a red error line → clear ☰ / concertina red warning; keep entries.
    markErrorsSeen();
    return;
  }
  if (cmd === 'load-synthetic') {
    loadSynthetic();
    return;
  }
  if (cmd === 'run-milestone') {
    runMilestoneDemo();
    return;
  }
  if (cmd === 'start-stage2') {
    startStage2FieldLoop();
    return;
  }
  if (cmd === 'toggle-stage2-checklist') {
    setState({
      showStage2Checklist: !state.showStage2Checklist,
      refuseMessage: null,
      menuOpen: true,
      menuFocus: 'tools',
    });
    return;
  }
  if (cmd === 'new-garden') {
    setState({
      doc: createEmptyGarden(),
      refuseMessage: null,
      showStage2Checklist: false,
      menuOpen: false,
    });
    return;
  }
  if (cmd === 'export') {
    exportGarden(state.doc);
    return;
  }
  if (cmd === 'print-tags') {
    setState({ view: 'tags', refuseMessage: null, menuOpen: false });
    return;
  }
  if (cmd === 'back-survey') {
    setState({ view: 'survey' });
    return;
  }
  if (cmd === 'do-print') {
    triggerPrint();
    return;
  }
  if (cmd === 'add-photo') {
    // Hierarchy Point + / legacy testid: always a **new** point → camera immediately.
    startAddPointDialog({ launchCamera: true });
    return;
  }
  if (cmd === 'again-photo') {
    const pointId =
      state.doc.session.inspectingPointId ?? state.doc.session.currentAddPointId;
    if (!pointId) {
      surfaceFail('Select a point first, then + Photo for another shot here.', 'photo');
      return;
    }
    // Keep inspect open on this point; camera attaches yaw/same-station photo.
    if (state.pointDialog !== 'inspect' || state.doc.session.inspectingPointId !== pointId) {
      setState({
        doc: {
          ...state.doc,
          session: { ...state.doc.session, inspectingPointId: pointId },
        },
        pointDialog: 'inspect',
        menuOpen: false,
      });
    }
    launchAgainPhotoCamera(pointId);
    return;
  }
  if (cmd === 'select-photo') {
    const photoId = target.getAttribute('data-photo-id');
    if (!photoId) return;
    setDoc(
      {
        ...state.doc,
        session: { ...state.doc.session, selectedPhotoId: photoId },
      },
      null,
    );
    return;
  }
  if (cmd === 'open-photo-mark') {
    const photoId = target.getAttribute('data-photo-id');
    if (!photoId) return;
    void openPhotoMark(photoId);
    return;
  }
  if (cmd === 'close-photo-mark') {
    closePhotoMark();
    return;
  }
  if (cmd === 'photo-mark-role') {
    const role = target.getAttribute('data-role') as MarkRole | null;
    if (!markDraft || !role) return;
    markDraft = {
      ...markDraft,
      assignRole: role,
      hint: `Placing ${role}${role === 'TARGET' ? ' (optional — needs distance / 2nd sighting)' : ''}.`,
    };
    for (const fn of [...listeners]) fn();
    return;
  }
  if (cmd === 'photo-mark-suggest') {
    if (!markDraft) return;
    void (async () => {
      const photo = state.doc.photos.find((p) => p.id === markDraft!.photoId);
      if (!photo?.thumbnailDataUrl) return;
      markDraft = { ...markDraft!, busy: true, hint: 'Suggesting tags…' };
      for (const fn of [...listeners]) fn();
      try {
        const suggestions = await suggestTagBlobs(
          photo.thumbnailDataUrl,
          photo.width,
          photo.height,
        );
        if (!markDraft) return;
        markDraft = {
          ...markDraft,
          suggestions,
          busy: false,
          hint: suggestions.length
            ? `${suggestions.length} suggestion(s) — tap a dashed ring.`
            : 'No tags found — tap the photo.',
        };
      } catch {
        if (!markDraft) return;
        markDraft = { ...markDraft, busy: false, hint: 'Suggest failed — tap to place.' };
      }
      for (const fn of [...listeners]) fn();
    })();
    return;
  }
  if (cmd === 'photo-mark-clear') {
    if (!markDraft) return;
    markDraft = {
      ...markDraft,
      clicks: [],
      assignRole: 'A',
      hint: 'Cleared marks — place A then B.',
    };
    for (const fn of [...listeners]) fn();
    return;
  }
  if (cmd === 'photo-mark-confirm') {
    confirmPhotoMarks();
    return;
  }
  if (cmd === 'photo-mark-accept-suggest') {
    const px = Number(target.getAttribute('data-px'));
    const py = Number(target.getAttribute('data-py'));
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    placeMarkAt(px, py);
    return;
  }
  if (cmd === 'photo-mark-canvas') {
    const img = (target as HTMLElement).closest('[data-mark-canvas]')?.querySelector('img');
    const photo = markDraft
      ? state.doc.photos.find((p) => p.id === markDraft!.photoId)
      : undefined;
    if (!img || !photo || !markDraft) return;
    const me = e as MouseEvent;
    const rect = img.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const px = ((me.clientX - rect.left) / rect.width) * photo.width;
    const py = ((me.clientY - rect.top) / rect.height) * photo.height;
    placeMarkAt(px, py);
    return;
  }
  if (cmd === 'delete-photo') {
    const pointId =
      state.doc.session.inspectingPointId ?? state.doc.session.currentAddPointId;
    const photoId = state.doc.session.selectedPhotoId;
    if (!pointId || !photoId) {
      surfaceFail('Select a photo to delete.', 'photo');
      return;
    }
    if (!window.confirm('Delete this photo from the point?')) return;
    const result = deletePhotoFromPoint(state.doc, pointId, photoId);
    if (result.reason) {
      surfaceFail(result.reason, 'delete-photo');
      setDoc(result.doc, result.reason);
      return;
    }
    setDoc(result.doc, null);
    setState({
      pointDialog: state.pointDialog === 'inspect' ? 'inspect' : 'add',
      pendingPointThumb: null,
      menuOpen: false,
    });
    speakCoachLine(
      result.doc.session.lastAction ?? 'Photo deleted.',
      result.doc.session.speakSteps,
    );
    return;
  }
  if (cmd === 'delete-point') {
    const pointId = state.doc.session.inspectingPointId;
    if (!pointId || state.pointDialog !== 'inspect') return;
    if (!window.confirm(`Delete point ${pointId}? This cannot be undone.`)) return;
    const result = deletePointMeasurement(state.doc, pointId);
    if (result.reason) {
      surfaceFail(result.reason, 'delete-point');
      setDoc(result.doc, result.reason);
      return;
    }
    setDoc(result.doc, null);
    setState({ pointDialog: null, pendingPointThumb: null, menuOpen: false });
    speakCoachLine(result.doc.session.lastAction ?? `Deleted ${pointId}.`, result.doc.session.speakSteps);
    return;
  }
  if (cmd === 'create-layer') {
    const name = window.prompt('Layer name', `Layer ${(state.doc.layers?.length ?? 0) + 1}`);
    if (name == null) return;
    const { doc } = createLayer(state.doc, { name: name.trim() || undefined });
    setDoc(doc, null);
    return;
  }
  if (cmd === 'delete-layer') {
    const layer = stickyLayer(state.doc);
    const itemCount = objectsOnLayer(state.doc, layer.id).length;
    const msg =
      itemCount > 0
        ? `Delete layer “${layer.name}” and its ${itemCount} item${itemCount === 1 ? '' : 's'}?`
        : `Delete layer “${layer.name}”?`;
    if (!window.confirm(msg)) return;
    const result = deleteLayerMeasurement(state.doc, layer.id);
    if (result.reason) {
      surfaceFail(result.reason, 'delete-layer');
      setDoc(result.doc, result.reason);
      return;
    }
    // Keep + Point dialog open — neutral reset (fallback layer, no sticky item/point).
    const doc = {
      ...result.doc,
      session: {
        ...result.doc.session,
        mode: 'ADD_POINT' as const,
        inspectingPointId: undefined,
        stickyObjectId: undefined,
        stickyObjectName: undefined,
        currentAddPointId: undefined,
        selectedPhotoId: undefined,
      },
    };
    setDoc(doc, null);
    setState({
      pointDialog: 'add',
      pendingPointThumb: null,
      menuOpen: false,
    });
    speakCoachLine(doc.session.lastAction ?? 'Layer deleted.', doc.session.speakSteps);
    return;
  }
  if (cmd === 'delete-item') {
    const obj = stickyObject(state.doc);
    if (!obj) {
      surfaceFail('Select an item to delete.', 'delete-item');
      return;
    }
    const n = obj.measuredPointIds.length;
    const msg =
      n > 0
        ? `Delete item “${obj.name}” and its ${n} point${n === 1 ? '' : 's'}?`
        : `Delete item “${obj.name}”?`;
    if (!window.confirm(msg)) return;
    const result = deleteObjectMeasurement(state.doc, obj.id);
    if (result.reason) {
      surfaceFail(result.reason, 'delete-item');
      setDoc(result.doc, result.reason);
      return;
    }
    // Keep + Point dialog open — ready for + Item / pick another item.
    const doc = {
      ...result.doc,
      session: {
        ...result.doc.session,
        mode: 'ADD_POINT' as const,
        inspectingPointId: undefined,
        stickyObjectId: undefined,
        stickyObjectName: undefined,
        currentAddPointId: undefined,
        selectedPhotoId: undefined,
      },
    };
    setDoc(doc, null);
    setState({
      pointDialog: 'add',
      pendingPointThumb: null,
      menuOpen: false,
    });
    speakCoachLine(doc.session.lastAction ?? 'Item deleted.', doc.session.speakSteps);
    return;
  }
  if (cmd === 'inspect-point') {
    const pointId = target.getAttribute('data-point-id');
    if (!pointId) return;
    const pt = state.doc.points.find((p) => p.id === pointId);
    if (!pt) return;
    // Seed sticky panel from this point's measurement history
    const seedPhoto =
      state.doc.session.selectedPhotoId &&
      (pt.photoIds ?? []).includes(state.doc.session.selectedPhotoId)
        ? state.doc.session.selectedPhotoId
        : pt.photoIds?.[pt.photoIds.length - 1];
    let doc = {
      ...state.doc,
      session: {
        ...state.doc.session,
        inspectingPointId: pointId,
        selectedPhotoId: seedPhoto,
        stickyLayerId: pt.layerId ?? state.doc.session.stickyLayerId,
        stickyObjectId: pt.objectId ?? state.doc.session.stickyObjectId,
        stickyObjectName:
          (pt.objectId
            ? state.doc.objects?.find((o) => o.id === pt.objectId)?.name
            : undefined) ?? state.doc.session.stickyObjectName,
        stickyGeometryType:
          (pt.objectId
            ? state.doc.objects?.find((o) => o.id === pt.objectId)?.geometryType
            : undefined) ?? state.doc.session.stickyGeometryType,
        currentBaselineId:
          pt.measuredWithBaselineId ?? state.doc.session.currentBaselineId,
      },
    };
    if (pt.measuredWithBaselineId) {
      const bl = doc.baselines.find((b) => b.id === pt.measuredWithBaselineId);
      if (bl) doc = { ...doc, session: { ...doc.session, activeBaselineEnds: { a: bl.a, b: bl.b } } };
    }
    setDoc(doc, null);
    openPointDialog('inspect');
    return;
  }
  if (cmd === 'close-inspector' || cmd === 'close-point-dialog') {
    closePointDialog();
    return;
  }
  if (cmd === 'point-ui-smaller') {
    bumpPointUiScale(-POINT_UI_SCALE_STEP);
    return;
  }
  if (cmd === 'point-ui-larger') {
    bumpPointUiScale(POINT_UI_SCALE_STEP);
    return;
  }
  if (cmd === 'apply-inspector') {
    const panel = target.closest('.point-dialog') ?? target.closest('.add-point-panel');
    const pointId = state.doc.session.inspectingPointId;
    if (!pointId || !panel) return;
    const layerId = (panel.querySelector('[data-field=layer]') as HTMLSelectElement | null)?.value;
    const objectName = (
      panel.querySelector('[data-field=object-name]') as HTMLInputElement | null
    )?.value;
    const geometryType = (panel.querySelector('[data-field=geometry]') as HTMLSelectElement | null)
      ?.value as GeometryType | undefined;
    const baselineId = (panel.querySelector('[data-field=baseline]') as HTMLSelectElement | null)
      ?.value;
    const objectId =
      (panel.querySelector('[data-field=object]') as HTMLSelectElement | null)?.value || undefined;
    const next = updatePointMeasurement(state.doc, pointId, {
      layerId,
      objectId: objectId === '__new__' ? undefined : objectId,
      objectName,
      geometryType,
      measuredWithBaselineId: baselineId || undefined,
    });
    setDoc(
      {
        ...next,
        session: { ...next.session, inspectingPointId: pointId },
      },
      null,
    );
    setState({ pointDialog: 'inspect', menuOpen: false });
    return;
  }
  if (cmd === 'create-object') {
    const panel = target.closest('.point-dialog') ?? target.closest('.add-point-panel');
    const name =
      (panel?.querySelector('[data-field=object-name]') as HTMLInputElement | null)?.value?.trim() ||
      'Untitled';
    const layerId =
      (panel?.querySelector('[data-field=layer]') as HTMLSelectElement | null)?.value ||
      stickyLayer(state.doc).id;
    const geometryType = ((panel?.querySelector('[data-field=geometry]') as HTMLSelectElement | null)
      ?.value || stickyGeometry(state.doc)) as GeometryType;
    const { doc } = createObject(state.doc, { layerId, name, geometryType });
    setDoc(doc, null);
    return;
  }
  if (cmd === 'save-object') {
    // Rename / update sticky fields for the selected existing item.
    const panel = target.closest('.point-dialog') ?? target.closest('.add-point-panel');
    if (!panel) return;
    const objectId = (panel.querySelector('[data-field=object]') as HTMLSelectElement | null)?.value;
    if (!objectId || objectId === '__new__') {
      surfaceFail('Select an existing item to rename, or use + Item.', 'item');
      return;
    }
    const objectName =
      (panel.querySelector('[data-field=object-name]') as HTMLInputElement | null)?.value?.trim() ||
      undefined;
    const layerId = (panel.querySelector('[data-field=layer]') as HTMLSelectElement | null)?.value;
    const geometryType = (panel.querySelector('[data-field=geometry]') as HTMLSelectElement | null)
      ?.value as GeometryType | undefined;
    const objects = (state.doc.objects ?? []).map((o) =>
      o.id === objectId
        ? {
            ...o,
            name: objectName || o.name,
            layerId: layerId || o.layerId,
            geometryType: geometryType || o.geometryType,
          }
        : o,
    );
    setDoc(
      {
        ...state.doc,
        objects,
        session: {
          ...state.doc.session,
          stickyObjectId: objectId,
          stickyObjectName: objectName || state.doc.session.stickyObjectName,
          stickyLayerId: layerId || state.doc.session.stickyLayerId,
          stickyGeometryType: geometryType || state.doc.session.stickyGeometryType,
          lastAction: `Saved item “${objectName || objectId}”`,
        },
      },
      null,
    );
    return;
  }
  if (cmd === 'save-baseline') {
    const panel = target.closest('.step-panel') ?? target.closest('[data-testid="baseline-form"]');
    const length = Number(
      (panel?.querySelector('[data-field=length]') as HTMLInputElement | null)?.value,
    );
    const offsetA = Number(
      (panel?.querySelector('[data-field=offset-a]') as HTMLInputElement | null)?.value || 0,
    );
    const offsetB = Number(
      (panel?.querySelector('[data-field=offset-b]') as HTMLInputElement | null)?.value || 0,
    );
    const baselineId =
      (panel?.querySelector('[data-field=baseline-id]') as HTMLInputElement | HTMLSelectElement | null)
        ?.value || undefined;
    const kind = ((panel?.querySelector('[data-field=kind]') as HTMLSelectElement | null)?.value ||
      'tape') as 'tape' | 'laser';
    const trustRaw = (panel?.querySelector('[data-field=trust]') as HTMLInputElement | null)?.value;
    const trust = trustRaw != null && trustRaw !== '' ? Number(trustRaw) : undefined;
    const result = saveBaselineLengthWorkflow(state.doc, length, offsetA, offsetB, true, {
      baselineId,
      kind,
      trust,
    });
    if (!result.ok) {
      surfaceFail(result.reason ?? 'Could not save baseline.', 'baseline');
      openMenuSection('baseline');
      return;
    }
    setDoc(result.doc, null);
    setState({ menuOpen: true, menuFocus: 'baseline', openErrorLog: false });
    speakCoachLine(
      result.doc.session.lastAction ??
        'Baseline saved. Take a photo with both ends and the next house mark in frame.',
      result.doc.session.speakSteps,
    );
    return;
  }
  if (cmd === 'add-house-corner') {
    const panel = target.closest('.step-panel');
    const edgeRaw = (panel?.querySelector('[data-field=edge]') as HTMLInputElement | null)?.value;
    const edge = edgeRaw === '' || edgeRaw == null ? undefined : Number(edgeRaw);
    const offset = Number(
      (panel?.querySelector('[data-field=offset]') as HTMLInputElement | null)?.value || 0,
    );
    if (edge != null && !(edge > 0)) {
      surfaceFail('Edge length must be empty or a positive number in metres.', 'house');
      openMenuSection('house');
      return;
    }
    const next = addHouseCornerWorkflow(state.doc, edge, offset);
    setDoc(next, null);
    setState({ menuOpen: true, menuFocus: 'house', openErrorLog: false });
    speakCoachLine(next.session.lastAction ?? 'Corner added.', next.session.speakSteps);
    return;
  }
  if (cmd === 'close-house') {
    const result = closeHouseWorkflow(state.doc);
    if (result.warn) {
      logError(result.note, { source: 'close-house' });
      setDoc(result.doc, result.note);
    } else {
      setDoc(result.doc, null);
    }
    setState({
      menuOpen: true,
      menuFocus: menuFocusAfterMode(result.doc.session.mode),
      openErrorLog: false,
    });
    speakCoachLine(result.note, result.doc.session.speakSteps);
    return;
  }
  if (cmd === 'record-tie') {
    if (!baselineReady(state.doc)) {
      surfaceFail(
        'Cannot record a baseline tie — establish the baseline length first.',
        'tie',
      );
      openMenuSection('baseline');
      return;
    }
    const next = applyCannedBaselineTie(state.doc);
    setDoc(next, null);
    setState({ menuOpen: true, menuFocus: 'recommend', openErrorLog: false });
    speakCoachLine(
      'I see both baseline ends and a target mark. Good tie.',
      next.session.speakSteps,
    );
    return;
  }
  if (cmd === 'confirm-ab') {
    setDoc(confirmAbTogether(state.doc), null);
    setState({ menuOpen: true, menuFocus: 'leapfrog', openErrorLog: false });
    return;
  }
  if (cmd === 'ms-signin') {
    void onSignIn();
    return;
  }
  if (cmd === 'photo-sign-in-upload') {
    void onPhotoSignInToUpload();
    return;
  }
  if (cmd === 'photo-upload-retry') {
    const photoId = target.getAttribute('data-photo-id') ?? undefined;
    void retryPhotoUpload(photoId);
    return;
  }
  if (cmd === 'ms-signout') {
    void onSignOut();
    return;
  }
  if (cmd === 'onedrive-save') {
    const panel = target.closest('.cloud-status');
    const ver = panel?.querySelector('[data-cmd=garden-version]') as HTMLInputElement | null;
    if (ver) {
      setGardenCloudVersion(ver.value);
      notifyCloudPrefsChanged();
    }
    void onOneDriveSave();
    return;
  }
  if (cmd === 'onedrive-load') {
    const panel = target.closest('.cloud-status');
    const pick = panel?.querySelector('[data-field=onedrive-file]') as HTMLSelectElement | null;
    const chosen = pick?.value?.trim();
    void onOneDriveLoad(chosen || undefined);
    return;
  }
  if (cmd === 'clear-local-cache') {
    clearCachedGarden();
    setCloudMessage(
      'Cleared browser garden cache (photo thumbs were not stored locally). In-memory work kept — Save to OneDrive or Export to keep it.',
    );
    if (state.refuseMessage && /browser|quota|storage/i.test(state.refuseMessage)) {
      setState({ refuseMessage: null });
    } else {
      for (const fn of [...listeners]) fn();
    }
    return;
  }
}

function notePhotoSignIn(needed: boolean): void {
  if (photoUploadNeedsSignIn === needed) {
    if (needed) setCloudMessage('Sign in to upload.');
    return;
  }
  photoUploadNeedsSignIn = needed;
  if (needed) setCloudMessage('Sign in to upload.');
  else setCloudMessage(getCloudStatus().message);
}

async function onPhotoSignInToUpload(): Promise<void> {
  setCloudMessage('Opening Microsoft sign-in to upload photos…');
  if (!isSignedIn()) {
    const result = await signIn();
    if (!result.ok) {
      photoUploadNeedsSignIn = true;
      setCloudMessage(result.error ?? 'Sign in to upload.');
    }
    return;
  }
  const auth = await acquireGraphToken();
  if (auth.ok) {
    photoUploadNeedsSignIn = false;
    setCloudMessage('Signed in. Uploading photos…');
    void resumePhotoUploads();
    return;
  }
  photoUploadNeedsSignIn = true;
  setCloudMessage('Sign in to upload.');
}

async function onSignIn(): Promise<void> {
  setCloudBusy(true);
  setCloudMessage('Opening Microsoft sign-in (redirect)…');
  const result = await signIn();
  // loginRedirect navigates away on success; only clear busy on failure.
  if (!result.ok) {
    setCloudBusy(false);
    const msg = result.error ?? 'Sign-in failed.';
    logError(msg, { source: 'msal' });
    setCloudMessage(msg);
  }
}

async function onSignOut(): Promise<void> {
  setCloudBusy(true);
  setCloudMessage('Signing out…');
  const result = await signOut();
  setCloudBusy(false);
  if (!result.ok) {
    const msg = result.error ?? 'Sign-out failed.';
    logError(msg, { source: 'msal' });
    setCloudMessage(msg);
  }
}

async function onOneDriveSave(): Promise<void> {
  const fileName = getGardenCloudFileName();
  setCloudBusy(true);
  setCloudMessage(`Saving ${fileName} to OneDrive…`);
  const result = await saveGardenCloud(state.doc, fileName);
  setCloudBusy(false);
  if (result.ok) {
    setLastSaveIso(result.savedAt);
    setCloudMessage(`Saved ${result.fileName} to OneDrive (${getCloudStatus().pathHint}).`);
    void refreshGardenFileList();
  } else {
    logError(result.error, { source: 'onedrive' });
    setCloudMessage(result.error);
  }
}

async function onOneDriveLoad(fileName?: string): Promise<void> {
  const target = fileName || getGardenCloudFileName();
  setCloudBusy(true);
  setCloudMessage(`Loading ${target} from OneDrive…`);
  const result = await loadGardenCloud(target);
  setCloudBusy(false);
  void refreshGardenFileList();
  if (!result.ok) {
    logError(result.error, { source: 'onedrive' });
    setCloudMessage(result.error);
    return;
  }
  setGardenCloudFileName(result.fileName);
  notifyCloudPrefsChanged();
  setDoc(result.doc, null);
  const via =
    result.fallbackFrom && result.fallbackFrom !== result.fileName
      ? result.usedLegacy
        ? ` (fallback legacy; ${result.fallbackFrom} missing)`
        : ` (fallback; ${result.fallbackFrom} missing)`
      : '';
  setCloudMessage(`Loaded ${result.fileName}${via} from OneDrive. Browser cache updated.`);
}

function onShellChange(e: Event): void {
  const t = e.target as HTMLInputElement | HTMLSelectElement | null;
  if (!t) return;
  const cmd = t.getAttribute('data-cmd');
  if (cmd === 'speak-toggle') {
    setDoc({
      ...state.doc,
      session: { ...state.doc.session, speakSteps: (t as HTMLInputElement).checked },
    });
    return;
  }
  if (cmd === 'select-chrome-mode') {
    selectChromeMode(t.value);
    return;
  }
  if (cmd === 'sticky-baseline') {
    setDoc(setStickyPanel(state.doc, { currentBaselineId: t.value || undefined }), null);
    return;
  }
  if (cmd === 'sticky-layer') {
    setDoc(setStickyPanel(state.doc, { stickyLayerId: t.value }), null);
    return;
  }
  if (cmd === 'sticky-object') {
    if (t.value === '__new__') {
      setDoc(setStickyPanel(state.doc, { stickyObjectId: null }), null);
      return;
    }
    const obj = state.doc.objects?.find((o) => o.id === t.value);
    setDoc(
      setStickyPanel(state.doc, {
        stickyObjectId: t.value,
        stickyObjectName: obj?.name,
        stickyGeometryType: obj?.geometryType,
        stickyLayerId: obj?.layerId,
      }),
      null,
    );
    return;
  }
  if (cmd === 'sticky-object-name') {
    setDoc(setStickyPanel(state.doc, { stickyObjectName: t.value }), null);
    return;
  }
  if (cmd === 'sticky-geometry') {
    setDoc(setStickyPanel(state.doc, { stickyGeometryType: t.value as GeometryType }), null);
    return;
  }
  if (cmd === 'baseline-trust') {
    const id = t.getAttribute('data-baseline-id');
    if (!id) return;
    setDoc(setBaselineTrust(state.doc, id, Number(t.value)), null);
    return;
  }
  if (cmd === 'garden-version') {
    setGardenCloudVersion((t as HTMLInputElement).value);
    notifyCloudPrefsChanged();
    return;
  }
  if (cmd === 'onedrive-pick-file') {
    const name = (t as HTMLSelectElement).value?.trim();
    if (!name) return;
    setGardenCloudFileName(name);
    notifyCloudPrefsChanged();
    return;
  }
}

function buildApp(): HTMLElement {
  const app = el('div', { className: 'app app--plan-first' });
  if (state.view === 'tags') {
    app.appendChild(buildTagsView());
    return app;
  }
  app.appendChild(buildSurveyView());
  return app;
}

function buildSurveyView(): HTMLElement {
  const doc = state.doc;
  const coach = buildCoach(doc);
  const legal = new Set(legalActions(doc));

  const wrap = el('div', { className: 'survey-layout survey-layout--plan-first' });

  const plan = el('section', {
    className: 'plan plan--backdrop',
    attrs: {
      'aria-label': 'Garden plan',
      'data-testid': 'plan-canvas',
    },
  });
  // Transform target is the viewport only — hamburger / dialogs stay position:fixed siblings.
  const viewport = el('div', {
    className: 'plan__viewport',
    attrs: { 'data-testid': 'plan-viewport' },
  });
  applyPlanTransform(viewport);
  const planHost = el('div', {
    className: 'plan__svg plan__svg--full',
    attrs: { 'data-testid': 'plan-svg' },
  });
  planHost.innerHTML = renderPlanSvg(doc, 960, 720);
  viewport.appendChild(planHost);
  plan.appendChild(viewport);
  wrap.appendChild(plan);
  attachPlanGestures(plan, viewport);

  // Plan chrome: bottom-right hamburger only (+ translucent point dialogue when open).
  wrap.appendChild(buildHamburgerButton());

  // Refuse banner stays under the floating + Point dialog (never covers Close / A±).
  // Persist/quota must not use refuseMessage — see handleLocalPersistFailure.
  if (state.refuseMessage && !state.pointDialog) {
    wrap.appendChild(
      el('div', {
        className: 'refuse refuse--overlay',
        attrs: { role: 'alert' },
        text: state.refuseMessage,
      }),
    );
  }

  if (state.pointDialog) {
    const dialog = buildPointDialog(doc, state.pointDialog);
    wrap.appendChild(dialog);
    attachPointDialogDrag(dialog);
  }

  if (state.menuOpen) {
    wrap.appendChild(buildMenuDrawer(doc, coach, legal));
  }

  if (state.markPhotoId && markDraft) {
    wrap.appendChild(buildPhotoMarkOverlay(doc));
  }

  return wrap;
}

/** Full-screen photo mark UI — suggest white tags, confirm baseline A/B → camera station. */
function buildPhotoMarkOverlay(doc: GardenDocument): HTMLElement {
  const draft = markDraft!;
  const photo = doc.photos.find((p) => p.id === draft.photoId);
  const bl = preferredBaseline(doc);
  const overlay = el('div', {
    className: 'photo-mark',
    attrs: {
      role: 'dialog',
      'aria-label': 'Mark baseline on photo',
      'data-testid': 'photo-mark',
    },
  });

  const head = el('div', { className: 'photo-mark__head' });
  head.appendChild(
    el('p', {
      className: 'photo-mark__title',
      text: bl ? `Mark ${bl.a}–${bl.b}` : 'Mark photo',
    }),
  );
  head.appendChild(
    el('p', {
      className: 'photo-mark__hint',
      text: draft.busy ? 'Looking for white tags…' : draft.hint,
      attrs: { 'data-testid': 'photo-mark-hint' },
    }),
  );
  overlay.appendChild(head);

  const stage = el('div', { className: 'photo-mark__stage' });
  const frame = el('div', {
    className: 'photo-mark__frame',
    attrs: {
      'data-cmd': 'photo-mark-canvas',
      'data-mark-canvas': '1',
    },
  });
  if (photo?.thumbnailDataUrl) {
    const img = document.createElement('img');
    img.className = 'photo-mark__img';
    img.src = photo.thumbnailDataUrl;
    img.alt = 'Survey photo';
    img.draggable = false;
    frame.appendChild(img);
  }

  const layer = el('div', { className: 'photo-mark__layer' });
  const pw = Math.max(1, photo?.width ?? 1);
  const ph = Math.max(1, photo?.height ?? 1);

  for (const s of draft.suggestions) {
    const btn = el('button', {
      className: 'photo-mark__suggest',
      attrs: {
        type: 'button',
        'data-cmd': 'photo-mark-accept-suggest',
        'data-px': String(s.px),
        'data-py': String(s.py),
        'aria-label': 'Accept tag suggestion',
        style: `left:${(s.px / pw) * 100}%;top:${(s.py / ph) * 100}%;width:${Math.max(6, (s.w / pw) * 100)}%;height:${Math.max(6, (s.h / ph) * 100)}%`,
      },
    });
    layer.appendChild(btn);
  }

  for (const c of draft.clicks) {
    const mark = el('div', {
      className: `photo-mark__pin photo-mark__pin--${c.pointId.toLowerCase()}`,
      text: c.pointId === 'TARGET' ? 'T' : c.pointId,
      attrs: {
        style: `left:${(c.px / pw) * 100}%;top:${(c.py / ph) * 100}%`,
      },
    });
    layer.appendChild(mark);
  }
  frame.appendChild(layer);
  stage.appendChild(frame);
  overlay.appendChild(stage);

  const roles = el('div', { className: 'photo-mark__roles' });
  for (const role of ['A', 'B', 'TARGET'] as MarkRole[]) {
    const label = role === 'TARGET' ? 'Target' : role;
    roles.appendChild(
      el('button', {
        className:
          'btn btn--util photo-mark__role' +
          (draft.assignRole === role ? ' photo-mark__role--active' : ''),
        text: label,
        attrs: {
          type: 'button',
          'data-cmd': 'photo-mark-role',
          'data-role': role,
          title:
            role === 'TARGET'
              ? 'Optional — needs second sighting or distance'
              : `Assign next tap as baseline end ${role}`,
        },
      }),
    );
  }
  overlay.appendChild(roles);

  const actions = el('div', { className: 'photo-mark__actions' });
  actions.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Suggest',
      attrs: {
        type: 'button',
        'data-cmd': 'photo-mark-suggest',
        disabled: draft.busy ? 'true' : undefined,
      },
    }),
  );
  actions.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Clear',
      attrs: { type: 'button', 'data-cmd': 'photo-mark-clear' },
    }),
  );
  actions.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Cancel',
      attrs: { type: 'button', 'data-cmd': 'close-photo-mark' },
    }),
  );
  actions.appendChild(
    el('button', {
      className: 'btn btn--suggested',
      text: 'Confirm',
      attrs: {
        type: 'button',
        'data-cmd': 'photo-mark-confirm',
        'data-testid': 'photo-mark-confirm',
      },
    }),
  );
  overlay.appendChild(actions);

  const uploadWord = photoUploadWord(photo);
  const usability = photo?.originalFile?.usabilityNote;
  overlay.appendChild(
    el('p', {
      className: 'photo-mark__foot',
      text: uploadWord
        ? `Point = camera station when A+B confirmed. Upload ${uploadWord}.${usability ? ` ${usability}` : ''}`
        : `Point = camera station when A+B confirmed. A separate object mark needs another sighting or a tape distance.${usability ? ` ${usability}` : ''}`,
      attrs: usability ? { 'data-testid': 'photo-usability' } : undefined,
    }),
  );

  return overlay;
}

function applyPlanTransform(viewport: HTMLElement): void {
  viewport.style.transform = `translate(${planView.x}px, ${planView.y}px) scale(${planView.scale})`;
}

/** Pinch / wheel zoom + one-finger pan on the plan canvas only. */
function attachPlanGestures(surface: HTMLElement, viewport: HTMLElement): void {
  let pointers = new Map<number, { x: number; y: number }>();
  let panOrigin: { x: number; y: number; viewX: number; viewY: number } | null = null;
  let pinchOrigin:
    | { dist: number; scale: number; midX: number; midY: number; viewX: number; viewY: number }
    | null = null;
  let moved = false;

  const pointOf = (ev: PointerEvent) => ({ x: ev.clientX, y: ev.clientY });

  const onPointerDown = (ev: PointerEvent) => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    // Leave dialog / menu / hamburger alone — they are not under this surface.
    pointers.set(ev.pointerId, pointOf(ev));
    surface.setPointerCapture(ev.pointerId);
    moved = false;
    if (pointers.size === 1) {
      const p = pointers.values().next().value!;
      panOrigin = { x: p.x, y: p.y, viewX: planView.x, viewY: planView.y };
      pinchOrigin = null;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      pinchOrigin = {
        dist,
        scale: planView.scale,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        viewX: planView.x,
        viewY: planView.y,
      };
      panOrigin = null;
    }
  };

  const onPointerMove = (ev: PointerEvent) => {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, pointOf(ev));
    if (pointers.size === 2 && pinchOrigin) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const nextScale = clampPlanScale(pinchOrigin.scale * (dist / pinchOrigin.dist));
      // Keep the pinch midpoint stable in screen space.
      const ratio = nextScale / pinchOrigin.scale;
      planView = {
        scale: nextScale,
        x: midX - (pinchOrigin.midX - pinchOrigin.viewX) * ratio,
        y: midY - (pinchOrigin.midY - pinchOrigin.viewY) * ratio,
      };
      applyPlanTransform(viewport);
      moved = true;
      ev.preventDefault();
      return;
    }
    if (pointers.size === 1 && panOrigin) {
      const p = pointers.values().next().value!;
      const dx = p.x - panOrigin.x;
      const dy = p.y - panOrigin.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      if (moved) {
        planView = { ...planView, x: panOrigin.viewX + dx, y: panOrigin.viewY + dy };
        applyPlanTransform(viewport);
        ev.preventDefault();
      }
    }
  };

  const onPointerUp = (ev: PointerEvent) => {
    pointers.delete(ev.pointerId);
    try {
      surface.releasePointerCapture(ev.pointerId);
    } catch {
      /* already released */
    }
    if (pointers.size === 0) {
      panOrigin = null;
      pinchOrigin = null;
    } else if (pointers.size === 1) {
      const p = pointers.values().next().value!;
      panOrigin = { x: p.x, y: p.y, viewX: planView.x, viewY: planView.y };
      pinchOrigin = null;
    }
  };

  const onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const rect = surface.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const factor = ev.deltaY < 0 ? 1.08 : 1 / 1.08;
    const nextScale = clampPlanScale(planView.scale * factor);
    const ratio = nextScale / planView.scale;
    planView = {
      scale: nextScale,
      x: mx - (mx - planView.x) * ratio,
      y: my - (my - planView.y) * ratio,
    };
    applyPlanTransform(viewport);
  };

  surface.addEventListener('pointerdown', onPointerDown);
  surface.addEventListener('pointermove', onPointerMove);
  surface.addEventListener('pointerup', onPointerUp);
  surface.addEventListener('pointercancel', onPointerUp);
  surface.addEventListener('wheel', onWheel, { passive: false });

  // Double-click resets pan/zoom (dialogs/hamburger are outside this surface).
  surface.addEventListener('dblclick', (ev) => {
    planView = { scale: 1, x: 0, y: 0 };
    applyPlanTransform(viewport);
    ev.preventDefault();
  });

  // Suppress click-through after a pan/pinch so inspect-point doesn't fire accidentally.
  surface.addEventListener(
    'click',
    (ev) => {
      if (moved) {
        ev.stopPropagation();
        ev.preventDefault();
        moved = false;
      }
    },
    true,
  );
}

function clampPlanScale(s: number): number {
  return Math.min(PLAN_SCALE_MAX, Math.max(PLAN_SCALE_MIN, s));
}

/** Floating hamburger — red while unseen errors remain. */
function buildHamburgerButton(): HTMLElement {
  const unseen = hasUnseenErrors();
  const count = unseenErrorCount();
  const btn = el('button', {
    className: 'hamburger' + (unseen ? ' hamburger--alert' : ''),
    attrs: {
      type: 'button',
      'data-cmd': unseen && !state.menuOpen ? 'open-error-log' : 'toggle-menu',
      'data-testid': 'hamburger',
      'aria-label': unseen
        ? `Menu — ${count} unseen error${count === 1 ? '' : 's'}`
        : state.menuOpen
          ? 'Close menu'
          : 'Open menu',
      'aria-expanded': state.menuOpen ? 'true' : 'false',
    },
  });
  btn.appendChild(el('span', { className: 'hamburger__bars', attrs: { 'aria-hidden': 'true' } }));
  if (unseen) {
    btn.appendChild(
      el('span', {
        className: 'hamburger__badge',
        text: count > 9 ? '9+' : String(count),
        attrs: { 'aria-hidden': 'true' },
      }),
    );
  }
  return btn;
}

/** Tiny recommend body used inside the hamburger accordion. */
function buildRecommendBody(
  doc: GardenDocument,
  coach: ReturnType<typeof buildCoach>,
  legal: Set<ModeAction>,
): HTMLElement {
  const body = el('div', { className: 'menu-acc__body', attrs: { 'data-testid': 'recommend-next' } });
  body.appendChild(
    el('p', {
      className: 'menu-acc__coach',
      text: coach.body[0] ?? 'Open a workflow below.',
    }),
  );
  if (coach.residualLine) {
    body.appendChild(el('p', { className: 'menu-acc__meta', text: coach.residualLine }));
  }
  const actions = el('div', { className: 'menu-drawer__row' });
  if (doc.session.mode === 'START' || legal.has('establish_baseline')) {
    actions.appendChild(
      el('button', {
        className: 'btn btn--stage2',
        text: 'Establish baseline',
        attrs: {
          type: 'button',
          'data-cmd': 'open-menu-section',
          'data-section': 'baseline',
        },
      }),
    );
  }
  if (legal.has('add_point') || doc.session.mode === 'ADD_POINT') {
    actions.appendChild(
      el('button', {
        className: 'btn btn--suggested',
        text: '+ Point',
        attrs: {
          type: 'button',
          'data-cmd': 'open-point-dialog',
          'data-testid': 'recommend-add-point',
        },
      }),
    );
  }
  if (coach.nextAction && legal.has(coach.nextAction) && coach.nextAction !== 'add_point' && coach.nextAction !== 'establish_baseline') {
    actions.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: coach.nextButton ?? actionLabel(coach.nextAction),
        attrs: {
          type: 'button',
          'data-cmd': 'mode',
          'data-action': coach.nextAction,
        },
      }),
    );
  }
  body.appendChild(actions);
  return body;
}

function buildBaselineForm(doc: GardenDocument): HTMLElement {
  const panel = el('div', {
    className: 'menu-acc__body step-panel',
    attrs: { 'data-testid': 'baseline-form' },
  });
  const ranked = baselinesByTrust(doc);
  const active = preferredBaseline(doc) ?? currentBaseline(doc);
  const ptA = active ? doc.points.find((p) => p.id === active.a) : undefined;
  const ptB = active ? doc.points.find((p) => p.id === active.b) : undefined;

  panel.appendChild(
    el('p', {
      text: active
        ? `Editing ${active.a}–${active.b}${active.label ? ` (${active.label})` : ''}. Save updates this baseline only.`
        : 'Default: one house edge. Enter length (m) and optional mark offsets (mm).',
    }),
  );

  const form = el('div', { className: 'step-form' });

  if (ranked.length > 1) {
    const pickWrap = el('label', { className: 'field' });
    pickWrap.appendChild(el('span', { text: 'Baseline' }));
    const pick = el('select', {
      attrs: {
        'data-field': 'baseline-id',
        'data-cmd': 'sticky-baseline',
        'aria-label': 'Select baseline',
        'data-testid': 'baseline-picker',
      },
    }) as HTMLSelectElement;
    for (const b of ranked) {
      const opt = document.createElement('option');
      opt.value = b.id;
      const used = b.usedForMeasurementCount ?? 0;
      opt.textContent = `${b.a}–${b.b} · ${b.lengthM.toFixed(3)} m · T${b.trust ?? 50}${used ? ` · used ×${used}` : ''}`;
      if (b.id === active?.id) opt.selected = true;
      pick.appendChild(opt);
    }
    pickWrap.appendChild(pick);
    form.appendChild(pickWrap);
  } else if (active) {
    form.appendChild(
      el('input', {
        attrs: { type: 'hidden', 'data-field': 'baseline-id', value: active.id },
      }),
    );
  }

  form.appendChild(
    textField('End A', 'end-a', active?.a ?? 'HSE01', {
      readonly: Boolean(active),
      hint: ptA?.label,
    }),
  );
  form.appendChild(
    textField('End B', 'end-b', active?.b ?? 'HSE02', {
      readonly: Boolean(active),
      hint: ptB?.label,
    }),
  );
  form.appendChild(
    numField('Length (m)', 'length', active ? String(active.lengthM) : '7'),
  );
  form.appendChild(
    numField('Offset A (mm)', 'offset-a', String(ptA?.offsetMm ?? 0)),
  );
  form.appendChild(
    numField('Offset B (mm)', 'offset-b', String(ptB?.offsetMm ?? 0)),
  );

  const kindWrap = el('label', { className: 'field' });
  kindWrap.appendChild(el('span', { text: 'Measure with' }));
  const kindSel = el('select', {
    attrs: { 'data-field': 'kind', 'aria-label': 'Tape or laser' },
  }) as HTMLSelectElement;
  for (const k of [
    { id: 'tape', label: 'Tape' },
    { id: 'laser', label: 'Laser' },
  ] as const) {
    const opt = document.createElement('option');
    opt.value = k.id;
    opt.textContent = k.label;
    if ((active?.kind ?? 'tape') === k.id) opt.selected = true;
    kindSel.appendChild(opt);
  }
  kindWrap.appendChild(kindSel);
  form.appendChild(kindWrap);

  const trustVal = String(active?.trust ?? 60);
  const trustWrap = el('label', { className: 'field field--trust' });
  trustWrap.appendChild(el('span', { text: `Trust ${trustVal}` }));
  trustWrap.appendChild(
    el('input', {
      attrs: {
        type: 'range',
        min: '0',
        max: '100',
        value: trustVal,
        'data-field': 'trust',
        'aria-label': 'Baseline trust',
      },
    }),
  );
  form.appendChild(trustWrap);

  panel.appendChild(form);
  panel.appendChild(
    el('button', {
      className: 'btn btn--util btn--stage2',
      text: active ? 'Save baseline' : 'Save baseline',
      attrs: { type: 'button', 'data-cmd': 'save-baseline' },
    }),
  );
  return panel;
}

function textField(
  label: string,
  field: string,
  value: string,
  opts: { readonly?: boolean; hint?: string } = {},
): HTMLElement {
  const wrap = el('label', { className: 'field' });
  wrap.appendChild(el('span', { text: opts.hint ? `${label} · ${opts.hint}` : label }));
  wrap.appendChild(
    el('input', {
      attrs: {
        type: 'text',
        'data-field': field,
        value,
        readonly: opts.readonly ? 'true' : undefined,
      },
    }),
  );
  return wrap;
}

function buildTieForm(doc: GardenDocument): HTMLElement {
  const panel = el('div', { className: 'menu-acc__body step-panel' });
  panel.appendChild(
    el('p', {
      text: baselineTieReady(doc)
        ? 'Both baseline ends + target mark present. Add point or measure more house edges.'
        : 'v1: one frame with both baseline ends and the house mark. Indoors, use demo clicks.',
    }),
  );
  if (!baselineTieReady(doc)) {
    panel.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Record baseline tie (demo clicks)',
        attrs: { type: 'button', 'data-cmd': 'record-tie' },
      }),
    );
  }
  return panel;
}

function buildHouseForm(doc: GardenDocument): HTMLElement {
  const panel = el('div', { className: 'menu-acc__body step-panel' });
  const n = houseCornerCount(doc);
  const closed = housePolygon(doc)?.closed;
  panel.appendChild(
    el('p', {
      text: closed
        ? `House closed with ${n} corners.`
        : `${n} corner(s) so far. Add next edge length (optional) + offset mm.`,
    }),
  );
  if (!closed) {
    const form = el('div', { className: 'step-form' });
    form.appendChild(numField('Next edge (m, optional)', 'edge', ''));
    form.appendChild(numField('Offset (mm)', 'offset', '0'));
    panel.appendChild(form);
    panel.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Add house corner',
        attrs: { type: 'button', 'data-cmd': 'add-house-corner' },
      }),
    );
    if (n >= 3) {
      panel.appendChild(
        el('button', {
          className: 'btn btn--util btn--stage2',
          text: 'Close house',
          attrs: { type: 'button', 'data-cmd': 'close-house' },
        }),
      );
    }
  }
  return panel;
}

function buildLeapfrogForm(doc: GardenDocument): HTMLElement {
  const panel = el('div', { className: 'menu-acc__body step-panel' });
  const setup = currentSetup(doc);
  panel.appendChild(
    el('p', {
      text: setup?.abPhotographedTogether
        ? 'A and B are in a shared photo. Rods moved is now legal.'
        : 'Photograph A and B together before you pick A up.',
    }),
  );
  if (!setup?.abPhotographedTogether) {
    panel.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Confirm A and B photographed together',
        attrs: { type: 'button', 'data-cmd': 'confirm-ab' },
      }),
    );
  }
  return panel;
}

function menuAccordion(
  id: MenuSection,
  title: string,
  body: HTMLElement,
  status?: { tone: 'ok' | 'warn' | 'error' | 'idle'; text?: string; inline?: string },
): HTMLElement {
  const tone = status?.tone ?? 'idle';
  const details = el('details', {
    className: 'menu-acc' + (tone !== 'idle' ? ` menu-acc--${tone}` : ''),
    attrs: {
      'data-section': id ?? undefined,
      'data-testid': id ? `menu-acc-${id}` : undefined,
      'data-status': tone,
    },
  });
  if (state.menuFocus === id) details.setAttribute('open', 'true');
  const summary = el('summary', {
    className: 'menu-acc__summary' + (tone !== 'idle' ? ` menu-acc__summary--${tone}` : ''),
    attrs: {
      'data-cmd': 'menu-accordion',
      'data-section': id ?? undefined,
    },
  });
  if (tone !== 'idle') {
    const iconLabel =
      tone === 'ok' ? 'Ready' : tone === 'warn' ? 'Not ready' : 'Problem';
    summary.appendChild(
      el('span', {
        className: `menu-acc__status-icon menu-acc__status-icon--${tone}`,
        attrs: {
          'aria-hidden': 'true',
          title: status?.text ?? status?.inline ?? iconLabel,
        },
      }),
    );
  } else {
    // Neutral spacer/dot on the left so titles align with status-bearing rows.
    summary.appendChild(
      el('span', {
        className: 'menu-acc__dot menu-acc__dot--idle',
        attrs: { 'aria-hidden': 'true' },
      }),
    );
  }
  summary.appendChild(el('span', { className: 'menu-acc__label', text: title }));
  if (status?.inline) {
    summary.appendChild(
      el('span', {
        className: 'menu-acc__inline',
        text: status.inline,
        attrs: { 'data-testid': id ? `menu-inline-${id}` : undefined },
      }),
    );
  }
  // Optional multi-line subtitle — kept for rare long detail; compact rows use inline.
  if (status?.text) {
    summary.appendChild(
      el('span', {
        className: 'menu-acc__status',
        text: status.text,
        attrs: { 'data-testid': id ? `menu-status-${id}` : undefined },
      }),
    );
  }
  // Prevent native toggle racing with our one-at-a-time state
  summary.addEventListener('click', (ev) => {
    ev.preventDefault();
  });
  details.appendChild(summary);
  details.appendChild(body);
  return details;
}

/** Concertina status for Sign in (see docs/design-philosophy-status-colours.md). */
function cloudSectionStatus(
  doc: GardenDocument,
): { tone: 'ok' | 'warn' | 'error' | 'idle'; inline?: string; text?: string } {
  const cloud = getCloudStatus();
  if (!cloud.configured) {
    return { tone: 'error', inline: 'not configured' };
  }
  if (cloud.message && /could not|error|problem|fail|denied|missing/i.test(cloud.message)) {
    return { tone: 'error', inline: 'error' };
  }
  if (!cloud.signedIn) {
    return { tone: 'warn', inline: 'not signed in' };
  }
  const gardenLoaded =
    doc.baselines.length > 0 ||
    doc.points.some((p) => p.x != null && p.y != null) ||
    Boolean(cloud.lastSaveIso);
  if (gardenLoaded) {
    // Collapsed: Sign in  garden loaded  ●green
    return { tone: 'ok', inline: 'garden loaded' };
  }
  return { tone: 'warn', inline: 'no garden' };
}

function baselineSectionStatus(
  doc: GardenDocument,
): { tone: 'ok' | 'warn' | 'error' | 'idle'; inline?: string } {
  if (baselineReady(doc)) {
    const bl = preferredBaseline(doc) ?? currentBaseline(doc);
    return {
      tone: 'ok',
      // One-line closed header: Baseline  A — B  ●
      inline: bl ? `${bl.a} — ${bl.b}` : undefined,
    };
  }
  return { tone: 'warn', inline: 'not set' };
}

function errorLogSectionStatus(): {
  tone: 'ok' | 'warn' | 'error' | 'idle';
  inline?: string;
} {
  if (hasUnseenErrors()) {
    const n = unseenErrorCount();
    return { tone: 'error', inline: n > 1 ? `${n} new` : 'new' };
  }
  return { tone: 'idle' };
}

/**
 * Display-only preview. Never written as the stored survey photo.
 * The original File/Blob is queued separately and uploaded unchanged.
 * Full width and height come from the decoded bitmap after EXIF orientation,
 * not from PixelX/YDimension (a downscaled Library pick can keep stale values).
 * resizeWidth runs on that upright bitmap, so a portrait frame is not squashed.
 * Clicks are upright edge coordinates: full = previewPx / previewScale.
 * Subtract 0.5 only for a pixel-centre index.
 */
async function fileToPreview(
  file: File,
  maxEdge = 640,
): Promise<{ dataUrl: string; pixels: PreviewPixelMap }> {
  const oriented = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  } as ImageBitmapOptions);
  try {
    const fullWidth = oriented.width;
    const fullHeight = oriented.height;
    if (Math.max(fullWidth, fullHeight) <= maxEdge) {
      return bitmapToPreview(oriented, fullWidth, fullHeight);
    }
    const scale = maxEdge / Math.max(fullWidth, fullHeight);
    const pw = Math.max(1, Math.round(fullWidth * scale));
    const ph = Math.max(1, Math.round(fullHeight * scale));
    try {
      const resized = await createImageBitmap(oriented, {
        resizeWidth: pw,
        resizeHeight: ph,
        resizeQuality: 'medium',
      } as ImageBitmapOptions);
      try {
        return bitmapToPreview(resized, fullWidth, fullHeight);
      } finally {
        resized.close();
      }
    } catch {
      return bitmapToPreview(oriented, fullWidth, fullHeight);
    }
  } finally {
    oriented.close();
  }
}

function bitmapToPreview(
  bitmap: ImageBitmap,
  fullWidth: number,
  fullHeight: number,
): { dataUrl: string; pixels: PreviewPixelMap } {
  const needsScale = Math.max(bitmap.width, bitmap.height) > 640;
  const scale = needsScale ? Math.min(1, 640 / Math.max(bitmap.width, bitmap.height)) : 1;
  const previewWidth = Math.max(1, Math.round(bitmap.width * scale));
  const previewHeight = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = previewWidth;
  canvas.height = previewHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(bitmap, 0, 0, previewWidth, previewHeight);
  const fullW = fullWidth || bitmap.width;
  const fullH = fullHeight || bitmap.height;
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.7),
    pixels: {
      fullWidth: fullW,
      fullHeight: fullH,
      previewWidth,
      previewHeight,
      previewScaleX: previewWidth / fullW,
      previewScaleY: previewHeight / fullH,
      clickMap: 'p/scale',
      clickSpace: 'upright',
    },
  };
}

function hierOps(
  plusCmd: string,
  minusCmd: string,
  opts: {
    plusTitle: string;
    minusTitle: string;
    minusDisabled?: boolean;
    plusDisabled?: boolean;
  },
): HTMLElement {
  const ops = el('div', { className: 'hier-row__ops' });
  const plusAttrs: Record<string, string | undefined> = {
    type: 'button',
    'data-cmd': plusCmd,
    'aria-label': opts.plusTitle,
    title: opts.plusTitle,
  };
  if (opts.plusDisabled) plusAttrs.disabled = 'true';
  ops.appendChild(
    el('button', {
      className: 'btn btn--hier',
      text: '+',
      attrs: plusAttrs,
    }),
  );
  const minusAttrs: Record<string, string | undefined> = {
    type: 'button',
    'data-cmd': minusCmd,
    'aria-label': opts.minusTitle,
    title: opts.minusTitle,
  };
  if (opts.minusDisabled) minusAttrs.disabled = 'true';
  ops.appendChild(
    el('button', {
      className: 'btn btn--hier btn--danger',
      text: '−',
      attrs: minusAttrs,
    }),
  );
  return ops;
}

function photoUploadWord(photo: Photo | undefined): string {
  const status = photo?.originalFile?.uploadStatus;
  if (
    status === 'queued' ||
    status === 'uploading' ||
    status === 'verified' ||
    status === 'failed'
  ) {
    return status;
  }
  return '';
}

/** Unified translucent + Point / inspect dialogue — Garden → Layer → Item → Point. */
function buildPointDialog(doc: GardenDocument, mode: 'add' | 'inspect'): HTMLElement {
  const inspectingId = mode === 'inspect' ? doc.session.inspectingPointId : undefined;
  const pt = inspectingId ? doc.points.find((p) => p.id === inspectingId) : undefined;

  const dialog = el('section', {
    className: 'point-dialog',
    attrs: {
      'data-testid': 'point-dialog',
      role: 'dialog',
      'aria-label': mode === 'inspect' ? 'Point inspector' : '+ Point',
      style: `transform: translate(${pointDialogPos.x}px, ${pointDialogPos.y}px); --point-ui-scale: ${pointUiScale}`,
    },
  });

  const head = el('div', { className: 'point-dialog__head' });
  const drag = el('div', {
    className: 'point-dialog__drag',
    attrs: { 'data-drag-handle': 'true', title: 'Drag to move' },
  });
  drag.appendChild(
    el('h2', {
      className: 'point-dialog__title',
      text: mode === 'inspect' ? (pt ? `Point ${pt.id}` : 'Point') : '+ Point',
      attrs: { 'data-testid': 'point-dialog-title' },
    }),
  );
  drag.appendChild(
    el('span', {
      className: 'point-dialog__grip',
      text: '⠿',
      attrs: { 'aria-hidden': 'true' },
    }),
  );
  head.appendChild(drag);
  const typeScale = el('div', {
    className: 'point-dialog__type-scale',
    attrs: { 'data-testid': 'point-ui-scale' },
  });
  typeScale.appendChild(
    el('button', {
      className: 'btn btn--util point-dialog__type-btn',
      text: 'A−',
      attrs: {
        type: 'button',
        'data-cmd': 'point-ui-smaller',
        'data-testid': 'point-ui-smaller',
        'aria-label': 'Smaller point dialog text',
        title: 'Smaller',
      },
    }),
  );
  typeScale.appendChild(
    el('button', {
      className: 'btn btn--util point-dialog__type-btn',
      text: 'A+',
      attrs: {
        type: 'button',
        'data-cmd': 'point-ui-larger',
        'data-testid': 'point-ui-larger',
        'aria-label': 'Larger point dialog text',
        title: 'Larger',
      },
    }),
  );
  head.appendChild(typeScale);
  head.appendChild(
    el('button', {
      className: 'btn btn--util point-dialog__close',
      text: '✕',
      attrs: {
        type: 'button',
        'data-cmd': 'close-point-dialog',
        'data-testid': 'point-dialog-close',
        'aria-label': 'Close dialogue',
        title: 'Close',
      },
    }),
  );
  dialog.appendChild(head);

  const stack = el('div', {
    className: 'point-dialog__stack',
    attrs: { 'data-testid': 'point-hierarchy' },
  });

  // —— Garden (single-garden context label; no multi-garden UI) ——
  const gardenRow = el('div', { className: 'hier-row hier-row--garden' });
  gardenRow.appendChild(el('span', { className: 'hier-row__label', text: 'Garden' }));
  gardenRow.appendChild(
    el('span', {
      className: 'hier-row__value',
      text: doc.name || 'Untitled garden',
      attrs: { 'data-testid': 'hier-garden-name' },
    }),
  );
  stack.appendChild(gardenRow);

  // —— Layer ——
  const layerRow = el('div', { className: 'hier-row' });
  const layerMain = el('label', { className: 'hier-row__main' });
  layerMain.appendChild(el('span', { className: 'hier-row__label', text: 'Layer' }));
  const layerSel = el('select', {
    attrs: { 'data-field': 'layer', 'data-cmd': 'sticky-layer', 'aria-label': 'Layer' },
  }) as HTMLSelectElement;
  const layers = doc.layers?.length ? doc.layers : [{ id: 'walkway', name: 'Walkway' }];
  const stickyL = stickyLayer(doc).id;
  for (const l of layers) {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;
    if (l.id === stickyL) opt.selected = true;
    layerSel.appendChild(opt);
  }
  layerMain.appendChild(layerSel);
  layerRow.appendChild(layerMain);
  layerRow.appendChild(
    hierOps('create-layer', 'delete-layer', {
      plusTitle: '+ Layer',
      minusTitle: '− Layer',
      minusDisabled: layers.length <= 1,
    }),
  );
  stack.appendChild(layerRow);

  // —— Item (model: object) ——
  const itemRow = el('div', { className: 'hier-row' });
  const itemMain = el('label', { className: 'hier-row__main' });
  itemMain.appendChild(el('span', { className: 'hier-row__label', text: 'Item' }));
  const objSel = el('select', {
    attrs: { 'data-field': 'object', 'data-cmd': 'sticky-object', 'aria-label': 'Item' },
  }) as HTMLSelectElement;
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ Item';
  objSel.appendChild(newOpt);
  for (const o of objectsOnLayer(doc, stickyL)) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.name;
    if (o.id === doc.session.stickyObjectId) opt.selected = true;
    objSel.appendChild(opt);
  }
  if (!doc.session.stickyObjectId) newOpt.selected = true;
  itemMain.appendChild(objSel);
  itemRow.appendChild(itemMain);
  itemRow.appendChild(
    hierOps('create-object', 'delete-item', {
      plusTitle: '+ Item',
      minusTitle: '− Item',
      minusDisabled: !doc.session.stickyObjectId,
    }),
  );
  stack.appendChild(itemRow);

  const nameRow = el('label', { className: 'hier-row hier-row--field' });
  nameRow.appendChild(el('span', { className: 'hier-row__label', text: 'Name' }));
  nameRow.appendChild(
    el('input', {
      attrs: {
        type: 'text',
        'data-field': 'object-name',
        'data-cmd': 'sticky-object-name',
        value: doc.session.stickyObjectName ?? stickyObject(doc)?.name ?? '',
        placeholder: 'Item name…',
        'aria-label': 'Item name',
      },
    }),
  );
  stack.appendChild(nameRow);

  const geoRow = el('label', { className: 'hier-row hier-row--field' });
  geoRow.appendChild(el('span', { className: 'hier-row__label', text: 'Geometry' }));
  const geoSel = el('select', {
    attrs: { 'data-field': 'geometry', 'data-cmd': 'sticky-geometry', 'aria-label': 'Geometry' },
  }) as HTMLSelectElement;
  const geo = stickyGeometry(doc);
  for (const g of GEOMETRY_CHOICES) {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.label;
    if (g.id === geo) opt.selected = true;
    geoSel.appendChild(opt);
  }
  geoRow.appendChild(geoSel);
  stack.appendChild(geoRow);

  // Baseline (measurement control — not a hierarchy level)
  const blRow = el('label', { className: 'hier-row hier-row--field' });
  blRow.appendChild(el('span', { className: 'hier-row__label', text: 'Baseline' }));
  const blSel = el('select', {
    attrs: { 'data-field': 'baseline', 'data-cmd': 'sticky-baseline', 'aria-label': 'Baseline' },
  }) as HTMLSelectElement;
  const ranked = baselinesByTrust(doc);
  if (!ranked.length) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'None — establish first';
    blSel.appendChild(empty);
  }
  for (const b of ranked) {
    const opt = document.createElement('option');
    opt.value = b.id;
    const used = b.usedForMeasurementCount ?? 0;
    opt.textContent = `${b.a}–${b.b} · T${b.trust ?? 50}${used ? ` · ×${used}` : ''}`;
    if (b.id === (doc.session.currentBaselineId ?? ranked[0]?.id)) opt.selected = true;
    blSel.appendChild(opt);
  }
  blRow.appendChild(blSel);
  stack.appendChild(blRow);

  const curBl = ranked.find((b) => b.id === doc.session.currentBaselineId) ?? ranked[0];
  if (curBl) {
    const trustRow = el('label', { className: 'hier-row hier-row--trust' });
    trustRow.appendChild(el('span', { className: 'hier-row__label', text: 'Trust' }));
    trustRow.appendChild(
      el('input', {
        attrs: {
          type: 'range',
          min: '0',
          max: '100',
          value: String(curBl.trust ?? 50),
          'data-cmd': 'baseline-trust',
          'data-baseline-id': curBl.id,
          'aria-label': `Trust ${curBl.a}–${curBl.b}`,
          title: `Trust ${curBl.trust ?? 50}`,
        },
      }),
    );
    stack.appendChild(trustRow);
  }

  // —— Point ——
  const pointRow = el('div', { className: 'hier-row' });
  const pointMain = el('div', { className: 'hier-row__main' });
  pointMain.appendChild(el('span', { className: 'hier-row__label', text: 'Point' }));
  pointMain.appendChild(
    el('span', {
      className: 'hier-row__value',
      text: pt ? pt.id : 'new',
      attrs: { 'data-testid': 'hier-point-id' },
    }),
  );
  pointRow.appendChild(pointMain);
  const pointOps = el('div', { className: 'hier-row__ops' });
  // + always means a **new** point (opens camera).
  pointOps.appendChild(
    el('button', {
      className: 'btn btn--hier btn--suggested',
      text: '+',
      attrs: {
        type: 'button',
        'data-cmd': 'add-photo',
        'data-testid': 'add-photo',
        'aria-label': '+ Point — new point',
        title: '+ Point',
      },
    }),
  );
  if (mode === 'inspect' && pt) {
    pointOps.appendChild(
      el('button', {
        className: 'btn btn--hier btn--danger',
        text: '−',
        attrs: {
          type: 'button',
          'data-cmd': 'delete-point',
          'data-testid': 'delete-point',
          'aria-label': 'Delete point',
          title: '− Point',
        },
      }),
    );
  }
  pointRow.appendChild(pointOps);
  stack.appendChild(pointRow);

  dialog.appendChild(stack);

  // Photos: hierarchy +/− (+ = + Photo, − = delete selected); thumbs + offset list.
  const photosSection = el('div', {
    className: 'point-dialog__photos',
    attrs: { 'data-testid': 'point-photos' },
  });
  const thumbPoint =
    pt ??
    (doc.session.currentAddPointId
      ? doc.points.find((p) => p.id === doc.session.currentAddPointId)
      : undefined);
  const pointPhotos = (thumbPoint?.photoIds ?? [])
    .map((id) => doc.photos.find((p) => p.id === id))
    .filter(Boolean);
  const selectedPhotoId =
    (doc.session.selectedPhotoId &&
    pointPhotos.some((p) => p!.id === doc.session.selectedPhotoId)
      ? doc.session.selectedPhotoId
      : pointPhotos[pointPhotos.length - 1]?.id) ?? undefined;

  const photoRow = el('div', { className: 'hier-row' });
  const photoMain = el('div', { className: 'hier-row__main' });
  photoMain.appendChild(el('span', { className: 'hier-row__label', text: 'Photo' }));
  const selectedPhoto = pointPhotos.find((p) => p?.id === selectedPhotoId);
  const uploadWord = photoUploadWord(selectedPhoto ?? undefined);
  photoMain.appendChild(
    el('span', {
      className: 'hier-row__value',
      text: selectedPhotoId
        ? `${selectedPhotoId}${pointPhotos.length > 1 ? ` · ${pointPhotos.length}` : ''}${uploadWord ? ` · ${uploadWord}` : ''}`
        : 'none',
      attrs: {
        'data-testid': 'hier-photo-id',
        'data-upload-status': uploadWord,
      },
    }),
  );
  photoRow.appendChild(photoMain);
  photoRow.appendChild(
    hierOps('again-photo', 'delete-photo', {
      plusTitle: '+ Photo',
      minusTitle: '− Photo',
      plusDisabled: !thumbPoint,
      minusDisabled: !selectedPhotoId || pointPhotos.length <= 1,
    }),
  );
  photosSection.appendChild(photoRow);
  if (selectedPhoto?.originalFile?.uploadStatus === 'failed' && selectedPhoto.originalFile.uploadError) {
    photosSection.appendChild(
      el('p', {
        className: 'point-dialog__mark-hint',
        text: selectedPhoto.originalFile.uploadError,
        attrs: { 'data-testid': 'photo-upload-status' },
      }),
    );
  } else if (uploadWord) {
    photosSection.appendChild(
      el('p', {
        className: 'point-dialog__mark-hint',
        text: `Upload ${uploadWord}.`,
        attrs: { 'data-testid': 'photo-upload-status' },
      }),
    );
  }
  if (
    selectedPhoto?.originalFile?.uploadStatus === 'failed' &&
    selectedPhoto.id &&
    !selectedPhoto.originalFile.uploadPermanent
  ) {
    photosSection.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Retry',
        attrs: {
          type: 'button',
          'data-cmd': 'photo-upload-retry',
          'data-photo-id': selectedPhoto.id,
          'data-testid': 'photo-upload-retry',
        },
      }),
    );
  }
  if (selectedPhoto?.originalFile?.usabilityNote) {
    photosSection.appendChild(
      el('p', {
        className: 'point-dialog__mark-hint',
        text: selectedPhoto.originalFile.usabilityNote,
        attrs: { 'data-testid': 'photo-usability' },
      }),
    );
  }

  const captureRow = el('div', { className: 'point-dialog__capture' });
  if (mode === 'inspect' || doc.session.stickyObjectId) {
    captureRow.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Save',
        attrs: {
          type: 'button',
          'data-cmd': mode === 'inspect' ? 'apply-inspector' : 'save-object',
          'data-testid': 'point-dialog-save',
          'aria-label': 'Save item changes',
        },
      }),
    );
  }
  captureRow.appendChild(
    el('button', {
      className: 'btn btn--util point-dialog__close-footer',
      text: 'Close',
      attrs: {
        type: 'button',
        'data-cmd': 'close-point-dialog',
        'data-testid': 'point-dialog-close-footer',
        'aria-label': 'Close dialogue',
      },
    }),
  );
  photosSection.appendChild(captureRow);

  if (pointPhotos.length && thumbPoint) {
    const strip = el('ul', { className: 'point-dialog__photo-strip' });
    for (const ph of pointPhotos) {
      if (!ph?.thumbnailDataUrl) continue;
      const selected = ph.id === selectedPhotoId;
      const li = el('li', {
        className:
          'point-dialog__thumb' +
          (ph.yawOnly ? ' point-dialog__thumb--yaw' : '') +
          (selected ? ' point-dialog__thumb--selected' : ''),
      });
      const btn = el('button', {
        className: 'point-dialog__thumb-btn',
        attrs: {
          type: 'button',
          'data-cmd': 'open-photo-mark',
          'data-photo-id': ph.id,
          'aria-label': `Mark tags on ${ph.id}`,
          title: ph.note ?? `Open ${ph.id} to mark baseline`,
        },
      });
      const img = document.createElement('img');
      img.src = ph.thumbnailDataUrl;
      img.alt = ph.id;
      btn.appendChild(img);
      if ((ph.clicks?.length ?? 0) >= 2) {
        li.appendChild(
          el('span', {
            className: 'point-dialog__thumb-badge',
            text: 'A·B',
            attrs: { title: 'Baseline ends marked' },
          }),
        );
      }
      li.appendChild(btn);
      strip.appendChild(li);
    }
    photosSection.appendChild(strip);

    photosSection.appendChild(
      el('p', {
        className: 'point-dialog__mark-hint',
        text: 'Tap a photo to mark tags (A/B) — station = camera.',
      }),
    );

    // Compact per-photo offsets from the combined (average) point — outliers readable.
    if (pointPhotos.length > 1 && thumbPoint.x != null && thumbPoint.y != null) {
      const list = el('ul', {
        className: 'point-dialog__photo-offsets',
        attrs: { 'data-testid': 'photo-offsets' },
      });
      pointPhotos.forEach((ph, i) => {
        if (!ph) return;
        const est = photoEstimateAt(ph, thumbPoint, i);
        const dxMm = (est.x - thumbPoint.x!) * 1000;
        const dyMm = (est.y - thumbPoint.y!) * 1000;
        const e = Math.hypot(dxMm, dyMm);
        const selected = ph.id === selectedPhotoId;
        list.appendChild(
          el('li', {
            className:
              'point-dialog__photo-offset' +
              (selected ? ' point-dialog__photo-offset--selected' : ''),
            text: `${ph.id}${ph.yawOnly ? ' yaw' : ''} · Δ${e.toFixed(0)} mm (E ${dxMm >= 0 ? '+' : ''}${dxMm.toFixed(0)}, N ${dyMm >= 0 ? '+' : ''}${dyMm.toFixed(0)})`,
            attrs: {
              'data-cmd': 'select-photo',
              'data-photo-id': ph.id,
            },
          }),
        );
      });
      photosSection.appendChild(list);
    }
  }

  if (pt) {
    const obj = pt.objectId ? doc.objects?.find((o) => o.id === pt.objectId) : undefined;
    if (obj?.residualMm != null) {
      photosSection.appendChild(
        el('p', {
          className: 'point-dialog__residual',
          text: `~${obj.residualMm.toFixed(0)} mm`,
        }),
      );
    }
  }

  dialog.appendChild(photosSection);
  return dialog;
}

/** Pointer drag on the dialogue header — updates transform live; persists offset. */
function attachPointDialogDrag(dialog: HTMLElement): void {
  const handle = dialog.querySelector('[data-drag-handle]') as HTMLElement | null;
  if (!handle) return;

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  const onMove = (ev: PointerEvent) => {
    if (!dragging) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const x = originX + dx;
    const y = originY + dy;
    dialog.style.transform = `translate(${x}px, ${y}px)`;
  };

  const onUp = (ev: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture(ev.pointerId);
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    pointDialogPos = { x: originX + dx, y: originY + dy };
    dialog.classList.remove('point-dialog--dragging');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };

  handle.addEventListener('pointerdown', (ev) => {
    if ((ev.target as HTMLElement).closest('button')) return;
    dragging = true;
    startX = ev.clientX;
    startY = ev.clientY;
    originX = pointDialogPos.x;
    originY = pointDialogPos.y;
    dialog.classList.add('point-dialog--dragging');
    handle.setPointerCapture(ev.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    ev.preventDefault();
  });
}

/** Full menu drawer — one accordion open at a time; plan stays chrome-free when closed. */
function buildMenuDrawer(
  doc: GardenDocument,
  coach: ReturnType<typeof buildCoach>,
  legal: Set<ModeAction>,
): HTMLElement {
  const root = el('div', {
    className: 'menu-drawer',
    attrs: { 'data-testid': 'menu-drawer', role: 'dialog', 'aria-label': 'Menu' },
  });
  root.appendChild(
    el('button', {
      className: 'menu-drawer__backdrop',
      attrs: { type: 'button', 'data-cmd': 'close-menu', 'aria-label': 'Close menu' },
    }),
  );

  const panel = el('div', { className: 'menu-drawer__panel' });
  const head = el('div', { className: 'menu-drawer__head' });
  head.appendChild(el('h2', { className: 'menu-drawer__title', text: 'Menu' }));
  panel.appendChild(head);

  // Always-visible thumb control — not buried in Recommended next / Tools.
  const quick = el('div', {
    className: 'menu-drawer__quick',
    attrs: { 'data-testid': 'menu-quick-actions' },
  });
  quick.appendChild(
    el('button', {
      className: 'btn btn--suggested btn--thumb',
      text: '+ Point',
      attrs: {
        type: 'button',
        'data-cmd': 'open-point-dialog',
        'data-testid': 'menu-open-add-point',
        'aria-label': 'Open + Point dialogue',
      },
    }),
  );
  panel.appendChild(quick);

  // —— Top: Mode + Version (near top of concertina) ——
  panel.appendChild(menuAccordion('mode', 'Mode', buildModePicker(doc), modeSectionStatus()));

  const versionBody = el('div', {
    className: 'menu-acc__body',
    attrs: { 'data-testid': 'version-panel' },
  });
  versionBody.appendChild(
    el('p', {
      className: 'menu-drawer__stamp',
      text: buildStamp(),
      attrs: { 'data-testid': 'build-stamp' },
    }),
  );
  panel.appendChild(menuAccordion('version', buildMenuTitle(), versionBody));

  // —— Workflows ——
  panel.appendChild(menuAccordion('recommend', 'Recommended next', buildRecommendBody(doc, coach, legal)));

  // + Point is NOT a concertina — quick / Mode / Tools open the on-plan dialogue and dismiss the menu.

  const coachBody = el('div', { className: 'menu-acc__body', attrs: { 'data-testid': 'coach-panel' } });
  for (const line of coach.body) {
    coachBody.appendChild(el('p', { className: 'menu-acc__coach', text: line }));
  }
  if (coach.residualLine) {
    coachBody.appendChild(el('p', { className: 'menu-acc__meta', text: coach.residualLine }));
  }
  if (coach.geometryLine) {
    coachBody.appendChild(el('p', { className: 'menu-acc__meta', text: coach.geometryLine }));
  }
  panel.appendChild(menuAccordion('coach', 'Coach', coachBody));

  panel.appendChild(
    menuAccordion('baseline', 'Baseline', buildBaselineForm(doc), baselineSectionStatus(doc)),
  );
  panel.appendChild(menuAccordion('tie', 'Baseline tie', buildTieForm(doc)));
  panel.appendChild(menuAccordion('house', 'House corners', buildHouseForm(doc)));
  panel.appendChild(menuAccordion('leapfrog', 'Leapfrog', buildLeapfrogForm(doc)));

  // —— Cloud ——
  const cloudBody = el('div', { className: 'menu-acc__body' });
  cloudBody.appendChild(buildCloudPanel());
  panel.appendChild(
    menuAccordion('cloud', 'Sign in', cloudBody, cloudSectionStatus(doc)),
  );

  // —— Tools ——
  const toolsBody = el('div', { className: 'menu-acc__body', attrs: { 'data-testid': 'tools-panel' } });
  toolsBody.appendChild(el('h4', { className: 'menu-acc__sub', text: 'Garden' }));
  const tools = el('div', { className: 'menu-drawer__row' });
  tools.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'New garden',
      attrs: { type: 'button', 'data-cmd': 'new-garden' },
    }),
  );
  tools.appendChild(
    el('button', {
      className: 'btn btn--util btn--stage2',
      text: 'Establish baseline (Stage 2)',
      attrs: { type: 'button', 'data-cmd': 'start-stage2' },
    }),
  );
  tools.appendChild(
    el('button', {
      className: 'btn btn--suggested btn--thumb',
      text: '+ Point',
      attrs: {
        type: 'button',
        'data-cmd': 'open-point-dialog',
        'data-testid': 'tools-open-add-point',
      },
    }),
  );
  toolsBody.appendChild(tools);

  toolsBody.appendChild(el('h4', { className: 'menu-acc__sub', text: 'All mode actions' }));
  const allList = el('div', { className: 'menu-drawer__actions' });
  for (const action of ALL_ACTIONS) {
    const isLegal = legal.has(action);
    allList.appendChild(
      el('button', {
        className:
          'btn btn--util' +
          (isLegal ? '' : ' btn--disabled') +
          (coach.nextAction === action ? ' btn--suggested' : ''),
        text: actionLabel(action),
        attrs: {
          type: 'button',
          'data-cmd': 'mode',
          'data-action': action,
          'aria-disabled': isLegal ? 'false' : 'true',
        },
      }),
    );
  }
  toolsBody.appendChild(allList);

  toolsBody.appendChild(el('h4', { className: 'menu-acc__sub', text: 'Print & checklist' }));
  const printRow = el('div', { className: 'menu-drawer__row' });
  printRow.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Print tags (A4 belts + FNC01–04)',
      attrs: { type: 'button', 'data-cmd': 'print-tags' },
    }),
  );
  printRow.appendChild(
    el('button', {
      className: 'btn btn--util btn--stage2',
      text: state.showStage2Checklist ? 'Hide Stage 2 checklist' : 'Show Stage 2 checklist',
      attrs: { type: 'button', 'data-cmd': 'toggle-stage2-checklist' },
    }),
  );
  toolsBody.appendChild(printRow);
  if (state.showStage2Checklist) {
    toolsBody.appendChild(buildStage2ChecklistPanel());
  }

  toolsBody.appendChild(el('h4', { className: 'menu-acc__sub', text: 'Load demo' }));
  const demos = el('div', { className: 'menu-drawer__row' });
  demos.appendChild(
    el('button', {
      className: 'btn btn--util btn--demo',
      text: 'Load synthetic demo',
      attrs: { type: 'button', 'data-cmd': 'load-synthetic' },
    }),
  );
  demos.appendChild(
    el('button', {
      className: 'btn btn--util btn--demo',
      text: 'Run milestone demo',
      attrs: { type: 'button', 'data-cmd': 'run-milestone' },
    }),
  );
  toolsBody.appendChild(demos);

  toolsBody.appendChild(el('h4', { className: 'menu-acc__sub', text: 'Export / Import' }));
  const io = el('div', { className: 'menu-drawer__row' });
  io.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Export garden.json',
      attrs: { type: 'button', 'data-cmd': 'export' },
    }),
  );
  const fileLabel = el('label', { className: 'btn btn--file', text: 'Import garden.json' });
  const fileInput = el('input', {
    attrs: { type: 'file', accept: 'application/json,.json', hidden: 'true' },
  }) as HTMLInputElement;
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const imported = await importGarden(f);
      setDoc(imported, null);
      setState({ menuOpen: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Import failed.';
      surfaceFail(msg, 'import');
    }
  });
  fileLabel.appendChild(fileInput);
  io.appendChild(fileLabel);
  toolsBody.appendChild(io);

  toolsBody.appendChild(el('h4', { className: 'menu-acc__sub', text: 'Settings' }));
  const speakLabel = el('label', { className: 'toggle' });
  const speak = el('input', {
    attrs: { type: 'checkbox', 'data-cmd': 'speak-toggle' },
  }) as HTMLInputElement;
  speak.checked = doc.session.speakSteps;
  speakLabel.appendChild(speak);
  speakLabel.appendChild(document.createTextNode(' Speak steps'));
  toolsBody.appendChild(speakLabel);
  panel.appendChild(menuAccordion('tools', 'Tools', toolsBody));

  // —— Error log ——
  const errBody = el('div', {
    className: 'menu-acc__body menu-drawer__errors',
    attrs: { 'data-testid': 'error-log', id: 'error-log' },
  });
  const errHead = el('div', { className: 'menu-drawer__row' });
  errHead.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Mark seen',
      attrs: { type: 'button', 'data-cmd': 'mark-errors-seen' },
    }),
  );
  errHead.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Clear',
      attrs: { type: 'button', 'data-cmd': 'clear-error-log' },
    }),
  );
  errBody.appendChild(errHead);
  const entries = getErrorLog();
  if (!entries.length) {
    errBody.appendChild(
      el('p', { className: 'menu-drawer__empty', text: 'No errors captured this session.' }),
    );
  } else {
    const list = el('ul', { className: 'error-log__list' });
    for (const entry of entries) {
      const isError = (entry.severity ?? 'error') === 'error';
      const item = el('li', {
        className:
          'error-log__item' +
          (isError ? ' error-log__item--error' : ' error-log__item--info'),
        attrs: isError
          ? {
              'data-cmd': 'acknowledge-error',
              'data-testid': 'error-log-entry',
              role: 'button',
              tabindex: '0',
              title: 'Tap to clear menu warning',
              'aria-label': 'Acknowledge error and clear menu warning',
            }
          : { 'data-testid': 'error-log-entry-info' },
      });
      const when = new Date(entry.at).toLocaleString();
      item.appendChild(
        el('div', {
          className: 'error-log__meta',
          text: `${when}${entry.source ? ` · ${entry.source}` : ''}`,
        }),
      );
      item.appendChild(el('div', { className: 'error-log__msg', text: entry.message }));
      if (entry.stack) {
        item.appendChild(el('pre', { className: 'error-log__stack', text: entry.stack }));
      }
      list.appendChild(item);
    }
    errBody.appendChild(list);
  }
  const errAcc = menuAccordion(
    'error-log',
    'Error log',
    errBody,
    errorLogSectionStatus(),
  );
  panel.appendChild(errAcc);

  // —— Glossary ——
  const glossaryBody = el('div', {
    className: 'menu-acc__body glossary',
    attrs: { 'data-testid': 'glossary' },
  });
  const glossary: Array<[string, string]> = [
    ['+ Point', 'New measurement — opens the camera; photo places the point.'],
    ['+ Item', 'New named thing on the current layer.'],
    ['+ Layer', 'New grouping plane in this garden.'],
    ['+ Photo', 'Another photo on the **current** point (yaw / same station).'],
    ['− Photo', 'Remove the selected photo (keep ≥1, or delete the point).'],
    ['− Point / Item / Layer', 'Delete that level (confirm when destructive).'],
    ['Baseline', 'Control segment used for measurements.'],
    ['Garden', 'This survey document (single garden for now).'],
    ['Layer', 'Grouping plane for items (e.g. walkway, bed).'],
    ['Item', 'Named thing you measure points on.'],
    ['Geometry', 'Shape hint for the item (square, circle, …).'],
    [
      'Photo',
      'Survey photos: shoot in Camera.app (12 MP, HEIF Max and ProRAW off, location off), then Library at Actual Size. Take photo is aim-only / camera-path (no lens data). The original file is queued for upload. The live view is an aiming preview.',
    ],
    ['Pinch / pan', 'Zooms and pans the garden plan only; dialogs and ☰ stay fixed.'],
    ['Menu', 'Idle mode when no workflow dialog is open.'],
  ];
  const dl = el('dl', { className: 'glossary__list' });
  for (const [term, def] of glossary) {
    dl.appendChild(el('dt', { className: 'glossary__term', text: term }));
    dl.appendChild(el('dd', { className: 'glossary__def', text: def }));
  }
  glossaryBody.appendChild(dl);
  panel.appendChild(menuAccordion('glossary', 'Glossary', glossaryBody));

  // Close is last in document flow (end of concertina list) — not a sticky overlay.
  // Backdrop click already closes; this is the thumb-reachable explicit control.
  const foot = el('div', {
    className: 'menu-drawer__foot',
    attrs: { 'data-testid': 'menu-drawer-foot' },
  });
  foot.appendChild(
    el('button', {
      className: 'btn btn--util menu-drawer__close',
      text: 'Close',
      attrs: {
        type: 'button',
        'data-cmd': 'close-menu',
        'data-testid': 'menu-close',
        'aria-label': 'Close menu',
      },
    }),
  );
  panel.appendChild(foot);

  root.appendChild(panel);

  if (state.openErrorLog || state.menuFocus === 'error-log') {
    queueMicrotask(() => {
      errAcc.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  } else if (state.menuFocus) {
    queueMicrotask(() => {
      const open = panel.querySelector(`details[data-section="${state.menuFocus}"]`);
      open?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  return root;
}

function buildCloudPanel(): HTMLElement {
  const cloud = getCloudStatus();
  const panel = el('section', {
    className: 'cloud-status',
    attrs: { 'aria-live': 'polite', 'data-testid': 'cloud-status' },
  });
  panel.appendChild(el('h2', { className: 'cloud-status__title', text: 'Microsoft / OneDrive' }));

  if (!cloud.configured) {
    panel.appendChild(
      el('p', {
        className: 'cloud-status__line',
        text: 'Sign-in is not configured on this build yet. Local cache and Export/Import still work. See docs/entra-onedrive-setup.md.',
      }),
    );
    return panel;
  }

  if (cloud.signedIn) {
    panel.appendChild(
      el('p', {
        className: 'cloud-status__line cloud-status__line--ok',
        text: `Signed in${cloud.accountLabel ? ` as ${cloud.accountLabel}` : ''}.`,
      }),
    );
  } else {
    panel.appendChild(
      el('p', {
        className: 'cloud-status__line',
        text: 'Not signed in. Sign in to save the garden map to OneDrive across devices.',
      }),
    );
  }

  panel.appendChild(
    el('p', {
      className: 'cloud-status__line cloud-status__meta',
      text: cloud.lastSaveLabel,
    }),
  );

  // Version + filename — always visible so prefs can be set before/after sign-in.
  const verRow = el('div', { className: 'cloud-status__row' });
  verRow.appendChild(
    el('label', {
      className: 'cloud-status__label',
      text: 'Version',
      attrs: { for: 'garden-cloud-version' },
    }),
  );
  const verInput = el('input', {
    className: 'cloud-status__version',
    attrs: {
      id: 'garden-cloud-version',
      type: 'text',
      inputmode: 'decimal',
      autocomplete: 'off',
      spellcheck: 'false',
      maxlength: '24',
      value: getGardenCloudVersion(),
      'data-cmd': 'garden-version',
      'data-testid': 'garden-version',
      'aria-label': 'Garden file version',
      placeholder: '1',
      disabled: cloud.busy ? 'true' : undefined,
    },
  }) as HTMLInputElement;
  verRow.appendChild(verInput);
  panel.appendChild(verRow);

  panel.appendChild(
    el('p', {
      className: 'cloud-status__line cloud-status__meta',
      text: cloud.pathHint,
      attrs: { 'data-testid': 'onedrive-path' },
    }),
  );

  if (cloud.signedIn) {
    if (cloud.gardenFiles === null) {
      void refreshGardenFileList();
    }
    const fileRow = el('div', { className: 'cloud-status__row' });
    fileRow.appendChild(
      el('label', {
        className: 'cloud-status__label',
        text: 'Load',
        attrs: { for: 'onedrive-file-pick' },
      }),
    );
    const sel = el('select', {
      className: 'cloud-status__file',
      attrs: {
        id: 'onedrive-file-pick',
        'data-field': 'onedrive-file',
        'data-cmd': 'onedrive-pick-file',
        'data-testid': 'onedrive-file',
        'aria-label': 'Garden file on OneDrive',
        disabled: cloud.busy ? 'true' : undefined,
      },
    }) as HTMLSelectElement;
    const names = new Set<string>();
    names.add(cloud.fileName);
    for (const f of cloud.gardenFiles ?? []) names.add(f.name);
    const sorted = [...names].sort((a, b) => {
      const ag = /^garden/i.test(a) ? 0 : 1;
      const bg = /^garden/i.test(b) ? 0 : 1;
      if (ag !== bg) return ag - bg;
      return a.localeCompare(b);
    });
    if (!sorted.length) {
      const empty = document.createElement('option');
      empty.value = cloud.fileName;
      empty.textContent = cloud.gardenFiles === null ? 'Listing…' : cloud.fileName;
      empty.selected = true;
      sel.appendChild(empty);
    } else {
      for (const name of sorted) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        if (name === cloud.fileName) opt.selected = true;
        sel.appendChild(opt);
      }
    }
    fileRow.appendChild(sel);
    panel.appendChild(fileRow);
  }

  if (cloud.message) {
    panel.appendChild(
      el('p', {
        className: 'cloud-status__line cloud-status__msg',
        text: cloud.message,
      }),
    );
  }
  if (cloud.busy) {
    panel.appendChild(
      el('p', {
        className: 'cloud-status__line cloud-status__busy',
        text: 'Working…',
      }),
    );
  }

  const row = el('div', { className: 'cloud-status__actions' });
  if (photoUploadNeedsSignIn) {
    row.appendChild(
      el('button', {
        className: 'btn btn--suggested',
        text: 'Sign in',
        attrs: {
          type: 'button',
          'data-cmd': 'photo-sign-in-upload',
          'data-testid': 'photo-sign-in-upload',
          disabled: cloud.busy ? 'true' : undefined,
        },
      }),
    );
  }
  if (!cloud.signedIn) {
    row.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Sign in with Microsoft',
        attrs: {
          type: 'button',
          'data-cmd': 'ms-signin',
          disabled: cloud.busy ? 'true' : undefined,
        },
      }),
    );
  } else {
    row.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Save',
        attrs: {
          type: 'button',
          'data-cmd': 'onedrive-save',
          disabled: cloud.busy ? 'true' : undefined,
          title: `Save ${cloud.fileName}`,
        },
      }),
    );
    row.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Load',
        attrs: {
          type: 'button',
          'data-cmd': 'onedrive-load',
          disabled: cloud.busy ? 'true' : undefined,
          title: `Load selected file`,
        },
      }),
    );
    row.appendChild(
      el('button', {
        className: 'btn btn--util',
        text: 'Sign out',
        attrs: {
          type: 'button',
          'data-cmd': 'ms-signout',
          disabled: cloud.busy ? 'true' : undefined,
        },
      }),
    );
  }
  row.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Clear local cache',
      attrs: {
        type: 'button',
        'data-cmd': 'clear-local-cache',
        title: 'Remove slim garden draft from this browser (not OneDrive)',
      },
    }),
  );
  panel.appendChild(row);
  return panel;
}

function buildStage2ChecklistPanel(): HTMLElement {
  const panel = el('section', {
    className: 'stage2-checklist',
    attrs: { 'data-testid': 'stage2-checklist', 'aria-label': 'Stage 2 field checklist' },
  });
  panel.appendChild(
    el('h2', { className: 'stage2-checklist__title', text: 'Stage 2 field checklist' }),
  );
  panel.appendChild(
    el('p', {
      className: 'stage2-checklist__intro',
      text: 'House → rod A → tie → Add point → (yaw) → leapfrog → rods moved → adjust. Full phone list: docs/stage-2-field-checklist.md',
    }),
  );
  const list = el('ol', { className: 'stage2-checklist__list' });
  for (const step of STAGE2_FIELD_STEPS) {
    const item = el('li', { className: 'stage2-checklist__item' });
    item.appendChild(
      el('strong', { className: 'stage2-checklist__mode', text: step.modeLabel }),
    );
    item.appendChild(document.createTextNode(` — ${step.doThis} `));
    item.appendChild(
      el('span', { className: 'stage2-checklist__btn', text: `(${step.button})` }),
    );
    list.appendChild(item);
  }
  panel.appendChild(list);
  return panel;
}

/** Begin Stage 2 via workflow (toolbox underneath). */
function startStage2FieldLoop(): void {
  const result = startStage2FieldWorkflow(state.doc);
  if (!result.ok) {
    surfaceFail(result.reason ?? 'Could not start Stage 2.', 'stage2');
    setState({
      showStage2Checklist: true,
      menuOpen: true,
      menuFocus: 'tools',
    });
    return;
  }
  setState({
    doc: result.doc,
    view: 'survey',
    refuseMessage: null,
    showStage2Checklist: result.showChecklist,
    menuOpen: true,
    menuFocus: 'baseline',
    openErrorLog: false,
  });
  const coach = buildCoach(result.doc);
  speakCoachLine(coach.body[0] ?? '', result.doc.session.speakSteps);
}

/** Prefer keeping workflow forms open in the drawer after a mode change. */
function menuFocusAfterMode(mode: string): MenuSection {
  switch (mode) {
    case 'BASELINE':
    case 'HOUSE_BASELINE':
      return 'baseline';
    case 'PHOTO_TIE_BASELINE':
    case 'PHOTO_TIE_HOUSE_ROD':
      return 'tie';
    case 'HOUSE_EDGES':
    case 'PLACE_ROD_A':
      return 'house';
    case 'LEAPFROG':
      return 'leapfrog';
    case 'ADD_POINT':
    case 'ADD_POINT_EXTRA_YAW':
      return 'recommend';
    case 'ADJUST':
      return 'coach';
    default:
      return 'recommend';
  }
}

function numField(label: string, field: string, value: string): HTMLElement {
  const wrap = el('label', { className: 'field' });
  wrap.appendChild(el('span', { text: label }));
  const attrs: Record<string, string | undefined> = {
    type: 'number',
    step: '0.001',
    'data-field': field,
  };
  if (value !== '') {
    attrs.min = '0';
    attrs.value = value;
  } else {
    attrs.min = '0';
    attrs.placeholder = 'optional';
  }
  wrap.appendChild(el('input', { attrs }));
  return wrap;
}

function buildTagsView(): HTMLElement {
  const wrap = el('div', { className: 'tags-view' });
  const toolbar = el('div', { className: 'tags-toolbar no-print' });
  toolbar.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: '← Back to survey',
      attrs: { type: 'button', 'data-cmd': 'back-survey' },
    }),
  );
  toolbar.appendChild(
    el('button', {
      className: 'btn btn--util',
      text: 'Print…',
      attrs: { type: 'button', 'data-cmd': 'do-print' },
    }),
  );
  wrap.appendChild(toolbar);
  const host = el('div', { className: 'tags-host' });
  host.innerHTML = renderTagsPrintHtml(state.doc);
  wrap.appendChild(host);
  return wrap;
}

function onModeAction(action: ModeAction): void {
  const doc = state.doc;

  if (action === 'close_house') {
    const probe = canTransition(doc, action);
    if (!probe.ok) {
      surfaceFail(probe.reason ?? 'Illegal transition.', 'mode');
      speakCoachLine(probe.reason ?? '', doc.session.speakSteps);
      return;
    }
    const result = closeHouseWorkflow(doc);
    if (result.warn) {
      logError(result.note, { source: 'close-house' });
      setDoc(result.doc, result.note);
    } else {
      setDoc(result.doc, null);
    }
    speakCoachLine(result.note, result.doc.session.speakSteps);
    setState({
      menuOpen: true,
      menuFocus: menuFocusAfterMode(result.doc.session.mode),
      openErrorLog: false,
    });
    return;
  }

  const probe = canTransition(doc, action);
  if (!probe.ok) {
    const reason = probe.reason ?? 'Illegal transition.';
    surfaceFail(reason, 'mode');
    speakCoachLine(reason, doc.session.speakSteps);
    return;
  }

  if (action === 'adjust') {
    runAdjust(doc);
    setState({
      menuOpen: true,
      menuFocus: 'coach',
      openErrorLog: false,
    });
    return;
  }

  // + Point always dismisses the hamburger, opens the on-plan dialog, and launches camera.
  if (action === 'add_point') {
    startAddPointDialog({ launchCamera: true });
    return;
  }

  // Same-station extra photo — camera attaches to current point (not a new point).
  if (action === 'another_photo_yaw') {
    const pointId =
      state.doc.session.currentAddPointId ?? state.doc.session.inspectingPointId;
    if (!pointId) {
      surfaceFail(
        'No current point yet. + Point first, then + Photo for another shot here.',
        'photo',
      );
      return;
    }
    const probe = canTransition(doc, action);
    if (!probe.ok) {
      surfaceFail(probe.reason ?? 'Illegal transition.', 'mode');
      speakCoachLine(probe.reason ?? '', doc.session.speakSteps);
      return;
    }
    const { doc: next, result } = applyTransition(doc, action);
    if (!result.ok) {
      surfaceFail(result.reason ?? 'Illegal transition.', 'mode');
      return;
    }
    setDoc(
      {
        ...next,
        session: { ...next.session, inspectingPointId: pointId },
      },
      null,
    );
    setState({ pointDialog: 'inspect', menuOpen: false, openErrorLog: false });
    launchAgainPhotoCamera(pointId);
    return;
  }

  const { doc: next, result } = applyTransition(doc, action);
  if (!result.ok) {
    surfaceFail(result.reason ?? 'Illegal transition.', 'mode');
    speakCoachLine(result.reason ?? '', doc.session.speakSteps);
    return;
  }
  setDoc(next, null);
  setState({
    menuOpen: true,
    menuFocus: menuFocusAfterMode(next.session.mode),
    openErrorLog: false,
  });
  const coach = buildCoach(next);
  speakCoachLine(coach.body[0] ?? '', next.session.speakSteps);
}

function runAdjust(doc: GardenDocument): void {
  const result = toolboxRunAdjust(doc);
  if (!result.ok) {
    surfaceFail(result.reason ?? 'Illegal transition.', 'adjust');
    speakCoachLine(result.reason ?? '', doc.session.speakSteps);
    return;
  }
  setDoc(result.doc, null);
  const coach = buildCoach(result.doc);
  const spoken = result.residualNotes.join(' ') || coach.body.join(' ');
  speakCoachLine(spoken, result.doc.session.speakSteps);
}

function loadSynthetic(): void {
  const doc = loadSyntheticWorkflow();
  setDoc(doc, null);
  setState({ menuOpen: false });
  const coach = buildCoach(doc);
  speakCoachLine(coach.body[0] ?? '', doc.session.speakSteps);
}

/** One-click unstick for the milestone demo path. */
function runMilestoneDemo(): void {
  const result = runMilestoneDemoWorkflow();
  if (!result.ok) {
    logError(result.reason ?? 'Milestone demo failed.', { source: 'demo' });
    setState({
      doc: result.doc,
      view: 'survey',
      refuseMessage: result.reason ?? 'Milestone demo failed.',
      menuOpen: false,
    });
    return;
  }
  setState({
    doc: result.doc,
    view: 'survey',
    refuseMessage: null,
    showStage2Checklist: false,
    menuOpen: false,
  });
  const coach = buildCoach(result.doc);
  speakCoachLine(
    result.residualNotes.join(' ') || coach.body.join(' '),
    result.doc.session.speakSteps,
  );
}

function el(
  tag: string,
  opts: {
    className?: string;
    text?: string;
    attrs?: Record<string, string | undefined>;
  } = {},
): HTMLElement {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v !== undefined) node.setAttribute(k, v);
    }
  }
  return node;
}
