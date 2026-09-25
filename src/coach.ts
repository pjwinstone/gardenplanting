import type { GardenDocument, SessionMode } from './model';
import {
  houseRectangleClosed,
  rodAPlaced,
  tiePhotoReady,
  currentSetup,
} from './model';
import { suggestedAction, actionLabel, legalActions, type ModeAction } from './modes';

/**
 * All coach copy lives here — edit wording without touching the solver.
 */

const MODE_BANNER: Record<SessionMode, string> = {
  START: 'START',
  HOUSE_BASELINE: 'HOUSE BASELINE',
  PLACE_ROD_A: 'PLACE ROD A',
  PHOTO_TIE_HOUSE_ROD: 'PHOTO TIE — HOUSE + ROD',
  OCCUPY: 'OCCUPY',
  OCCUPY_EXTRA_YAW: 'OCCUPY — EXTRA YAW',
  LEAPFROG: 'LEAPFROG',
  RODS_MOVED: 'RODS MOVED',
  FENCE_TAG: 'FENCE TAG',
  ADJUST: 'ADJUST',
  REVIEW: 'REVIEW',
};

const MODE_COACH: Record<SessionMode, string> = {
  START:
    'New garden or load JSON. For the milestone demo, press Load synthetic demo, then Adjust. Or Start house and enter the back wall and one diagonal.',
  HOUSE_BASELINE:
    'Measure the back wall and one diagonal. Enter those lengths below — we will not move on until the house rectangle closes.',
  PLACE_ROD_A:
    'Put rod A where the house can see it. Both ends need toilet-roll belts. When the belts are on, take the tie photo.',
  PHOTO_TIE_HOUSE_ROD:
    'Stand where this photo contains two house corners AND both ends of rod A. Then tap those four marks (or record the canned demo clicks below).',
  OCCUPY:
    'Spike on the thing you are naming. Bubble the pole. Photograph the live rod(s). Then name the point. Press Adjust when ready for the plan.',
  OCCUPY_EXTRA_YAW:
    'Do not step. Only turn the phone so another mark sits in the middle of the frame. These photos share this point.',
  LEAPFROG:
    'Plant rod B in the new view. Photograph A and B together before you pick A up. Confirm that photo below, then Rods moved.',
  RODS_MOVED:
    'Rod A is no longer the old coordinates. Close setup done — open the new live rod and keep surveying.',
  FENCE_TAG:
    'You cannot stand in the fence. Stick a roll on the post, photograph it with a live rod.',
  ADJUST:
    'Layer A then Layer B are done. Residuals are in plain language — house first, then rods, then occupies. Open Print tags when you want A4 belts.',
  REVIEW:
    'Plan on an iPad-sized layout. Thumbnails sit beside points. Export garden.json when you are happy.',
};

export function modeBanner(mode: SessionMode): string {
  return MODE_BANNER[mode];
}

export interface CoachLines {
  banner: string;
  body: string[];
  nextButton: string | null;
  nextAction: ModeAction | null;
  residualLine: string | null;
}

export function buildCoach(doc: GardenDocument): CoachLines {
  const mode = doc.session.mode;
  const body: string[] = [MODE_COACH[mode]];

  if (doc.session.lastAction) {
    body.push(`Last action: ${doc.session.lastAction}.`);
  }

  if (mode === 'ADJUST' && doc.observations.length) {
    const residuals = doc.observations.filter((o) => o.kind === 'residual');
    for (const r of residuals.slice(0, 3)) {
      if (r.note) body.push(r.note);
    }
  }

  if (mode === 'HOUSE_BASELINE' && !houseRectangleClosed(doc)) {
    body.push(
      'House rectangle is not closed yet. Enter back wall, side, and diagonal below — or Load synthetic demo.',
    );
  }

  if (mode === 'PLACE_ROD_A' && !rodAPlaced(doc)) {
    body.push('Rod A is not declared yet. Use Rod A ready only after the house closes.');
  }

  if (mode === 'PHOTO_TIE_HOUSE_ROD') {
    if (tiePhotoReady(doc)) {
      body.push(
        'I see rod A ends and house corners. Good tie. Proceed to Occupy when ready.',
      );
    } else {
      body.push(
        'Only partial clicks so far. I cannot fix you on the map yet. Record the four marks below.',
      );
    }
  }

  if (mode === 'LEAPFROG') {
    const setup = currentSetup(doc);
    if (!setup?.abPhotographedTogether) {
      body.push(
        'A and B have not been photographed together yet — Rods moved stays refused until you confirm that photo.',
      );
    }
  }

  if (mode === 'OCCUPY' || mode === 'OCCUPY_EXTRA_YAW') {
    const occ = doc.session.currentOccupyId;
    if (occ) {
      const n = doc.photos.filter((p) => p.occupyPointId === occ).length;
      if (n > 1) {
        body.push(
          `${n} photos on ${occ}. Say Repeat if this is another visit, or yaw-only if you did not move your feet.`,
        );
      }
    }
  }

  const legal = legalActions(doc);
  if (legal.length === 0) {
    body.push(
      'No mode button is legal yet — that is not a silent void. Use the step panel below, or Load synthetic demo, then Adjust.',
    );
  }

  const next = suggestedAction(doc);
  let residualLine: string | null = null;
  if (doc.session.lastResidualMm != null) {
    const mm = doc.session.lastResidualMm;
    residualLine =
      Math.abs(mm) < 1
        ? `Last residual: under 1 mm.`
        : `Last residual: ${mm.toFixed(0)} mm.`;
  }

  // Keep coach readable but never drop the escape line when stuck.
  const capped = body.length <= 4 ? body : [body[0], body[1], body[body.length - 1]].filter(Boolean);

  return {
    banner: modeBanner(mode),
    body: capped,
    nextButton: next ? actionLabel(next) : null,
    nextAction: next,
    residualLine,
  };
}

export function speakCoachLine(text: string, enabled: boolean): void {
  if (!enabled || typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

export function refusalSentence(reason: string): string {
  return reason;
}
