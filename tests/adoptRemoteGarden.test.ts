import type { AuthenticationResult } from '@azure/msal-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGardenCloudFileName } from '../src/cloudConfig';
import { getCloudStatus } from '../src/cloudStatus';
import { gardenIsDirty, gardenRevision, rememberDriveETag, rememberedDriveETag } from '../src/gardenCloudSave';
import { gardenSaveIsOwed } from '../src/cloudSignIn';
import { setGraphTokenClientForTests } from '../src/msalAuth';
import { emptyDocument, type GardenDocument, type Photo } from '../src/model';
import { gardenCloudUiForTests, getState, photosOnPoint } from '../src/ui';

const authFlag = vi.hoisted(() => ({ signedIn: false }));

vi.mock('../src/msalAuth', async () => {
  const actual = await vi.importActual<typeof import('../src/msalAuth')>('../src/msalAuth');
  return {
    ...actual,
    isSignedIn: () => authFlag.signedIn,
  };
});

const ACCOUNT = {
  homeAccountId: 'home-account',
  environment: 'login.microsoftonline.com',
  tenantId: 'common',
  username: 'paul@example.com',
  localAccountId: 'local',
};

function memoryLocalStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

function namedGarden(name: string): GardenDocument {
  const doc = emptyDocument(name);
  doc.points = [{ id: 'HSE01', kind: 'HSE', label: name }];
  return doc;
}

describe('adopt remote garden', () => {
  let fetches = 0;
  let putName = '';

  beforeEach(() => {
    fetches = 0;
    putName = '';
    vi.stubGlobal('localStorage', memoryLocalStorage());
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      fetches += 1;
      const method = init?.method ?? 'GET';
      if (method === 'POST') return new Response('', { status: 409 });
      if (method === 'PUT') {
        putName = (JSON.parse(String(init?.body)) as GardenDocument).name;
        return new Response(JSON.stringify({ eTag: '"written"' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json', etag: '"written"' },
        });
      }
      return new Response(JSON.stringify({ error: { message: 'missing' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    authFlag.signedIn = true;
    setGraphTokenClientForTests({
      account: ACCOUNT,
      acquireTokenSilent: async () => ({ accessToken: 'tok' }) as AuthenticationResult,
      acquireTokenRedirect: async () => {},
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    gardenCloudUiForTests.adopt(namedGarden('Reset'), 'garden-v1.json', '"reset"');
    authFlag.signedIn = false;
    setGraphTokenClientForTests(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sets the base eTag, clears dirty, and does not schedule a save', async () => {
    const before = gardenRevision();
    gardenCloudUiForTests.edit(namedGarden('Local edit'));
    const revision = gardenRevision();
    expect(revision).toBe(before + 1);
    expect(gardenIsDirty()).toBe(true);
    expect(gardenCloudUiForTests.saveScheduled()).toBe(true);

    const remote = namedGarden('OneDrive copy');
    remote.updatedAt = '2026-10-03T11:00:00.000Z';
    gardenCloudUiForTests.adopt(remote, 'garden-v9.json', '"v9"');

    expect(gardenCloudUiForTests.saveScheduled()).toBe(false);
    expect(gardenIsDirty()).toBe(false);
    expect(gardenRevision()).toBe(revision);
    expect(getState().doc).toBe(remote);
    expect(getState().doc.updatedAt).toBe('2026-10-03T11:00:00.000Z');
    expect(rememberedDriveETag('home-account', 'garden-v9.json')).toBe('"v9"');
    expect(getGardenCloudFileName()).toBe('garden-v9.json');

    await vi.advanceTimersByTimeAsync(3000);
    expect(fetches).toBe(0);
    expect(gardenIsDirty()).toBe(false);
  });

  it('keeps the garden dirty when it changes while the auto-save is waiting for a token', async () => {
    let edited = false;
    setGraphTokenClientForTests({
      account: ACCOUNT,
      acquireTokenSilent: async () => {
        if (!edited) {
          edited = true;
          gardenCloudUiForTests.edit(namedGarden('During token'));
        }
        return { accessToken: 'tok' } as AuthenticationResult;
      },
      acquireTokenRedirect: async () => {},
    });

    gardenCloudUiForTests.edit(namedGarden('Before save'));
    expect(gardenCloudUiForTests.saveScheduled()).toBe(true);
    await vi.advanceTimersByTimeAsync(2500);

    expect(edited).toBe(true);
    expect(putName).toBe('Before save');
    expect(getState().doc.name).toBe('During token');
    expect(gardenIsDirty()).toBe(true);
    expect(gardenCloudUiForTests.saveScheduled()).toBe(true);
  });

  it('does not treat an autosave and a manual save as a OneDrive conflict', async () => {
    let asked = false;
    vi.stubGlobal('window', {
      confirm: () => {
        asked = true;
        return true;
      },
    });
    let inLock = 0;
    let maxInLock = 0;
    let lockEntries = 0;
    vi.stubGlobal('navigator', {
      locks: {
        request: async (
          _name: string,
          optionsOrCallback: { signal?: AbortSignal } | (() => Promise<unknown>),
          maybeCallback?: () => Promise<unknown>,
        ) => {
          const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
          if (!callback) throw new Error('lock request needs a callback');
          lockEntries += 1;
          inLock += 1;
          maxInLock = Math.max(maxInLock, inLock);
          try {
            return await callback();
          } finally {
            inLock -= 1;
          }
        },
      },
    });

    let remoteEtag = '"E0"';
    let releaseFirstPut = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirstPut = resolve;
    });
    let markPutStarted = (): void => {};
    const putStarted = new Promise<void>((resolve) => {
      markPutStarted = resolve;
    });
    const ifMatches: Array<string | null> = [];
    const putNames: string[] = [];
    const remoteBody = namedGarden('Remote');
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      if (method === 'POST') return new Response('', { status: 409 });
      if (method === 'GET' && url.includes('$select=')) {
        return new Response(
          JSON.stringify({
            eTag: remoteEtag,
            lastModifiedDateTime: remoteBody.updatedAt,
            '@microsoft.graph.downloadUrl': 'https://download.example/garden',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith('https://download.example/garden')) {
        return new Response(JSON.stringify(remoteBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'PUT') {
        const headers = new Headers(init?.headers);
        ifMatches.push(headers.get('If-Match'));
        putNames.push((JSON.parse(String(init?.body)) as GardenDocument).name);
        if (ifMatches.length === 1) {
          markPutStarted();
          await gate;
          remoteEtag = '"E1"';
          return new Response(JSON.stringify({ eTag: '"E1"' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', etag: '"E1"' },
          });
        }
        remoteEtag = '"E2"';
        return new Response(JSON.stringify({ eTag: '"E2"' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', etag: '"E2"' },
        });
      }
      return new Response(JSON.stringify({ error: { message: 'missing' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    authFlag.signedIn = false;
    gardenCloudUiForTests.edit(namedGarden('Queued'));
    authFlag.signedIn = true;
    rememberDriveETag('home-account', getGardenCloudFileName(), '"E0"');

    const auto = gardenCloudUiForTests.autoSave();
    await putStarted;
    gardenCloudUiForTests.edit(namedGarden('Typed while the first save was uploading'));
    const manual = gardenCloudUiForTests.saveNow();
    releaseFirstPut();
    await auto;
    await manual;

    expect(asked).toBe(false);
    expect(ifMatches).toEqual(['"E0"', '"E1"']);
    expect(putNames).toEqual(['Queued', 'Typed while the first save was uploading']);
    expect(lockEntries).toBe(2);
    expect(maxInLock).toBe(1);
    expect(rememberedDriveETag('home-account', getGardenCloudFileName())).toBe('"E2"');
    expect(getState().doc.name).toBe('Typed while the first save was uploading');
  });

  it('runs Load after an in-flight save so the save keeps its eTag', async () => {
    const result = await followInFlightSave(() => gardenCloudUiForTests.loadNow());
    expect(result.getsWhileSaving).toBe(0);
    expect(result.asked).toBe(false);
    expect(result.ifMatches).toEqual(['"E0"', '"E1"']);
    expect(rememberedDriveETag('home-account', getGardenCloudFileName())).toBe('"E2"');
  });

  it('runs sign-in after an in-flight save so the save keeps its eTag', async () => {
    const result = await followInFlightSave(() => gardenCloudUiForTests.afterSignIn());
    expect(result.getsWhileSaving).toBe(0);
    expect(result.asked).toBe(false);
    expect(result.ifMatches).toEqual(['"E0"', '"E1"']);
  });

  it('says it is waiting for another tab while that tab holds the save lock', async () => {
    const seen: Array<string | null> = [];
    vi.stubGlobal('navigator', {
      locks: {
        query: async () => ({ held: [{ name: 'garden-survey-save', mode: 'exclusive' as const }], pending: [] }),
        request: async (
          _name: string,
          optionsOrCallback: { signal?: AbortSignal } | (() => Promise<void>),
          maybeCallback?: () => Promise<void>,
        ) => {
          const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
          seen.push(getCloudStatus().message);
          return callback?.();
        },
      },
    });
    authFlag.signedIn = false;
    gardenCloudUiForTests.edit(namedGarden('Wait'));
    authFlag.signedIn = true;
    await gardenCloudUiForTests.saveNow();
    expect(seen[0]).toBe('Waiting for another tab…');
  });

  it('re-attaches a photo onto the point the thumbnails read', () => {
    let prompt = '';
    vi.stubGlobal('window', {
      confirm: (text: string) => {
        prompt = text;
        return true;
      },
    });
    const remote = namedGarden('Remote');
    remote.points[0] = { ...remote.points[0]!, photoIds: ['ph-old'] };
    remote.photos = [pointPhoto('ph-old', 'HSE01', 'data:image/jpeg;base64,old')];
    const added = pointPhoto('ph-roll', 'HSE01', 'data:image/jpeg;base64,roll');
    gardenCloudUiForTests.adopt(remote, 'garden-v1.json', '"v9"', [added, added]);
    expect(prompt).toBe(
      "1 photo from this device isn't in the OneDrive version (it may have been deleted on another device). Re-attach it?",
    );
    expect(getState().doc.name).toBe('Remote');
    expect(getState().doc.points.find((point) => point.id === 'HSE01')?.photoIds).toEqual(['ph-old', 'ph-roll']);
    expect(getState().doc.photos.map((photo) => photo.id)).toEqual(['ph-old', 'ph-roll']);
    const shown = photosOnPoint(getState().doc, 'HSE01');
    expect(shown.map((photo) => photo.id)).toEqual(['ph-old', 'ph-roll']);
    expect(shown[1]?.thumbnailDataUrl).toBe('data:image/jpeg;base64,roll');
    expect(getState().doc.photos[1]?.originalFile?.uploadStatus).toBe('uploading');
    expect(gardenIsDirty()).toBe(true);
    expect(fetches).toBe(0);
  });

  it('skips a photo whose point is not in the OneDrive garden and says where it was kept', () => {
    let alerted = '';
    let confirmed = false;
    vi.stubGlobal('window', {
      alert: (text: string) => {
        alerted = text;
      },
      confirm: () => {
        confirmed = true;
        return true;
      },
    });
    const conflict = '/Garden Survey/garden-conflict-2026-10-03T10-00-00.000Z.json';
    gardenCloudUiForTests.adopt(
      namedGarden('Remote'),
      'garden-v1.json',
      '"v9"',
      [pointPhoto('ph-gone', 'HSE99', 'data:image/jpeg;base64,gone'), pointPhoto('ph-also', 'HSE98')],
      conflict,
    );
    expect(confirmed).toBe(false);
    expect(alerted).toBe(
      "2 photos belong to points not in the OneDrive version; they're kept in garden-conflict-2026-10-03T10-00-00.000Z.json",
    );
    expect(getState().doc.photos).toEqual([]);
    expect(getState().doc.points.map((point) => point.id)).toEqual(['HSE01']);
    expect(photosOnPoint(getState().doc, 'HSE99')).toEqual([]);
    expect(gardenIsDirty()).toBe(false);
    expect(fetches).toBe(0);
  });

  it('names skipped photos in the re-attach prompt and does not create their points', () => {
    let prompt = '';
    vi.stubGlobal('window', {
      confirm: (text: string) => {
        prompt = text;
        return true;
      },
      alert: () => {},
    });
    const conflict = '/Garden Survey/garden-conflict-2026-10-03T10-00-00.000Z.json';
    gardenCloudUiForTests.adopt(
      namedGarden('Remote'),
      'garden-v1.json',
      '"v9"',
      [
        pointPhoto('ph-roll', 'HSE01', 'data:image/jpeg;base64,roll'),
        pointPhoto('ph-gone', 'HSE99'),
        pointPhoto('ph-also', 'HSE98'),
      ],
      conflict,
    );
    expect(prompt).toContain(
      "1 photo from this device isn't in the OneDrive version (it may have been deleted on another device). Re-attach it?",
    );
    expect(prompt).toContain(
      "2 photos belong to points not in the OneDrive version; they're kept in garden-conflict-2026-10-03T10-00-00.000Z.json",
    );
    expect(getState().doc.photos.map((photo) => photo.id)).toEqual(['ph-roll']);
    expect(getState().doc.points.map((point) => point.id)).toEqual(['HSE01']);
    expect(photosOnPoint(getState().doc, 'HSE01').map((photo) => photo.id)).toEqual(['ph-roll']);
    expect(photosOnPoint(getState().doc, 'HSE01')[0]?.thumbnailDataUrl).toBe('data:image/jpeg;base64,roll');
  });

  it('leaves the adopted garden unchanged when re-attach is declined', () => {
    vi.stubGlobal('window', { confirm: () => false, alert: () => {} });
    gardenCloudUiForTests.adopt(namedGarden('Remote'), 'garden-v1.json', '"v9"', [
      pointPhoto('ph-roll', 'HSE01'),
    ]);
    expect(getState().doc.photos).toEqual([]);
    expect(getState().doc.points[0]?.photoIds).toBeUndefined();
    expect(gardenIsDirty()).toBe(false);
    expect(gardenCloudUiForTests.saveScheduled()).toBe(false);
    expect(fetches).toBe(0);
  });

  it('stops waiting for another tab after 30s and keeps the save owed', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => new AbortController().signal);
    vi.stubGlobal('navigator', {
      locks: {
        query: async () => ({ held: [{ name: 'garden-survey-save', mode: 'exclusive' as const }], pending: [] }),
        request: async (_name: string, options: { signal?: AbortSignal }) => {
          expect(options.signal).toBeInstanceOf(AbortSignal);
          throw new DOMException('The operation was aborted.', 'AbortError');
        },
      },
    });
    try {
      gardenCloudUiForTests.edit(namedGarden('Busy tab'));
      await gardenCloudUiForTests.saveNow();
      expect(timeout).toHaveBeenCalledWith(30_000);
      expect(getCloudStatus().message).toBe('Another tab is busy — tap Save to retry');
      expect(getCloudStatus().busy).toBe(false);
      expect(gardenIsDirty()).toBe(true);
      expect(gardenSaveIsOwed()).toBe(true);
      expect(fetches).toBe(0);
    } finally {
      timeout.mockRestore();
    }
  });

  it('passes an AbortSignal when AbortSignal.timeout is missing', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
    Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: undefined });
    let sawSignal = false;
    vi.stubGlobal('navigator', {
      locks: {
        request: async (
          _name: string,
          options: { signal?: AbortSignal },
          callback: () => Promise<void>,
        ) => {
          sawSignal = options.signal instanceof AbortSignal;
          options.signal?.addEventListener('abort', () => {});
          return callback();
        },
      },
    });
    try {
      gardenCloudUiForTests.edit(namedGarden('Fallback signal'));
      await gardenCloudUiForTests.saveNow();
      expect(sawSignal).toBe(true);
    } finally {
      if (descriptor) Object.defineProperty(AbortSignal, 'timeout', descriptor);
    }
  });
});

function pointPhoto(id: string, addPointId: string, thumbnailDataUrl?: string): Photo {
  return { ...uploadingPhoto(id), addPointId, thumbnailDataUrl };
}

function uploadingPhoto(id: string): Photo {
  return {
    id,
    setupId: 'setup-1',
    width: 8,
    height: 8,
    clicks: [],
    originalFile: {
      fileName: `${id}.jpg`,
      size: 4,
      quickXorHash: 'hash',
      uploadStatus: 'uploading',
    },
  };
}

async function followInFlightSave(follow: () => Promise<unknown>): Promise<{
  ifMatches: Array<string | null>;
  getsWhileSaving: number;
  asked: boolean;
}> {
  let asked = false;
  vi.stubGlobal('window', {
    confirm: () => {
      asked = true;
      return true;
    },
  });
  let remoteEtag = '"E0"';
  let releaseFirstPut = (): void => {};
  const gate = new Promise<void>((resolve) => {
    releaseFirstPut = resolve;
  });
  let markPutStarted = (): void => {};
  const putStarted = new Promise<void>((resolve) => {
    markPutStarted = resolve;
  });
  const ifMatches: Array<string | null> = [];
  let watching = false;
  let putFinished = false;
  let getsWhileSaving = 0;
  const remoteBody = namedGarden('Remote');
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    if (method === 'POST') return new Response('', { status: 409 });
    if (method === 'GET' && url.includes('$select=')) {
      if (watching && !putFinished) getsWhileSaving += 1;
      return new Response(
        JSON.stringify({
          eTag: remoteEtag,
          lastModifiedDateTime: remoteBody.updatedAt,
          '@microsoft.graph.downloadUrl': 'https://download.example/garden',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.startsWith('https://download.example/garden')) {
      return new Response(JSON.stringify(remoteBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'PUT') {
      const headers = new Headers(init?.headers);
      ifMatches.push(headers.get('If-Match'));
      if (ifMatches.length === 1) {
        markPutStarted();
        await gate;
        putFinished = true;
        remoteEtag = '"E1"';
        return new Response(JSON.stringify({ eTag: '"E1"' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', etag: '"E1"' },
        });
      }
      remoteEtag = '"E2"';
      return new Response(JSON.stringify({ eTag: '"E2"' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', etag: '"E2"' },
      });
    }
    return new Response(JSON.stringify({ error: { message: 'missing' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  authFlag.signedIn = false;
  gardenCloudUiForTests.edit(namedGarden('Queued'));
  authFlag.signedIn = true;
  rememberDriveETag('home-account', getGardenCloudFileName(), '"E0"');
  const auto = gardenCloudUiForTests.autoSave();
  await putStarted;
  watching = true;
  const followed = follow();
  await Promise.resolve();
  expect(getsWhileSaving).toBe(0);
  releaseFirstPut();
  await auto;
  await followed;
  const manual = gardenCloudUiForTests.saveNow();
  await manual;
  return { ifMatches, getsWhileSaving, asked };
}
