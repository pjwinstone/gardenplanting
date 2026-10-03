import { describe, expect, it } from 'vitest';
import { bytesToBase64, quickXorHash } from '../src/quickXorHash';
import { verifyRemoteFile } from '../src/photoUpload';

describe('quickXorHash', () => {
  it('matches the published hello-world digest', () => {
    const digest = quickXorHash(new TextEncoder().encode('hello world'));
    expect([...digest.bytes]).toEqual([
      104, 40, 3, 27, 216, 240, 6, 16, 220, 225, 13, 114, 107, 3, 25, 0, 0, 0, 0, 0,
    ]);
    expect(digest.base64).toBe(bytesToBase64(digest.bytes));
  });

  it('mixes the file length into an empty file', () => {
    const digest = quickXorHash(new Uint8Array(0));
    expect(digest.bytes.every((b) => b === 0)).toBe(true);
    expect(digest.base64).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  });

  it('changes when a single byte changes', () => {
    const a = quickXorHash(new Uint8Array([1, 2, 3, 4]));
    const b = quickXorHash(new Uint8Array([1, 2, 3, 5]));
    expect(a.base64).not.toBe(b.base64);
  });

  it('matches the 64-bit reference on short and straddling buffers', () => {
    const samples = [
      new Uint8Array(0),
      new TextEncoder().encode('hello world'),
      new Uint8Array(159).map((_, i) => (i * 17) & 0xff),
      new Uint8Array(160).map((_, i) => (i * 17) & 0xff),
      new Uint8Array(161).map((_, i) => (i * 17) & 0xff),
      new Uint8Array(320).map((_, i) => (i * 3) & 0xff),
      new Uint8Array(1000).map((_, i) => i & 0xff),
    ];
    for (const sample of samples) {
      expect([...quickXorHash(sample).bytes]).toEqual([...referenceQuickXorHash(sample)]);
    }
  });
});

/** BigInt form of the Microsoft sample. The 32-bit port must stay equal to this. */
function referenceQuickXorHash(input: Uint8Array): Uint8Array {
  const bitsInLastCell = 32;
  const shift = 11;
  const widthInBits = 160;
  const widthInBytes = (widthInBits - 1) / 8 + 1;
  const cellCount = Math.floor((widthInBits - 1) / 64) + 1;
  const mask64 = (1n << 64n) - 1n;
  const data = new Array<bigint>(cellCount).fill(0n);
  const cbSize = input.length;
  let vectorArrayIndex = 0;
  let vectorOffset = 0;
  const iterations = Math.min(cbSize, widthInBits);
  for (let i = 0; i < iterations; i++) {
    const isLastCell = vectorArrayIndex === data.length - 1;
    const bitsInVectorCell = isLastCell ? bitsInLastCell : 64;
    if (vectorOffset <= bitsInVectorCell - 8) {
      for (let j = i; j < cbSize; j += widthInBits) {
        data[vectorArrayIndex] =
          (data[vectorArrayIndex]! ^ (BigInt(input[j]!) << BigInt(vectorOffset))) & mask64;
      }
    } else {
      const index1 = vectorArrayIndex;
      const index2 = isLastCell ? 0 : vectorArrayIndex + 1;
      const low = bitsInVectorCell - vectorOffset;
      let xoredByte = 0;
      for (let j = i; j < cbSize; j += widthInBits) xoredByte ^= input[j]!;
      data[index1] = (data[index1]! ^ (BigInt(xoredByte) << BigInt(vectorOffset))) & mask64;
      data[index2] = (data[index2]! ^ (BigInt(xoredByte) >> BigInt(low))) & mask64;
    }
    vectorOffset += shift;
    while (vectorOffset >= bitsInVectorCell) {
      vectorArrayIndex = isLastCell ? 0 : vectorArrayIndex + 1;
      vectorOffset -= bitsInVectorCell;
    }
  }
  const rgb = new Uint8Array(widthInBytes);
  const writeLe = (offset: number, value: bigint, nbytes: number) => {
    let v = value;
    for (let i = 0; i < nbytes; i++) {
      rgb[offset + i] = Number(v & 0xffn);
      v >>= 8n;
    }
  };
  for (let i = 0; i < data.length - 1; i++) writeLe(i * 8, data[i]!, 8);
  writeLe((data.length - 1) * 8, data[data.length - 1]!, rgb.length - (data.length - 1) * 8);
  let length = BigInt(cbSize);
  const lengthAt = widthInBits / 8 - 8;
  for (let i = 0; i < 8; i++) {
    rgb[lengthAt + i] ^= Number(length & 0xffn);
    length >>= 8n;
  }
  return rgb;
}

describe('verifyRemoteFile', () => {
  const local = { size: 12, quickXorHash: 'abc=' };

  it('accepts a matching size and hash', () => {
    expect(verifyRemoteFile(local, { size: 12, quickXorHash: 'abc=' })).toEqual({ ok: true });
  });

  it('rejects a size mismatch', () => {
    const result = verifyRemoteFile(local, { size: 11, quickXorHash: 'abc=' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Size mismatch/);
  });

  it('rejects a missing or different hash', () => {
    expect(verifyRemoteFile(local, { size: 12 }).ok).toBe(false);
    const different = verifyRemoteFile(local, { size: 12, quickXorHash: 'nope=' });
    expect(different.ok).toBe(false);
    if (!different.ok) expect(different.reason).toMatch(/quickXorHash/);
  });
});
