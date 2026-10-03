/**
 * OneDrive quickXorHash (160-bit), base64, as Graph returns on `file.hashes.quickXorHash`.
 * Port of the Microsoft reference (little-endian 64-bit cells, length XOR into the last 8 bytes):
 * https://learn.microsoft.com/en-us/onedrive/developer/code-snippets/quickxorhash
 *
 * Cells are pairs of uint32 (lo, hi) so the inner loop stays in 32-bit arithmetic.
 * JavaScript `<<` masks the shift to 5 bits, so shifts are multiplies instead.
 */

const BITS_IN_LAST_CELL = 32;
const SHIFT = 11;
const WIDTH_IN_BITS = 160;
const WIDTH_IN_BYTES = (WIDTH_IN_BITS - 1) / 8 + 1;
const CELL_COUNT = Math.floor((WIDTH_IN_BITS - 1) / 64) + 1;

export interface QuickXorDigest {
  bytes: Uint8Array;
  /** Standard base64, the form Graph compares. */
  base64: string;
}

interface Cell {
  lo: number;
  hi: number;
}

export function quickXorHash(input: Uint8Array): QuickXorDigest {
  const data: Cell[] = [];
  for (let i = 0; i < CELL_COUNT; i++) data.push({ lo: 0, hi: 0 });
  const cbSize = input.length;

  let vectorArrayIndex = 0;
  let vectorOffset = 0;
  const iterations = Math.min(cbSize, WIDTH_IN_BITS);

  for (let i = 0; i < iterations; i++) {
    const isLastCell = vectorArrayIndex === data.length - 1;
    const bitsInVectorCell = isLastCell ? BITS_IN_LAST_CELL : 64;
    const cell = data[vectorArrayIndex]!;

    if (vectorOffset <= bitsInVectorCell - 8) {
      for (let j = i; j < cbSize; j += WIDTH_IN_BITS) {
        xorShifted(cell, input[j]!, vectorOffset, bitsInVectorCell);
      }
    } else {
      const index1 = vectorArrayIndex;
      const index2 = isLastCell ? 0 : vectorArrayIndex + 1;
      const low = bitsInVectorCell - vectorOffset;
      let xoredByte = 0;
      for (let j = i; j < cbSize; j += WIDTH_IN_BITS) {
        xoredByte ^= input[j]!;
      }
      xorShifted(data[index1]!, xoredByte, vectorOffset, bitsInVectorCell);
      data[index2]!.lo = u32(data[index2]!.lo ^ (xoredByte >>> low));
    }

    vectorOffset += SHIFT;
    while (vectorOffset >= bitsInVectorCell) {
      vectorArrayIndex = isLastCell ? 0 : vectorArrayIndex + 1;
      vectorOffset -= bitsInVectorCell;
    }
  }

  const rgb = new Uint8Array(WIDTH_IN_BYTES);
  for (let i = 0; i < data.length - 1; i++) {
    writeCell(rgb, i * 8, data[i]!, 8);
  }
  const lastBytes = rgb.length - (data.length - 1) * 8;
  writeCell(rgb, (data.length - 1) * 8, data[data.length - 1]!, lastBytes);

  let lengthLo = u32(cbSize);
  let lengthHi = Math.floor(cbSize / 2 ** 32);
  const lengthAt = WIDTH_IN_BITS / 8 - 8;
  for (let i = 0; i < 4; i++) {
    rgb[lengthAt + i] ^= lengthLo & 0xff;
    lengthLo >>>= 8;
  }
  for (let i = 0; i < 4; i++) {
    rgb[lengthAt + 4 + i] ^= lengthHi & 0xff;
    lengthHi = Math.floor(lengthHi / 256);
  }

  return { bytes: rgb, base64: bytesToBase64(rgb) };
}

/** XOR `(byte << shift)` into a cell, masked to 32 or 64 bits. `shift` is 0..63. */
function xorShifted(cell: Cell, byte: number, shift: number, bits: number): void {
  const b = byte & 0xff;
  if (bits <= 32) {
    if (shift < 32) cell.lo = u32(cell.lo ^ u32(b * 2 ** shift));
    cell.hi = 0;
    return;
  }
  if (shift >= 64) return;
  if (shift >= 32) {
    cell.hi = u32(cell.hi ^ u32(b * 2 ** (shift - 32)));
    return;
  }
  cell.lo = u32(cell.lo ^ u32(b * 2 ** shift));
  if (shift > 24) cell.hi = u32(cell.hi ^ (b >>> (32 - shift)));
}

function u32(n: number): number {
  return n >>> 0;
}

function writeCell(target: Uint8Array, offset: number, cell: Cell, nbytes: number): void {
  let lo = cell.lo >>> 0;
  let hi = cell.hi >>> 0;
  for (let i = 0; i < nbytes; i++) {
    if (i < 4) {
      target[offset + i] = lo & 0xff;
      lo >>>= 8;
    } else {
      target[offset + i] = hi & 0xff;
      hi >>>= 8;
    }
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}
