import { describe, expect, it } from 'vitest';
import { readSurveyExif } from '../src/photoExif';
import { inspectOriginalFile } from '../src/photoOriginal';
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
      capturedAt: '2026-10-02T23:26:00.123Z',
    });
    expect(draft.size).toBe(file.size);
    expect(draft.fileName).toBe('P01-ABCD_20261002T232600123Z.heic');
    expect(draft.blob).toBe(file);
    const stored = new Uint8Array(await draft.blob.arrayBuffer());
    expect([...stored]).toEqual([...containers.jpeg]);
    expect(draft.exif.DateTimeOriginal).toBe(SAMPLE_EXIF.DateTimeOriginal);
    expect(draft.quickXorHash.length).toBeGreaterThan(10);
  });
});
