/**
 * EXIF fields the survey keeps on the photos manifest.
 * Read with exifr (JPEG and HEIC). Tag names follow the EXIF spec;
 * exifr's aliases (ExifImageWidth, FocalLengthIn35mmFormat) are mapped here.
 *
 * iOS file-input facts (WebKit WKFileUploadPanel, main 7fc2aaf), for anyone
 * reading a photo that has no lens tags:
 * Take Photo uses UIImagePickerControllerOriginalImage, then
 * UIImageJPEGRepresentation(image, 0.8) named image.jpg. That drops Make,
 * Model, LensModel, FocalLength, DateTimeOriginal, GPS and the MakerNote.
 * Library uses PHPicker Compatible mode (a converted JPEG) unless the internal
 * PhotoPickerPrefersOriginalImageFormat preference is set, and it defaults to
 * false. Actual Size is offered because the panel calls _setAllowsDownscaling:YES.
 * WebKit bug 207088 comments 24–25 (iOS 16.4+) say EXIF is kept, location is
 * stripped and HEIC becomes JPG. That is a user report only.
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

/** Apple maker-note fields we can read. Omitted when the note is absent or opaque. */
export interface AppleMakerNote {
  AccelerationVector?: [number, number, number];
  RunTime?: { flags: number; value: number; scale: number; epoch: number };
  CameraType?: number;
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

/**
 * ISO-8601 capture time from DateTimeOriginal, plus SubSec and OffsetTime when present.
 * No offset is left as local wall time — a missing offset is not rewritten as Z.
 */
export function exifCapturedAtIso(exif: SurveyExif): string | undefined {
  const dto = exif.DateTimeOriginal;
  if (!dto) return undefined;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(dto);
  if (!m) return undefined;
  const sub = (exif.SubSecTimeOriginal ?? '').replace(/\D/g, '').slice(0, 3);
  const frac = sub ? `.${sub}` : '';
  const offset = normalizeOffset(exif.OffsetTimeOriginal || exif.OffsetTime);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${frac}${offset}`;
}

function normalizeOffset(raw: string | undefined): string {
  if (!raw) return '';
  const compact = /^([+-])(\d{2})(\d{2})$/.exec(raw.trim());
  if (compact) return `${compact[1]}${compact[2]}:${compact[3]}`;
  if (/^[+-]\d{2}:\d{2}$/.test(raw.trim())) return raw.trim();
  return '';
}

const APPLE_IOS = [0x41, 0x70, 0x70, 0x6c, 0x65, 0x20, 0x69, 0x4f, 0x53, 0x00];

/**
 * Apple iOS maker note, where the "Apple iOS" header and a TIFF IFD are readable.
 * Tags: AccelerationVector 0x0008, RunTime 0x0003, CameraType 0x0030.
 */
export function readAppleMakerNote(bytes: Uint8Array): AppleMakerNote | undefined {
  const at = indexOfBytes(bytes, APPLE_IOS);
  if (at < 0) return undefined;
  const tiff = at + APPLE_IOS.length;
  if (tiff + 8 > bytes.length) return undefined;
  const le = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const be = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!le && !be) return undefined;
  if (u16(bytes, tiff + 2, le) !== 42) return undefined;
  const ifdAt = tiff + u32(bytes, tiff + 4, le);
  if (ifdAt < tiff || ifdAt + 2 > bytes.length) return undefined;
  const count = u16(bytes, ifdAt, le);
  if (count > 256 || ifdAt + 2 + count * 12 > bytes.length) return undefined;

  const out: AppleMakerNote = {};
  for (let i = 0; i < count; i++) {
    const entry = ifdAt + 2 + i * 12;
    const tag = u16(bytes, entry, le);
    const type = u16(bytes, entry + 2, le);
    const n = u32(bytes, entry + 4, le);
    const inline = entry + 8;
    const size = tiffTypeSize(type);
    if (!size || n === 0 || n > 1_000_000) continue;
    const total = size * n;
    const dataAt = total <= 4 ? inline : tiff + u32(bytes, inline, le);
    if (dataAt < 0 || dataAt + total > bytes.length) continue;

    if (tag === 0x0008 && type === 10 && n >= 3) {
      const x = srational(bytes, dataAt, le);
      const y = srational(bytes, dataAt + 8, le);
      const z = srational(bytes, dataAt + 16, le);
      if (x != null && y != null && z != null) out.AccelerationVector = [x, y, z];
    } else if (tag === 0x0003 && total >= 20) {
      const flags = u32(bytes, dataAt, le);
      const value = u64(bytes, dataAt + 4, le);
      const scale = i32(bytes, dataAt + 12, le);
      const epoch = i32(bytes, dataAt + 16, le);
      if (Number.isFinite(value)) out.RunTime = { flags, value, scale, epoch };
    } else if (tag === 0x0030) {
      const camera = readUnsigned(bytes, dataAt, type, le);
      if (camera != null) out.CameraType = camera;
    }
  }
  if (!out.AccelerationVector && !out.RunTime && out.CameraType == null) return undefined;
  return out;
}

function tiffTypeSize(type: number): number {
  switch (type) {
    case 1:
    case 2:
    case 6:
    case 7:
      return 1;
    case 3:
    case 8:
      return 2;
    case 4:
    case 9:
      return 4;
    case 5:
    case 10:
      return 8;
    default:
      return 0;
  }
}

function readUnsigned(bytes: Uint8Array, at: number, type: number, le: boolean): number | undefined {
  if (type === 1 || type === 7) return bytes[at];
  if (type === 3) return u16(bytes, at, le);
  if (type === 4) return u32(bytes, at, le);
  return undefined;
}

function srational(bytes: Uint8Array, at: number, le: boolean): number | null {
  const n = i32(bytes, at, le);
  const d = i32(bytes, at + 4, le);
  if (d === 0) return null;
  return n / d;
}

function u16(bytes: Uint8Array, at: number, le: boolean): number {
  if (at + 2 > bytes.length) return 0;
  return le ? bytes[at]! | (bytes[at + 1]! << 8) : (bytes[at]! << 8) | bytes[at + 1]!;
}

function u32(bytes: Uint8Array, at: number, le: boolean): number {
  if (at + 4 > bytes.length) return 0;
  if (le) {
    return (
      (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0
    );
  }
  return (
    ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0
  );
}

function i32(bytes: Uint8Array, at: number, le: boolean): number {
  const u = u32(bytes, at, le);
  return u > 0x7fffffff ? u - 0x100000000 : u;
}

function u64(bytes: Uint8Array, at: number, le: boolean): number {
  const lo = u32(bytes, le ? at : at + 4, le);
  const hi = u32(bytes, le ? at + 4 : at, le);
  return hi * 2 ** 32 + lo;
}

function indexOfBytes(hay: Uint8Array, needle: number[]): number {
  if (needle.length === 0 || hay.length < needle.length) return -1;
  const last = hay.length - needle.length;
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
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
