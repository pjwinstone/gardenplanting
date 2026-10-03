/**
 * EXIF fields the survey keeps on the photos manifest.
 * Read with exifr's lite build (JPEG, HEIC, and maker notes). The lite
 * `pick` option throws, so the whole EXIF block is read and then trimmed.
 * Tag names follow the EXIF spec;
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
  /**
   * Tag 0x0003. `scale` is the plist `timescale` (often 1e9).
   * `raw` is set when the value is a binary plist we could not read.
   */
  RunTime?: {
    flags?: number;
    value?: number | string;
    scale?: number;
    epoch?: number;
    raw?: string;
  };
  /** Tag 0x002e. Tag 0x0030 is HDRGain and is not used. */
  CameraType?: number;
}

export async function readSurveyExif(input: Blob | Uint8Array | ArrayBuffer): Promise<SurveyExif> {
  let parsed: Record<string, unknown> | undefined;
  try {
    const exifr = await import('exifr/dist/lite.esm.mjs');
    parsed = (await exifr.parse(input, {
      reviveValues: false,
      translateValues: false,
      mergeOutput: true,
      iptc: false,
      xmp: false,
      icc: false,
      gps: false,
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
 * Maker-note bytes from exifr (lite build: JPEG, HEIC, and makerNote).
 * The bytes start at the Apple header when the file has one.
 */
export async function readMakerNoteBytes(
  input: Blob | Uint8Array | ArrayBuffer,
): Promise<Uint8Array | undefined> {
  try {
    const exifr = await import('exifr/dist/lite.esm.mjs');
    const parsed = (await exifr.parse(input, {
      makerNote: true,
      mergeOutput: true,
      reviveValues: false,
      translateValues: false,
      iptc: false,
      xmp: false,
      icc: false,
      gps: false,
    })) as { makerNote?: unknown } | undefined;
    return asBytes(parsed?.makerNote);
  } catch {
    return undefined;
  }
}

/**
 * Apple iOS maker note, ExifTool layout:
 * `Apple iOS\\0`, then `00 01`, then `MM` (or `II`).
 * The IFD starts at header+14. There is no 42 marker.
 * Value offsets are relative to the start of the maker note, not to `MM`.
 * RunTime (0x0003) is a binary plist. CameraType is 0x002e (0x0030 is HDRGain).
 */
export function readAppleMakerNote(bytes: Uint8Array): AppleMakerNote | undefined {
  const at = indexOfBytes(bytes, APPLE_IOS);
  if (at < 0 || at + 16 > bytes.length) return undefined;
  const le = bytes[at + 12] === 0x49 && bytes[at + 13] === 0x49;
  const be = bytes[at + 12] === 0x4d && bytes[at + 13] === 0x4d;
  if (!le && !be) return undefined;
  const ifdAt = at + 14;
  const count = u16(bytes, ifdAt, le);
  if (count === 0 || count > 256 || ifdAt + 2 + count * 12 > bytes.length) return undefined;

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
    const dataAt = total <= 4 ? inline : at + u32(bytes, inline, le);
    if (dataAt < 0 || dataAt + total > bytes.length) continue;

    if (tag === 0x0008 && type === 10 && n >= 3) {
      const x = srational(bytes, dataAt, le);
      const y = srational(bytes, dataAt + 8, le);
      const z = srational(bytes, dataAt + 16, le);
      if (x != null && y != null && z != null) out.AccelerationVector = [x, y, z];
    } else if (tag === 0x0003) {
      const runtime = parseRunTime(bytes.subarray(dataAt, dataAt + total));
      if (runtime) out.RunTime = runtime;
    } else if (tag === 0x002e) {
      const camera = readUnsigned(bytes, dataAt, type, le);
      if (camera != null) out.CameraType = camera;
    }
  }
  if (!out.AccelerationVector && !out.RunTime && out.CameraType == null) return undefined;
  return out;
}

function parseRunTime(bytes: Uint8Array): AppleMakerNote['RunTime'] | undefined {
  if (bytes.length >= 8 && new TextDecoder().decode(bytes.subarray(0, 8)) === 'bplist00') {
    const parsed = parseBinaryPlist(bytes);
    if (parsed && typeof parsed === 'object') {
      const rec = parsed as Record<string, unknown>;
      const flags = asPlistInt(rec.flags);
      const value = asPlistIntOrString(rec.value);
      const scale = asPlistInt(rec.timescale);
      const epoch = asPlistInt(rec.epoch);
      if (flags != null || value != null || scale != null || epoch != null) {
        return {
          flags: flags ?? undefined,
          value: value ?? undefined,
          scale: scale ?? undefined,
          epoch: epoch ?? undefined,
        };
      }
    }
  }
  return { raw: bytesToBase64(bytes) };
}

function asPlistInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

function asPlistIntOrString(value: unknown): number | string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) return value;
  return undefined;
}

/** Small binary-plist reader for the Apple RunTime dict (strings, ints, one dict). */
function parseBinaryPlist(bytes: Uint8Array): unknown {
  if (bytes.length < 40) return undefined;
  const trailer = bytes.length - 32;
  const offsetSize = bytes[trailer + 6] ?? 0;
  const refSize = bytes[trailer + 7] ?? 0;
  const numObjects = readBE(bytes, trailer + 8, 8);
  const top = readBE(bytes, trailer + 16, 8);
  const table = readBE(bytes, trailer + 24, 8);
  if (
    typeof numObjects !== 'number' ||
    typeof top !== 'number' ||
    typeof table !== 'number' ||
    numObjects < 1 ||
    numObjects > 64 ||
    offsetSize < 1 ||
    offsetSize > 4 ||
    refSize < 1 ||
    refSize > 2
  ) {
    return undefined;
  }
  const offsets: number[] = [];
  for (let i = 0; i < numObjects; i++) {
    const off = readBE(bytes, table + i * offsetSize, offsetSize);
    if (typeof off !== 'number') return undefined;
    offsets.push(off);
  }
  const readRef = (at: number): number | undefined => {
    const n = readBE(bytes, at, refSize);
    return typeof n === 'number' ? n : undefined;
  };
  const readObj = (index: number): unknown => {
    const at = offsets[index];
    if (at == null || at >= bytes.length) return undefined;
    const marker = bytes[at]!;
    const kind = marker >> 4;
    const info = marker & 0x0f;
    if (kind === 0x1) {
      const len = 1 << info;
      return readBE(bytes, at + 1, len);
    }
    if (kind === 0x5) {
      const len = info === 0x0f ? undefined : info;
      if (len == null) return undefined;
      return new TextDecoder().decode(bytes.subarray(at + 1, at + 1 + len));
    }
    if (kind === 0x0d) {
      const n = info;
      if (n === 0x0f) return undefined;
      let p = at + 1;
      const keys: unknown[] = [];
      const vals: unknown[] = [];
      for (let i = 0; i < n; i++) {
        const ref = readRef(p);
        p += refSize;
        keys.push(ref == null ? undefined : readObj(ref));
      }
      for (let i = 0; i < n; i++) {
        const ref = readRef(p);
        p += refSize;
        vals.push(ref == null ? undefined : readObj(ref));
      }
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) obj[String(keys[i])] = vals[i];
      return obj;
    }
    return undefined;
  };
  return readObj(top);
}

function readBE(bytes: Uint8Array, at: number, len: number): number | string | undefined {
  if (len <= 0 || at < 0 || at + len > bytes.length) return undefined;
  if (len > 8) return undefined;
  let hex = '';
  let n = 0;
  for (let i = 0; i < len; i++) {
    const b = bytes[at + i]!;
    n = n * 256 + b;
    hex += b.toString(16).padStart(2, '0');
  }
  if (n > Number.MAX_SAFE_INTEGER) return hex.replace(/^0+/, '') || '0';
  return n;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function asBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return undefined;
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
