import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { IOS_BUNDLE_ID, IOS_ENTRA_REDIRECT_URI, IOS_URL_SCHEME } from '../src/iosPublicConfig';
import {
  captureSurveyPhoto,
  fileFromNativeStill,
  sidecarFromPlugin,
  type NativeCaptureSidecar,
} from '../src/surveyCapture';

const original = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4]);

function shutterResult(): NativeCaptureSidecar {
  return {
    path: '/tmp/GardenCamera/GP-1.jpg',
    webPath: 'capacitor://localhost/_capacitor_file_/tmp/GardenCamera/GP-1.jpg',
    fileName: 'GP-1.jpg',
    mimeType: 'image/jpeg',
    byteSize: original.byteLength,
    source: 'shutter',
    deviceType: 'AVCaptureDeviceTypeBuiltInWideAngleCamera',
    videoZoomFactor: 1,
    lensPosition: 0.62,
    focusLocked: true,
    exposureLocked: true,
    geometricDistortionCorrectionSupported: true,
    geometricDistortionCorrectionEnabled: false,
    contentAwareDistortionCorrectionSupported: true,
    contentAwareDistortionCorrectionEnabled: false,
    photoQualityPrioritization: 'speed',
    autoRedEyeReductionEnabled: false,
    stabilization: 'off',
    focalLengthMm: 6.9,
    focalLength35mm: 26,
    lensModel: 'iPhone back camera 6.9mm f/1.78',
    intrinsicMatrix: null,
    intrinsicReferenceWidth: null,
    intrinsicReferenceHeight: null,
    motionInterpolated: true,
    gravity: { x: 0.01, y: -0.98, z: -0.02 },
    width: 4032,
    height: 3024,
    requestedWidth: 4032,
    requestedHeight: 3024,
    orientation: 6,
  };
}

describe('survey capture', () => {
  it('uses the web file input when the app is not the iOS shell', async () => {
    const capture = vi.fn();
    const choice = await captureSurveyPhoto({
      native: false,
      camera: { capture },
      readFile: async () => {
        throw new Error('web capture must not read a native file');
      },
    });
    expect(choice).toEqual({ route: 'web' });
    expect(capture).not.toHaveBeenCalled();
  });

  it('returns the original bytes from the Capacitor shutter', async () => {
    const sidecar = shutterResult();
    let released = false;
    const choice = await captureSurveyPhoto({
      native: true,
      camera: { capture: async () => sidecar },
      readFile: async (asked) => {
        expect(asked.webPath).toBe(sidecar.webPath);
        return new Blob([original], { type: 'image/jpeg' });
      },
      release: async (path) => {
        expect(path).toBe(sidecar.path);
        released = true;
      },
    });
    expect(choice.route).toBe('capacitor');
    if (choice.route !== 'capacitor') return;
    expect(released).toBe(true);
    expect(choice.file.name).toBe('GP-1.jpg');
    expect(choice.file.type).toBe('image/jpeg');
    expect(new Uint8Array(await choice.file.arrayBuffer())).toEqual(original);
    expect(choice.file.size).toBe(original.byteLength);
    expect(choice.sidecar.lensPosition).toBe(0.62);
    expect(choice.sidecar.focalLengthMm).toBe(6.9);
    expect(choice.sidecar.intrinsicMatrix).toBeNull();
    expect(choice.sidecar.focusLocked).toBe(true);
    expect(choice.sidecar.geometricDistortionCorrectionEnabled).toBe(false);
    expect(choice.sidecar.contentAwareDistortionCorrectionEnabled).toBe(false);
    expect(choice.sidecar.photoQualityPrioritization).toBe('speed');
    expect(choice.sidecar.autoRedEyeReductionEnabled).toBe(false);
    expect(choice.sidecar.requestedWidth).toBe(4032);
    expect(choice.sidecar.requestedHeight).toBe(3024);
    expect(choice.sidecar.gravity).toEqual({ x: 0.01, y: -0.98, z: -0.02 });
  });

  it('does not invent a file when the shutter is cancelled or the library is chosen', async () => {
    const readFile = vi.fn();
    const cancelled = await captureSurveyPhoto({
      native: true,
      camera: { capture: async () => ({ cancelled: true }) },
      readFile,
    });
    const library = await captureSurveyPhoto({
      native: true,
      camera: { capture: async () => ({ useLibrary: true }) },
      readFile,
    });
    expect(cancelled).toEqual({ route: 'cancelled' });
    expect(library).toEqual({ route: 'library' });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('refuses a native capture when the plugin is missing', async () => {
    await expect(
      captureSurveyPhoto({
        native: true,
        camera: null,
        readFile: async () => new Blob([original]),
      }),
    ).rejects.toThrow(/native camera/i);
  });

  it('keeps focal length and a reported matrix, and leaves a missing matrix null', async () => {
    const parsed = sidecarFromPlugin({
      path: '/tmp/GardenCamera/GP-2.jpg',
      fileName: 'GP-2.jpg',
      mimeType: 'image/jpeg',
      byteSize: 9,
      source: 'shutter',
      deviceType: 'AVCaptureDeviceTypeBuiltInWideAngleCamera',
      videoZoomFactor: 1,
      lensPosition: 0.4,
      focusLocked: true,
      exposureLocked: true,
      geometricDistortionCorrectionSupported: false,
      geometricDistortionCorrectionEnabled: false,
      contentAwareDistortionCorrectionSupported: false,
      contentAwareDistortionCorrectionEnabled: false,
      photoQualityPrioritization: 'speed',
      autoRedEyeReductionEnabled: false,
      requestedWidth: 4032,
      requestedHeight: 3024,
      focalLengthMm: 5.7,
      focalLength35mm: 24,
      lensModel: 'back camera',
      intrinsicMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      intrinsicReferenceWidth: 4032,
      intrinsicReferenceHeight: 3024,
      gravityX: 0,
      gravityY: -1,
      gravityZ: 0,
      width: 4032,
      height: 3024,
    });
    expect('useLibrary' in parsed).toBe(false);
    if ('path' in parsed) {
      expect(parsed.focalLength35mm).toBe(24);
      expect(parsed.intrinsicMatrix).toHaveLength(9);
      expect(parsed.intrinsicReferenceWidth).toBe(4032);
      expect(parsed.gravity).toEqual({ x: 0, y: -1, z: 0 });
      expect(parsed.requestedWidth).toBe(4032);
      expect(parsed.autoRedEyeReductionEnabled).toBe(false);
    }
    const noMatrix = sidecarFromPlugin({
      path: '/tmp/GardenCamera/GP-3.jpg',
      fileName: 'GP-3.jpg',
    });
    if ('path' in noMatrix) {
      expect(noMatrix.intrinsicMatrix).toBeNull();
      expect(noMatrix.lensPosition).toBeNull();
      expect(noMatrix.focalLengthMm).toBeNull();
      expect(noMatrix.requestedWidth).toBeNull();
      expect(noMatrix.autoRedEyeReductionEnabled).toBeNull();
    }
  });

  it('releases the native file only after the bytes have been read', async () => {
    const order: string[] = [];
    const sidecar = shutterResult();
    const file = await fileFromNativeStill(
      sidecar,
      async () => {
        order.push('read');
        return new Blob([original], { type: 'image/jpeg' });
      },
      async () => {
        order.push('release');
      },
    );
    expect(order).toEqual(['read', 'release']);
    expect(file.size).toBe(original.byteLength);
  });
});

describe('iOS identity', () => {
  it('uses the confirmed bundle id and Entra redirect in the native project', () => {
    expect(IOS_BUNDLE_ID).toBe('com.pjwinstone.gardenplanting');
    expect(IOS_ENTRA_REDIRECT_URI).toBe('msauth.com.pjwinstone.gardenplanting://auth');
    expect(IOS_URL_SCHEME).toBe('msauth.com.pjwinstone.gardenplanting');
    const plist = readFileSync('ios/App/App/Info.plist', 'utf8');
    const auth = readFileSync('ios/App/App/GardenAuthPlugin.swift', 'utf8');
    const project = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
    expect(plist).toContain(IOS_URL_SCHEME);
    expect(plist).toContain('Garden Planting');
    expect(auth).toContain(IOS_ENTRA_REDIRECT_URI);
    expect(project).toContain(`PRODUCT_BUNDLE_IDENTIFIER = ${IOS_BUNDLE_ID};`);
    const camera = readFileSync('ios/App/App/GardenCameraPlugin.swift', 'utf8');
    expect(camera).toContain('videoRotationAngleForHorizonLevelCapture');
    expect(camera).toContain('photoQualityPrioritization = .speed');
    expect(camera).toContain('isAutoRedEyeReductionEnabled = false');
    expect(camera).toContain('isGeometricDistortionCorrectionEnabled = false');
    expect(camera).toContain('image/heic');
    expect(auth).toContain('refreshInFlight');
    expect(auth).toContain('refreshWaiters');
    const flight = readFileSync('.github/workflows/testflight.yml', 'utf8');
    expect(flight).toContain("github.ref == 'refs/heads/main'");
    expect(flight).toContain('if: always()');
    expect(flight).toContain("require('./package.json').version");
    expect(flight).toContain('GITHUB_RUN_NUMBER');
    expect(flight).not.toMatch(/^\s*push:\s*$/m);
  });
});
