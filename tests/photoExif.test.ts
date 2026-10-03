import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exifCapturedAtIso, readAppleMakerNote, readMakerNoteBytes, readSurveyExif } from '../src/photoExif';
import { emptyDocument, normalizeDocument } from '../src/model';
import {
  calibrationKeyFor,
  dngRejectionMessage,
  inferPhotoProvenance,
  inspectOriginalFile,
  migratePreviewPixels,
  type LegacyPreviewPixels,
  photoUsabilityNote,
  previewPixelToFull,
  previewPixelToFullCentre,
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
    expect(draft.calibrationKey).toBe('Apple|iPhone14|Back wide|5.2|26|4032x3024');
    expect(draft.calibrationKey).toBe(calibrationKeyFor(draft.exif));
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
    expect(inferPhotoProvenance('note.png', {})).toBe('unknown');
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

  it('reads Apple maker-note AccelerationVector and CameraType 0x002e', () => {
    const note = appleMakerNote();
    expect(readAppleMakerNote(note)).toEqual({
      AccelerationVector: [0.5, -0.25, 1],
      CameraType: 1,
    });
    expect(readAppleMakerNote(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
  });

  it('parses a real iPhone 7 maker note from ExifTool’s Apple.jpg', async () => {
    // Source, commit, © Phil Harvey, and licence: tests/fixtures/README.md.
    // Independent parser check. Test data only, not a personal photo.
    const file = readFileSync(new URL('./fixtures/exiftool-apple-iphone7.jpg', import.meta.url));
    const note = await readMakerNoteBytes(file);
    expect(note?.[0]).toBe(0x41);
    const parsed = readAppleMakerNote(note ?? new Uint8Array());
    expect(parsed?.AccelerationVector?.[0]).toBeCloseTo(-0.6483164083377873, 6);
    expect(parsed?.AccelerationVector?.[1]).toBeCloseTo(0.0022641190037876384, 6);
    expect(parsed?.AccelerationVector?.[2]).toBeCloseTo(-0.750076757752533, 6);
    expect(parsed?.RunTime).toEqual({
      flags: 1,
      value: 39772089846958,
      scale: 1_000_000_000,
      epoch: 0,
    });
    expect(parsed?.CameraType).toBeUndefined();
    const exif = await readSurveyExif(file);
    expect(exif.FocalLengthIn35mmFilm).toBe(28);
    expect(calibrationKeyFor(exif)).toBe('Apple|iPhone 7|iPhone 7 back camera 3.99mm f/1.8|3.99|28|4032x3024');
    expect(
      photoUsabilityNote({
        exif,
        capturedAt: '2016-01-01T00:00:00Z',
        sessionStartedAt: '2016-01-01T00:00:00Z',
        now: '2016-01-01T00:00:00Z',
      }),
    ).toMatch(/not 1×/);
  });

  it('maps a preview-edge click with full = p / scale', () => {
    const scale = 640 / 4032;
    expect(previewPixelToFull(10, scale)).toBeCloseTo(10 / scale);
    expect(previewPixelToFullCentre(10, scale)).toBeCloseTo(10 / scale - 0.5);
    expect(
      photoUsabilityNote({
        exif: {
          LensModel: 'iPhone 14 front camera 2.71mm f/1.9',
          FocalLength: 2.71,
          FocalLengthIn35mmFilm: 23,
        },
        capturedAt: '2026-10-02T12:00:00.000Z',
        sessionStartedAt: '2026-10-02T12:00:00.000Z',
        now: '2026-10-02T12:00:00.000Z',
      }),
    ).toMatch(/not 1×/);
    expect(
      photoUsabilityNote({
        exif: { LensModel: 'iPhone 14 back camera', FocalLength: 5.7, FocalLengthIn35mmFilm: 26 },
        capturedAt: '2026-10-02T12:00:00.000Z',
        sessionStartedAt: '2026-10-02T12:00:00.000Z',
        now: '2026-10-02T12:00:00.000Z',
      }),
    ).toBeUndefined();
    const oldCentre = (10 + 0.5) / scale - 0.5;
    expect(oldCentre - previewPixelToFullCentre(10, scale)).toBeCloseTo(0.5 / scale, 5);
    expect(suffixedPhotoFileName('P01_20261002T232600123Z.jpg')).toBe('P01_20261002T232600123Z-2.jpg');
    expect(suffixedPhotoFileName('P01_20261002T232600123Z-4.jpg')).toBeNull();
  });

  it('relabels a 7a4e268 +0.5 row and leaves the stored click where it was', () => {
    const scale = 640 / 4032;
    const legacy: LegacyPreviewPixels = {
      fullWidth: 4032,
      fullHeight: 3024,
      previewWidth: 640,
      previewHeight: 480,
      previewScale: scale,
      pixelCentre: '+0.5',
    };
    const migrated = migratePreviewPixels(legacy);
    expect(migrated?.clickMap).toBe('p/scale');
    expect(migrated?.clickMapMigratedFrom).toBe('+0.5');
    expect(migrated?.pixelCentre).toBeUndefined();
    expect(migrated?.previewScaleX).toBeCloseTo(scale);
    expect(migrated?.previewScaleY).toBeCloseTo(scale);
    const doc = normalizeDocument({
      ...emptyDocument(),
      photos: [
        {
          id: 'ph-old',
          setupId: 'setup-1',
          width: 640,
          height: 480,
          clicks: [{ pointId: 'A', px: 10, py: 4 }],
          originalFile: {
            fileName: 'old.jpg',
            size: 12,
            quickXorHash: 'h',
            previewScale: scale,
            pixelCentre: '+0.5',
          },
        },
      ],
    });
    expect(doc.photos[0]?.clicks[0]?.px).toBe(10);
    expect(doc.photos[0]?.originalFile?.clickMap).toBe('p/scale');
    expect(previewPixelToFull(10, scale)).toBeCloseTo(10 / scale);
    expect(previewPixelToFull(10, scale)).not.toBeCloseTo((10 + 0.5) / scale - 0.5);
  });
});

/** ExifTool layout: Apple iOS\\0, 00 01, MM, IFD at +14, offsets from byte 0. */
function appleMakerNote(): Uint8Array {
  const bytes = new Uint8Array(80);
  bytes.set([0x41, 0x70, 0x70, 0x6c, 0x65, 0x20, 0x69, 0x4f, 0x53, 0x00], 0);
  bytes[11] = 0x01;
  bytes[12] = 0x4d;
  bytes[13] = 0x4d;
  writeU16be(bytes, 14, 3);
  const accelOff = 52;
  writeEntryBe(bytes, 16, 0x0008, 10, 3, accelOff);
  writeEntryBe(bytes, 28, 0x002e, 3, 1, 0x00010000);
  writeEntryBe(bytes, 40, 0x0030, 3, 1, 0x00090000);
  writeI32be(bytes, accelOff, 1);
  writeI32be(bytes, accelOff + 4, 2);
  writeI32be(bytes, accelOff + 8, -1);
  writeI32be(bytes, accelOff + 12, 4);
  writeI32be(bytes, accelOff + 16, 1);
  writeI32be(bytes, accelOff + 20, 1);
  return bytes;
}

function writeEntryBe(bytes: Uint8Array, at: number, tag: number, type: number, count: number, value: number): void {
  writeU16be(bytes, at, tag);
  writeU16be(bytes, at + 2, type);
  writeU32be(bytes, at + 4, count);
  writeU32be(bytes, at + 8, value);
}

function writeU16be(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = (value >>> 8) & 0xff;
  bytes[at + 1] = value & 0xff;
}

function writeU32be(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = (value >>> 24) & 0xff;
  bytes[at + 1] = (value >>> 16) & 0xff;
  bytes[at + 2] = (value >>> 8) & 0xff;
  bytes[at + 3] = value & 0xff;
}

function writeI32be(bytes: Uint8Array, at: number, value: number): void {
  writeU32be(bytes, at, value < 0 ? value + 0x100000000 : value);
}
