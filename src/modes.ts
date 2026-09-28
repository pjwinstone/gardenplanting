import type { GardenDocument, SessionMode } from './model';
import {
  hasLiveControl,
  baselineReady,
  baselineTieReady,
  currentSetup,
  declareRodA,
  houseCornerCount,
  housePolygon,
} from './model';

/** Mode-changing actions (buttons). */
export type ModeAction =
  | 'establish_baseline'
  | 'take_baseline_tie'
  | 'measure_house_edges'
  | 'close_house'
  | 'place_helper_rod'
  | 'add_point'
  | 'another_photo_yaw'
  | 'start_leapfrog'
  | 'rods_moved'
  | 'fence_mark'
  | 'adjust'
  | 'done_with_setup';

export interface TransitionResult {
  ok: boolean;
  nextMode?: SessionMode;
  reason?: string;
}

const ACTION_LABELS: Record<ModeAction, string> = {
  establish_baseline: 'Establish baseline',
  take_baseline_tie: 'Take baseline tie',
  measure_house_edges: 'Measure house edges',
  close_house: 'Close house',
  place_helper_rod: 'Place helper rod A',
  add_point: '+ Point',
  another_photo_yaw: 'Another photo here (yaw)',
  start_leapfrog: 'Start leapfrog',
  rods_moved: 'Rods moved',
  fence_mark: 'Fence mark',
  adjust: 'Adjust',
  done_with_setup: 'Done with this setup',
};

export function actionLabel(action: ModeAction): string {
  return ACTION_LABELS[action];
}

export const ALL_ACTIONS: ModeAction[] = [
  'establish_baseline',
  'take_baseline_tie',
  'measure_house_edges',
  'close_house',
  'place_helper_rod',
  'add_point',
  'another_photo_yaw',
  'start_leapfrog',
  'rods_moved',
  'fence_mark',
  'adjust',
  'done_with_setup',
];

/**
 * Legal transitions for the session mode state machine.
 * Illegal actions return a clear refusal sentence — never silent.
 */
export function canTransition(
  doc: GardenDocument,
  action: ModeAction,
): TransitionResult {
  const mode = normalizeMode(doc.session.mode);

  switch (action) {
    case 'establish_baseline': {
      if (mode === 'START' || mode === 'REVIEW' || mode === 'HOUSE_EDGES' || mode === 'RODS_MOVED') {
        return { ok: true, nextMode: 'BASELINE' };
      }
      if (mode === 'BASELINE') {
        return {
          ok: false,
          reason:
            'Already establishing a baseline. Enter length and offsets below, then Take baseline tie.',
        };
      }
      return {
        ok: false,
        reason: `Cannot establish baseline from ${mode}. Finish this step or return via Done with this setup / New garden.`,
      };
    }

    case 'take_baseline_tie': {
      if (mode === 'BASELINE' || mode === 'HOUSE_EDGES') {
        if (!baselineReady(doc)) {
          return {
            ok: false,
            reason:
              'No baseline length yet. Mark both ends and enter the taped/laser length first.',
          };
        }
        return { ok: true, nextMode: 'PHOTO_TIE_BASELINE' };
      }
      if (mode === 'PHOTO_TIE_BASELINE') {
        return {
          ok: false,
          reason:
            'Already in baseline-tie mode. Stand where the frame holds both baseline ends AND the target mark, then tap them.',
        };
      }
      return {
        ok: false,
        reason: `Take baseline tie is not legal in ${mode}. Establish a baseline first.`,
      };
    }

    case 'measure_house_edges': {
      if (
        mode === 'PHOTO_TIE_BASELINE' ||
        mode === 'BASELINE' ||
        mode === 'HOUSE_EDGES' ||
        mode === 'ADD_POINT' ||
        mode === 'ADJUST' ||
        mode === 'REVIEW'
      ) {
        if (!baselineReady(doc)) {
          return {
            ok: false,
            reason: 'Measure house edges needs a baseline first (default: one house edge).',
          };
        }
        return { ok: true, nextMode: 'HOUSE_EDGES' };
      }
      return {
        ok: false,
        reason: `Measure house edges is not legal in ${mode}.`,
      };
    }

    case 'close_house': {
      if (
        mode === 'HOUSE_EDGES' ||
        mode === 'PHOTO_TIE_BASELINE' ||
        mode === 'ADJUST' ||
        mode === 'ADD_POINT'
      ) {
        if (houseCornerCount(doc) < 3) {
          return {
            ok: false,
            reason: 'Close house refused: need at least three corners on the house polygon.',
          };
        }
        return { ok: true, nextMode: mode === 'ADJUST' ? 'ADJUST' : 'HOUSE_EDGES' };
      }
      return {
        ok: false,
        reason: `Close house is not legal in ${mode}. Grow corners first.`,
      };
    }

    case 'place_helper_rod': {
      if (
        mode === 'BASELINE' ||
        mode === 'PHOTO_TIE_BASELINE' ||
        mode === 'HOUSE_EDGES' ||
        mode === 'RODS_MOVED' ||
        mode === 'ADD_POINT'
      ) {
        if (!baselineReady(doc) && mode !== 'RODS_MOVED') {
          return {
            ok: false,
            reason:
              'Place helper rod after the baseline exists (or after Rods moved in a new setup).',
          };
        }
        return { ok: true, nextMode: mode === 'RODS_MOVED' ? 'ADD_POINT' : mode };
      }
      return {
        ok: false,
        reason: `Place helper rod is not legal in ${mode}.`,
      };
    }

    case 'add_point': {
      if (mode === 'PHOTO_TIE_BASELINE') {
        if (!baselineTieReady(doc)) {
          return {
            ok: false,
            reason:
              'Baseline tie incomplete. v1 needs both baseline ends AND the target mark in one frame.',
          };
        }
        if (!hasLiveControl(doc)) {
          return {
            ok: false,
            reason: 'No live control exists. Keep the baseline or place a helper rod.',
          };
        }
        return { ok: true, nextMode: 'ADD_POINT' };
      }
      if (
        mode === 'HOUSE_EDGES' ||
        mode === 'ADD_POINT_EXTRA_YAW' ||
        mode === 'FENCE_TAG' ||
        mode === 'LEAPFROG' ||
        mode === 'ADJUST' ||
        mode === 'REVIEW' ||
        mode === 'ADD_POINT' ||
        mode === 'RODS_MOVED'
      ) {
        if (!hasLiveControl(doc)) {
          return {
            ok: false,
            reason:
              mode === 'RODS_MOVED'
                ? 'New setup has no live control yet. Place helper rod A or establish a baseline before you can Add point.'
                : 'No live control exists. You cannot Add point without a baseline or live rod.',
          };
        }
        return { ok: true, nextMode: 'ADD_POINT' };
      }
      if (mode === 'START' || mode === 'BASELINE') {
        return {
          ok: false,
          reason:
            'Cannot Add point yet — establish the baseline and take a baseline tie (or place a helper rod) first.',
        };
      }
      return {
        ok: false,
        reason: `Cannot Add point from ${mode}. Get a baseline tie or live rod first.`,
      };
    }

    case 'another_photo_yaw': {
      if (mode === 'ADD_POINT' || mode === 'ADD_POINT_EXTRA_YAW') {
        if (!doc.session.currentAddPointId) {
          return {
            ok: false,
            reason:
              'No current Add point yet. Spike and name a point before taking a yaw-only extra photo.',
          };
        }
        return { ok: true, nextMode: 'ADD_POINT_EXTRA_YAW' };
      }
      return {
        ok: false,
        reason:
          'Another photo here (yaw) only works during Add point. Do not step — only turn the phone.',
      };
    }

    case 'start_leapfrog': {
      if (
        mode === 'ADD_POINT' ||
        mode === 'ADD_POINT_EXTRA_YAW' ||
        mode === 'HOUSE_EDGES' ||
        mode === 'REVIEW'
      ) {
        if (!hasLiveControl(doc)) {
          return { ok: false, reason: 'No live rod/baseline to leapfrog from.' };
        }
        return { ok: true, nextMode: 'LEAPFROG' };
      }
      return {
        ok: false,
        reason: `Start leapfrog is not legal in ${mode}. Add point or finish a house edge, then plant rod B for the far side.`,
      };
    }

    case 'rods_moved': {
      if (mode === 'LEAPFROG') {
        const setup = currentSetup(doc);
        if (!setup?.abPhotographedTogether) {
          return {
            ok: false,
            reason:
              'Rods moved refused: A and B have not been photographed together. Photograph A and B together before you pick A up.',
          };
        }
        return { ok: true, nextMode: 'RODS_MOVED' };
      }
      if (mode === 'RODS_MOVED') {
        return {
          ok: false,
          reason:
            'Already confirmed rods moved. Place the new live rod, a second baseline, or Add point.',
        };
      }
      return {
        ok: false,
        reason:
          '“Rods moved” is only legal during leapfrog, after A and B are photographed together.',
      };
    }

    case 'fence_mark': {
      if (mode === 'ADD_POINT' || mode === 'ADD_POINT_EXTRA_YAW' || mode === 'FENCE_TAG') {
        if (!hasLiveControl(doc)) {
          return {
            ok: false,
            reason: 'Fence mark needs live control in the photo. No baseline or rod is live.',
          };
        }
        return { ok: true, nextMode: 'FENCE_TAG' };
      }
      return {
        ok: false,
        reason: `Fence mark is not legal in ${mode}. Add point with live control, then stick a roll on the post.`,
      };
    }

    case 'adjust': {
      if (
        mode === 'ADD_POINT' ||
        mode === 'ADD_POINT_EXTRA_YAW' ||
        mode === 'HOUSE_EDGES' ||
        mode === 'PHOTO_TIE_BASELINE' ||
        mode === 'REVIEW' ||
        mode === 'ADJUST' ||
        mode === 'FENCE_TAG'
      ) {
        if (!baselineReady(doc)) {
          return {
            ok: false,
            reason: 'Cannot adjust yet — establish a baseline first.',
          };
        }
        return { ok: true, nextMode: 'ADJUST' };
      }
      return {
        ok: false,
        reason: `Adjust is not legal in ${mode}. Establish a baseline (and preferably a tie or Add point) first.`,
      };
    }

    case 'done_with_setup': {
      if (mode === 'ADJUST' || mode === 'ADD_POINT' || mode === 'REVIEW' || mode === 'HOUSE_EDGES') {
        return { ok: true, nextMode: 'REVIEW' };
      }
      return {
        ok: false,
        reason: `Done with this setup is not legal in ${mode}. Run Adjust or finish occupies first.`,
      };
    }

    default: {
      const _exhaustive: never = action;
      return { ok: false, reason: `Unknown action: ${_exhaustive}` };
    }
  }
}

function normalizeMode(mode: SessionMode): SessionMode {
  if (mode === 'HOUSE_BASELINE') return 'BASELINE';
  if (mode === 'PLACE_ROD_A') return 'HOUSE_EDGES';
  if (mode === 'PHOTO_TIE_HOUSE_ROD') return 'PHOTO_TIE_BASELINE';
  if ((mode as string) === 'OCCUPY') return 'ADD_POINT';
  if ((mode as string) === 'OCCUPY_EXTRA_YAW') return 'ADD_POINT_EXTRA_YAW';
  return mode;
}

export function applyTransition(
  doc: GardenDocument,
  action: ModeAction,
): { doc: GardenDocument; result: TransitionResult } {
  const result = canTransition(doc, action);
  if (!result.ok || !result.nextMode) {
    return { doc, result };
  }

  if (action === 'close_house') {
    return {
      doc: {
        ...doc,
        session: {
          ...doc.session,
          mode: result.nextMode,
          lastAction: ACTION_LABELS[action],
        },
      },
      result,
    };
  }

  let next: GardenDocument = {
    ...doc,
    session: {
      ...doc.session,
      mode: result.nextMode,
      lastAction: ACTION_LABELS[action],
    },
    setups: doc.setups.map((s) => ({ ...s })),
  };

  if (action === 'establish_baseline' && next.setups.length === 0) {
    const id = `setup-${Date.now()}`;
    next.setups.push({
      id,
      startedAt: new Date().toISOString(),
      liveRodIds: [],
      closed: false,
    });
    next.session.currentSetupId = id;
  }

  if (action === 'place_helper_rod') {
    next = declareRodA(next);
    next = {
      ...next,
      session: {
        ...next.session,
        mode: result.nextMode,
        lastAction: next.session.lastAction,
      },
    };
  }

  if (action === 'rods_moved') {
    const old = next.setups.find((s) => s.id === next.session.currentSetupId);
    if (old) {
      old.closed = true;
      old.endedAt = new Date().toISOString();
    }
    const id = `setup-${Date.now()}`;
    next.setups.push({
      id,
      startedAt: new Date().toISOString(),
      liveRodIds: ['B'],
      closed: false,
      abPhotographedTogether: false,
    });
    next.session.currentSetupId = id;
    next.session.lastAction =
      'Rods moved — old setup closed. Rod A is no longer the old coordinates. Add a second baseline if needed for the far side.';
  }

  return { doc: next, result };
}

export function legalActions(doc: GardenDocument): ModeAction[] {
  return ALL_ACTIONS.filter((a) => canTransition(doc, a).ok);
}

export function suggestedAction(doc: GardenDocument): ModeAction | null {
  const mode = normalizeMode(doc.session.mode);
  const order: Partial<Record<SessionMode, ModeAction[]>> = {
    START: ['establish_baseline'],
    BASELINE: ['take_baseline_tie', 'place_helper_rod'],
    PHOTO_TIE_BASELINE: ['measure_house_edges', 'add_point', 'adjust'],
    HOUSE_EDGES: ['close_house', 'take_baseline_tie', 'add_point', 'start_leapfrog', 'adjust'],
    ADD_POINT: ['adjust', 'another_photo_yaw', 'start_leapfrog', 'measure_house_edges', 'fence_mark'],
    ADD_POINT_EXTRA_YAW: ['add_point', 'adjust'],
    LEAPFROG: ['rods_moved', 'add_point'],
    RODS_MOVED: ['establish_baseline', 'place_helper_rod', 'add_point'],
    FENCE_TAG: ['add_point', 'adjust'],
    ADJUST: ['done_with_setup', 'measure_house_edges', 'add_point'],
    REVIEW: ['adjust', 'add_point', 'establish_baseline'],
  };
  const candidates = order[mode] ?? [];
  for (const a of candidates) {
    if (canTransition(doc, a).ok) {
      if (a === 'close_house' && housePolygon(doc)?.closed) continue;
      if (a === 'take_baseline_tie' && mode === 'BASELINE' && !baselineReady(doc)) continue;
      return a;
    }
  }
  const legal = legalActions(doc);
  return legal[0] ?? null;
}
