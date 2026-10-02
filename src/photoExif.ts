/**
 * EXIF fields the survey keeps on the photos manifest.
 * Read with exifr (JPEG and HEIC). Tag names follow the EXIF spec;
 * exifr's aliases (ExifImageWidth, FocalLengthIn35mmFormat) are mapped here.
 */

export interface SurveyExif {
  FocalLength?: number;
  FocalLengthIn35mmFilm?: number;
  LensModel?: string;
  Make?: string;
  Model?: string;
  DateTimeOriginal?: string;
  SubSecTimeOriginal?: string;
  OffsetTimeOriginal?: string;
  OffsetTime?: string;
  PixelXDimension?: number;
  PixelYDimension?: number;
  Orientation?: number;
}

const PICK = [
  'FocalLength',
  'FocalLengthIn35mmFilm',
  'FocalLengthIn35mmFormat',
  'LensModel',
  'Make',
  'Model',
  'DateTimeOriginal',
  'SubSecTimeOriginal',
  'OffsetTimeOriginal',
  'OffsetTime',
  'PixelXDimension',
  'PixelYDimension',
  'ExifImageWidth',
  'ExifImageHeight',
  'Orientation',
];

export async function readSurveyExif(input: Blob | Uint8Array | ArrayBuffer): Promise<SurveyExif> {
  let parsed: Record<string, unknown> | undefined;
  try {
    const exifr = await import('exifr');
    parsed = (await exifr.parse(input, {
      reviveValues: false,
      translateValues: false,
      mergeOutput: true,
      iptc: false,
      xmp: false,
      icc: false,
      gps: false,
      pick: PICK,
    })) as Record<string, unknown> | undefined;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  return normalizeSurveyExif(parsed);
}

export function normalizeSurveyExif(raw: Record<string, unknown>): SurveyExif {
  const out: SurveyExif = {};
  const focal = asNumber(raw.FocalLength);
  if (focal != null) out.FocalLength = focal;
  const film = asNumber(raw.FocalLengthIn35mmFilm ?? raw.FocalLengthIn35mmFormat);
  if (film != null) out.FocalLengthIn35mmFilm = film;
  const lens = asString(raw.LensModel);
  if (lens) out.LensModel = lens;
  const make = asString(raw.Make);
  if (make) out.Make = make;
  const model = asString(raw.Model);
  if (model) out.Model = model;
  const dto = asDateTime(raw.DateTimeOriginal);
  if (dto) out.DateTimeOriginal = dto;
  const sub = asString(raw.SubSecTimeOriginal);
  if (sub) out.SubSecTimeOriginal = sub;
  const offOrig = asString(raw.OffsetTimeOriginal);
  if (offOrig) out.OffsetTimeOriginal = offOrig;
  const off = asString(raw.OffsetTime);
  if (off) out.OffsetTime = off;
  const px = asNumber(raw.PixelXDimension ?? raw.ExifImageWidth);
  if (px != null) out.PixelXDimension = px;
  const py = asNumber(raw.PixelYDimension ?? raw.ExifImageHeight);
  if (py != null) out.PixelYDimension = py;
  const orientation = asNumber(raw.Orientation);
  if (orientation != null) out.Orientation = orientation;
  return out;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.replace(/\u0000/g, '').trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asDateTime(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}:${pad(value.getMonth() + 1)}:${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  return asString(value);
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === 'object') {
    const rec = value as { numerator?: unknown; denominator?: unknown };
    const n = asNumber(rec.numerator);
    const d = asNumber(rec.denominator);
    if (n != null && d != null && d !== 0) return n / d;
  }
  if (Array.isArray(value) && value.length >= 2) {
    const n = asNumber(value[0]);
    const d = asNumber(value[1]);
    if (n != null && d != null && d !== 0) return n / d;
  }
  return undefined;
}
