/**
 * Focal length for a survey photo, stored as fx / width.
 * EXIF FocalLengthIn35mmFilm over a 36 mm frame is the prior.
 * A capture matrix, or another photo of the same phone and lens, is the
 * shared calibration. A missing lens is not treated as 1×.
 */

import type { GardenDocument, Photo } from './model';
import { lensKeyFromExif, normaliseLensKey } from './solver/lens';

const FILM_WIDTH_MM = 36;
/** EXIF 35 mm equivalent is an integer. About ±2% at 26 mm. */
export const EXIF_FX_RELATIVE = 0.02;

export function fxOverWidthFrom35mm(focalLength35mm: number): number | null {
  if (!Number.isFinite(focalLength35mm) || focalLength35mm <= 0) return null;
  return focalLength35mm / FILM_WIDTH_MM;
}

/** Apple's intrinsic matrix is column-major, so fx is the first entry. */
export function fxOverWidthFromIntrinsic(
  matrix: number[] | null | undefined,
  referenceWidth: number | null | undefined,
): number | null {
  if (!matrix || matrix.length < 1 || referenceWidth == null || !(referenceWidth > 0)) return null;
  const fx = matrix[0];
  if (fx == null || !Number.isFinite(fx) || fx <= 0) return null;
  return fx / referenceWidth;
}

/** Make|Model|LensModel|FocalLength|FocalLengthIn35mmFilm|size. */
function calibrationExif(photo: Photo): { lensModel?: string; focal35?: number } {
  const key = photo.originalFile?.calibrationKey;
  if (!key) return {};
  const parts = key.split('|');
  const lensModel = parts[2]?.trim() || undefined;
  const focal35 = Number(parts[4]);
  return {
    lensModel,
    focal35: Number.isFinite(focal35) && focal35 > 0 ? focal35 : undefined,
  };
}

function lensAndFilm(photo: Photo): { lensModel?: string; focal35?: number } {
  const native = photo.originalFile?.nativeCapture;
  const fromKey = calibrationExif(photo);
  return {
    lensModel: native?.lensModel ?? fromKey.lensModel,
    focal35: native?.focalLength35mm ?? fromKey.focal35,
  };
}

function resolvedLens(photo: Photo): string | undefined {
  const named = photo.lens?.trim();
  if (named) return normaliseLensKey(named) ?? undefined;
  const film = lensAndFilm(photo);
  return lensKeyFromExif(film.lensModel, film.focal35) ?? undefined;
}

function phoneIdFor(photo: Photo): string | undefined {
  if (photo.phoneId) return photo.phoneId;
  const key = photo.originalFile?.calibrationKey;
  if (!key) return undefined;
  const [make, model] = key.split('|');
  if (!make && !model) return undefined;
  return `phone:${make}|${model}`;
}

function focalOf(photo: Photo): { fxOverWidth: number; fxRelativeUncertainty?: number; phoneId?: string; lens?: string } | null {
  if (photo.fxOverWidth == null || !(photo.fxOverWidth > 0)) return null;
  return {
    fxOverWidth: photo.fxOverWidth,
    fxRelativeUncertainty: photo.fxRelativeUncertainty,
    phoneId: photo.phoneId,
    lens: photo.lens,
  };
}

/** Fill fx / phone / lens on photos that do not have them yet. */
export function stampPhotoFocals(doc: GardenDocument, photoIds?: string[]): GardenDocument {
  const wanted = photoIds ? new Set(photoIds) : null;
  let changed = false;
  const photos = doc.photos.map((photo) => {
    if (wanted && !wanted.has(photo.id)) return photo;
    if (photo.fxOverWidth != null && photo.fxOverWidth > 0 && photo.lens && photo.phoneId) return photo;
    const lens = photo.lens ? (normaliseLensKey(photo.lens) ?? photo.lens) : resolvedLens(photo);
    const phoneId = phoneIdFor(photo);
    const native = photo.originalFile?.nativeCapture;
    const film = lensAndFilm(photo);
    const mates = doc.photos.filter((other) =>
      other.id !== photo.id
      && other.fxOverWidth != null
      && other.fxOverWidth > 0
      && phoneId
      && lens
      && (other.phoneId ?? phoneIdFor(other)) === phoneId
      && (other.lens ? (normaliseLensKey(other.lens) ?? other.lens) : resolvedLens(other)) === lens,
    );
    const calibrated = mates.map(focalOf).find((item) => item && !(item.fxRelativeUncertainty != null && item.fxRelativeUncertainty > 0));
    const shared = calibrated ?? mates.map(focalOf).find((item) => item);
    const intrinsic = fxOverWidthFromIntrinsic(native?.intrinsicMatrix, native?.intrinsicReferenceWidth);
    const exif = film.focal35 != null ? fxOverWidthFrom35mm(film.focal35) : null;
    const chosen = shared
      ?? (intrinsic != null ? { fxOverWidth: intrinsic, fxRelativeUncertainty: undefined, phoneId, lens } : null)
      ?? (exif != null ? { fxOverWidth: exif, fxRelativeUncertainty: EXIF_FX_RELATIVE, phoneId, lens } : null);
    if (!chosen && lens === photo.lens && phoneId === photo.phoneId) return photo;
    const fxOverWidth = photo.fxOverWidth != null && photo.fxOverWidth > 0 ? photo.fxOverWidth : chosen?.fxOverWidth;
    if (fxOverWidth == null && !lens && !phoneId) return photo;
    changed = true;
    return {
      ...photo,
      fxOverWidth,
      fxRelativeUncertainty: photo.fxRelativeUncertainty ?? chosen?.fxRelativeUncertainty,
      phoneId: photo.phoneId ?? phoneId,
      lens: photo.lens ?? lens,
    };
  });
  return changed ? { ...doc, photos } : doc;
}
