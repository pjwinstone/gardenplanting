import { describe, expect, it } from 'vitest';
import {
  applyRedirectOwedSave,
  gardenConflictPrompt,
  type GardenCopyChoice,
} from '../src/gardenCloudSave';
import { markGardenSaveOwed, readOwedGardenSave, type OwedGardenSave, type OwedSaveStorage } from '../src/cloudSignIn';
import { emptyDocument, type GardenDocument } from '../src/model';

const FILE = 'garden-v1.json';
const ACCOUNT = 'home-account';
const LOCAL_AT = '2026-10-03T10:00:00.000Z';
const REMOTE_OLDER = '2026-10-03T09:00:00.000Z';
const REMOTE_NEWER = '2026-10-03T11:00:00.000Z';

function memoryStorage(): OwedSaveStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function garden(updatedAt: string, name = 'House edge'): GardenDocument {
  const doc = emptyDocument(name);
  doc.updatedAt = updatedAt;
  doc.points = [{ id: 'HSE01', kind: 'HSE', label: name }];
  return doc;
}

function owe(storage: OwedSaveStorage, patch: Partial<OwedGardenSave> = {}): void {
  markGardenSaveOwed(
    {
      account: ACCOUNT,
      fileName: FILE,
      baseETag: '"v1"',
      docUpdatedAt: LOCAL_AT,
      ...patch,
    },
    storage,
  );
}

function graph(opts: {
  remotes: GardenDocument[];
  etags: string[];
  putStatuses?: number[];
}): {
  fetchImpl: typeof fetch;
  puts: { ifMatch: string | null; name: string; updatedAt?: string }[];
  calls: number;
} {
  let reads = 0;
  let putsN = 0;
  const puts: { ifMatch: string | null; name: string; updatedAt?: string }[] = [];
  let calls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    calls += 1;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    if (method === 'POST') return json(409, { error: { code: 'nameAlreadyExists' } });
    if (method === 'GET' && url.includes('$select=')) {
      const i = Math.min(reads, opts.remotes.length - 1);
      return json(200, {
        eTag: opts.etags[Math.min(reads, opts.etags.length - 1)],
        lastModifiedDateTime: opts.remotes[i]?.updatedAt,
        '@microsoft.graph.downloadUrl': `https://download.example/garden/${i}`,
      });
    }
    if (url.startsWith('https://download.example/garden/')) {
      const i = Math.min(reads, opts.remotes.length - 1);
      reads += 1;
      return json(200, opts.remotes[i]);
    }
    if (method === 'PUT') {
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body)) as GardenDocument;
      puts.push({
        ifMatch: headers.get('If-Match'),
        name: body.name,
        updatedAt: body.updatedAt,
      });
      const status = opts.putStatuses?.[putsN] ?? 200;
      putsN += 1;
      if (status === 412) return json(412, { error: { message: 'precondition failed' } });
      return json(201, { eTag: '"written"' }, { etag: '"written"' });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return {
    fetchImpl,
    puts,
    get calls() {
      return calls;
    },
  };
}

describe('applyRedirectOwedSave', () => {
  it('writes the owed garden after a redirect when the account and file match', async () => {
    const storage = memoryStorage();
    owe(storage);
    const remote = graph({
      remotes: [garden(REMOTE_OLDER, 'Older OneDrive')],
      etags: ['"v1"'],
    });
    const outcome = await applyRedirectOwedSave({
      account: ACCOUNT,
      fileName: FILE,
      localDoc: garden(LOCAL_AT, 'This browser'),
      token: 'tok',
      storage,
      fetchImpl: remote.fetchImpl,
    });
    expect(outcome.kind).toBe('saved');
    expect(remote.puts).toEqual([
      { ifMatch: '"v1"', name: 'This browser', updatedAt: LOCAL_AT },
    ]);
    expect(readOwedGardenSave(storage)).toBeNull();
  });

  it('asks which copy to keep on 412 and does not write a newer remote', async () => {
    const storage = memoryStorage();
    owe(storage);
    const remote = graph({
      remotes: [garden(REMOTE_OLDER, 'Before'), garden(REMOTE_NEWER, 'Newer OneDrive')],
      etags: ['"v1"', '"v2"'],
      putStatuses: [412],
    });
    let choice: GardenCopyChoice | null = null;
    const outcome = await applyRedirectOwedSave({
      account: ACCOUNT,
      fileName: FILE,
      localDoc: garden(LOCAL_AT, 'This browser'),
      token: 'tok',
      storage,
      fetchImpl: remote.fetchImpl,
      choose: async (next) => {
        choice = next;
        return 'local';
      },
    });
    expect(choice).not.toBeNull();
    expect(choice!.localUpdatedAt).toBe(LOCAL_AT);
    expect(choice!.remoteUpdatedAt).toBe(REMOTE_NEWER);
    expect(choice!.message).toContain(LOCAL_AT);
    expect(choice!.message).toContain(REMOTE_NEWER);
    expect(gardenConflictPrompt(choice!)).toContain(LOCAL_AT);
    expect(gardenConflictPrompt(choice!)).toContain(REMOTE_NEWER);
    expect(remote.puts).toHaveLength(1);
    expect(remote.puts[0]?.ifMatch).toBe('"v1"');
    expect(outcome.kind).toBe('kept-remote');
    if (outcome.kind === 'kept-remote') {
      expect(outcome.doc.name).toBe('Newer OneDrive');
      expect(outcome.message).toContain(LOCAL_AT);
      expect(outcome.message).toContain(REMOTE_NEWER);
    }
    expect(readOwedGardenSave(storage)).toBeNull();
  });

  it('never writes a stale or empty local copy', async () => {
    const staleStore = memoryStorage();
    owe(staleStore);
    const stale = graph({
      remotes: [garden(REMOTE_NEWER, 'Newer OneDrive')],
      etags: ['"v9"'],
    });
    const staleOutcome = await applyRedirectOwedSave({
      account: ACCOUNT,
      fileName: FILE,
      localDoc: garden(LOCAL_AT, 'Old browser'),
      token: 'tok',
      storage: staleStore,
      fetchImpl: stale.fetchImpl,
    });
    expect(stale.puts).toEqual([]);
    expect(staleOutcome.kind).toBe('kept-remote');
    if (staleOutcome.kind === 'kept-remote') expect(staleOutcome.doc.name).toBe('Newer OneDrive');
    expect(readOwedGardenSave(staleStore)).toBeNull();

    const undated = graph({
      remotes: [garden(REMOTE_NEWER, 'Dated OneDrive')],
      etags: ['"v9"'],
    });
    const undatedStore = memoryStorage();
    owe(undatedStore);
    const local = garden(LOCAL_AT, 'Undated');
    delete local.updatedAt;
    const undatedOutcome = await applyRedirectOwedSave({
      account: ACCOUNT,
      fileName: FILE,
      localDoc: local,
      token: 'tok',
      storage: undatedStore,
      fetchImpl: undated.fetchImpl,
    });
    expect(undated.puts).toEqual([]);
    expect(undatedOutcome.kind).toBe('kept-remote');

    const emptyStore = memoryStorage();
    owe(emptyStore);
    let emptyCalls = 0;
    const emptyOutcome = await applyRedirectOwedSave({
      account: ACCOUNT,
      fileName: FILE,
      localDoc: emptyDocument('Untitled garden'),
      token: 'tok',
      storage: emptyStore,
      fetchImpl: async () => {
        emptyCalls += 1;
        throw new Error('empty garden must not touch OneDrive');
      },
    });
    expect(emptyCalls).toBe(0);
    expect(emptyOutcome.kind).toBe('empty');
    expect(readOwedGardenSave(emptyStore)).toBeNull();
  });

  it('ignores an owed save for a different account or file', async () => {
    const accountStore = memoryStorage();
    owe(accountStore);
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      throw new Error('mismatched owed save must not write');
    };
    const accountOutcome = await applyRedirectOwedSave({
      account: 'someone-else',
      fileName: FILE,
      localDoc: garden(LOCAL_AT),
      token: 'tok',
      storage: accountStore,
      fetchImpl,
    });
    expect(accountOutcome.kind).toBe('mismatch');
    expect(calls).toBe(0);
    expect(readOwedGardenSave(accountStore)).toBeNull();

    const fileStore = memoryStorage();
    owe(fileStore);
    const fileOutcome = await applyRedirectOwedSave({
      account: ACCOUNT,
      fileName: 'garden-v2.json',
      localDoc: garden(LOCAL_AT),
      token: 'tok',
      storage: fileStore,
      fetchImpl,
    });
    expect(fileOutcome.kind).toBe('mismatch');
    expect(calls).toBe(0);
    expect(readOwedGardenSave(fileStore)).toBeNull();

    const legacy = memoryStorage();
    legacy.setItem('garden-survey:garden-save-owed', '1');
    const legacyOutcome = await applyRedirectOwedSave({
      account: ACCOUNT,
      fileName: FILE,
      localDoc: garden(LOCAL_AT),
      token: 'tok',
      storage: legacy,
      fetchImpl,
    });
    expect(legacyOutcome.kind).toBe('absent');
    expect(calls).toBe(0);
    expect(legacy.getItem('garden-survey:garden-save-owed')).toBeNull();
  });
});

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
