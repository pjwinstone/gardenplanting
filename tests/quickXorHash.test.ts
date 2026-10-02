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
});

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
