/**
 * Browser side of sleeve detection: load the full-resolution original from the IndexedDB photo
 * queue, cut a vertical strip around the tap (full image height), and run the pure detector.
 * Only the strip is decoded to pixels, so a 12 MP photo costs a few MB, not 48 MB.
 */

import type { Photo } from '../../model';
import { getAppPhotoQueue } from '../../photoSync';
import { detectSleeve, greyFromRgba, type SleeveDetection } from './sleeveDetect';

export interface FullResDetection {
  detection?: SleeveDetection;
  /** Full-image pixels per preview pixel. */
  scaleX: number;
  scaleY: number;
  /** Why there is no detection (no original on this phone, decode failed …). */
  unavailable?: string;
}

/** Aspect ratios within 1% and the same scale on both axes (within 1%). */
export function originalMatchesPreview(fullW: number, fullH: number, previewW: number, previewH: number): boolean {
  if (!(fullW > 0 && fullH > 0 && previewW > 0 && previewH > 0)) return false;
  const sx = fullW / previewW;
  const sy = fullH / previewH;
  const arFull = fullW / fullH;
  const arPreview = previewW / previewH;
  return Math.abs(arFull / arPreview - 1) <= 0.01 && Math.abs(sx / sy - 1) <= 0.01;
}

export async function detectSleeveFromOriginal(photo: Photo, tapPreviewX: number, tapPreviewY: number): Promise<FullResDetection> {
  const record = await getAppPhotoQueue().get(photo.id).catch(() => undefined);
  if (!record?.blob) return { scaleX: 1, scaleY: 1, unavailable: 'The full-size photo is no longer on this phone.' };
  let bitmap: ImageBitmap;
  try {
    // iOS 15+ WebKit applies EXIF orientation when decoding; the aspect check below catches any mismatch.
    bitmap = await createImageBitmap(record.blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    return { scaleX: 1, scaleY: 1, unavailable: 'Could not open the full-size photo.' };
  }
  try {
    const W = bitmap.width;
    const H = bitmap.height;
    const scaleX = W / Math.max(1, photo.width);
    const scaleY = H / Math.max(1, photo.height);
    // Preview and original must be the same picture the same way up. If not (EXIF rotation applied to
    // one and not the other, a crop), do not guess: fall back to manual taps.
    if (!originalMatchesPreview(W, H, photo.width, photo.height)) {
      return { scaleX, scaleY, unavailable: 'The full-size photo does not line up with the preview.' };
    }
    const tx = tapPreviewX * scaleX;
    const ty = tapPreviewY * scaleY;
    const reach = Math.round(Math.min(Math.max(H * 0.08, 20), 400)) + 8;
    const x0 = Math.max(0, Math.floor(tx - reach));
    const x1 = Math.min(W, Math.ceil(tx + reach));
    const sw = Math.max(1, x1 - x0);
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(sw, H) : Object.assign(document.createElement('canvas'), { width: sw, height: H });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return { scaleX, scaleY, unavailable: 'No canvas to read the photo.' };
    ctx.drawImage(bitmap, x0, 0, sw, H, 0, 0, sw, H);
    const data = ctx.getImageData(0, 0, sw, H).data;
    const found = detectSleeve(greyFromRgba(sw, H, data), tx - x0, ty);
    if (!found) return { scaleX, scaleY };
    return { scaleX, scaleY, detection: { ...found, topX: found.topX + x0, bottomX: found.bottomX + x0 } };
  } finally {
    bitmap.close();
  }
}
