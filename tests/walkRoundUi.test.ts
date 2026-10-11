/**
 * @vitest-environment happy-dom
 * The walk goes green only after the buttons the field actually presses:
 * baseline, corner tape, cross-tie, upload, and mark clicks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/tagSuggest', () => ({
  suggestTagBlobs: async () => [],
  imageNaturalSize: async () => ({ width: 200, height: 150 }),
}));

import { emptyDocument } from '../src/model';
import { applyPhotoUploadStatus, getState, onShellClick } from '../src/ui';
import { gardenCloudUiForTests } from '../src/ui';
import { readProgress } from '../src/workflows/guided/engine';
import { GOOD_LEG, walkView } from '../src/workflows/guided/traverseWalk';
import { workflowAddPoint } from '../src/workflows/addPoint';

function click(node: HTMLElement, extra: Partial<MouseEvent> = {}): Promise<void> {
  return onShellClick({
    target: node,
    preventDefault() {},
    clientX: 0,
    clientY: 0,
    ...extra,
  } as unknown as Event);
}

function field(panel: HTMLElement, name: string, value: string, tag = 'input'): void {
  const node = document.createElement(tag);
  node.setAttribute('data-field', name);
  if (tag === 'input') (node as HTMLInputElement).value = value;
  else {
    const opt = document.createElement('option');
    opt.value = value;
    opt.selected = true;
    node.append(opt);
    (node as HTMLSelectElement).value = value;
  }
  panel.append(node);
}

function button(cmd: string, attrs: Record<string, string> = {}): HTMLButtonElement {
  const node = document.createElement('button');
  node.setAttribute('data-cmd', cmd);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

describe('walk round through the shell', () => {
  beforeEach(() => {
    localStorage.clear();
    gardenCloudUiForTests.edit(emptyDocument('Shell'));
  });

  it('reaches a settled leg from tape, upload, and mark clicks', async () => {
    await click(button('workflow-start', { 'data-workflow': 'house-traverse' }));
    const baseline = document.createElement('div');
    baseline.className = 'step-panel';
    field(baseline, 'length', '7');
    field(baseline, 'offset-a', '0');
    field(baseline, 'offset-b', '0');
    field(baseline, 'end-a', 'HSE01');
    field(baseline, 'end-b', 'HSE02');
    field(baseline, 'kind', 'tape', 'select');
    const save = button('save-baseline');
    baseline.append(save);
    await click(save);

    await click(button('workflow-next'));
    expect(readProgress(getState().doc).runs['house-traverse']?.currentStepId).toBe('leg');

    const house = document.createElement('div');
    house.className = 'step-panel';
    field(house, 'edge', '5.2');
    field(house, 'offset', '0');
    const addCorner = button('add-house-corner');
    house.append(addCorner);
    await click(addCorner);
    expect(getState().doc.houseTraverse?.newestId).toBe('HSE03');

    const tie = document.createElement('div');
    tie.className = 'step-panel';
    field(tie, 'tie-a', 'HSE01', 'select');
    field(tie, 'tie-b', 'HSE03', 'select');
    field(tie, 'tie-length', '6');
    const saveTie = button('tape-between-marks');
    tie.append(saveTie);
    await click(saveTie);
    expect(getState().doc.lines.some((line) => line.role === 'cross' && line.runId)).toBe(true);

    const added = workflowAddPoint(getState().doc, {
      thumbnailDataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      width: 200,
      height: 150,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    gardenCloudUiForTests.edit(added.doc);
    const photoId = added.doc.session.selectedPhotoId ?? '';
    const now = new Date().toISOString();
    applyPhotoUploadStatus({
      photoId,
      status: 'verified',
      fileName: 'library.jpg',
      size: 12,
      quickXorHash: 'hash',
      contentType: 'image/jpeg',
      receivedAt: now,
      capturedAt: now,
      calibrationKey: 'Apple|iPhone|back camera|6.9|27|200x150',
      nativeCapture: {
        source: 'library',
        deviceType: 'iPhone',
        videoZoomFactor: 1,
        lensPosition: null,
        focusLocked: true,
        exposureLocked: true,
        geometricDistortionCorrectionSupported: null,
        geometricDistortionCorrectionEnabled: null,
        contentAwareDistortionCorrectionSupported: null,
        contentAwareDistortionCorrectionEnabled: null,
        photoQualityPrioritization: null,
        autoRedEyeReductionEnabled: null,
        stabilization: null,
        focalLengthMm: 6.9,
        focalLength35mm: 27,
        lensModel: 'iPhone back camera',
        intrinsicMatrix: null,
        intrinsicReferenceWidth: null,
        intrinsicReferenceHeight: null,
        motionInterpolated: false,
        gravity: { x: 0, y: 1, z: 0 },
        width: 200,
        height: 150,
        requestedWidth: null,
        requestedHeight: null,
        orientation: 1,
      },
    });
    const uploaded = getState().doc.photos.find((photo) => photo.id === photoId);
    expect(uploaded?.fxOverWidth).toBeCloseTo(27 / 36, 5);
    expect(uploaded?.runId).toBe(readProgress(getState().doc).runs['house-traverse']?.startedAt);

    const open = button('open-photo-mark', { 'data-photo-id': photoId });
    await click(open);
    await Promise.resolve();
    const frame = document.createElement('div');
    frame.setAttribute('data-mark-canvas', '1');
    const img = document.createElement('img');
    img.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 150, width: 200, height: 150, toJSON() { return {}; },
    });
    frame.append(img);
    const canvas = button('photo-mark-canvas');
    frame.append(canvas);
    document.body.append(frame);
    await click(canvas, { clientX: 30, clientY: 70 });
    await click(canvas, { clientX: 160, clientY: 70 });
    await click(canvas, { clientX: 100, clientY: 40 });
    await click(button('photo-mark-confirm'));

    const marked = getState().doc.photos.find((photo) => photo.id === photoId);
    const ids = marked?.clicks.map((click) => click.pointId) ?? [];
    expect(ids).toEqual(expect.arrayContaining(['HSE01', 'HSE02', 'HSE03']));
    await click(button('workflow-next'));
    const view = walkView(getState().doc);
    expect(view.status?.line).not.toBe('The leg is not settled.');
    expect(view.status?.line === GOOD_LEG || view.status?.blocked === true).toBe(true);
    expect(view.status?.headline).toMatch(/95%/);
  });
});
