/**
 * Tiny synthetic JPEG + HEIC with the EXIF fields the survey manifest keeps.
 * Not a photograph — a hand-built TIFF so tests do not need anyone's pictures.
 */

export const SAMPLE_EXIF = {
  Make: 'Apple',
  Model: 'iPhone14',
  Orientation: 6,
  DateTimeOriginal: '2026:10:02 23:26:00',
  OffsetTime: '+01:00',
  OffsetTimeOriginal: '+01:00',
  SubSecTimeOriginal: '123',
  FocalLengthN: 26,
  FocalLengthD: 5,
  FocalLengthIn35mmFilm: 26,
  PixelXDimension: 4032,
  PixelYDimension: 3024,
  LensModel: 'Back wide',
} as const;

const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

interface Field {
  tag: number;
  type: number;
  count: number;
  /** Present when the value fits in 4 bytes (little-endian). */
  inline?: Uint8Array;
  external?: Uint8Array;
}

export function buildSurveyExifContainers(): { jpeg: Uint8Array; heic: Uint8Array } {
  const tiff = buildTiff();
  return { jpeg: wrapJpeg(tiff), heic: wrapHeic(tiff) };
}

function buildTiff(): Uint8Array {
  const ifd0: Field[] = [
    asciiField(0x010f, SAMPLE_EXIF.Make),
    asciiField(0x0110, SAMPLE_EXIF.Model),
    shortField(0x0112, SAMPLE_EXIF.Orientation),
    longField(0x8769, 0),
  ];
  const exif: Field[] = [
    asciiField(0x9003, SAMPLE_EXIF.DateTimeOriginal),
    asciiField(0x9010, SAMPLE_EXIF.OffsetTime),
    asciiField(0x9011, SAMPLE_EXIF.OffsetTimeOriginal),
    rationalField(0x920a, SAMPLE_EXIF.FocalLengthN, SAMPLE_EXIF.FocalLengthD),
    asciiField(0x9291, SAMPLE_EXIF.SubSecTimeOriginal),
    longField(0xa002, SAMPLE_EXIF.PixelXDimension),
    longField(0xa003, SAMPLE_EXIF.PixelYDimension),
    shortField(0xa405, SAMPLE_EXIF.FocalLengthIn35mmFilm),
    asciiField(0xa434, SAMPLE_EXIF.LensModel),
  ];

  const ifd0Start = 8;
  const ifd0Size = 2 + ifd0.length * 12 + 4;
  const exifStart = ifd0Start + ifd0Size;
  const exifSize = 2 + exif.length * 12 + 4;
  let dataAt = exifStart + exifSize;
  const externals: { field: Field; offset: number }[] = [];
  const claim = (fields: Field[]) => {
    for (const field of fields) {
      if (!field.external) continue;
      externals.push({ field, offset: dataAt });
      dataAt += field.external.length;
    }
  };
  // dataAt must start at the byte after both IFDs before claiming.
  claim(ifd0.filter((f) => f.tag !== 0x8769));
  claim(exif);

  const exifPointer = ifd0.find((f) => f.tag === 0x8769)!;
  exifPointer.inline = u32le(exifStart);

  const total = dataAt;
  const out = new Uint8Array(total);
  out[0] = 0x49;
  out[1] = 0x49;
  out[2] = 0x2a;
  out[3] = 0x00;
  writeU32(out, 4, ifd0Start);
  writeIfd(out, ifd0Start, ifd0, externals, 0);
  writeIfd(out, exifStart, exif, externals, 0);
  for (const item of externals) {
    out.set(item.field.external!, item.offset);
  }
  return out;
}

function writeIfd(
  out: Uint8Array,
  start: number,
  fields: Field[],
  externals: { field: Field; offset: number }[],
  next: number,
): void {
  writeU16(out, start, fields.length);
  let cursor = start + 2;
  for (const field of fields) {
    writeU16(out, cursor, field.tag);
    writeU16(out, cursor + 2, field.type);
    writeU32(out, cursor + 4, field.count);
    if (field.external) {
      const found = externals.find((item) => item.field === field);
      writeU32(out, cursor + 8, found?.offset ?? 0);
    } else {
      out.set(field.inline ?? new Uint8Array(4), cursor + 8);
    }
    cursor += 12;
  }
  writeU32(out, cursor, next);
}

function asciiField(tag: number, text: string): Field {
  const bytes = asciiZ(text);
  if (bytes.length <= 4) {
    const inline = new Uint8Array(4);
    inline.set(bytes);
    return { tag, type: TYPE_ASCII, count: bytes.length, inline };
  }
  return { tag, type: TYPE_ASCII, count: bytes.length, external: bytes };
}

function shortField(tag: number, value: number): Field {
  const inline = new Uint8Array(4);
  inline[0] = value & 0xff;
  inline[1] = (value >> 8) & 0xff;
  return { tag, type: TYPE_SHORT, count: 1, inline };
}

function longField(tag: number, value: number): Field {
  return { tag, type: TYPE_LONG, count: 1, inline: u32le(value) };
}

function rationalField(tag: number, numerator: number, denominator: number): Field {
  const external = new Uint8Array(8);
  external.set(u32le(numerator), 0);
  external.set(u32le(denominator), 4);
  return { tag, type: TYPE_RATIONAL, count: 1, external };
}

function wrapJpeg(tiff: Uint8Array): Uint8Array {
  const header = ascii('Exif\0\0');
  const payload = concat(header, tiff);
  const length = 2 + payload.length;
  return concat(
    new Uint8Array([0xff, 0xd8, 0xff, 0xe1]),
    u16be(length),
    payload,
    new Uint8Array([0xff, 0xd9]),
  );
}

function wrapHeic(tiff: Uint8Array): Uint8Array {
  const ftyp = box('ftyp', concat(ascii('heic'), u32be(0), ascii('heic'), ascii('mif1')));
  const exifPayload = concat(u32be(0), tiff);
  const infe = fullBox(
    'infe',
    2,
    0,
    concat(u16be(1), u16be(0), ascii('Exif'), new Uint8Array([0])),
  );
  const iinf = fullBox('iinf', 0, 0, concat(u16be(1), infe));
  const ilocBodyLen =
    2 + // size nibbles
    2 + // item count
    2 + // item id
    2 + // data ref
    2 + // extent count
    4 + // offset
    4; // length
  const iloc = fullBox('iloc', 0, 0, new Uint8Array(ilocBodyLen));
  const metaPayloadLen = 4 + iinf.length + iloc.length;
  const metaLen = 8 + metaPayloadLen;
  const exifOffset = ftyp.length + metaLen;
  const ilocFilled = fullBox(
    'iloc',
    0,
    0,
    concat(
      new Uint8Array([0x44, 0x00]),
      u16be(1),
      u16be(1),
      u16be(0),
      u16be(1),
      u32be(exifOffset),
      u32be(exifPayload.length),
    ),
  );
  if (ilocFilled.length !== iloc.length) {
    throw new Error(`iloc size changed (${iloc.length} vs ${ilocFilled.length})`);
  }
  const meta = fullBox('meta', 0, 0, concat(iinf, ilocFilled));
  return concat(ftyp, meta, exifPayload);
}

function box(type: string, payload: Uint8Array): Uint8Array {
  return concat(u32be(8 + payload.length), ascii(type), payload);
}

function fullBox(type: string, version: number, flags: number, payload: Uint8Array): Uint8Array {
  return box(type, concat(u32be((version << 24) | flags), payload));
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function asciiZ(text: string): Uint8Array {
  return ascii(text.endsWith('\0') ? text : `${text}\0`);
}

function u16be(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value);
  return out;
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function writeU16(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >> 8) & 0xff;
}

function writeU32(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >> 8) & 0xff;
  out[offset + 2] = (value >> 16) & 0xff;
  out[offset + 3] = (value >> 24) & 0xff;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
