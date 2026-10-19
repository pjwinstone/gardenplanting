import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachRollerWheel } from '../src/workflows/guided/guidedRoller';
import { emptyDocument } from '../src/model';
import { commitWorkflow, confirmSetupWorkflow, emptyProgress, readProgress, scrollWorkflowToStep, startWorkflow } from '../src/workflows/guided/engine';
import { handleWorkflowCommand } from '../src/workflows/guided/guidedChrome';

const ROW = 44;
const IDS = ['setup', 'gather-kit', 'set-out-circle', 'tape-diameters', 'place-baseline-points'];

class FakeList extends EventTarget {
  isConnected = true;
  clientHeight = 5 * ROW;
  scrollTop = 0;
  rows = IDS.map((id, i) => ({ dataset: { stepId: id }, offsetTop: 2 * ROW + i * ROW, offsetHeight: ROW, style: {} as Record<string, string> }));
  querySelectorAll() {
    return this.rows;
  }
}

function wheelFor(list: FakeList) {
  return { querySelector: () => list } as unknown as HTMLElement;
}

describe('roller settle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      requestAnimationFrame: (fn: () => void) => globalThis.setTimeout(fn, 0),
      matchMedia: () => ({ matches: false }),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a user scroll settles on the row under the capsule', () => {
    const list = new FakeList();
    const onSettle = vi.fn();
    attachRollerWheel(wheelFor(list), IDS, 'setup', onSettle);
    list.dispatchEvent(new Event('touchstart'));
    list.scrollTop = ROW; // gather-kit centred
    list.dispatchEvent(new Event('scroll'));
    list.dispatchEvent(new Event('touchend'));
    vi.advanceTimersByTime(200);
    expect(onSettle).toHaveBeenCalledWith('gather-kit');
  });

  it('a re-render mid-scroll does not snap back to Set-up from the detached list', () => {
    const list = new FakeList();
    list.scrollTop = 2 * ROW; // on set-out-circle
    const onSettle = vi.fn();
    attachRollerWheel(wheelFor(list), IDS, 'set-out-circle', onSettle);
    list.dispatchEvent(new Event('touchstart'));
    list.dispatchEvent(new Event('scroll'));
    list.dispatchEvent(new Event('touchend'));
    // re-render: the old list leaves the document and measures 0 everywhere
    list.isConnected = false;
    list.clientHeight = 0;
    list.scrollTop = 0;
    for (const row of list.rows) row.offsetTop = 0;
    vi.advanceTimersByTime(500);
    expect(onSettle).not.toHaveBeenCalled();
  });

  it('a programmatic scroll on render (no touch) never commits a step', () => {
    const list = new FakeList();
    const onSettle = vi.fn();
    attachRollerWheel(wheelFor(list), IDS, 'gather-kit', onSettle);
    list.scrollTop = 0;
    list.dispatchEvent(new Event('scroll'));
    list.dispatchEvent(new Event('scrollend'));
    vi.advanceTimersByTime(500);
    expect(onSettle).not.toHaveBeenCalled();
  });
});

describe('row pills and Confirm', () => {
  const NOW = '2026-06-01T12:00:00.000Z';

  it('Take photos opens the camera for that camera position, not the point-type chooser', () => {
    let progress = startWorkflow(emptyProgress(), 'circle-field-test', NOW).progress;
    progress = confirmSetupWorkflow(progress, undefined, NOW).progress;
    progress = scrollWorkflowToStep(progress, 'camera-left', NOW).progress;
    const doc = commitWorkflow(emptyDocument('Circle day'), progress);
    const result = handleWorkflowCommand('workflow-go', doc, {
      getAttribute: (name: string) => (name === 'data-step' ? 'camera-left' : null),
    });
    expect(result.link).toEqual({ to: 'camera', stepId: 'camera-left', cameraPositionId: 'Left' });
  });

  it('Confirm then a settle-and-re-render keeps the new step', () => {
    const doc = commitWorkflow(emptyDocument('Circle day'), startWorkflow(emptyProgress(), 'circle-field-test', NOW).progress);
    const confirmed = handleWorkflowCommand('workflow-confirm-setup', doc, { getAttribute: () => null }).doc!;
    expect(readProgress(confirmed).runs['circle-field-test']?.currentStepId).toBe('gather-kit');
    // the detached-list settle that used to fire after the re-render is now ignored (see above),
    // so nothing writes 'setup' back.
    expect(readProgress(confirmed).runs['circle-field-test']?.setup?.status).toBe('confirmed');
  });
});
