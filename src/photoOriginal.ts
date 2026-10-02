/**
 * Name and describe an original camera file without re-encoding it.
 * The Blob passed in is the stored copy.
 */

import type { SurveyExif } from './photoExif';
import { readSurveyExif } from './photoExif';
import { quickXorHash } from './quickXorHash';

export interface OriginalPhotoDraft {
  photoId: string;
  stationId: string;
  observationId?: string;
  fileName: string;
  /** The same Blob the camera/file input delivered. */
  blob: Blob;
  size: number;
  contentType: string;
  capturedAt: string;
  quickXorHash: string;
  exif: SurveyExif;
}

export function originalPhotoFileName(
  stationId: string,
  capturedAtIso: string,
  sourceName: string,
  sourceType: string,
): string {
  const station = stationId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'STA';
  const stamp = capturedAtIso.replace(/[-:.]/g, '');
  const ext = extensionFor(sourceName, sourceType);
  return `${station}_${stamp}.${ext}`;
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
 * Hash and read EXIF from the original bytes. Does not draw or re-encode the image.
 */
export async function inspectOriginalFile(
  file: Blob,
  meta: {
    name?: string;
    type?: string;
    photoId: string;
    stationId: string;
    observationId?: string;
    capturedAt?: string;
  },
): Promise<OriginalPhotoDraft> {
  const capturedAt = meta.capturedAt ?? new Date().toISOString();
  const name = meta.name ?? '';
  const type = meta.type ?? file.type ?? '';
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = quickXorHash(bytes);
  const exif = await readSurveyExif(bytes);
  const fileName = originalPhotoFileName(meta.stationId, capturedAt, name, type);
  return {
    photoId: meta.photoId,
    stationId: meta.stationId,
    observationId: meta.observationId,
    fileName,
    blob: file,
    size: file.size,
    contentType: contentTypeFor(type, fileName),
    capturedAt,
    quickXorHash: hash.base64,
    exif,
  };
}
