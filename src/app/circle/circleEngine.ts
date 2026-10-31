/** Garden Planting: the circle test nets on the generic engine (src/engine). */
import circleNetsYaml from '../../../workflow/nets/circle-test.nets.yaml?raw';
import { Engine, loadNets, type Guard } from '../../engine';

export const circleNets = loadNets(circleNetsYaml);

/** Guards read app state through this hook (set by the guided chrome before rendering). */
export interface CircleFacts {
  points: number;
  live: number;
  deleted: number;
  fitN: number;
  cameFromStep: boolean;
  pointDeleted: boolean;
  /** Title of the previous step, or '' on the first one. */
  prevStep: string;
}
let facts: CircleFacts = { points: 0, live: 0, deleted: 0, fitN: 0, cameFromStep: false, pointDeleted: false, prevStep: '' };
export function setCircleFacts(f: Partial<CircleFacts>): void { facts = { ...facts, ...f }; }
export function circleFacts(): CircleFacts { return facts; }

export const circleGuards: Record<string, Guard> = {
  canFit: () => (facts.fitN >= 3 ? { ok: true } : { ok: false, why: `Needs 3 edge points in the fit (${facts.fitN} now).` }),
  cameFromStep: () => (facts.cameFromStep ? { ok: true } : { ok: false, why: 'You came here from the steps: pick a step to go to another one.' }),
  hasPrevStep: () => (facts.prevStep ? { ok: true } : { ok: false, why: 'This is the first step.' }),
  hasPoints: () => (facts.points > 0 ? { ok: true } : { ok: false, why: 'No edge points yet.' }),
  hasLivePoint: () => (facts.live > 0 ? { ok: true } : { ok: false, why: 'No point to delete.' }),
  hasDeletedPoint: () => (facts.deleted > 0 ? { ok: true } : { ok: false, why: 'Nothing deleted.' }),
  pointLive: () => (!facts.pointDeleted ? { ok: true } : { ok: false, why: 'Already deleted.' }),
  pointDeleted: () => (facts.pointDeleted ? { ok: true } : { ok: false, why: 'Not deleted.' }),
};

export const circleEngine = new Engine(circleNets, { guards: circleGuards });

/** Fire `id` if it is a move of the current level; otherwise do nothing (other flows). */
export function circleFire(id: string, opts?: { arg?: string; focus?: string }): boolean {
  return circleEngine.moves().some((m) => m.t.id === id) ? circleEngine.fire(id, opts) : false;
}

export function circleAt(net: string, place?: string): boolean {
  const w = circleEngine.where();
  return w.net === net && (place === undefined || w.place === place);
}

/** Make sure the engine is inside the circle test (resume lands on the steps / list). */
export function circleEnter(onEdgeStep: boolean): void {
  if (circleAt('home', 'hub')) circleEngine.fire('open_circle_test');
  if (onEdgeStep && circleAt('circle_test', 'steps')) circleEngine.fire('open_edge_points');
}

/** Camera / tap screen events from the app shell (ui.ts). Ignored outside Add edge point. */
export function circleCameraEvent(kind: 'photo_in' | 'camera_cancel' | 'taps_saved' | 'taps_later'): boolean {
  if (circleAt('edge_edit', 'taps') && (kind === 'taps_saved' || kind === 'taps_later')) return circleEngine.fire('taps_back');
  return circleAt('edge_add') ? circleFire(kind) : false;
}
