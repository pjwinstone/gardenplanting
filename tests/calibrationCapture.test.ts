import { describe, expect, it } from 'vitest';
import { emptyDocument } from '../src/model';
import { captureSurveyPhoto, type NativeCaptureOptions, type NativeCaptureSidecar } from '../src/surveyCapture';
import { cameraPositionHint, checkCameraPositionPhoto } from '../src/workflows/guided/cameraCapture';
import { circleFieldTest } from '../src/workflows/guided/definitions';

describe('calibration photo', () => {
  it('asks the native shutter for a landscape-locked screen with the step hint', async () => {
    let seen: NativeCaptureOptions | undefined;
    const sidecar = { path: '/tmp/a.jpg', webPath: 'x', fileName: 'a.jpg', mimeType: 'image/jpeg', source: 'shutter' } as NativeCaptureSidecar;
    const choice = await captureSurveyPhoto({
      native: true,
      camera: {
        async capture(options) {
          seen = options;
          return sidecar;
        },
      },
      readFile: async () => new Blob([new Uint8Array([1, 2, 3])]),
      cameraOptions: { landscape: true, hint: 'Calibration' },
    });
    expect(choice.route).toBe('capacitor');
    expect(seen).toEqual({ landscape: true, hint: 'Calibration' });
  });

  it('hint names the taped distance and what to aim at', () => {
    const hint = cameraPositionHint(emptyDocument('x'), 'Calibration');
    expect(hint).toContain('4.0 m');
    expect(hint).toMatch(/landscape, 1×/);
    expect(hint).toMatch(/whole sleeve/);
    expect(cameraPositionHint(emptyDocument('x'), 'Position 1')).toContain('14.60 m to BAS01');
  });

  it('phone held upright is portrait even if the frame came out wide', () => {
    const upright = checkCameraPositionPhoto({ width: 4032, height: 3024, zoom: 1, gravity: { x: 0.02, y: -0.99, z: -0.1 } });
    expect(upright.ok).toBe(false);
    expect(upright.message).toMatch(/^Turn the phone sideways/);
    const sideways = checkCameraPositionPhoto({ width: 4032, height: 3024, zoom: 1, gravity: { x: -0.98, y: 0.05, z: -0.1 } });
    expect(sideways).toMatchObject({ ok: true, orientation: 'landscape' });
  });

  it('step text has a numbered 3-step how-to', () => {
    const step = circleFieldTest.steps.find((s) => s.id === 'camera-calibration')!;
    const numbered = (step.detail ?? []).filter((line) => /^[123]\. /.test(line));
    expect(numbered).toHaveLength(3);
    expect(step.instruction).toMatch(/4\.0 m/);
  });
});
