import type { GardenDocument, SessionMode } from './model';
import {
  houseRectangleClosed,
  rodAPlaced,
  tiePhotoReady,
  currentSetup,
} from './model';
import { suggestedAction, actionLabel, legalActions, type ModeAction } from './modes';
import { STAGE2_ENTRY_COACH } from './stage2Checklist';

/**
 * All coach copy lives here — edit wording without touching the solver.
 */

/** Residual quality bands for Stage 2 field guidance (mm). */
const RESIDUAL_GOOD_MM = 15;
const RESIDUAL_USABLE_MM = 50;

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
    'New garden or load JSON. For the live plot, tap Start Stage 2 field loop (house tapes first). For a dry run, Load synthetic demo then Adjust.',
  HOUSE_BASELINE:
    'Measure the back wall, one side, and the diagonal with tape or laser. Enter metres below — we will not move on until the house rectangle closes.',
  PLACE_ROD_A:
    'Put rod A where the house can see it. Both ends need toilet-roll belts. When the belts are on, take the tie photo.',
  PHOTO_TIE_HOUSE_ROD:
    'Stand where this photo contains two house corners AND both ends of rod A. Then tap those four marks on the phone.',
  OCCUPY:
    'Spike on the thing you are naming. Bubble the pole. Photograph the live rod(s). Then name the point. Press Adjust when you want residuals on the plan.',
  OCCUPY_EXTRA_YAW:
    'Do not step. Only turn the phone so another mark sits in the middle of the frame. These photos share this point.',
  LEAPFROG:
    'Plant rod B in the new view. Photograph A and B together before you pick A up. Confirm that photo below, then Rods moved.',
  RODS_MOVED:
    'Rod A is no longer the old coordinates. Close setup done — open the new live rod and keep surveying.',
  FENCE_TAG:
    'You cannot stand in the fence. Stick a roll on the post, photograph it with a live rod.',
  ADJUST:
    'Layer A then Layer B are done. Residuals are in millimetres — house first, then rods, then occupies. Proceed only if geometry is good enough.',
  REVIEW:
    'Plan on an iPad-sized layout. Thumbnails sit beside points. Export garden.json when you are happy — OneDrive also keeps a copy when signed in.',
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
  /** Plain “good enough / remeasure” for Stage 2. */
  geometryLine: string | null;
}

export function buildCoach(doc: GardenDocument): CoachLines {
  const mode = doc.session.mode;
  const body: string[] = [MODE_COACH[mode]];

  if (mode === 'START') {
    body.push(STAGE2_ENTRY_COACH);
  }

  if (doc.session.lastAction) {
    body.push(`Last action: ${doc.session.lastAction}.`);
  }

  if (mode === 'ADJUST' && doc.observations.length) {
    const residuals = doc.observations.filter((o) => o.kind === 'residual' && o.note);
    for (const r of residuals.slice(0, 3)) {
      if (r.note) body.push(r.note);
    }
  }

  if (mode === 'HOUSE_BASELINE') {
    if (!houseRectangleClosed(doc)) {
      body.push(
        'House rectangle is not closed yet. Enter back wall, side, and diagonal below — then Rod A ready becomes legal.',
      );
    } else {
      body.push('House rectangle closes. Geometry is good enough to place rod A.');
    }
  }

  if (mode === 'PLACE_ROD_A' && !rodAPlaced(doc)) {
    body.push('Rod A is not declared yet. Use Rod A ready only after the house closes.');
  }

  if (mode === 'PHOTO_TIE_HOUSE_ROD') {
    if (tiePhotoReady(doc)) {
      body.push(
        'I see rod A ends and house corners. Good tie. Geometry is good enough to Occupy.',
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
    } else {
      body.push('A and B are in a shared photo. Rods moved is now legal.');
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
      'No mode button is legal yet — that is not a silent void. Use the step panel below, or Start Stage 2 field loop / Load synthetic demo.',
    );
  }

  const next = suggestedAction(doc);
  const residualLine = formatResidualLine(doc.session.lastResidualMm);
  const geometryLine = formatGeometryLine(doc);

  // Keep coach readable but never drop the escape line when stuck.
  const capped = body.length <= 4 ? body : [body[0], body[1], body[body.length - 1]].filter(Boolean);

  return {
    banner: modeBanner(mode),
    body: capped,
    nextButton: next ? actionLabel(next) : null,
    nextAction: next,
    residualLine,
    geometryLine,
  };
}

export function formatResidualLine(mm: number | undefined): string | null {
  if (mm == null || Number.isNaN(mm)) return null;
  const abs = Math.abs(mm);
  const amount =
    abs < 1 ? 'Last residual: under 1 mm' : `Last residual: ${abs.toFixed(0)} mm`;
  if (abs < RESIDUAL_GOOD_MM) {
    return `${amount} — good enough to proceed.`;
  }
  if (abs < RESIDUAL_USABLE_MM) {
    return `${amount} — usable; watch the next occupy.`;
  }
  return `${amount} — remeasure before you trust the plan.`;
}

export function formatGeometryLine(doc: GardenDocument): string | null {
  const mode = doc.session.mode;
  if (doc.session.geometryOk === true) {
    return 'Geometry looks good enough to keep surveying.';
  }
  if (doc.session.geometryOk === false && (mode === 'ADJUST' || mode === 'REVIEW')) {
    return 'Geometry is not good enough yet — remeasure house/rod or retake a weak occupy photo.';
  }
  if (mode === 'HOUSE_BASELINE' && houseRectangleClosed(doc)) {
    return 'House closes — good enough to proceed to rod A.';
  }
  if (mode === 'PHOTO_TIE_HOUSE_ROD' && tiePhotoReady(doc)) {
    return 'Tie is complete — good enough to proceed to Occupy.';
  }
  return null;
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
