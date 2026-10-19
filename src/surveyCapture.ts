/**
 * Survey photo capture. In the iOS app this calls the native shutter and
 * reads the original file. Everywhere else it leaves the existing web capture
 * (aiming preview, then the system file input) in place.
 * The bytes are not re-encoded here. OneDrive upload still goes through
 * inspectOriginalFile.
 */

import { Capacitor } from '@capacitor/core';
import type { NativeCaptureRecord } from './model';
import { isNativeApp } from './nativePlatform';

export interface NativeCaptureSidecar extends NativeCaptureRecord {
  path: string;
  webPath: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
}

export type NativeCameraResult =
  | { cancelled: true }
  | { useLibrary: true }
  | NativeCaptureSidecar;

/** Field-test camera positions: lock the shutter screen to landscape and show a step hint. */
export interface NativeCaptureOptions {
  landscape?: boolean;
  hint?: string;
}

export interface NativeCameraClient {
  capture(options?: NativeCaptureOptions): Promise<NativeCameraResult>;
}

export type SurveyCaptureChoice =
  | { route: 'capacitor'; file: File; sidecar: NativeCaptureSidecar }
  | { route: 'web' }
  | { route: 'library' }
  | { route: 'cancelled' };

const sidecars = new WeakMap<File, NativeCaptureRecord>();

export function attachNativeCapture(file: File, sidecar: NativeCaptureSidecar): void {
  sidecars.set(file, captureRecord(sidecar));
}

export function nativeCaptureRecordFor(file: File): NativeCaptureRecord | undefined {
  return sidecars.get(file);
}

export function captureRecord(sidecar: NativeCaptureSidecar): NativeCaptureRecord {
  return {
    source: sidecar.source,
    deviceType: sidecar.deviceType,
    videoZoomFactor: sidecar.videoZoomFactor,
    lensPosition: sidecar.lensPosition,
    focusLocked: sidecar.focusLocked,
    exposureLocked: sidecar.exposureLocked,
    geometricDistortionCorrectionSupported: sidecar.geometricDistortionCorrectionSupported,
    geometricDistortionCorrectionEnabled: sidecar.geometricDistortionCorrectionEnabled,
    contentAwareDistortionCorrectionSupported: sidecar.contentAwareDistortionCorrectionSupported,
    contentAwareDistortionCorrectionEnabled: sidecar.contentAwareDistortionCorrectionEnabled,
    photoQualityPrioritization: sidecar.photoQualityPrioritization,
    autoRedEyeReductionEnabled: sidecar.autoRedEyeReductionEnabled,
    stabilization: sidecar.stabilization,
    focalLengthMm: sidecar.focalLengthMm,
    focalLength35mm: sidecar.focalLength35mm,
    lensModel: sidecar.lensModel,
    intrinsicMatrix: sidecar.intrinsicMatrix,
    intrinsicReferenceWidth: sidecar.intrinsicReferenceWidth,
    intrinsicReferenceHeight: sidecar.intrinsicReferenceHeight,
    motionInterpolated: sidecar.motionInterpolated,
    gravity: sidecar.gravity,
    width: sidecar.width,
    height: sidecar.height,
    requestedWidth: sidecar.requestedWidth,
    requestedHeight: sidecar.requestedHeight,
    orientation: sidecar.orientation,
  };
}

export function isCaptureCancel(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const o = error as { code?: string; message?: string };
  return o.code === 'USER_CANCELLED' || o.message === 'cancelled';
}

/**
 * Native app: take the original file from the plugin.
 * Browser and installed PWA: caller uses the existing file input.
 */
export async function captureSurveyPhoto(options: {
  native: boolean;
  camera: NativeCameraClient | null;
  readFile: (sidecar: NativeCaptureSidecar) => Promise<Blob>;
  release?: (path: string) => Promise<void>;
  cameraOptions?: NativeCaptureOptions;
}): Promise<SurveyCaptureChoice> {
  if (!options.native) return { route: 'web' };
  if (!options.camera) throw new Error('The native camera is not available.');
  const result = await options.camera.capture(options.cameraOptions);
  if ('cancelled' in result) return { route: 'cancelled' };
  if ('useLibrary' in result) return { route: 'library' };
  const file = await fileFromNativeStill(result, () => options.readFile(result), options.release);
  attachNativeCapture(file, result);
  return { route: 'capacitor', file, sidecar: result };
}

export async function fileFromNativeStill(
  sidecar: NativeCaptureSidecar,
  readBytes: (webPath: string) => Promise<Blob>,
  release?: (path: string) => Promise<void>,
): Promise<File> {
  const blob = await readBytes(sidecar.webPath);
  if (blob.size === 0) throw new Error('The camera file was empty.');
  const file = new File([blob], sidecar.fileName, {
    type: sidecar.mimeType || blob.type || 'image/jpeg',
  });
  if (release) await release(sidecar.path);
  return file;
}

interface GardenCameraPlugin {
  capture(options?: NativeCaptureOptions): Promise<Record<string, unknown>>;
  release(options: { path: string }): Promise<void>;
}

const GardenCamera = Capacitor.registerPlugin<GardenCameraPlugin>('GardenCamera');

export function installedCameraClient(): NativeCameraClient {
  return {
    async capture(options?: NativeCaptureOptions) {
      try {
        return sidecarFromPlugin(await GardenCamera.capture(options ?? {}));
      } catch (error) {
        if (isCaptureCancel(error)) return { cancelled: true };
        throw error;
      }
    },
  };
}

export async function readInstalledNativeFile(sidecar: NativeCaptureSidecar): Promise<Blob> {
  const url = sidecar.webPath || Capacitor.convertFileSrc(sidecar.path);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not read the camera file (${response.status}).`);
  const blob = await response.blob();
  try {
    await GardenCamera.release({ path: sidecar.path });
  } catch {
    /* The bytes are already in memory. A leftover file can be cleaned up later. */
  }
  return blob;
}

export function nativeSurveyCaptureAvailable(): boolean {
  return isNativeApp();
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function nullableBool(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  return null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function matrix(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 9) return null;
  const out: number[] = [];
  for (const item of value) {
    const n = num(item);
    if (n == null) return null;
    out.push(n);
  }
  return out;
}

function gravity(raw: Record<string, unknown>): { x: number; y: number; z: number } | null {
  const x = num(raw.gravityX);
  const y = num(raw.gravityY);
  const z = num(raw.gravityZ);
  if (x == null || y == null || z == null) return null;
  return { x, y, z };
}

export function sidecarFromPlugin(raw: Record<string, unknown>): NativeCameraResult {
  if (raw.useLibrary === true) return { useLibrary: true };
  if (raw.cancelled === true) return { cancelled: true };
  const path = str(raw.path);
  const fileName = str(raw.fileName);
  if (!path || !fileName) throw new Error('The camera did not return a file.');
  const webPath = str(raw.webPath) || Capacitor.convertFileSrc(path);
  return {
    path,
    webPath,
    fileName,
    mimeType: str(raw.mimeType) || 'image/jpeg',
    byteSize: num(raw.byteSize) ?? 0,
    source: raw.source === 'library' ? 'library' : 'shutter',
    deviceType: str(raw.deviceType) || 'builtInWideAngleCamera',
    videoZoomFactor: num(raw.videoZoomFactor),
    lensPosition: num(raw.lensPosition),
    focusLocked: bool(raw.focusLocked),
    exposureLocked: bool(raw.exposureLocked),
    geometricDistortionCorrectionSupported: nullableBool(raw.geometricDistortionCorrectionSupported),
    geometricDistortionCorrectionEnabled: nullableBool(raw.geometricDistortionCorrectionEnabled),
    contentAwareDistortionCorrectionSupported: nullableBool(raw.contentAwareDistortionCorrectionSupported),
    contentAwareDistortionCorrectionEnabled: nullableBool(raw.contentAwareDistortionCorrectionEnabled),
    photoQualityPrioritization: str(raw.photoQualityPrioritization),
    autoRedEyeReductionEnabled: nullableBool(raw.autoRedEyeReductionEnabled),
    stabilization: str(raw.stabilization),
    focalLengthMm: num(raw.focalLengthMm),
    focalLength35mm: num(raw.focalLength35mm),
    lensModel: str(raw.lensModel),
    intrinsicMatrix: matrix(raw.intrinsicMatrix),
    intrinsicReferenceWidth: num(raw.intrinsicReferenceWidth),
    intrinsicReferenceHeight: num(raw.intrinsicReferenceHeight),
    motionInterpolated: bool(raw.motionInterpolated),
    gravity: gravity(raw),
    width: num(raw.width),
    height: num(raw.height),
    requestedWidth: num(raw.requestedWidth),
    requestedHeight: num(raw.requestedHeight),
    orientation: num(raw.orientation),
  };
}
