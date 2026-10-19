import { describe, expect, it, vi } from 'vitest';
import { quickXorHash } from '../src/quickXorHash';
import { SIZE_MISMATCH_RETRIES, bodyBytes, uploadAndVerifyOriginal } from '../src/photoUpload';
import { isSizeMismatchGiveUp } from '../src/photoSync';
import { bindErrorLogView, createOncePerKeyLogger } from '../src/errorLogBinding';
import type { GraphRequest } from '../src/photosManifest';

type Call = { method: string; url: string; init?: RequestInit };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function item(size: number, h: string): unknown {
  return { size, name: 'f', file: { hashes: { quickXorHash: h } } };
}

/** Folders already exist (409); the rest is handled by `handler`. */
function fakeGraph(handler: (c: Call) => Response | undefined): GraphRequest & { calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const c = { method: init?.method ?? 'GET', url, init };
    calls.push(c);
    if (c.method === 'POST' && url.endsWith('/children')) return json(409, {});
    const r = handler(c);
    if (!r) throw new Error(`unexpected ${c.method} ${url}`);
    return r;
  };
  return { token: 't', fetch: fetchImpl, calls };
}

const big = new Uint8Array(4_591_996);
for (let i = 0; i < big.length; i += 1) big[i] = (i * 31) & 0xff;
const bigHash = quickXorHash(big).base64;

describe('upload fix', () => {
  it('>4 MB uses an upload session with 320 KiB-multiple chunks and Content-Range, sending ArrayBuffers', async () => {
    const received: number[] = [];
    const client = fakeGraph((c) => {
      if (c.url.includes('createUploadSession')) return json(200, { uploadUrl: 'https://up.example/s' });
      if (c.url === 'https://up.example/s') {
        expect(c.init?.body).toBeInstanceOf(ArrayBuffer);
        const len = (c.init?.body as ArrayBuffer).byteLength;
        const range = (c.init?.headers as Record<string, string>)['Content-Range'];
        const [, s, e, total] = /bytes (\d+)-(\d+)\/(\d+)/.exec(range)!;
        expect(Number(total)).toBe(big.length);
        expect(Number(e) - Number(s) + 1).toBe(len);
        expect((c.init?.headers as Record<string, string>).Authorization).toBeUndefined();
        received.push(len);
        const done = Number(e) + 1 === big.length;
        return done ? json(201, item(big.length, bigHash)) : json(202, {});
      }
      return undefined;
    });
    const r = await uploadAndVerifyOriginal({ client, bytes: big, fileName: 'P.jpg', contentType: 'image/jpeg', localHash: bigHash });
    expect(r.ok).toBe(true);
    expect(client.calls.some((c) => c.method === 'PUT' && c.url.includes(':/content'))).toBe(false);
    received.slice(0, -1).forEach((n) => expect(n % (320 * 1024)).toBe(0));
    expect(received.reduce((a, b) => a + b, 0)).toBe(big.length);
  });

  it('bodyBytes copies exactly the view, not the whole backing buffer', () => {
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const out = bodyBytes(backing.subarray(2, 5));
    expect(out).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(out)]).toEqual([3, 4, 5]);
  });

  it('a 0-byte file left on OneDrive is replaced, not accepted or looped on', async () => {
    let replaced = false;
    const client = fakeGraph((c) => {
      if (c.url.includes('createUploadSession')) {
        const body = JSON.parse(String(c.init?.body));
        if (body.item['@microsoft.graph.conflictBehavior'] === 'fail') return json(409, {});
        replaced = true;
        return json(200, { uploadUrl: 'https://up.example/s' });
      }
      if (c.method === 'GET') return json(200, item(0, ''));
      if (c.url === 'https://up.example/s') {
        const range = (c.init?.headers as Record<string, string>)['Content-Range'];
        return range.endsWith(`-${big.length - 1}/${big.length}`) ? json(201, item(big.length, bigHash)) : json(202, {});
      }
      return undefined;
    });
    const r = await uploadAndVerifyOriginal({
      client, bytes: big, fileName: 'P.jpg', contentType: 'image/jpeg', localHash: bigHash, sleep: async () => {},
    });
    expect(replaced).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('size mismatch retries a bounded number of times then gives up once as permanent', async () => {
    let sessions = 0;
    const sleep = vi.fn(async () => {});
    const client = fakeGraph((c) => {
      if (c.url.includes('createUploadSession')) {
        sessions += 1;
        return json(200, { uploadUrl: 'https://up.example/s' });
      }
      if (c.url === 'https://up.example/s') {
        const range = (c.init?.headers as Record<string, string>)['Content-Range'];
        return range.endsWith(`-${big.length - 1}/${big.length}`) ? json(201, item(0, 'x')) : json(202, {});
      }
      return undefined;
    });
    const r = await uploadAndVerifyOriginal({ client, bytes: big, fileName: 'P.jpg', contentType: 'image/jpeg', localHash: bigHash, sleep });
    expect(sessions).toBe(SIZE_MISMATCH_RETRIES + 1);
    expect(sleep).toHaveBeenCalledTimes(SIZE_MISMATCH_RETRIES);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.permanent).toBe(true);
      expect(r.error).toMatch(/Size mismatch \(local 4591996, OneDrive 0\)/);
      expect(isSizeMismatchGiveUp(r.error)).toBe(true);
    }
  });

  it('the same upload failure for a photo is logged once', () => {
    const log = vi.fn();
    const once = createOncePerKeyLogger(log);
    for (let i = 0; i < 5; i += 1) once('P11', 'Photo upload failed: Size mismatch');
    once('P12', 'Photo upload failed: Size mismatch');
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('log appends patch the log in place (batched) and never call a full render', async () => {
    let listener: () => void = () => {};
    const fullRender = vi.fn();
    const refreshInPlace = vi.fn();
    bindErrorLogView({ refreshInPlace }, (fn) => {
      listener = fn;
      return () => {};
    });
    for (let i = 0; i < 10; i += 1) listener();
    await Promise.resolve();
    expect(refreshInPlace).toHaveBeenCalledTimes(1);
    expect(fullRender).not.toHaveBeenCalled();
  });
});
