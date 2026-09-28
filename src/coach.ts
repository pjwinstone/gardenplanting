import type { GardenDocument, SessionMode } from './model';
import {
  baselineReady,
  baselineTieReady,
  housePolygon,
  houseCornerCount,
  currentSetup,
  currentBaseline,
} from './model';
import { suggestedAction, actionLabel, legalActions, type ModeAction } from './modes';
import { STAGE2_ENTRY_COACH } from './stage2Checklist';

/**
 * All coach copy lives here — edit wording without touching the solver.
 */

const RESIDUAL_GOOD_MM = 15;
const RESIDUAL_USABLE_MM = 50;

const MODE_BANNER: Record<string, string> = {
  START: 'START',
  BASELINE: 'BASELINE',
  PHOTO_TIE_BASELINE: 'PHOTO TIE — BASELINE',
  HOUSE_EDGES: 'HOUSE EDGES',
  OCCUPY: 'OCCUPY',
  OCCUPY_EXTRA_YAW: 'OCCUPY — EXTRA YAW',
  LEAPFROG: 'LEAPFROG',
  RODS_MOVED: 'RODS MOVED',
  FENCE_TAG: 'FENCE TAG',
  ADJUST: 'ADJUST',
  REVIEW: 'REVIEW',
  HOUSE_BASELINE: 'BASELINE',
  PLACE_ROD_A: 'HOUSE EDGES',
  PHOTO_TIE_HOUSE_ROD: 'PHOTO TIE — BASELINE',
};

const MODE_COACH: Record<string, string> = {
  START:
    'New garden or load JSON. For the live plot, Establish baseline (default: one house edge). For a dry run, Load synthetic demo then Adjust.',
  BASELINE:
    'This edge is your baseline. Mark both ends, measure the length, and enter any roll/post offset in mm if the mark is not the true corner.',
  PHOTO_TIE_BASELINE:
    'Stand where one photo contains both baseline ends AND the house mark you are fixing. Then tap those marks. Do not hide the baseline.',
  HOUSE_EDGES:
    'Grow the house polygon — tape the next reachable edge, photo-tie another corner, or leapfrog for the far side. Close house when you have enough corners.',
  OCCUPY:
    'Spike on the thing you are naming. Bubble the pole. Photograph live control (baseline ends and/or rod). Then name the point.',
  OCCUPY_EXTRA_YAW:
    'Do not step. Only turn the phone so another mark sits in the middle of the frame. These photos share this point.',
  LEAPFROG:
    'Plant rod B in the new view for the far side / second baseline. Photograph A and B together before you pick A up.',
  RODS_MOVED:
    'Rod A is no longer the old coordinates. Establish another baseline if needed, or place the new live rod and keep surveying.',
  FENCE_TAG:
    'You cannot stand in the fence. Stick a roll on the post, photograph it with live control.',
  ADJUST:
    'Layer A then Layer B are done. Residuals are in millimetres — baseline first, then edges, house close gap, then occupies.',
  REVIEW:
    'Plan on an iPad-sized layout. Thumbnails sit beside points. Export or trust OneDrive when signed in.',
};

export function modeBanner(mode: SessionMode): string {
  return MODE_BANNER[mode] ?? mode;
}

export interface CoachLines {
  banner: string;
  body: string[];
  nextButton: string | null;
  nextAction: ModeAction | null;
  residualLine: string | null;
  geometryLine: string | null;
}

export function buildCoach(doc: GardenDocument): CoachLines {
  const mode = doc.session.mode;
  const body: string[] = [MODE_COACH[mode] ?? MODE_COACH.START];

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

  if (mode === 'BASELINE') {
    if (!baselineReady(doc)) {
      body.push('No length yet. Enter the baseline metres below — house-edge is the default.');
    } else {
      const bl = currentBaseline(doc);
      body.push(
        `Baseline ${bl?.a}–${bl?.b} is set at ${bl?.lengthM.toFixed(3)} m. Geometry is good enough to take a baseline tie.`,
      );
    }
  }

  if (mode === 'PHOTO_TIE_BASELINE') {
    if (baselineTieReady(doc)) {
      body.push('I see both baseline ends and a target mark. Good tie. Occupy or measure more house edges.');
    } else {
      body.push(
        'Only partial clicks so far. v1 needs both baseline ends and the target in one frame.',
      );
    }
  }

  if (mode === 'HOUSE_EDGES') {
    const n = houseCornerCount(doc);
    const closed = housePolygon(doc)?.closed;
    body.push(
      closed
        ? `House polygon closed with ${n} corners.`
        : `House has ${n} corner(s) so far — aim for ~10 on a full walk. Far side needs leapfrog.`,
    );
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
      'No mode button is legal yet — that is not a silent void. Use the step panel below, or Establish baseline / Load synthetic demo.',
    );
  }

  const next = suggestedAction(doc);
  const residualLine = formatResidualLine(doc.session.lastResidualMm);
  const geometryLine = formatGeometryLine(doc);

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
  if (abs < RESIDUAL_GOOD_MM) return `${amount} — good enough to proceed.`;
  if (abs < RESIDUAL_USABLE_MM) return `${amount} — usable; watch the next occupy.`;
  return `${amount} — remeasure before you trust the plan.`;
}

export function formatGeometryLine(doc: GardenDocument): string | null {
  const mode = doc.session.mode;
  if (doc.session.geometryOk === true) {
    return 'Geometry looks good enough to keep surveying.';
  }
  if (doc.session.geometryOk === false && (mode === 'ADJUST' || mode === 'REVIEW')) {
    return 'Geometry is not good enough yet — remeasure baseline/edges or retake a weak photo.';
  }
  if (mode === 'BASELINE' && baselineReady(doc)) {
    return 'Baseline set — good enough to proceed to a photo tie.';
  }
  if (mode === 'PHOTO_TIE_BASELINE' && baselineTieReady(doc)) {
    return 'Tie is complete — good enough to grow the house or Occupy.';
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
