/**
 * Name and describe an original camera file without re-encoding it.
 * The Blob passed in is the stored copy.
 *
 * iOS Safari (WebKit WKFileUploadPanel, main 7fc2aaf): Take Photo re-encodes
 * UIImageJPEGRepresentation(image, 0.8) as image.jpg and drops Make, Model,
 * LensModel, FocalLength, DateTimeOriginal, GPS and MakerNote. Library uses
 * PHPicker Compatible mode (converted JPEG) unless PhotoPickerPrefersOriginalImageFormat
 * is set, and that preference defaults to false. Actual Size is the picker's
 * downscale choice (`_setAllowsDownscaling:YES`). WebKit bug 207088 comments
 * 24–25 claim EXIF survives that conversion; that is a user report only.
 * Provenance below is inferred from the file we actually received.
 */

import {
  exifCapturedAtIso,
  readAppleMakerNote,
  readMakerNoteBytes,
  readSurveyExif,
  type AppleMakerNote,
  type SurveyExif,
} from './photoExif';
import { CLICK_MAP, type PhotoProvenance } from './photosManifest';
import { quickXorHash } from './quickXorHash';

export interface PreviewPixelMap {
  /** Upright full-resolution size (EXIF orientation applied). */
  fullWidth: number;
  fullHeight: number;
  previewWidth: number;
  previewHeight: number;
  /** previewWidth / fullWidth. Clicks use this axis on their own. */
  previewScaleX: number;
  /** previewHeight / fullHeight. */
  previewScaleY: number;
  /**
   * Clicks are upright edge coordinates: fraction × preview width, from the
   * pixel edge. fullEdge = previewPx / previewScale. A pixel-centre index is
   * fullEdge − 0.5.
   */
  clickMap: typeof CLICK_MAP;
  /** Clicks are in upright pixels, after EXIF orientation is applied. */
  clickSpace: 'upright';
}

export interface OriginalPhotoDraft {
  photoId: string;
  stationId: string;
  observationId?: string;
  fileName: string;
  /** The same Blob the camera/file input delivered. */
  blob: Blob;
  size: number;
  contentType: string;
  /** Wall clock when the app received the file. */
  receivedAt: string;
  /** EXIF capture time when DateTimeOriginal is present. */
  capturedAt?: string;
  provenance: PhotoProvenance;
  sha256: string;
  calibrationKey: string;
  quickXorHash: string;
  exif: SurveyExif;
  makerNote?: AppleMakerNote;
  pixels?: PreviewPixelMap;
  usabilityNote?: string;
}

export function originalPhotoFileName(
  stationId: string,
  receivedAtIso: string,
  sourceName: string,
  sourceType: string,
): string {
  const station = stationId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'STA';
  const stamp = receivedAtIso.replace(/[-:.]/g, '');
  const ext = extensionFor(sourceName, sourceType);
  return `${station}_${stamp}.${ext}`;
}

/** Next OneDrive name when the preferred name is a different file. Caps at -4. */
export function suffixedPhotoFileName(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  const numbered = /^(.*)-(\d+)$/.exec(stem);
  if (numbered) {
    const n = Number(numbered[2]);
    if (n >= 4) return null;
    if (n >= 2) return `${numbered[1]}-${n + 1}${ext}`;
  }
  return `${stem}-2${ext}`;
}

export function extensionFor(sourceName: string, sourceType: string): string {
  const fromName = /\.([A-Za-z0-9]{2,5})$/.exec(sourceName)?.[1]?.toLowerCase();
  if (fromName) return fromName === 'jpeg' ? 'jpg' : fromName;
  const type = sourceType.toLowerCase();
  if (type === 'image/heic' || type === 'image/heif') return 'heic';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

export function contentTypeFor(sourceType: string, fileName: string): string {
  if (sourceType && sourceType !== 'application/octet-stream') return sourceType;
  const ext = extensionFor(fileName, '');
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/**
 * `camera-path` when the input named the file image.jpg / image.jpeg and EXIF has no Make.
 * That is the WebKit Take Photo re-encode. A file that still has Make is `library`.
 * Anything else is `unknown` — do not guess library.
 */
export function inferPhotoProvenance(sourceName: string, exif: SurveyExif): PhotoProvenance {
  const base = sourceName.split(/[/\\]/).pop() ?? sourceName;
  if (/^image\.jpe?g$/i.test(base) && !exif.Make) return 'camera-path';
  if (exif.Make) return 'library';
  return 'unknown';
}

/** True for a 1× main-camera equivalent (about 24–26 mm). 0.5×, 2×, and Pro 28/35 mm crops are not. */
export function isOneXEquivalent(focalLengthIn35mm: number | undefined): boolean {
  if (focalLengthIn35mm == null || !Number.isFinite(focalLengthIn35mm)) return false;
  return focalLengthIn35mm >= 23 && focalLengthIn35mm <= 27;
}

export function orientationSwapsAxes(orientation: number | undefined): boolean {
  return orientation != null && orientation >= 5 && orientation <= 8;
}

/**
 * Make|Model|LensModel|FocalLength|FocalLengthIn35mmFilm|sensor pixel size.
 * Pixel size is the sensor orientation (EXIF PixelX/Y), not the upright preview.
 */
export function calibrationKeyFor(
  exif: SurveyExif,
  pixels?: { fullWidth?: number; fullHeight?: number },
): string {
  let w = exif.PixelXDimension;
  let h = exif.PixelYDimension;
  if ((w == null || h == null) && pixels?.fullWidth && pixels.fullHeight) {
    if (orientationSwapsAxes(exif.Orientation)) {
      w = pixels.fullHeight;
      h = pixels.fullWidth;
    } else {
      w = pixels.fullWidth;
      h = pixels.fullHeight;
    }
  }
  const size = w && h ? `${Math.round(w)}x${Math.round(h)}` : '';
  const focal = exif.FocalLength != null ? String(exif.FocalLength) : '';
  const film = exif.FocalLengthIn35mmFilm != null ? String(exif.FocalLengthIn35mmFilm) : '';
  return [exif.Make ?? '', exif.Model ?? '', exif.LensModel ?? '', focal, film, size].join('|');
}

const SESSION_SLACK_MS = 2 * 60 * 1000;

/**
 * Missing LensModel or FocalLength → not usable for focal length.
 * Missing DateTimeOriginal, or a capture time outside the station setup window, → not usable for timing.
 */
export function photoUsabilityNote(opts: {
  exif: SurveyExif;
  capturedAt?: string;
  sessionStartedAt?: string;
  sessionEndedAt?: string;
  now?: string;
}): string | undefined {
  const parts: string[] = [];
  const lensMissing = !opts.exif.LensModel || opts.exif.FocalLength == null;
  const oneX = isOneXEquivalent(opts.exif.FocalLengthIn35mmFilm);
  if (lensMissing || !oneX) {
    parts.push(
      !lensMissing && opts.exif.FocalLengthIn35mmFilm != null
        ? 'Not usable for focal length (not 1×).'
        : 'Not usable for focal length.',
    );
  }
  if (captureOutsideSession(opts.capturedAt, opts.sessionStartedAt, opts.sessionEndedAt, opts.now)) {
    parts.push('Not usable for timing.');
  }
  return parts.length ? parts.join(' ') : undefined;
}

function captureOutsideSession(
  capturedAt: string | undefined,
  startedAt?: string,
  endedAt?: string,
  now?: string,
): boolean {
  if (!capturedAt) return true;
  const t = Date.parse(capturedAt);
  if (!Number.isFinite(t)) return true;
  if (startedAt) {
    const start = Date.parse(startedAt);
    if (Number.isFinite(start) && t < start - SESSION_SLACK_MS) return true;
  }
  const endIso = endedAt || now;
  if (endIso) {
    const end = Date.parse(endIso);
    if (Number.isFinite(end) && t > end + SESSION_SLACK_MS) return true;
  }
  return false;
}

/**
 * Map a stored click to upright full-resolution pixels.
 * The click is fraction × preview size, measured from the pixel edge,
 * so `full = previewPx / previewScale`. Subtract 0.5 only when a caller
 * needs a pixel-centre index.
 */
export function previewPixelToFull(previewPx: number, previewScale: number): number {
  return previewPx / previewScale;
}

export function previewPixelToFullCentre(previewPx: number, previewScale: number): number {
  return previewPx / previewScale - 0.5;
}

export const DNG_REJECTION =
  'This file is DNG/ProRAW. Turn ProRAW off (12 MP, HEIF Max off, location off). Shoot in Camera.app and pick the photo from Library at Actual Size.';

/** Extension, MIME, or a TIFF that carries DNGVersion (0xC612). JPEG EXIF is not a DNG. */
export function dngRejectionMessage(bytes: Uint8Array, name: string, type: string): string | null {
  if (/\.dng$/i.test(name)) return DNG_REJECTION;
  const mime = type.toLowerCase();
  if (mime === 'image/dng' || mime === 'image/x-adobe-dng' || mime === 'image/x-dcraw') {
    return DNG_REJECTION;
  }
  if (tiffHasTag(bytes, 0xc612)) return DNG_REJECTION;
  return null;
}

function tiffHasTag(bytes: Uint8Array, tag: number): boolean {
  if (bytes.length < 16) return false;
  const le = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00;
  const be = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a;
  if (!le && !be) return false;
  const ifd = u32at(bytes, 4, le);
  if (ifd + 2 > bytes.length) return false;
  const count = u16at(bytes, ifd, le);
  if (count > 512 || ifd + 2 + count * 12 > bytes.length) return false;
  for (let i = 0; i < count; i++) {
    if (u16at(bytes, ifd + 2 + i * 12, le) === tag) return true;
  }
  return false;
}

function u16at(bytes: Uint8Array, at: number, le: boolean): number {
  if (at + 1 >= bytes.length) return 0;
  return le ? bytes[at]! | (bytes[at + 1]! << 8) : (bytes[at]! << 8) | bytes[at + 1]!;
}

function u32at(bytes: Uint8Array, at: number, le: boolean): number {
  if (at + 3 >= bytes.length) return 0;
  if (le) {
    return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;
  }
  return ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash and read EXIF from the original bytes. Does not draw or re-encode the image.
 * Throws when the file is DNG/ProRAW.
 */
export async function inspectOriginalFile(
  file: Blob,
  meta: {
    name?: string;
    type?: string;
    photoId: string;
    stationId: string;
    observationId?: string;
    receivedAt?: string;
    pixels?: PreviewPixelMap;
    sessionStartedAt?: string;
    sessionEndedAt?: string;
  },
): Promise<OriginalPhotoDraft> {
  const receivedAt = meta.receivedAt ?? new Date().toISOString();
  const name = meta.name ?? '';
  const type = meta.type ?? file.type ?? '';
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dng = dngRejectionMessage(bytes, name, type);
  if (dng) throw new Error(dng);
  const hash = quickXorHash(bytes);
  const exif = await readSurveyExif(bytes);
  const noteBytes = await readMakerNoteBytes(bytes);
  const makerNote = readAppleMakerNote(noteBytes ?? bytes);
  const capturedAt = exifCapturedAtIso(exif);
  const provenance = inferPhotoProvenance(name, exif);
  const fileName = originalPhotoFileName(meta.stationId, receivedAt, name, type);
  const calibrationKey = calibrationKeyFor(exif, meta.pixels);
  const usabilityNote = photoUsabilityNote({
    exif,
    capturedAt,
    sessionStartedAt: meta.sessionStartedAt,
    sessionEndedAt: meta.sessionEndedAt,
    now: receivedAt,
  });
  return {
    photoId: meta.photoId,
    stationId: meta.stationId,
    observationId: meta.observationId,
    fileName,
    blob: file,
    size: file.size,
    contentType: contentTypeFor(type, fileName),
    receivedAt,
    capturedAt,
    provenance,
    sha256: await sha256Hex(bytes),
    calibrationKey,
    quickXorHash: hash.base64,
    exif,
    makerNote,
    pixels: meta.pixels,
    usabilityNote,
  };
}
