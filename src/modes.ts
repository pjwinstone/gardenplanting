import type { GardenDocument, SessionMode } from './model';
import {
  hasLiveControl,
  houseRectangleClosed,
  rodAPlaced,
  tiePhotoReady,
  currentSetup,
  declareRodA,
} from './model';

/** Mode-changing actions (buttons). */
export type ModeAction =
  | 'start_house'
  | 'rod_a_ready'
  | 'take_tie_photo'
  | 'occupy'
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
  start_house: 'Start house',
  rod_a_ready: 'Rod A ready',
  take_tie_photo: 'Take tie photo',
  occupy: 'Occupy',
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
  'start_house',
  'rod_a_ready',
  'take_tie_photo',
  'occupy',
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
  const mode = doc.session.mode;

  switch (action) {
    case 'start_house': {
      if (mode === 'START' || mode === 'REVIEW') {
        return { ok: true, nextMode: 'HOUSE_BASELINE' };
      }
      return {
        ok: false,
        reason: `Cannot start house from ${mode}. Finish or return to Start / Review first.`,
      };
    }

    case 'rod_a_ready': {
      if (mode === 'HOUSE_BASELINE') {
        if (!houseRectangleClosed(doc)) {
          return {
            ok: false,
            reason:
              'House rectangle does not close yet. Measure the back wall and one diagonal before placing rod A.',
          };
        }
        return { ok: true, nextMode: 'PLACE_ROD_A' };
      }
      if (mode === 'RODS_MOVED') {
        return { ok: true, nextMode: 'PLACE_ROD_A' };
      }
      if (mode === 'PLACE_ROD_A') {
        return {
          ok: false,
          reason: 'Already placing rod A. Put the belts on, then take the tie photo.',
        };
      }
      return {
        ok: false,
        reason: `Rod A ready is not legal in ${mode}. Complete the house baseline first.`,
      };
    }

    case 'take_tie_photo': {
      if (mode === 'PLACE_ROD_A') {
        if (!rodAPlaced(doc) && doc.points.every((p) => p.id !== 'A1')) {
          return {
            ok: false,
            reason: 'Rod A is not declared yet. Put rod A where the house can see it.',
          };
        }
        return { ok: true, nextMode: 'PHOTO_TIE_HOUSE_ROD' };
      }
      if (mode === 'PHOTO_TIE_HOUSE_ROD') {
        return {
          ok: false,
          reason: 'Already in tie-photo mode. Tap two house corners and both ends of rod A.',
        };
      }
      return {
        ok: false,
        reason: `Take tie photo is not legal in ${mode}. Place rod A first.`,
      };
    }

    case 'occupy': {
      if (mode === 'PHOTO_TIE_HOUSE_ROD') {
        if (!tiePhotoReady(doc)) {
          return {
            ok: false,
            reason:
              'Tie photo incomplete. Stand where the frame contains two house corners AND both ends of rod A, then tap those four marks.',
          };
        }
        if (!hasLiveControl(doc)) {
          return {
            ok: false,
            reason: 'No live control exists. You cannot occupy until a live rod is in the setup.',
          };
        }
        return { ok: true, nextMode: 'OCCUPY' };
      }
      if (
        mode === 'OCCUPY_EXTRA_YAW' ||
        mode === 'FENCE_TAG' ||
        mode === 'LEAPFROG' ||
        mode === 'ADJUST' ||
        mode === 'REVIEW'
      ) {
        if (!hasLiveControl(doc)) {
          return {
            ok: false,
            reason: 'No live control exists. You cannot occupy without a live rod.',
          };
        }
        return { ok: true, nextMode: 'OCCUPY' };
      }
      if (mode === 'OCCUPY' || mode === 'RODS_MOVED') {
        if (!hasLiveControl(doc)) {
          return {
            ok: false,
            reason:
              mode === 'RODS_MOVED'
                ? 'New setup has no live rod yet. Place rod A (or B) before occupying.'
                : 'No live control exists. You cannot occupy until a live rod is in the setup.',
          };
        }
        return { ok: true, nextMode: 'OCCUPY' };
      }
      return {
        ok: false,
        reason: `Cannot occupy from ${mode}. Get a house–rod tie first, or restore a live control.`,
      };
    }

    case 'another_photo_yaw': {
      if (mode === 'OCCUPY' || mode === 'OCCUPY_EXTRA_YAW') {
        if (!doc.session.currentOccupyId) {
          return {
            ok: false,
            reason:
              'No current occupy point. Spike and name a point before taking a yaw-only extra photo.',
          };
        }
        return { ok: true, nextMode: 'OCCUPY_EXTRA_YAW' };
      }
      return {
        ok: false,
        reason:
          'Another photo here (yaw) only works during an occupy. Do not step — only turn the phone.',
      };
    }

    case 'start_leapfrog': {
      if (mode === 'OCCUPY' || mode === 'OCCUPY_EXTRA_YAW' || mode === 'REVIEW') {
        if (!hasLiveControl(doc)) {
          return {
            ok: false,
            reason: 'No live rod to leapfrog from.',
          };
        }
        return { ok: true, nextMode: 'LEAPFROG' };
      }
      return {
        ok: false,
        reason: `Start leapfrog is not legal in ${mode}. Occupy first, then plant rod B in the new view.`,
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
          reason: 'Already confirmed rods moved. Place the new live rod or occupy.',
        };
      }
      return {
        ok: false,
        reason:
          '“Rods moved” is only legal during leapfrog, after A and B are photographed together.',
      };
    }

    case 'fence_mark': {
      if (mode === 'OCCUPY' || mode === 'OCCUPY_EXTRA_YAW' || mode === 'FENCE_TAG') {
        if (!hasLiveControl(doc)) {
          return {
            ok: false,
            reason: 'Fence mark needs a live rod in the photo. No live control exists.',
          };
        }
        return { ok: true, nextMode: 'FENCE_TAG' };
      }
      return {
        ok: false,
        reason: `Fence mark is not legal in ${mode}. Occupy with a live rod, then stick a roll on the post.`,
      };
    }

    case 'adjust': {
      if (
        mode === 'OCCUPY' ||
        mode === 'OCCUPY_EXTRA_YAW' ||
        mode === 'REVIEW' ||
        mode === 'ADJUST' ||
        mode === 'FENCE_TAG'
      ) {
        if (!houseRectangleClosed(doc)) {
          return {
            ok: false,
            reason: 'Cannot adjust yet — house baseline does not close.',
          };
        }
        return { ok: true, nextMode: 'ADJUST' };
      }
      return {
        ok: false,
        reason: `Adjust is not legal in ${mode}. Collect house + rod tie (and preferably an occupy) first.`,
      };
    }

    case 'done_with_setup': {
      if (mode === 'ADJUST' || mode === 'OCCUPY' || mode === 'REVIEW') {
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

export function applyTransition(
  doc: GardenDocument,
  action: ModeAction,
): { doc: GardenDocument; result: TransitionResult } {
  const result = canTransition(doc, action);
  if (!result.ok || !result.nextMode) {
    return { doc, result };
  }

  const next: GardenDocument = {
    ...doc,
    session: {
      ...doc.session,
      mode: result.nextMode,
      lastAction: ACTION_LABELS[action],
    },
    setups: doc.setups.map((s) => ({ ...s })),
  };

  if (action === 'start_house' && next.setups.length === 0) {
    const id = `setup-${Date.now()}`;
    next.setups.push({
      id,
      startedAt: new Date().toISOString(),
      liveRodIds: [],
      closed: false,
    });
    next.session.currentSetupId = id;
  }

  if (action === 'rod_a_ready') {
    const setup = next.setups.find((s) => s.id === next.session.currentSetupId) ?? next.setups[0];
    if (setup && !setup.liveRodIds.includes('A')) {
      setup.liveRodIds = [...setup.liveRodIds.filter((r) => r !== 'A'), 'A'];
    }
    // Declaring rod A (4.000 m) is part of “Rod A ready” — avoids PLACE_ROD_A with no A1/A2.
    const withRod = declareRodA(next);
    next.points = withRod.points;
    next.lines = withRod.lines;
    next.session.lastAction = withRod.session.lastAction;
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
      'Rods moved — old setup closed. Rod A is no longer the old coordinates.';
  }

  return { doc: next, result };
}

/** Which actions are currently legal (for enabling buttons). */
export function legalActions(doc: GardenDocument): ModeAction[] {
  return ALL_ACTIONS.filter((a) => canTransition(doc, a).ok);
}

/** Preferred next action to highlight in the coach. */
export function suggestedAction(doc: GardenDocument): ModeAction | null {
  const mode = doc.session.mode;
  const order: Partial<Record<SessionMode, ModeAction[]>> = {
    START: ['start_house'],
    HOUSE_BASELINE: ['rod_a_ready'],
    PLACE_ROD_A: ['take_tie_photo'],
    PHOTO_TIE_HOUSE_ROD: ['occupy'],
    // Prefer Adjust when the milestone demo (or any occupy with geometry) can run the plan.
    OCCUPY: ['adjust', 'another_photo_yaw', 'start_leapfrog', 'fence_mark'],
    OCCUPY_EXTRA_YAW: ['occupy', 'adjust'],
    LEAPFROG: ['rods_moved', 'occupy'],
    RODS_MOVED: ['rod_a_ready', 'occupy'],
    FENCE_TAG: ['occupy', 'adjust'],
    ADJUST: ['done_with_setup', 'occupy'],
    REVIEW: ['adjust', 'occupy', 'start_house'],
  };
  const candidates = order[mode] ?? [];
  for (const a of candidates) {
    if (canTransition(doc, a).ok) return a;
  }
  const legal = legalActions(doc);
  return legal[0] ?? null;
}
