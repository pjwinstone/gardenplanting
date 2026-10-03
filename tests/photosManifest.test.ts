import { describe, expect, it } from 'vitest';
import {
  mergeManifestEntry,
  upsertManifestPhoto,
  type ManifestPhoto,
  type PhotosManifest,
} from '../src/photosManifest';

function entry(fileName: string, photoId: string): ManifestPhoto {
  return {
    fileName,
    photoId,
    stationId: 'P01',
    observationId: photoId === 'ph-b' ? 'obs-2' : undefined,
    size: 100 + fileName.length,
    quickXorHash: `hash-${photoId}`,
    sha256: `sha-${photoId}`,
    receivedAt: '2026-10-02T23:30:00.000Z',
    capturedAt: '2026-10-02T23:26:00.123+01:00',
    provenance: 'library',
    calibrationKey: 'Apple|iPhone14|Back wide|5.2|4032x3024',
    pixelCentre: '+0.5',
    fullWidth: 4032,
    fullHeight: 3024,
    previewWidth: 640,
    previewHeight: 480,
    previewScale: 640 / 4032,
    exif: {
      Make: 'Apple',
      Model: 'iPhone14',
      DateTimeOriginal: '2026:10:02 23:26:00',
      SubSecTimeOriginal: '123',
      OffsetTimeOriginal: '+01:00',
      PixelXDimension: 4032,
      PixelYDimension: 3024,
      Orientation: 6,
      FocalLength: 5.2,
      FocalLengthIn35mmFilm: 26,
      LensModel: 'Back wide',
    },
  };
}

describe('mergeManifestEntry', () => {
  it('adds a photo and replaces the same file without dropping others', () => {
    const first = mergeManifestEntry(null, entry('a.jpg', 'ph-a'), 't1');
    const second = mergeManifestEntry(first, entry('b.jpg', 'ph-b'), 't2');
    const replaced = mergeManifestEntry(
      second,
      { ...entry('a.jpg', 'ph-a'), size: 999 },
      't3',
    );
    expect(replaced.photos.map((p) => p.fileName)).toEqual(['a.jpg', 'b.jpg']);
    expect(replaced.photos[0]?.size).toBe(999);
    expect(replaced.photos[1]?.observationId).toBe('obs-2');
    expect(replaced.updatedAt).toBe('t3');
    expect(replaced.version).toBe(1);
  });
});

describe('upsertManifestPhoto', () => {
  it('creates the manifest when metadata is 404, without reading :/content', async () => {
    const puts: { ifNone?: string; body: PhotosManifest }[] = [];
    const client = mockFetch(async (url, init) => {
      expect(init?.method === 'GET' && url.includes(':/content')).toBe(false);
      if (init?.method === 'GET') return json(404, {});
      const headers = new Headers(init?.headers);
      puts.push({
        ifNone: headers.get('If-None-Match') ?? undefined,
        body: JSON.parse(String(init?.body)) as PhotosManifest,
      });
      return json(200, { eTag: '"etag-1"' });
    });
    const result = await upsertManifestPhoto({
      client,
      manifestPath: 'Garden Survey/photos/manifest.json',
      entry: entry('a.jpg', 'ph-a'),
      now: 't1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.etag).toBe('"etag-1"');
    expect(puts[0]?.ifNone).toBe('*');
    expect(puts[0]?.body.photos).toHaveLength(1);
    expect(puts[0]?.body.photos[0]?.receivedAt).toBe('2026-10-02T23:30:00.000Z');
    expect(client.urls.some((url) => url.includes('$select='))).toBe(true);
    expect(client.urls.some((url) => url.includes(':/content') && url.includes('GET'))).toBe(false);
  });

  it('uses the metadata eTag and downloads the body from @microsoft.graph.downloadUrl', async () => {
    const download = 'https://download.example/photos/manifest.json';
    const remote: PhotosManifest = {
      version: 1,
      updatedAt: 'earlier',
      photos: [entry('kept.jpg', 'ph-kept')],
    };
    const calls: { url: string; method: string; auth: string | null; ifMatch: string | null }[] = [];
    const client = mockFetch(async (url, init) => {
      const headers = new Headers(init?.headers);
      const method = init?.method ?? 'GET';
      calls.push({
        url,
        method,
        auth: headers.get('Authorization'),
        ifMatch: headers.get('If-Match'),
      });
      if (method === 'GET' && url.includes(':/content')) {
        return new Response(null, { status: 302, headers: { Location: download } });
      }
      if (method === 'GET' && url.includes('$select=')) {
        expect(url).toContain('eTag');
        expect(url).toContain('downloadUrl');
        return json(200, { eTag: '"meta-v1"', '@microsoft.graph.downloadUrl': download });
      }
      if (url === download) {
        expect(headers.get('Authorization')).toBeNull();
        return json(200, remote);
      }
      expect(headers.get('If-Match')).toBe('"meta-v1"');
      return json(200, { eTag: '"meta-v2"' });
    });
    const result = await upsertManifestPhoto({
      client,
      manifestPath: 'Garden Survey/photos/manifest.json',
      entry: entry('new.jpg', 'ph-new'),
      now: 't9',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.etag).toBe('"meta-v2"');
      expect(result.manifest.photos.map((p) => p.fileName)).toEqual(['kept.jpg', 'new.jpg']);
    }
    expect(calls.some((c) => c.method === 'GET' && c.url.includes(':/content'))).toBe(false);
    expect(calls.some((c) => c.url === download && c.auth == null)).toBe(true);
  });

  it('retries on If-Match conflict and keeps the other writer’s photo', async () => {
    const download = 'https://download.example/manifest.json';
    let etag = '"v1"';
    const remote: PhotosManifest = {
      version: 1,
      updatedAt: 'earlier',
      photos: [entry('kept.jpg', 'ph-kept')],
    };
    let puts = 0;
    const bodies: PhotosManifest[] = [];
    const client = mockFetch(async (url, init) => {
      if (init?.method !== 'PUT') {
        if (url === download) return json(200, remote);
        return json(200, { eTag: etag, '@microsoft.graph.downloadUrl': download });
      }
      puts += 1;
      const headers = new Headers(init?.headers);
      const match = headers.get('If-Match');
      const body = JSON.parse(String(init?.body)) as PhotosManifest;
      bodies.push(body);
      if (puts === 1) {
        expect(match).toBe('"v1"');
        remote.photos.push(entry('other.jpg', 'ph-other'));
        etag = '"v2"';
        return json(412, { error: { message: 'precondition failed' } });
      }
      expect(match).toBe('"v2"');
      return json(200, { eTag: '"v3"' });
    });
    const result = await upsertManifestPhoto({
      client,
      manifestPath: 'Garden Survey/photos/manifest.json',
      entry: entry('new.jpg', 'ph-new'),
      now: 't9',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.etag).toBe('"v3"');
    expect(puts).toBe(2);
    const names = bodies[1]?.photos.map((p) => p.fileName);
    expect(names).toEqual(['kept.jpg', 'other.jpg', 'new.jpg']);
  });

  it('does not write when an existing manifest has no eTag', async () => {
    let puts = 0;
    const client = mockFetch(async (_url, init) => {
      if (init?.method === 'PUT') {
        puts += 1;
        return json(200, {});
      }
      return json(200, { '@microsoft.graph.downloadUrl': 'https://download.example/m' });
    });
    const result = await upsertManifestPhoto({
      client,
      manifestPath: 'Garden Survey/photos/manifest.json',
      entry: entry('a.jpg', 'ph-a'),
      now: 't1',
    });
    expect(result.ok).toBe(false);
    expect(puts).toBe(0);
  });
});

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 404 ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function mockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
): { token: string; fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    urls.push(`${init?.method ?? 'GET'} ${url}`);
    return handler(url, init);
  };
  return { token: 'tok', fetch: fetchImpl, urls };
}
