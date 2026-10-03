import { describe, expect, it } from 'vitest';
import {
  applyRedirectOwedSave,
  commitGardenSave,
  gardenConflictPrompt,
  gardenIsDirty,
  gardenRevision,
  noteLocalGardenEdit,
  noteRemoteGardenApplied,
  photosOnlyInLocal,
  reconcileGardenOnLoad,
  rememberedDriveETag,
  rememberDriveETag,
  type GardenCopyChoice,
} from '../src/gardenCloudSave';
import { markGardenSaveOwed, readOwedGardenSave, type OwedGardenSave, type OwedSaveStorage } from '../src/cloudSignIn';
import { emptyDocument, type GardenDocument, type Photo } from '../src/model';
import { loadDeletedPhotoKeys } from '../src/photosManifest';

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
      expect(outcome.preservedRevision).toBe(gardenRevision(storage));
    }
    // The UI clears the owed flag when it replaces the garden, in the same turn.
    expect(readOwedGardenSave(storage)).not.toBeNull();
    expect(readOwedGardenSave(storage)?.baseETag).toBe('"v1"');
    expect(rememberedDriveETag(ACCOUNT, FILE, storage)).toBe('');
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

  it('decides from the garden and dirty flag when the load finishes', async () => {
    const storage = memoryStorage();
    rememberDriveETag(ACCOUNT, FILE, '"v1"', storage);
    const captured = emptyDocument('Untitled garden');
    const edited = garden(LOCAL_AT, 'Typed during load');
    edited.points = [{ id: 'HSE01', kind: 'HSE', label: 'During load' }];
    const remote = graph({
      remotes: [garden(IPAD_AT, 'Cloud garden')],
      etags: ['"v1"'],
    });
    let fetchStarted = false;
    let choice: GardenCopyChoice | null = null;
    const outcome = await reconcileGardenOnLoad({
      localDoc: captured,
      fileName: FILE,
      token: 'tok',
      account: ACCOUNT,
      storage,
      fetchImpl: async (input, init) => {
        fetchStarted = true;
        return remote.fetchImpl(input, init);
      },
      readLocal: () => {
        expect(fetchStarted).toBe(true);
        return { doc: edited, dirty: true };
      },
      choose: async (next) => {
        choice = next;
        return 'local';
      },
    });
    expect(choice).not.toBeNull();
    expect(choice!.localDoc.name).toBe('Typed during load');
    expect(choice!.localDoc.points[0]?.label).toBe('During load');
    expect(choice!.localUpdatedAt).toBe(LOCAL_AT);
    expect(outcome.kind).toBe('cancelled');
    expect(remote.puts).toEqual([]);
    expect(gardenIsDirty(storage)).toBe(true);
  });

  it('prompts with the edit made during load even when the captured garden matched', async () => {
    const storage = memoryStorage();
    rememberDriveETag(ACCOUNT, FILE, '"v1"', storage);
    const captured = garden(REMOTE_OLDER, 'Local cache');
    const edited = garden(LOCAL_AT, 'Edit during load');
    edited.points = [{ id: 'HSE09', kind: 'HSE', label: 'New corner' }];
    const remote = graph({
      remotes: [garden(IPAD_AT, 'Cloud copy')],
      etags: ['"v1"'],
    });
    let choice: GardenCopyChoice | null = null;
    const outcome = await reconcileGardenOnLoad({
      localDoc: captured,
      fileName: FILE,
      token: 'tok',
      account: ACCOUNT,
      storage,
      fetchImpl: remote.fetchImpl,
      readLocal: () => ({ doc: edited, dirty: true }),
      choose: async (next) => {
        choice = next;
        return 'local';
      },
    });
    expect(choice!.localDoc.name).toBe('Edit during load');
    expect(choice!.localDoc.points[0]?.id).toBe('HSE09');
    expect(outcome.kind).toBe('cancelled');
    expect(remote.puts).toEqual([]);
  });

  it('still adopts when the garden is clean at decision time', async () => {
    const storage = memoryStorage();
    rememberDriveETag(ACCOUNT, FILE, '"v1"', storage);
    const live = garden(LOCAL_AT, 'Still the cache');
    const remote = graph({
      remotes: [garden(IPAD_AT, 'Cloud copy')],
      etags: ['"v1"'],
    });
    const outcome = await reconcileGardenOnLoad({
      localDoc: garden(REMOTE_OLDER, 'Snapshot from when load began'),
      fileName: FILE,
      token: 'tok',
      account: ACCOUNT,
      storage,
      fetchImpl: remote.fetchImpl,
      readLocal: () => ({ doc: live, dirty: false }),
      choose: async () => {
        throw new Error('clean garden at decision time must not ask');
      },
    });
    expect(outcome.kind).toBe('adopted');
    if (outcome.kind === 'adopted') expect(outcome.doc.name).toBe('Cloud copy');
    expect(gardenIsDirty(storage)).toBe(false);
    expect(remote.puts).toEqual([]);
  });
});

describe('commitGardenSave dirty flag', () => {
  it('clears dirty after a save only when nothing changed during the upload', async () => {
    const storage = memoryStorage();
    rememberDriveETag(ACCOUNT, FILE, '"v1"', storage);
    noteLocalGardenEdit(storage);
    const revision = gardenRevision(storage);
    expect(revision).toBe(1);
    const remote = graph({
      remotes: [garden(REMOTE_OLDER, 'Cloud')],
      etags: ['"v1"'],
    });
    const saved = await commitGardenSave({
      doc: garden(LOCAL_AT, 'This browser'),
      fileName: FILE,
      token: 'tok',
      ifMatch: '"v1"',
      account: ACCOUNT,
      storage,
      revision,
      fetchImpl: remote.fetchImpl,
    });
    expect(saved.ok && saved.wrote).toBe(true);
    expect(gardenIsDirty(storage)).toBe(false);
    expect(gardenRevision(storage)).toBe(revision);
    expect(rememberedDriveETag(ACCOUNT, FILE, storage)).toBe('"written"');

    noteLocalGardenEdit(storage);
    const again = gardenRevision(storage);
    let editedDuringUpload = false;
    const racing = graph({
      remotes: [garden(LOCAL_AT, 'This browser')],
      etags: ['"written"'],
    });
    const raced = await commitGardenSave({
      doc: garden(LOCAL_AT, 'This browser'),
      fileName: FILE,
      token: 'tok',
      ifMatch: '"written"',
      account: ACCOUNT,
      storage,
      revision: again,
      fetchImpl: async (input, init) => {
        const method = init?.method ?? 'GET';
        if (method === 'PUT' && !editedDuringUpload) {
          editedDuringUpload = true;
          noteLocalGardenEdit(storage);
        }
        return racing.fetchImpl(input, init);
      },
    });
    expect(editedDuringUpload).toBe(true);
    expect(raced.ok && raced.wrote).toBe(true);
    if (raced.ok && raced.wrote) expect(raced.eTag).toBe('"written"');
    expect(gardenIsDirty(storage)).toBe(true);
    expect(gardenRevision(storage)).toBe(again + 1);
    expect(rememberedDriveETag(ACCOUNT, FILE, storage)).toBe('"written"');
  });
});

function uploadingPhoto(id: string): Photo {
  return {
    id,
    setupId: 'setup-1',
    width: 64,
    height: 64,
    clicks: [],
    originalFile: {
      fileName: `${id}.jpg`,
      size: 12,
      quickXorHash: 'hash',
      uploadStatus: 'uploading',
    },
  };
}

describe('conflict copy stays current', () => {
  it('files an edit made while the conflict prompt is open, including an uploading photo', async () => {
    const storage = memoryStorage();
    noteLocalGardenEdit(storage);
    let live = garden(LOCAL_AT, 'Before prompt');
    const remote = graph({
      remotes: [garden(IPAD_AT, 'OneDrive copy')],
      etags: ['"v9"'],
    });
    const outcome = await reconcileGardenOnLoad({
      localDoc: garden(LOCAL_AT, 'Stale when the load started'),
      fileName: FILE,
      token: 'tok',
      account: ACCOUNT,
      storage,
      fetchImpl: remote.fetchImpl,
      now: () => CONFLICT_AT,
      readLocal: () => ({ doc: live, dirty: true, revision: gardenRevision(storage) }),
      choose: async (choice) => {
        expect(choice.localDoc.name).toBe('Before prompt');
        const next = garden(LOCAL_AT, 'Added during prompt');
        next.points = [
          { id: 'HSE01', kind: 'HSE', label: 'Before prompt' },
          { id: 'HSE02', kind: 'HSE', label: 'Added during prompt' },
        ];
        next.photos = [uploadingPhoto('ph-roll')];
        live = next;
        noteLocalGardenEdit(storage);
        return 'remote';
      },
    });
    expect(outcome.kind).toBe('kept-remote');
    const conflicts = remote.puts.filter((put) => put.fileName.startsWith('garden-conflict'));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.body.name).toBe('Added during prompt');
    expect(conflicts[0]?.body.points.map((point) => point.id)).toEqual(['HSE01', 'HSE02']);
    expect(conflicts[0]?.body.photos[0]?.id).toBe('ph-roll');
    expect(conflicts[0]?.body.photos[0]?.originalFile?.uploadStatus).toBe('uploading');
    expect(conflicts[0]?.body.photos[0]?.originalFile?.fileName).toBe('ph-roll.jpg');
    // Adopting may read photos/manifest.json for deletedAt. It must not write or delete that file.
    expect(remote.puts.some((put) => put.fileName.includes('manifest'))).toBe(false);
  });

  it('uploads the conflict copy again when the garden changes while it is uploading', async () => {
    const storage = memoryStorage();
    noteLocalGardenEdit(storage);
    let live = garden(LOCAL_AT, 'At the prompt');
    let bumped = false;
    const remote = graph({
      remotes: [garden(IPAD_AT, 'OneDrive copy')],
      etags: ['"v9"'],
    });
    const outcome = await commitGardenSave({
      doc: garden(LOCAL_AT, 'Stale at save start'),
      fileName: FILE,
      token: 'tok',
      ifMatch: '"v1"',
      account: ACCOUNT,
      storage,
      now: () => CONFLICT_AT,
      fetchImpl: async (input, init) => {
        const method = init?.method ?? 'GET';
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (method === 'PUT' && url.includes('garden-conflict') && !bumped) {
          bumped = true;
          const next = garden(LOCAL_AT, 'Added during upload');
          next.points = [
            { id: 'HSE01', kind: 'HSE', label: 'At the prompt' },
            { id: 'HSE02', kind: 'HSE', label: 'Added during upload' },
          ];
          live = next;
          noteLocalGardenEdit(storage);
        }
        return remote.fetchImpl(input, init);
      },
      readLocal: () => ({ doc: live, revision: gardenRevision(storage) }),
      choose: async () => 'remote',
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.wrote).toBe(false);
    const conflicts = remote.puts.filter((put) => put.fileName.startsWith('garden-conflict'));
    expect(conflicts.map((put) => put.fileName)).toEqual([
      CONFLICT_NAME,
      'garden-conflict-2026-10-03T10-00-00.000Z-r1.json',
    ]);
    expect(conflicts[1]?.body.name).toBe('Added during upload');
    expect(conflicts[1]?.body.points.map((point) => point.id)).toEqual(['HSE01', 'HSE02']);
    if (outcome.ok && !outcome.wrote) expect(outcome.preservedRevision).toBe(gardenRevision(storage));
    // Dirty and the base eTag stay until the UI replaces the garden.
    expect(gardenIsDirty(storage)).toBe(true);
    expect(rememberedDriveETag(ACCOUNT, FILE, storage)).toBe('');
    expect(remote.events.some((event) => event.includes('manifest') || event.includes('deleted'))).toBe(false);
  });

  it('does not adopt when the garden is still changing after the conflict copy is retried', async () => {
    const storage = memoryStorage();
    noteLocalGardenEdit(storage);
    let live = garden(LOCAL_AT, 'At the prompt');
    const remote = graph({
      remotes: [garden(IPAD_AT, 'OneDrive copy')],
      etags: ['"v9"'],
    });
    const outcome = await commitGardenSave({
      doc: live,
      fileName: FILE,
      token: 'tok',
      ifMatch: '"v1"',
      account: ACCOUNT,
      storage,
      now: () => CONFLICT_AT,
      fetchImpl: async (input, init) => {
        const method = init?.method ?? 'GET';
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (method === 'PUT' && url.includes('garden-conflict')) {
          live = garden(LOCAL_AT, 'Still moving');
          noteLocalGardenEdit(storage);
        }
        return remote.fetchImpl(input, init);
      },
      readLocal: () => ({ doc: live, revision: gardenRevision(storage) }),
      choose: async () => 'remote',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.cancelled).toBe(true);
      expect(outcome.error).toMatch(/Nothing was replaced/);
    }
    expect(remote.puts.filter((put) => put.fileName.startsWith('garden-conflict'))).toHaveLength(2);
    expect(gardenIsDirty(storage)).toBe(true);
    expect(rememberedDriveETag(ACCOUNT, FILE, storage)).toBe('');
  });
});

describe('save generation and in-memory revision', () => {
  it('does not store the eTag or clear dirty when the garden is replaced during the upload', async () => {
    const storage = memoryStorage();
    rememberDriveETag(ACCOUNT, FILE, '"v1"', storage);
    noteLocalGardenEdit(storage);
    const remote = graph({
      remotes: [garden(REMOTE_OLDER, 'Cloud')],
      etags: ['"v1"'],
    });
    const saved = await commitGardenSave({
      doc: garden(LOCAL_AT, 'In flight'),
      fileName: FILE,
      token: 'tok',
      ifMatch: '"v1"',
      account: ACCOUNT,
      storage,
      revision: gardenRevision(storage),
      fetchImpl: async (input, init) => {
        if ((init?.method ?? 'GET') === 'PUT') noteRemoteGardenApplied();
        return remote.fetchImpl(input, init);
      },
    });
    expect(saved.ok && saved.wrote && saved.superseded).toBe(true);
    expect(gardenIsDirty(storage)).toBe(true);
    expect(gardenRevision(storage)).toBe(1);
    expect(rememberedDriveETag(ACCOUNT, FILE, storage)).toBe('"v1"');
  });

  it('keeps the revision and dirty flag when localStorage writes throw', () => {
    const storage: OwedSaveStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(gardenRevision(storage)).toBe(0);
    expect(gardenIsDirty(storage)).toBe(false);
    expect(noteLocalGardenEdit(storage)).toBe(1);
    expect(noteLocalGardenEdit(storage)).toBe(2);
    expect(gardenRevision(storage)).toBe(2);
    expect(gardenIsDirty(storage)).toBe(true);
  });
});

describe('conflict prompt and local-only photos', () => {
  it('does not hold the save lock while the conflict prompt is open, then re-checks the eTag', async () => {
    const storage = memoryStorage();
    const remote = graph({
      remotes: [garden(IPAD_AT, 'OneDrive copy')],
      etags: ['"v9"'],
    });
    let depth = 0;
    let depthAtPrompt = -1;
    let depthAtConflictPut = -1;
    const outcome = await commitGardenSave({
      doc: garden(LOCAL_AT, 'This browser'),
      fileName: FILE,
      token: 'tok',
      ifMatch: '"v1"',
      account: ACCOUNT,
      storage,
      now: () => CONFLICT_AT,
      usingLock: async (fn) => {
        depth += 1;
        try {
          return await fn();
        } finally {
          depth -= 1;
        }
      },
      fetchImpl: async (input, init) => {
        const method = init?.method ?? 'GET';
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (method === 'PUT' && url.includes('garden-conflict')) depthAtConflictPut = depth;
        return remote.fetchImpl(input, init);
      },
      choose: async () => {
        depthAtPrompt = depth;
        return 'remote';
      },
    });
    expect(depthAtPrompt).toBe(0);
    expect(depthAtConflictPut).toBe(1);
    expect(depth).toBe(0);
    expect(outcome.ok && !outcome.wrote).toBe(true);
  });

  it('asks again when OneDrive changes while the prompt is open, and adopts the newer copy', async () => {
    const storage = memoryStorage();
    const first = garden(IPAD_AT, 'First remote');
    const moved = garden(REMOTE_NEWER, 'Moved remote');
    const remote = graph({
      remotes: [first, moved, moved],
      etags: ['"v2"', '"v3"', '"v3"'],
    });
    const seen: string[] = [];
    const outcome = await commitGardenSave({
      doc: garden(LOCAL_AT, 'This browser'),
      fileName: FILE,
      token: 'tok',
      ifMatch: '"v1"',
      account: ACCOUNT,
      storage,
      now: () => CONFLICT_AT,
      fetchImpl: remote.fetchImpl,
      choose: async (choice) => {
        seen.push(choice.remoteETag);
        return 'remote';
      },
    });
    expect(seen).toEqual(['"v2"', '"v3"']);
    expect(outcome.ok && !outcome.wrote && outcome.kept === 'remote').toBe(true);
    if (outcome.ok && !outcome.wrote) {
      expect(outcome.doc.name).toBe('Moved remote');
      expect(outcome.eTag).toBe('"v3"');
    }
    expect(remote.puts.filter((put) => put.fileName.startsWith('garden-conflict'))).toHaveLength(1);
  });

  it('reports photos that exist only in the filed local copy', async () => {
    const storage = memoryStorage();
    const local = garden(LOCAL_AT, 'With a roll');
    local.photos = [uploadingPhoto('ph-roll')];
    const remote = graph({
      remotes: [garden(IPAD_AT, 'OneDrive copy')],
      etags: ['"v9"'],
    });
    const outcome = await commitGardenSave({
      doc: local,
      fileName: FILE,
      token: 'tok',
      ifMatch: '"v1"',
      account: ACCOUNT,
      storage,
      now: () => CONFLICT_AT,
      fetchImpl: remote.fetchImpl,
      choose: async () => 'remote',
    });
    expect(outcome.ok && !outcome.wrote).toBe(true);
    if (outcome.ok && !outcome.wrote) {
      expect(outcome.localOnlyPhotos.map((photo) => photo.id)).toEqual(['ph-roll']);
      expect(outcome.localOnlyPhotos[0]?.originalFile?.uploadStatus).toBe('uploading');
      expect(outcome.localOnlyPhotos[0]?.originalFile?.fileName).toBe('ph-roll.jpg');
    }
    const filed = remote.puts.find((put) => put.fileName.startsWith('garden-conflict'));
    expect(filed?.body.photos[0]?.id).toBe('ph-roll');
    expect(remote.puts.some((put) => put.fileName.includes('manifest'))).toBe(false);
  });

  it('leaves out photos recorded as deleted in the manifest or photos/deleted/', async () => {
    const storage = memoryStorage();
    const local = garden(LOCAL_AT, 'With rolls');
    local.photos = [uploadingPhoto('ph-dead'), uploadingPhoto('ph-moved'), uploadingPhoto('ph-roll')];
    const remoteGarden = garden(IPAD_AT, 'OneDrive copy');
    const remote = graph({ remotes: [remoteGarden], etags: ['"v9"'] });
    const left = photosOnlyInLocal(local, remoteGarden, {
      photoIds: ['ph-dead'],
      fileNames: ['ph-moved.jpg'],
    });
    expect(left.map((photo) => photo.id)).toEqual(['ph-roll']);

    const outcome = await commitGardenSave({
      doc: local,
      fileName: FILE,
      token: 'tok',
      ifMatch: '"v1"',
      account: ACCOUNT,
      storage,
      now: () => CONFLICT_AT,
      choose: async () => 'remote',
      fetchImpl: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (url.includes('photos/manifest.json') && url.includes('$select=')) {
          return json(200, {
            eTag: '"manifest"',
            '@microsoft.graph.downloadUrl': 'https://download.example/manifest',
          });
        }
        if (url === 'https://download.example/manifest') {
          return json(200, {
            version: 1,
            updatedAt: '2026-10-03T12:00:00.000Z',
            photos: [{ photoId: 'ph-dead', fileName: 'ph-dead.jpg', deletedAt: '2026-10-03T12:00:00.000Z' }],
          });
        }
        if (url.includes('/photos/deleted') && url.includes('children')) {
          return json(200, { value: [{ name: 'ph-moved.jpg' }] });
        }
        return remote.fetchImpl(input, init);
      },
    });
    expect(outcome.ok && !outcome.wrote).toBe(true);
    if (outcome.ok && !outcome.wrote) {
      expect(outcome.localOnlyPhotos.map((photo) => photo.id)).toEqual(['ph-roll']);
    }
    const filed = remote.puts.find((put) => put.fileName.startsWith('garden-conflict'));
    expect(filed?.body.photos.map((photo) => photo.id)).toEqual(['ph-dead', 'ph-moved', 'ph-roll']);
    expect(remote.puts.some((put) => put.fileName.includes('manifest'))).toBe(false);
  });

  it('keeps an edit made while deleted photos are being listed', async () => {
    const storage = memoryStorage();
    noteLocalGardenEdit(storage);
    let live = garden(LOCAL_AT, 'Before lookup');
    const remote = graph({
      remotes: [garden(IPAD_AT, 'OneDrive copy')],
      etags: ['"v9"'],
    });
    const order: string[] = [];
    const outcome = await commitGardenSave({
      doc: live,
      fileName: FILE,
      token: 'tok',
      ifMatch: '"v1"',
      account: ACCOUNT,
      storage,
      now: () => CONFLICT_AT,
      readLocal: () => ({ doc: live, dirty: true, revision: gardenRevision(storage) }),
      choose: async () => 'remote',
      fetchImpl: async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const method = init?.method ?? 'GET';
        if (url.includes('photos/manifest.json') || url.includes('download.example/manifest')) {
          order.push('manifest');
          if (order.filter((step) => step === 'manifest').length === 1) {
            const next = garden(LOCAL_AT, 'Added during deleted lookup');
            next.points = [
              { id: 'HSE01', kind: 'HSE', label: 'Before lookup' },
              { id: 'HSE02', kind: 'HSE', label: 'Added during deleted lookup' },
            ];
            live = next;
            noteLocalGardenEdit(storage);
          }
          if (url.includes('$select=')) {
            return json(200, {
              eTag: '"manifest"',
              '@microsoft.graph.downloadUrl': 'https://download.example/manifest',
            });
          }
          return json(200, { version: 1, updatedAt: '', photos: [] });
        }
        if (url.includes('/photos/deleted') && url.includes('children')) {
          order.push('deleted');
          return json(200, { value: [] });
        }
        if (method === 'PUT' && url.includes('garden-conflict')) order.push('conflict');
        return remote.fetchImpl(input, init);
      },
    });
    expect(order.indexOf('manifest')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('conflict')).toBeGreaterThan(order.indexOf('manifest'));
    expect(order.indexOf('deleted')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('conflict')).toBeGreaterThan(order.indexOf('deleted'));
    const conflicts = remote.puts.filter((put) => put.fileName.startsWith('garden-conflict'));
    const filed = conflicts.some((put) => put.body.points.some((point) => point.id === 'HSE02'));
    const aborted = !outcome.ok && outcome.cancelled === true && live.points.some((point) => point.id === 'HSE02');
    expect(filed || aborted).toBe(true);
    if (outcome.ok && !outcome.wrote) {
      expect(filed).toBe(true);
      expect(conflicts.at(-1)?.body.points.map((point) => point.id)).toContain('HSE02');
    } else {
      expect(gardenIsDirty(storage)).toBe(true);
      expect(rememberedDriveETag(ACCOUNT, FILE, storage)).not.toBe('"v9"');
    }
  });

  it('reads every page of photos/deleted', async () => {
    const keys = await loadDeletedPhotoKeys({
      client: {
        token: 'tok',
        fetch: async (input) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
          if (url.includes('manifest')) return json(404, {});
          if (url.includes('children')) {
            return json(200, {
              value: [{ name: 'page-one.jpg' }],
              '@odata.nextLink': 'https://graph.example/deleted?page=2',
            });
          }
          if (url.includes('page=2')) return json(200, { value: [{ name: 'page-two.jpg' }] });
          return json(404, {});
        },
      },
      manifestPath: 'Garden Survey/photos/manifest.json',
      deletedFolderPath: 'Garden Survey/photos/deleted',
    });
    expect(keys.fileNames).toEqual(['page-one.jpg', 'page-two.jpg']);
  });
});

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
