import type { AuthenticationResult } from '@azure/msal-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGardenCloudFileName } from '../src/cloudConfig';
import { gardenIsDirty, gardenRevision, rememberedDriveETag } from '../src/gardenCloudSave';
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
});
