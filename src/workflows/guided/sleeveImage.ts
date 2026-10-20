/**
 * Browser side of sleeve detection: load the full-resolution original from the IndexedDB photo
 * queue, cut a vertical strip around the tap (full image height), and run the pure detector.
 * Only the strip is decoded to pixels, so a 12 MP photo costs a few MB, not 48 MB.
 */

import type { Photo } from '../../model';
import { getAppPhotoQueue } from '../../photoSync';
import { detectSleeve, greyFromRgba, type SleeveDetection } from './sleeveDetect';
import { scanSleeves, type ScanResult, type ScannedSleeve } from './sleeveScan';
import type { ScanReply, ScanRequest } from './sleeveScan.worker';

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

export interface FullResScan {
  sleeves: ScannedSleeve[];
  duplicates: string[];
  partial: boolean;
  ms: number;
  /** Full-image pixels per preview pixel. */
  scaleX: number;
  scaleY: number;
  unavailable?: string;
}

/** Rows per tile when turning the bitmap into grey: only one tile of RGBA exists at a time. */
const TILE_ROWS = 256;

/**
 * Whole-photo scan of the full-size original (docs/marker-detection.md). One bitmap is decoded,
 * checked against the preview (same picture, same way up, else `unavailable`), turned into an
 * 8-bit grey image tile by tile and closed; the grey image goes to a Web Worker.
 */
export async function scanSleevesFromOriginal(photo: Photo, markerIds: string[], budgetMs?: number): Promise<FullResScan> {
  const none = (unavailable: string, scaleX = 1, scaleY = 1): FullResScan => ({ sleeves: [], duplicates: [], partial: false, ms: 0, scaleX, scaleY, unavailable });
  const record = await getAppPhotoQueue().get(photo.id).catch(() => undefined);
  if (!record?.blob) return none('The full-size photo is no longer on this phone.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(record.blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    return none('Could not open the full-size photo.');
  }
  let W = 0;
  let H = 0;
  let grey: Uint8ClampedArray;
  let scaleX = 1;
  let scaleY = 1;
  try {
    W = bitmap.width;
    H = bitmap.height;
    scaleX = W / Math.max(1, photo.width);
    scaleY = H / Math.max(1, photo.height);
    if (!originalMatchesPreview(W, H, photo.width, photo.height)) {
      return none('The full-size photo does not line up with the preview.', scaleX, scaleY);
    }
    const rows = Math.min(TILE_ROWS, H);
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, rows) : Object.assign(document.createElement('canvas'), { width: W, height: rows });
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return none('No canvas to read the photo.', scaleX, scaleY);
    grey = new Uint8ClampedArray(W * H);
    for (let y0 = 0; y0 < H; y0 += rows) {
      const h = Math.min(rows, H - y0);
      ctx.clearRect(0, 0, W, rows);
      ctx.drawImage(bitmap, 0, y0, W, h, 0, 0, W, h);
      const data = ctx.getImageData(0, 0, W, h).data;
      for (let i = 0, j = 0, o = y0 * W; i < W * h; i += 1, j += 4) grey[o + i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    }
  } finally {
    bitmap.close();
  }
  const result = await runScan({ width: W, height: H, grey, markerIds, budgetMs });
  return { sleeves: result.sleeves, duplicates: result.duplicates, partial: result.partial, ms: result.ms, scaleX, scaleY };
}

/** In a Web Worker when the platform has one; on the main thread otherwise. */
function runScan(req: ScanRequest): Promise<ScanResult> {
  const inline = () => scanSleeves({ width: req.width, height: req.height, grey: req.grey }, { markerIds: req.markerIds, budgetMs: req.budgetMs });
  if (typeof Worker === 'undefined') return Promise.resolve(inline());
  return new Promise<ScanResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./sleeveScan.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(inline());
      return;
    }
    const done = () => worker.terminate();
    worker.onmessage = (ev: MessageEvent<ScanReply>) => {
      done();
      if (ev.data.ok) resolve(ev.data.result);
      else reject(new Error(ev.data.error));
    };
    worker.onerror = () => {
      done();
      // The image was transferred, so it cannot be scanned here as well.
      reject(new Error('The sleeve scan stopped.'));
    };
    worker.postMessage(req, [req.grey.buffer]);
  });
}
