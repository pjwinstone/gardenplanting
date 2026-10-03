import { describe, expect, it } from 'vitest';
import {
  applyRedirectOwedSave,
  commitGardenSave,
  gardenConflictPrompt,
  gardenIsDirty,
  noteLocalGardenEdit,
  reconcileGardenOnLoad,
  rememberDriveETag,
  type GardenCopyChoice,
} from '../src/gardenCloudSave';
import { markGardenSaveOwed, readOwedGardenSave, type OwedGardenSave, type OwedSaveStorage } from '../src/cloudSignIn';
import { emptyDocument, type GardenDocument } from '../src/model';

const FILE = 'garden-v1.json';
const ACCOUNT = 'home-account';
const LOCAL_AT = '2026-10-03T10:00:00.000Z';
const REMOTE_OLDER = '2026-10-03T09:00:00.000Z';
const REMOTE_NEWER = '2026-10-03T11:00:00.000Z';
const IPAD_AT = '2026-10-03T10:30:00.000Z';
const CONFLICT_AT = '2026-10-03T10:00:00.000Z';
const CONFLICT_NAME = 'garden-conflict-2026-10-03T10-00-00.000Z.json';

interface PutRecord {
  ifMatch: string | null;
  ifNoneMatch: string | null;
  name: string;
  fileName: string;
  updatedAt?: string;
  body: GardenDocument;
}

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

function gardenFileFromUrl(url: string): string {
  const decoded = decodeURIComponent(url);
  const match = decoded.match(/Garden Survey\/([^?]+)/);
  if (!match?.[1]) return '';
  return match[1].replace(/:\/content$/, '').replace(/:$/, '');
}

function graph(opts: {
  remotes: GardenDocument[];
  etags: string[];
  putStatuses?: number[];
  /** First metadata read is 404 until a 412 PUT, then later reads use remotes. */
  missing?: boolean;
}): {
  fetchImpl: typeof fetch;
  puts: PutRecord[];
  events: string[];
} {
  let reads = 0;
  let putsN = 0;
  let saw412 = false;
  const puts: PutRecord[] = [];
  const events: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const fileName = gardenFileFromUrl(url);
    if (method === 'POST') return json(409, { error: { code: 'nameAlreadyExists' } });
    if (method === 'GET' && url.includes('$select=')) {
      events.push(`GET ${fileName}`);
      if (opts.missing && !saw412) return json(404, {});
      const i = Math.min(reads, Math.max(opts.remotes.length - 1, 0));
      return json(200, {
        eTag: opts.etags[Math.min(reads, Math.max(opts.etags.length - 1, 0))],
        lastModifiedDateTime: opts.remotes[i]?.updatedAt,
        '@microsoft.graph.downloadUrl': `https://download.example/garden/${i}`,
      });
    }
    if (url.startsWith('https://download.example/garden/')) {
      events.push(`BODY ${fileName || url}`);
      const i = Math.min(reads, Math.max(opts.remotes.length - 1, 0));
      reads += 1;
      return json(200, opts.remotes[i]);
    }
    if (method === 'PUT') {
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body)) as GardenDocument;
      puts.push({
        ifMatch: headers.get('If-Match'),
        ifNoneMatch: headers.get('If-None-Match'),
        name: body.name,
        fileName,
        updatedAt: body.updatedAt,
        body,
      });
      events.push(`PUT ${fileName}`);
      const status = opts.putStatuses?.[putsN] ?? 200;
      putsN += 1;
      if (status === 412) {
        saw412 = true;
        return json(412, { error: { message: 'precondition failed' } });
      }
      if (status !== 200 && status !== 201) {
        return json(status, { error: { message: 'put failed' } });
      }
      return json(201, { eTag: '"written"' }, { etag: '"written"' });
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fetchImpl, puts, events };
}

describe('applyRedirectOwedSave', () => {
  it('writes the owed garden after a redirect when the eTags match', async () => {
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
    expect(remote.puts).toHaveLength(1);
    expect(remote.puts[0]).toMatchObject({
      ifMatch: '"v1"',
      ifNoneMatch: null,
      name: 'This browser',
      fileName: FILE,
      updatedAt: LOCAL_AT,
    });
    expect(readOwedGardenSave(storage)).toBeNull();
  });

  it('keeps the phone edits when the iPad saved later, and files them before adopting', async () => {
    const storage = memoryStorage();
    owe(storage, { docUpdatedAt: LOCAL_AT });
    const phone = garden(LOCAL_AT, 'Phone edit');
    phone.points = [{ id: 'HSE01', kind: 'HSE', label: 'Phone corner' }];
    const ipad = garden(IPAD_AT, 'iPad save');
    ipad.points = [{ id: 'HSE02', kind: 'HSE', label: 'iPad corner' }];
    const remote = graph({ remotes: [ipad], etags: ['"v2"'] });
    let choice: GardenCopyChoice | null = null;
    const outcome = await applyRedirectOwedSave({
      account: ACCOUNT,
      fileName: FILE,
      localDoc: phone,
      token: 'tok',
      storage,
      fetchImpl: remote.fetchImpl,
      now: () => CONFLICT_AT,
      choose: async (next) => {
        choice = next;
        remote.events.push('choose');
        return 'remote';
      },
    });
    expect(choice).not.toBeNull();
    expect(choice!.localUpdatedAt).toBe(LOCAL_AT);
    expect(choice!.remoteUpdatedAt).toBe(IPAD_AT);
    expect(choice!.localDoc.points[0]?.label).toBe('Phone corner');
    expect(choice!.message).toContain(LOCAL_AT);
    expect(choice!.message).toContain(IPAD_AT);
    expect(gardenConflictPrompt(choice!)).toContain('Times are only a guide');
    const chooseAt = remote.events.indexOf('choose');
    const conflictAt = remote.events.indexOf(`PUT ${CONFLICT_NAME}`);
    expect(chooseAt).toBeGreaterThanOrEqual(0);
    expect(conflictAt).toBeGreaterThan(chooseAt);
    expect(remote.events.some((event) => event === `PUT ${FILE}`)).toBe(false);
    expect(remote.puts).toHaveLength(1);
    expect(remote.puts[0]).toMatchObject({
      fileName: CONFLICT_NAME,
      ifNoneMatch: '*',
      ifMatch: null,
      name: 'Phone edit',
      updatedAt: LOCAL_AT,
    });
    expect(remote.puts[0]?.body.points[0]?.label).toBe('Phone corner');
    expect(outcome.kind).toBe('kept-remote');
    if (outcome.kind === 'kept-remote') {
      expect(outcome.doc.name).toBe('iPad save');
      expect(outcome.doc.points[0]?.label).toBe('iPad corner');
      expect(outcome.preservedAs).toContain(CONFLICT_NAME);
      expect(outcome.message).toContain(CONFLICT_NAME);
      expect(outcome.message).toContain('/Garden Survey/');
    }
    expect(readOwedGardenSave(storage)).toBeNull();
  });

  it('Cancel at a 412 writes nothing further and adopts nothing', async () => {
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
    expect(remote.puts).toHaveLength(1);
    expect(remote.puts[0]).toMatchObject({ ifMatch: '"v1"', fileName: FILE });
    expect(outcome.kind).toBe('cancelled');
    if (outcome.kind === 'cancelled') {
      expect(outcome.message).toMatch(/still waiting/i);
    }
    expect(readOwedGardenSave(storage)?.baseETag).toBe('"v1"');
  });

  it('ignores clock skew when the eTag matches, and still asks when it does not', async () => {
    const matching = memoryStorage();
    owe(matching);
    let asked = 0;
    const sameTag = graph({
      remotes: [garden(REMOTE_NEWER, 'Clock ahead')],
      etags: ['"v1"'],
    });
    const wrote = await applyRedirectOwedSave({
      account: ACCOUNT,
      fileName: FILE,
      localDoc: garden(LOCAL_AT, 'Clock behind'),
      token: 'tok',
      storage: matching,
      fetchImpl: sameTag.fetchImpl,
      choose: async () => {
        asked += 1;
        return 'remote';
      },
    });
    expect(asked).toBe(0);
    expect(wrote.kind).toBe('saved');
    expect(sameTag.puts).toHaveLength(1);
    expect(sameTag.puts[0]).toMatchObject({
      ifMatch: '"v1"',
      fileName: FILE,
      name: 'Clock behind',
      updatedAt: LOCAL_AT,
    });

    const differing = memoryStorage();
    owe(differing);
    const localLater = garden('2026-10-03T12:00:00.000Z', 'Clock ahead locally');
    const remoteEarlier = garden(LOCAL_AT, 'Earlier OneDrive');
    const skew = graph({ remotes: [remoteEarlier], etags: ['"v2"'] });
    const askedSkew = await applyRedirectOwedSave({
      account: ACCOUNT,
      fileName: FILE,
      localDoc: localLater,
      token: 'tok',
      storage: differing,
      fetchImpl: skew.fetchImpl,
      choose: async (choice) => {
        asked += 1;
        expect(choice.localUpdatedAt).toBe('2026-10-03T12:00:00.000Z');
        expect(choice.remoteUpdatedAt).toBe(LOCAL_AT);
        return 'local';
      },
    });
    expect(asked).toBe(1);
    expect(skew.puts).toEqual([]);
    expect(askedSkew.kind).toBe('cancelled');
    expect(readOwedGardenSave(differing)).not.toBeNull();
  });

  it('creates a missing garden with If-None-Match, and a 412 there asks', async () => {
    const storage = memoryStorage();
    owe(storage, { baseETag: '' });
    const created = graph({ remotes: [], etags: [], missing: true });
    const outcome = await applyRedirectOwedSave({
      account: ACCOUNT,
      fileName: FILE,
      localDoc: garden(LOCAL_AT, 'First save'),
      token: 'tok',
      storage,
      fetchImpl: created.fetchImpl,
    });
    expect(outcome.kind).toBe('saved');
    expect(created.puts).toHaveLength(1);
    expect(created.puts[0]).toMatchObject({
      ifNoneMatch: '*',
      ifMatch: null,
      fileName: FILE,
      name: 'First save',
    });
    expect(readOwedGardenSave(storage)).toBeNull();

    const raced = memoryStorage();
    owe(raced, { baseETag: '' });
    const remote = graph({
      remotes: [garden(IPAD_AT, 'Created elsewhere')],
      etags: ['"v9"'],
      missing: true,
      putStatuses: [412],
    });
    let prompted = false;
    const conflict = await applyRedirectOwedSave({
      account: ACCOUNT,
      fileName: FILE,
      localDoc: garden(LOCAL_AT, 'First save'),
      token: 'tok',
      storage: raced,
      fetchImpl: remote.fetchImpl,
      choose: async (choice) => {
        prompted = true;
        expect(choice.remoteETag).toBe('"v9"');
        expect(choice.remoteUpdatedAt).toBe(IPAD_AT);
        return 'local';
      },
    });
    expect(prompted).toBe(true);
    expect(remote.puts).toHaveLength(1);
    expect(remote.puts[0]).toMatchObject({ ifNoneMatch: '*', ifMatch: null, fileName: FILE });
    expect(conflict.kind).toBe('cancelled');
    expect(readOwedGardenSave(raced)).not.toBeNull();
  });

  it('does not adopt when the conflict file cannot be uploaded', async () => {
    const storage = memoryStorage();
    owe(storage);
    noteLocalGardenEdit(storage);
    const phone = garden(LOCAL_AT, 'Phone edit');
    const offline = graph({
      remotes: [garden(IPAD_AT, 'iPad save')],
      etags: ['"v2"'],
      putStatuses: [500],
    });
    const downloaded: { name: string; label?: string }[] = [];
    const outcome = await applyRedirectOwedSave({
      account: ACCOUNT,
      fileName: FILE,
      localDoc: phone,
      token: 'tok',
      storage,
      fetchImpl: offline.fetchImpl,
      now: () => CONFLICT_AT,
      choose: async () => 'remote',
      downloadLocal: (doc, name) => {
        downloaded.push({ name, label: doc.points[0]?.label });
      },
    });
    expect(downloaded).toEqual([{ name: CONFLICT_NAME, label: 'Phone edit' }]);
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.error).toMatch(/Nothing was replaced/);
    expect(offline.puts.some((put) => put.fileName === FILE)).toBe(false);
    expect(readOwedGardenSave(storage)).not.toBeNull();
    expect(gardenIsDirty(storage)).toBe(true);
  });

  it('asks instead of writing when OneDrive has a garden and this browser has no eTag', async () => {
    const storage = memoryStorage();
    owe(storage, { baseETag: '' });
    const remote = graph({
      remotes: [garden(IPAD_AT, 'Already there')],
      etags: ['"v4"'],
    });
    let asked = false;
    const outcome = await applyRedirectOwedSave({
      account: ACCOUNT,
      fileName: FILE,
      localDoc: garden(LOCAL_AT, 'No base'),
      token: 'tok',
      storage,
      fetchImpl: remote.fetchImpl,
      choose: async () => {
        asked = true;
        return 'local';
      },
    });
    expect(asked).toBe(true);
    expect(remote.puts).toEqual([]);
    expect(outcome.kind).toBe('cancelled');
    expect(readOwedGardenSave(storage)).not.toBeNull();
  });

  it('never writes an empty local garden', async () => {
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

  it('asks an auto-save at most once until the user acts or the eTag changes', async () => {
    const storage = memoryStorage();
    let asks = 0;
    const choose = async () => {
      asks += 1;
      return 'local' as const;
    };
    const first = graph({ remotes: [garden(IPAD_AT, 'iPad')], etags: ['"v2"'] });
    const opened = await commitGardenSave({
      doc: garden(LOCAL_AT, 'Phone'),
      fileName: FILE,
      token: 'tok',
      ifMatch: '"v1"',
      account: ACCOUNT,
      storage,
      prompt: 'auto',
      fetchImpl: first.fetchImpl,
      choose,
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.cancelled).toBe(true);
    expect(asks).toBe(1);

    const again = graph({ remotes: [garden(IPAD_AT, 'iPad')], etags: ['"v2"'] });
    const skipped = await commitGardenSave({
      doc: garden(LOCAL_AT, 'Phone'),
      fileName: FILE,
      token: 'tok',
      ifMatch: '"v1"',
      account: ACCOUNT,
      storage,
      prompt: 'auto',
      fetchImpl: again.fetchImpl,
      choose,
    });
    expect(asks).toBe(1);
    expect(again.puts).toEqual([]);
    expect(skipped.ok).toBe(false);
    if (!skipped.ok) expect(skipped.deferred).toBe(true);

    const explicit = graph({ remotes: [garden(IPAD_AT, 'iPad')], etags: ['"v2"'] });
    await commitGardenSave({
      doc: garden(LOCAL_AT, 'Phone'),
      fileName: FILE,
      token: 'tok',
      ifMatch: '"v1"',
      account: ACCOUNT,
      storage,
      prompt: 'user',
      fetchImpl: explicit.fetchImpl,
      choose,
    });
    expect(asks).toBe(2);

    const moved = graph({ remotes: [garden(REMOTE_NEWER, 'iPad again')], etags: ['"v3"'] });
    await commitGardenSave({
      doc: garden(LOCAL_AT, 'Phone'),
      fileName: FILE,
      token: 'tok',
      ifMatch: '"v1"',
      account: ACCOUNT,
      storage,
      prompt: 'auto',
      fetchImpl: moved.fetchImpl,
      choose,
    });
    expect(asks).toBe(3);
    expect(moved.puts).toEqual([]);
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

describe('reconcileGardenOnLoad', () => {
  it('prompts on sign-in after a signed-out edit and does not overwrite', async () => {
    const storage = memoryStorage();
    noteLocalGardenEdit(storage);
    expect(readOwedGardenSave(storage)).toBeNull();
    expect(gardenIsDirty(storage)).toBe(true);
    const local = garden(LOCAL_AT, 'Signed-out edit');
    local.points = [{ id: 'HSE01', kind: 'HSE', label: 'Signed-out corner' }];
    const remote = graph({
      remotes: [garden(IPAD_AT, 'iPad save')],
      etags: ['"v2"'],
    });
    let asked = false;
    const outcome = await reconcileGardenOnLoad({
      localDoc: local,
      fileName: FILE,
      token: 'tok',
      account: ACCOUNT,
      storage,
      fetchImpl: remote.fetchImpl,
      choose: async (choice) => {
        asked = true;
        expect(choice.localDoc.name).toBe('Signed-out edit');
        expect(choice.localDoc.points[0]?.label).toBe('Signed-out corner');
        expect(choice.remoteDoc.name).toBe('iPad save');
        expect(choice.remoteETag).toBe('"v2"');
        return 'local';
      },
    });
    expect(asked).toBe(true);
    expect(outcome.kind).toBe('cancelled');
    expect(remote.puts).toEqual([]);
    expect(gardenIsDirty(storage)).toBe(true);
  });

  it('keeps an edit made just before the redirect', async () => {
    const storage = memoryStorage();
    rememberDriveETag(ACCOUNT, FILE, '"v1"', storage);
    noteLocalGardenEdit(storage);
    expect(readOwedGardenSave(storage)).toBeNull();
    const local = garden(LOCAL_AT, 'Edit before redirect');
    const remote = graph({
      remotes: [garden(REMOTE_OLDER, 'Last cloud save')],
      etags: ['"v1"'],
    });
    let asked = false;
    const outcome = await reconcileGardenOnLoad({
      localDoc: local,
      fileName: FILE,
      token: 'tok',
      account: ACCOUNT,
      storage,
      fetchImpl: remote.fetchImpl,
      choose: async (choice) => {
        asked = true;
        expect(choice.localUpdatedAt).toBe(LOCAL_AT);
        expect(choice.localDoc.name).toBe('Edit before redirect');
        expect(choice.remoteETag).toBe('"v1"');
        return 'local';
      },
    });
    expect(asked).toBe(true);
    expect(outcome.kind).toBe('cancelled');
    expect(remote.puts).toEqual([]);
    expect(gardenIsDirty(storage)).toBe(true);
  });

  it('adopts an empty local garden without asking', async () => {
    const storage = memoryStorage();
    noteLocalGardenEdit(storage);
    const remote = graph({
      remotes: [garden(IPAD_AT, 'Cloud garden')],
      etags: ['"v2"'],
    });
    const outcome = await reconcileGardenOnLoad({
      localDoc: emptyDocument('Untitled garden'),
      fileName: FILE,
      token: 'tok',
      account: ACCOUNT,
      storage,
      fetchImpl: remote.fetchImpl,
      choose: async () => {
        throw new Error('empty local must not ask');
      },
    });
    expect(outcome.kind).toBe('adopted');
    if (outcome.kind === 'adopted') {
      expect(outcome.silent).toBe(true);
      expect(outcome.doc.name).toBe('Cloud garden');
      expect(outcome.eTag).toBe('"v2"');
    }
    expect(remote.puts).toEqual([]);
    expect(gardenIsDirty(storage)).toBe(false);
  });

  it('adopts silently when the eTag matches and the local garden is clean', async () => {
    const storage = memoryStorage();
    rememberDriveETag(ACCOUNT, FILE, '"v1"', storage);
    expect(gardenIsDirty(storage)).toBe(false);
    const remote = graph({
      remotes: [garden(IPAD_AT, 'Cloud copy')],
      etags: ['"v1"'],
    });
    const outcome = await reconcileGardenOnLoad({
      localDoc: garden(LOCAL_AT, 'Local cache'),
      fileName: FILE,
      token: 'tok',
      account: ACCOUNT,
      storage,
      fetchImpl: remote.fetchImpl,
      choose: async () => {
        throw new Error('clean matching eTag must not ask');
      },
    });
    expect(outcome.kind).toBe('adopted');
    if (outcome.kind === 'adopted') {
      expect(outcome.silent).toBe(true);
      expect(outcome.doc.name).toBe('Cloud copy');
    }
    expect(remote.puts).toEqual([]);
    expect(gardenIsDirty(storage)).toBe(false);
    expect(readOwedGardenSave(storage)).toBeNull();
  });
});

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
