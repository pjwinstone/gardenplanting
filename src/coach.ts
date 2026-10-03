import type { GardenDocument, SessionMode } from './model';
import type { SolvePoint, SolveResult } from './solver/types';
import type { HouseTolerance } from './solver/house';
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
import { activeBaselineLabel, stickyChipLabel } from './layers';

/**
 * All coach copy lives here — edit wording without touching the solver.
 */

const RESIDUAL_GOOD_MM = 15;
const RESIDUAL_USABLE_MM = 50;

const MODE_BANNER: Record<string, string> = {
  MENU: 'MENU',
  START: 'START',
  BASELINE: 'BASELINE',
  PHOTO_TIE_BASELINE: 'PHOTO TIE — BASELINE',
  HOUSE_EDGES: 'HOUSE EDGES',
  ADD_POINT: 'ADD POINT',
  ADD_POINT_EXTRA_YAW: 'ADD POINT — EXTRA YAW',
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
  MENU:
    'Menu. Pick a workflow below, open + Point, or choose a mode from the Mode list.',
  START:
    'New garden or load JSON. For the live plot, Establish baseline (default: one house edge). For a dry run, Load synthetic demo then Adjust.',
  BASELINE:
    'This edge is your baseline. Mark both ends, measure the length, and enter any roll/post offset in mm if the mark is not the true corner.',
  PHOTO_TIE_BASELINE:
    'Stand where one photo contains both baseline ends AND the house mark you are fixing. Then tap those marks. Do not hide the baseline.',
  HOUSE_EDGES:
    'Grow the house polygon — tape the next reachable edge, photo-tie another corner, or leapfrog for the far side. Close house when you have enough corners.',
  ADD_POINT:
    'Spike the station. + Point opens the camera — the photo places the point. Use + Photo for another shot without stepping.',
  ADD_POINT_EXTRA_YAW:
    'Same point — only yaw. Do not step.',
  LEAPFROG:
    'Plant rod B. Photo A+B together before picking A up.',
  RODS_MOVED:
    'Rod A moved. Pick a trusted baseline or place the new live rod.',
  FENCE_TAG:
    'Stick a roll on the post; photo with live control.',
  ADJUST:
    'Refit: baselines are not sacred — higher-trust ones are preferred. Residuals in mm.',
  REVIEW:
    'Plan view. Tap a point to inspect how it was measured.',
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
      body.push('I see both baseline ends and a target mark. Good tie. Add point or measure more house edges.');
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

  if (mode === 'ADD_POINT' || mode === 'ADD_POINT_EXTRA_YAW') {
    body.push(`${stickyChipLabel(doc)} · baseline ${activeBaselineLabel(doc)}`);
    const occ = doc.session.currentAddPointId;
    if (occ) {
      const n = doc.photos.filter((p) => p.addPointId === occ).length;
      if (n > 1) body.push(`${n} photos on ${occ}.`);
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
  if (abs < RESIDUAL_USABLE_MM) return `${amount} — usable; watch the next Add point.`;
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
    return 'Tie is complete — good enough to grow the house or Add point.';
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

function mm(metres: number): string {
  return `${Math.abs(metres * 1000).toFixed(0)} mm`;
}

/**
 * Sentences for a phase-1 solve. The solver returns numbers and codes;
 * the wording stays here.
 */
export function solverCoachLines(result: SolveResult): string[] {
  const lines: string[] = [];
  const origin = result.points.find((p) => p.datumRole === 'origin');
  const axis = result.points.find((p) => p.datumRole === 'axis');
  if (origin && axis) {
    lines.push(
      `${origin.id} is the datum origin. ${axis.id} lies on the axis, and the baseline tape is an ordinary distance.`,
    );
  }
  if (result.degreesOfFreedom > 0 && result.sigma0 != null) {
    if (result.varianceTest === 'low') {
      lines.push(
        `Variance factor σ̂₀ is ${result.sigma0.toFixed(2)}. That is low, so the σ's may be conservative. This is not a warning.`,
      );
    } else if (result.varianceTest === 'high') {
      lines.push(
        `Variance factor σ̂₀ is ${result.sigma0.toFixed(2)} on ${result.degreesOfFreedom} degrees of freedom. That is high, so nothing is checked or plantable.`,
      );
    } else {
      lines.push(
        `Variance factor σ̂₀ is ${result.sigma0.toFixed(2)} on ${result.degreesOfFreedom} degrees of freedom. The upper-tail test does not reject it. That is not a verification.`,
      );
    }
  } else {
    lines.push('Nothing is spare yet, so σ̂₀ is not defined.');
  }
  if (result.inseparableObservationIds.length > 1) {
    lines.push(
      `These residuals move together, so I have not dropped one: ${result.inseparableObservationIds.join(', ')}.`,
    );
  }
  for (const o of result.observations) {
    if (!o.used || o.kind !== 'distance') continue;
    const sign = o.residual < 0 ? 'short' : 'long';
    lines.push(`${o.id} residual ${mm(o.residual)} ${sign}.`);
    if (o.flagged && o.standardised != null) {
      lines.push(`${o.id} fails the w-test, |w| = ${Math.abs(o.standardised).toFixed(2)}.`);
    }
  }
  for (const o of result.observations) {
    if (!o.used || o.kind === 'distance' || !o.flagged || o.standardised == null) continue;
    lines.push(`${o.id} fails the w-test, |w| = ${Math.abs(o.standardised).toFixed(2)}.`);
  }
  for (const p of result.points) {
    lines.push(...pointCoach(p));
  }
  for (const w of result.withheld) {
    lines.push(
      w.pass
        ? `Withheld ${w.id} misses by ${mm(w.missM)}, inside the 1.96 limit of ${mm(w.limitM)}.`
        : `Withheld ${w.id} misses by ${mm(w.missM)}, outside the 1.96 limit of ${mm(w.limitM)}.`,
    );
  }
  for (const skip of result.skippedPhotos) {
    lines.push(`${skip.id} has no calibrated fx/width, so I have not resected it.`);
  }
  return lines;
}

function pointCoach(p: SolvePoint): string[] {
  if (p.datumRole === 'origin') return [];
  if (p.status === 'unset') {
    if (p.unsetCode === 'one-distance') {
      return [
        `${p.id} has one taped edge. That does not fix a corner, and I will not turn 90° to place it. A second distance or a ray would.`,
      ];
    }
    if (p.unsetCode === 'hanging') {
      return [`${p.id} is not tied to a solved point yet.`];
    }
    if (p.unsetCode === 'arc-only') {
      return [`${p.id} has no coordinate. Two marks and no tape are only an arc.`];
    }
    if (p.unsetCode === 'two-candidates') {
      const apart = p.candidateSeparationM != null ? ` ${p.candidateSeparationM.toFixed(1)} m apart.` : '';
      return [`${p.id} is two candidates${apart} I will not average them.`];
    }
    if (p.unsetCode === 'flat-angle') {
      return [`The subtended angle at ${p.id} is nearly flat. I will not invent a range.`];
    }
    if (p.unsetCode === 'danger') {
      const size = p.rejected?.semiMajor95M != null ? ` The 95% semi-major is ${mm(p.rejected.semiMajor95M)}.` : '';
      return [`${p.id} sits on the danger circle.${size} I have not set a coordinate.`];
    }
    if (p.unsetCode === 'mirror') {
      return [`${p.id} has two mirrors and nothing to choose between them. I have not set a coordinate.`];
    }
    if (p.unsetCode === 'rank') {
      return [`${p.id} is unset. The normal matrix cannot carry it.`];
    }
    if (p.unsetCode === 'behind-camera') {
      return [`${p.id} is unset. A ray places it behind a camera, or closer than half a metre.`];
    }
    if (p.unsetCode === 'diverged') {
      return [`${p.id} is unset. The adjustment did not converge, so I have not published it.`];
    }
    if (p.unsetCode === 'sanity') {
      return [`${p.id} is unset. Its 95% semi-major is too large to publish.`];
    }
    if (p.unsetCode === 'miss') {
      return [`${p.id} is unset. Those distances do not meet.`];
    }
    return [`${p.id} is unset.`];
  }
  const lines: string[] = [];
  if (p.status === 'unchecked') {
    if (p.varianceHold) {
      lines.push(`${p.id} is not checked. The variance factor is high.`);
    } else if (p.uncheckedObservationId) {
      lines.push(
        `${p.id} is fixed but unchecked. ${p.uncheckedObservationId} does not check it.`,
      );
    } else {
      lines.push(
        p.branchChoice
          ? `${p.id} is an explicit branch choice, so it is fixed but unchecked.`
          : `${p.id} is fixed but unchecked. Nothing spare is checking it.`,
      );
    }
  }
  if (p.semiMajor95M != null && p.x != null) {
    lines.push(`${p.id} 95% semi-major ${mm(p.semiMajor95M)}.`);
  }
  if (p.earlyWarning === 'shallow-intersection' || p.earlyWarning === 'straight-intersection') {
    lines.push(`${p.id} intersection is shallow. The ellipse decides, not the angle.`);
  }
  if (p.earlyWarning === 'shallow-rays') {
    lines.push(`${p.id} rays cross under about 25°. The ellipse decides.`);
  }
  if (p.meetsStationClass) {
    lines.push(`${p.id} meets the 200 mm station class.`);
  } else if (p.stationClassBlock === 'fx') {
    lines.push(`${p.id} does not meet the station class. fx is not calibrated to 1%.`);
  }
  return lines;
}

/** House closing sentence. Distances alone have no misclosure to test. */
export function houseCoachLine(tolerance: HouseTolerance, flatGateMm = 50): string {
  const semi = mm(tolerance.semiMajor95M);
  if (!tolerance.hasTraverseMisclosure) {
    return `No angles were measured, so the house has no traverse misclosure. Distance noise alone would still scatter a closing by a 95% semi-major of ${semi}. A flat ${flatGateMm} mm gate is not the test.`;
  }
  const gate = tolerance.pass ? 'inside' : 'outside';
  return `Traverse misclosure is ${gate} χ²(2, 0.95). The 95% semi-major of Q_m is ${semi}.`;
}
