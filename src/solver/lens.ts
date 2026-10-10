/**
 * Which lens a photo belongs to, for the shared fx scale.
 * A missing lens is not 1×. '1x', '1×' and '1.0x' are one key.
 */

export interface ResolvedLens {
  /** `phone:<id>|<lens>`, or the photo id when the scale stays private. */
  key: string;
  phoneId?: string;
  /** Canonical lens when this photo joins that phone's group. */
  lens?: string;
  /** Phone was named, and neither the lens field nor EXIF said which lens. */
  lensUnknown: boolean;
}

/** '1×', '1.0x', '0.50×' → '1x', '1x', '0.5x'. Unrecognised text is null. */
export function normaliseLensKey(raw: string): string | null {
  const compact = raw.trim().toLowerCase().replace(/×/g, 'x').replace(/\s+/g, '');
  const match = compact.match(/^(\d+(?:\.\d+)?|\.\d+)x$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return `${value}x`;
}

/**
 * Lens from EXIF LensModel and FocalLengthIn35mmFilm.
 * 1× is the same 23–27 mm back-camera band as `isOneXEquivalent`.
 * 28 mm is not 1×. A front camera is not used. Bands do not overlap.
 */
export function lensKeyFromExif(lensModel?: string, focalLengthIn35mmFilm?: number): string | null {
  const model = lensModel?.trim();
  if (model && /front/i.test(model) && !/back/i.test(model)) return null;
  const mm = focalLengthIn35mmFilm;
  const mmOk = mm != null && Number.isFinite(mm);
  if (model && /ultra\s*-?\s*wide/i.test(model) && (!mmOk || (mm >= 12 && mm <= 16))) return '0.5x';
  if (!mmOk) return null;
  if (model && !/back/i.test(model)) return null;
  if (mm >= 12 && mm <= 16) return '0.5x';
  if (mm >= 23 && mm <= 27) return '1x';
  if (mm >= 46 && mm <= 56) return '2x';
  if (mm >= 70 && mm <= 85) return '3x';
  if (mm >= 110 && mm <= 130) return '5x';
  return null;
}

export function resolveLens(photo: {
  id: string;
  phoneId?: string;
  lens?: string;
  lensModel?: string;
  focalLengthIn35mmFilm?: number;
}): ResolvedLens {
  if (!photo.phoneId) return { key: photo.id, lensUnknown: false };
  const named = photo.lens != null && photo.lens.trim() !== '';
  const fromField = named ? normaliseLensKey(photo.lens ?? '') : null;
  // An explicit lens we cannot read does not fall through to EXIF, and it
  // does not join 1×. Only a missing lens is filled from EXIF.
  const lens = fromField ?? (named ? null : lensKeyFromExif(photo.lensModel, photo.focalLengthIn35mmFilm));
  if (!lens) {
    return { key: photo.id, phoneId: photo.phoneId, lensUnknown: true };
  }
  return { key: `phone:${photo.phoneId}|${lens}`, phoneId: photo.phoneId, lens, lensUnknown: false };
}
