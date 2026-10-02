/**
 * OneDrive quickXorHash (160-bit), base64, as Graph returns on `file.hashes.quickXorHash`.
 * Port of the Microsoft reference (little-endian 64-bit cells, length XOR into the last 8 bytes):
 * https://learn.microsoft.com/en-us/onedrive/developer/code-snippets/quickxorhash
 */

const BITS_IN_LAST_CELL = 32;
const SHIFT = 11;
const WIDTH_IN_BITS = 160;
const WIDTH_IN_BYTES = (WIDTH_IN_BITS - 1) / 8 + 1;
const CELL_COUNT = Math.floor((WIDTH_IN_BITS - 1) / 64) + 1;
const MASK64 = (1n << 64n) - 1n;

export interface QuickXorDigest {
  bytes: Uint8Array;
  /** Standard base64, the form Graph compares. */
  base64: string;
}

export function quickXorHash(input: Uint8Array): QuickXorDigest {
  const data = new Array<bigint>(CELL_COUNT).fill(0n);
  const cbSize = input.length;

  let vectorArrayIndex = 0;
  let vectorOffset = 0;
  const iterations = Math.min(cbSize, WIDTH_IN_BITS);

  for (let i = 0; i < iterations; i++) {
    const isLastCell = vectorArrayIndex === data.length - 1;
    const bitsInVectorCell = isLastCell ? BITS_IN_LAST_CELL : 64;

    if (vectorOffset <= bitsInVectorCell - 8) {
      for (let j = i; j < cbSize; j += WIDTH_IN_BITS) {
        data[vectorArrayIndex] =
          (data[vectorArrayIndex]! ^ (BigInt(input[j]!) << BigInt(vectorOffset))) & MASK64;
      }
    } else {
      const index1 = vectorArrayIndex;
      const index2 = isLastCell ? 0 : vectorArrayIndex + 1;
      const low = bitsInVectorCell - vectorOffset;
      let xoredByte = 0;
      for (let j = i; j < cbSize; j += WIDTH_IN_BITS) {
        xoredByte ^= input[j]!;
      }
      data[index1] = (data[index1]! ^ (BigInt(xoredByte) << BigInt(vectorOffset))) & MASK64;
      data[index2] = (data[index2]! ^ (BigInt(xoredByte) >> BigInt(low))) & MASK64;
    }

    vectorOffset += SHIFT;
    while (vectorOffset >= bitsInVectorCell) {
      vectorArrayIndex = isLastCell ? 0 : vectorArrayIndex + 1;
      vectorOffset -= bitsInVectorCell;
    }
  }

  const rgb = new Uint8Array(WIDTH_IN_BYTES);
  for (let i = 0; i < data.length - 1; i++) {
    writeLe(rgb, i * 8, data[i]!, 8);
  }
  const lastBytes = rgb.length - (data.length - 1) * 8;
  writeLe(rgb, (data.length - 1) * 8, data[data.length - 1]!, lastBytes);

  let length = BigInt(cbSize);
  const lengthAt = WIDTH_IN_BITS / 8 - 8;
  for (let i = 0; i < 8; i++) {
    rgb[lengthAt + i] ^= Number(length & 0xffn);
    length >>= 8n;
  }

  return { bytes: rgb, base64: bytesToBase64(rgb) };
}

function writeLe(target: Uint8Array, offset: number, value: bigint, nbytes: number): void {
  let v = value;
  for (let i = 0; i < nbytes; i++) {
    target[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}
