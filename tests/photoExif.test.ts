import { describe, expect, it } from 'vitest';
import { exifCapturedAtIso, readAppleMakerNote, readSurveyExif } from '../src/photoExif';
import {
  calibrationKeyFor,
  dngRejectionMessage,
  inferPhotoProvenance,
  inspectOriginalFile,
  previewPixelToFull,
  suffixedPhotoFileName,
} from '../src/photoOriginal';
import { SAMPLE_EXIF, buildSurveyExifContainers } from './fixtures/buildSurveyExif';

const containers = buildSurveyExifContainers();

describe('survey EXIF', () => {
  it('reads the sample JPEG', async () => {
    const exif = await readSurveyExif(containers.jpeg);
    expect(exif).toMatchObject({
      Make: SAMPLE_EXIF.Make,
      Model: SAMPLE_EXIF.Model,
      Orientation: SAMPLE_EXIF.Orientation,
      DateTimeOriginal: SAMPLE_EXIF.DateTimeOriginal,
      OffsetTime: SAMPLE_EXIF.OffsetTime,
      OffsetTimeOriginal: SAMPLE_EXIF.OffsetTimeOriginal,
      SubSecTimeOriginal: SAMPLE_EXIF.SubSecTimeOriginal,
      FocalLengthIn35mmFilm: SAMPLE_EXIF.FocalLengthIn35mmFilm,
      PixelXDimension: SAMPLE_EXIF.PixelXDimension,
      PixelYDimension: SAMPLE_EXIF.PixelYDimension,
      LensModel: SAMPLE_EXIF.LensModel,
    });
    expect(exif.FocalLength).toBeCloseTo(SAMPLE_EXIF.FocalLengthN / SAMPLE_EXIF.FocalLengthD, 5);
  });

  it('reads the same fields from a synthetic HEIC', async () => {
    const exif = await readSurveyExif(containers.heic);
    expect(exif.Make).toBe(SAMPLE_EXIF.Make);
    expect(exif.Model).toBe(SAMPLE_EXIF.Model);
    expect(exif.DateTimeOriginal).toBe(SAMPLE_EXIF.DateTimeOriginal);
    expect(exif.SubSecTimeOriginal).toBe(SAMPLE_EXIF.SubSecTimeOriginal);
    expect(exif.OffsetTimeOriginal).toBe(SAMPLE_EXIF.OffsetTimeOriginal);
    expect(exif.PixelXDimension).toBe(SAMPLE_EXIF.PixelXDimension);
    expect(exif.PixelYDimension).toBe(SAMPLE_EXIF.PixelYDimension);
    expect(exif.Orientation).toBe(SAMPLE_EXIF.Orientation);
    expect(exif.LensModel).toBe(SAMPLE_EXIF.LensModel);
    expect(exif.FocalLengthIn35mmFilm).toBe(SAMPLE_EXIF.FocalLengthIn35mmFilm);
  });

  it('keeps the original bytes when describing a file', async () => {
    const file = new File([containers.jpeg], 'IMG_0001.HEIC', { type: 'image/heic' });
    const draft = await inspectOriginalFile(file, {
      name: file.name,
      type: file.type,
      photoId: 'ph-1',
      stationId: 'P01-ABCD',
      receivedAt: '2026-10-02T23:26:00.123Z',
      sessionStartedAt: '2026-10-02T22:00:00.000Z',
      sessionEndedAt: '2026-10-02T22:10:00.000Z',
    });
    expect(draft.size).toBe(file.size);
    expect(draft.fileName).toBe('P01-ABCD_20261002T232600123Z.heic');
    expect(draft.blob).toBe(file);
    const stored = new Uint8Array(await draft.blob.arrayBuffer());
    expect([...stored]).toEqual([...containers.jpeg]);
    expect(draft.exif.DateTimeOriginal).toBe(SAMPLE_EXIF.DateTimeOriginal);
    expect(draft.receivedAt).toBe('2026-10-02T23:26:00.123Z');
    expect(draft.capturedAt).toBe('2026-10-02T23:26:00.123+01:00');
    expect(draft.provenance).toBe('library');
    expect(draft.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(draft.calibrationKey).toBe(calibrationKeyFor(draft.exif));
    expect(draft.calibrationKey).toContain('Apple|iPhone14|Back wide|');
    expect(draft.quickXorHash.length).toBeGreaterThan(10);
    expect(draft.usabilityNote).toMatch(/Not usable for timing/);
    expect(draft.usabilityNote ?? '').not.toMatch(/focal length/);
  });

  it('marks image.jpg with no Make as camera-path and keeps a library pick that still has Make', async () => {
    const bare = new File([new Uint8Array([1, 2, 3, 4])], 'image.jpg', { type: 'image/jpeg' });
    const cameraPath = await inspectOriginalFile(bare, {
      name: bare.name,
      type: bare.type,
      photoId: 'ph-cam',
      stationId: 'P01',
      receivedAt: '2026-10-02T23:26:00.123Z',
    });
    expect(cameraPath.provenance).toBe('camera-path');
    expect(cameraPath.capturedAt).toBeUndefined();
    expect(cameraPath.usabilityNote).toMatch(/focal length/);
    expect(cameraPath.usabilityNote).toMatch(/timing/);
    expect(inferPhotoProvenance('image.jpg', { Make: 'Apple' })).toBe('library');
    expect(exifCapturedAtIso(cameraPath.exif)).toBeUndefined();
  });

  it('rejects DNG/ProRAW and leaves a JPEG that merely contains TIFF-looking bytes', async () => {
    const dng = new Uint8Array([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0xc6, 0x01, 0x00, 0x04, 0x00,
      0x00, 0x00, 0x01, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(dngRejectionMessage(dng, 'IMG_1.dng', 'image/dng')).toMatch(/DNG\/ProRAW/);
    const file = new File([dng], 'IMG_1.DNG', { type: 'image/x-adobe-dng' });
    await expect(
      inspectOriginalFile(file, { name: file.name, type: file.type, photoId: 'ph-dng', stationId: 'P01' }),
    ).rejects.toThrow(/DNG\/ProRAW/);
    const jpeg = new Uint8Array([0xff, 0xd8, 0x49, 0x49, 0x2a, 0x00, 0x12, 0xc6]);
    expect(dngRejectionMessage(jpeg, 'IMG_1.jpg', 'image/jpeg')).toBeNull();
  });

  it('reads Apple maker-note AccelerationVector, RunTime and CameraType when the header is present', () => {
    const note = appleMakerNote();
    expect(readAppleMakerNote(note)).toEqual({
      AccelerationVector: [0.5, -0.25, 1],
      RunTime: { flags: 1, value: 1000, scale: 1_000_000_000, epoch: 0 },
      CameraType: 1,
    });
    expect(readAppleMakerNote(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });

  it('maps preview clicks back to full pixels with the +0.5 centre', () => {
    expect(previewPixelToFull(0, 0.5)).toBeCloseTo(0.5);
    expect(previewPixelToFull(10, 0.5)).toBeCloseTo(20.5);
    expect(suffixedPhotoFileName('P01_20261002T232600123Z.jpg')).toBe('P01_20261002T232600123Z-2.jpg');
    expect(suffixedPhotoFileName('P01_20261002T232600123Z-4.jpg')).toBeNull();
  });
});

function appleMakerNote(): Uint8Array {
  const head = [0x41, 0x70, 0x70, 0x6c, 0x65, 0x20, 0x69, 0x4f, 0x53, 0x00];
  const tiff = 10;
  const runtimeAt = 80;
  const accelAt = 104;
  const bytes = new Uint8Array(140);
  bytes.set(head, 0);
  bytes[tiff] = 0x49;
  bytes[tiff + 1] = 0x49;
  bytes[tiff + 2] = 42;
  bytes[tiff + 4] = 8;
  const ifd = tiff + 8;
  bytes[ifd] = 3;
  writeEntry(bytes, ifd + 2, 0x0003, 7, 20, runtimeAt);
  writeEntry(bytes, ifd + 14, 0x0008, 10, 3, accelAt);
  writeEntry(bytes, ifd + 26, 0x0030, 3, 1, 1);
  writeU32(bytes, tiff + runtimeAt, 1);
  writeU32(bytes, tiff + runtimeAt + 4, 1000);
  writeU32(bytes, tiff + runtimeAt + 12, 1_000_000_000);
  writeI32(bytes, tiff + accelAt, 1);
  writeI32(bytes, tiff + accelAt + 4, 2);
  writeI32(bytes, tiff + accelAt + 8, -1);
  writeI32(bytes, tiff + accelAt + 12, 4);
  writeI32(bytes, tiff + accelAt + 16, 1);
  writeI32(bytes, tiff + accelAt + 20, 1);
  return bytes;
}

function writeEntry(bytes: Uint8Array, at: number, tag: number, type: number, count: number, value: number): void {
  bytes[at] = tag & 0xff;
  bytes[at + 1] = (tag >> 8) & 0xff;
  bytes[at + 2] = type & 0xff;
  bytes[at + 3] = (type >> 8) & 0xff;
  writeU32(bytes, at + 4, count);
  writeU32(bytes, at + 8, value);
}

function writeU32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
  bytes[at + 2] = (value >>> 16) & 0xff;
  bytes[at + 3] = (value >>> 24) & 0xff;
}

function writeI32(bytes: Uint8Array, at: number, value: number): void {
  writeU32(bytes, at, value < 0 ? value + 0x100000000 : value);
}
