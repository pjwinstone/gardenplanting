import type { AuthenticationResult } from '@azure/msal-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGardenCloudFileName } from '../src/cloudConfig';
import { gardenIsDirty, gardenRevision, rememberDriveETag, rememberedDriveETag } from '../src/gardenCloudSave';
import { setGraphTokenClientForTests } from '../src/msalAuth';
import { emptyDocument, type GardenDocument } from '../src/model';
import { gardenCloudUiForTests, getState } from '../src/ui';

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
        request: async (_name: string, callback: () => Promise<void>) => {
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
});
