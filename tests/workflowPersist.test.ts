import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setGardenCloudFileName } from '../src/cloudConfig';
import { gardenIsDirty } from '../src/gardenCloudSave';
import { emptyDocument, normalizeDocument, type GardenDocument } from '../src/model';
import { gardenCloudUiForTests, getState } from '../src/ui';
import { circleFieldTest } from '../src/workflows/guided/definitions';
import {
  WORKFLOW_MIRROR_KEY,
  commitWorkflow,
  emptyProgress,
  gardenFileKey,
  hydrateWorkflowProgress,
  readProgress,
  readWorkflowMirror,
  startWorkflow,
} from '../src/workflows/guided/engine';

const authFlag = vi.hoisted(() => ({ signedIn: false }));

vi.mock('../src/msalAuth', async () => {
  const actual = await vi.importActual<typeof import('../src/msalAuth')>('../src/msalAuth');
  return { ...actual, isSignedIn: () => authFlag.signedIn };
});

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

describe('workflow progress on the garden document', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryLocalStorage());
    authFlag.signedIn = true;
  });

  afterEach(() => {
    authFlag.signedIn = false;
    vi.unstubAllGlobals();
  });

  it('writes the local mirror and rides setDoc through the save queue', () => {
    const progress = startWorkflow(emptyProgress(), circleFieldTest.id, '2026-06-01T12:00:00.000Z').progress;
    const doc = commitWorkflow(emptyDocument('Circle day'), progress);
    expect(doc.workflowProgress?.activeId).toBe('circle-field-test');
    expect(localStorage.getItem(WORKFLOW_MIRROR_KEY)).toContain('circle-field-test');
    expect(readWorkflowMirror()?.activeId).toBe('circle-field-test');

    gardenCloudUiForTests.edit(doc);
    expect(gardenIsDirty()).toBe(true);
    expect(gardenCloudUiForTests.saveScheduled()).toBe(true);
    expect(getState().doc.workflowProgress?.runs['circle-field-test']?.currentStepId).toBe('kit');

    const round = normalizeDocument(JSON.parse(JSON.stringify(getState().doc)) as GardenDocument);
    expect(round.workflowProgress?.version).toBe(1);
    expect(round.workflowProgress?.runs['circle-field-test']?.steps.kit?.status).toBe('pending');

    const older = normalizeDocument(emptyDocument('Before workflows'));
    expect(older.workflowProgress).toBeUndefined();
    expect(readProgress(older).activeId).toBeUndefined();
    expect(hydrateWorkflowProgress(older).workflowProgress).toBeUndefined();
    expect(readWorkflowMirror()?.activeId).toBe('circle-field-test');
    expect(readWorkflowMirror(older.createdAt)).toBeNull();

    const sameGarden = emptyDocument('Same garden');
    sameGarden.createdAt = doc.createdAt;
    const hydrated = hydrateWorkflowProgress(sameGarden);
    expect(hydrated.workflowProgress?.activeId).toBe('circle-field-test');
    expect(localStorage.getItem(WORKFLOW_MIRROR_KEY)).toContain(gardenFileKey());

    setGardenCloudFileName('garden-v9.json');
    expect(hydrateWorkflowProgress(sameGarden).workflowProgress).toBeUndefined();
    setGardenCloudFileName('garden-v1.json');
    expect(hydrateWorkflowProgress(sameGarden).workflowProgress?.activeId).toBe('circle-field-test');

    const present = emptyDocument('Already has progress');
    present.createdAt = doc.createdAt;
    present.workflowProgress = emptyProgress();
    expect(hydrateWorkflowProgress(present)).toBe(present);
  });
});
