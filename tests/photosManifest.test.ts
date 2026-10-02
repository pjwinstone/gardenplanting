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
    capturedAt: '2026-10-02T23:26:00.000Z',
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
  it('creates the manifest when it is missing', async () => {
    const puts: { etagHeader?: string; body: PhotosManifest }[] = [];
    const client = mockFetch(async (url, init) => {
      if (init?.method === 'GET') return json(404, {});
      const headers = new Headers(init?.headers);
      puts.push({
        etagHeader: headers.get('If-None-Match') ?? undefined,
        body: JSON.parse(String(init?.body)) as PhotosManifest,
      });
      return json(200, {}, { etag: '"etag-1"' });
    });
    const result = await upsertManifestPhoto({
      client,
      manifestPath: 'Garden Survey/photos/manifest.json',
      entry: entry('a.jpg', 'ph-a'),
      now: 't1',
    });
    expect(result.ok).toBe(true);
    expect(puts[0]?.etagHeader).toBe('*');
    expect(puts[0]?.body.photos).toHaveLength(1);
    expect(urlSeen(client.urls, 'Garden%20Survey/photos/manifest.json:/content')).toBe(true);
  });

  it('retries on If-Match conflict and keeps the other writer’s photo', async () => {
    const remote: PhotosManifest = {
      version: 1,
      updatedAt: 'earlier',
      photos: [entry('kept.jpg', 'ph-kept')],
    };
    let etag = '"v1"';
    let puts = 0;
    const bodies: PhotosManifest[] = [];
    const client = mockFetch(async (_url, init) => {
      if (init?.method === 'GET') {
        return json(200, remote, { etag });
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
      return json(200, {}, { etag: '"v3"' });
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
});

function urlSeen(urls: string[], fragment: string): boolean {
  return urls.some((url) => url.includes(fragment));
}

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
    urls.push(url);
    return handler(url, init);
  };
  return { token: 'tok', fetch: fetchImpl, urls };
}
