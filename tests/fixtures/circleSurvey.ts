/**
 * Synthetic garden-circle survey with known truth (docs/garden-circle.md): BAS01–BAS02 taped,
 * edge points on a circle (or an ellipse), camera positions round it, photos made by projecting
 * every point in view with a little click noise. Feeds the main adjustment (solve).
 */
import type { SolveInput, SolverPhotoInput } from '../../src/solver/types';

export interface Xy { x: number; y: number }

export interface CircleSurveyOpt {
  /** Circle centre and radius (m); ellipse when ry differs from r. */
  centre?: Xy;
  r?: number;
  ry?: number;
  /** Edge point azimuths, degrees (default 12 evenly). */
  pointDeg?: number[];
  /** Camera azimuths round the centre, degrees, at `camRange` m from it. */
  cameraDeg?: number[];
  camRange?: number;
  baselineM?: number;
  /** Camera positions taped to BAS01 and BAS02 (default the first two). */
  tapedCameras?: number;
  /** Old field rule: only yaws that keep BAS01 or BAS02 in view (default false: any yaw). */
  basInEveryPhoto?: boolean;
  /** Most photos per camera position. */
  photosPerPosition?: number;
  /** Click noise, px (1σ). */
  noisePx?: number;
  seed?: number;
}

const WIDTH = 4032;
const HEIGHT = 3024;
const FX_OVER_WIDTH = 0.75;
const HALF_FOV = Math.atan(0.5 / FX_OVER_WIDTH) * 0.92;

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

export function circleSurvey(o: CircleSurveyOpt = {}) {
  const c = o.centre ?? { x: 3, y: 8 };
  const r = o.r ?? 6;
  const ry = o.ry ?? r;
  const L = o.baselineM ?? 6;
  const deg = o.pointDeg ?? Array.from({ length: 12 }, (_, i) => i * 30 + 15);
  const camDeg = o.cameraDeg ?? [-40, 50, 140, 230];
  const range = o.camRange ?? r + 4;
  const rand = rng(o.seed ?? 5);
  const noise = o.noisePx ?? 0.5;
  const truth: Record<string, Xy> = { BAS01: { x: 0, y: 0 }, BAS02: { x: L, y: 0 } };
  const edgeIds: string[] = [];
  deg.forEach((d, i) => {
    const id = `EDG${String(i + 1).padStart(2, '0')}`;
    edgeIds.push(id);
    truth[id] = { x: c.x + r * Math.cos((d * Math.PI) / 180), y: c.y + ry * Math.sin((d * Math.PI) / 180) };
  });
  const photos: SolverPhotoInput[] = [];
  camDeg.forEach((d, k) => {
    const station = `POS${k + 1}`;
    const S = { x: c.x + range * Math.cos((d * Math.PI) / 180), y: c.y + range * Math.sin((d * Math.PI) / 180) };
    truth[station] = S;
    // Yaws that cover every point from here, plus one on the baseline.
    const targets = Object.entries(truth).filter(([id]) => !id.startsWith('POS'));
    const azs = targets.map(([, p]) => Math.atan2(p.y - S.y, p.x - S.x));
    // Pick yaws greedily until every point in range is in some photo. A photo with no baseline
    // end is oriented by the edge points it shares with other photos.
    const inView = (yaw: number) => targets.map((_, t) => {
      const b = Math.atan2(Math.sin(azs[t] - yaw), Math.cos(azs[t] - yaw));
      return Math.abs(b) <= HALF_FOV;
    });
    const options: { yaw: number; seen: boolean[] }[] = [];
    for (let a = -180; a < 180; a += 5) {
      const yaw = (a * Math.PI) / 180;
      const seen = inView(yaw);
      if (!o.basInEveryPhoto || targets.some(([id], t) => id.startsWith('BAS') && seen[t])) options.push({ yaw, seen });
    }
    const covered = new Set<number>();
    const yaws: number[] = [];
    for (let k2 = 0; k2 < (o.photosPerPosition ?? 6) && options.length; k2 += 1) {
      let best = options[0];
      let gain = -1;
      for (const op of options) {
        const g = op.seen.filter((v, t) => v && !covered.has(t)).length;
        if (g > gain) { gain = g; best = op; }
      }
      if (gain <= 0 && yaws.length) break;
      options.splice(options.indexOf(best), 1);
      yaws.push(best.yaw);
      best.seen.forEach((v, t) => { if (v) covered.add(t); });
    }
    yaws.forEach((yaw, j) => {
      const seen = inView(yaw);
      const clicks = [];
      for (let t = 0; t < targets.length; t += 1) {
        if (!seen[t]) continue;
        const b = Math.atan2(Math.sin(azs[t] - yaw), Math.cos(azs[t] - yaw));
        const px = WIDTH / 2 - FX_OVER_WIDTH * WIDTH * Math.tan(b) + noise * gauss(rand);
        clicks.push({ pointId: targets[t][0], px, py: HEIGHT / 2 });
      }
      if (clicks.length >= 2) {
        photos.push({
          id: `${station}-${j + 1}`, stationId: station, width: WIDTH, height: HEIGHT, fxOverWidth: FX_OVER_WIDTH,
          fxRelativeUncertainty: 0.003, gravity: { x: 0, y: 1, z: 0 }, sigmaPx: 1, phoneId: 'phone', lens: '1x', clicks,
        } as SolverPhotoInput);
      }
    });
  });
  const distances = [];
  for (let k = 0; k < Math.min(o.tapedCameras ?? 2, camDeg.length); k += 1) {
    const S = truth[`POS${k + 1}`];
    for (const end of ['BAS01', 'BAS02']) {
      const E = truth[end];
      distances.push({ id: `POS${k + 1}-${end}`, a: `POS${k + 1}`, b: end, slopeM: Math.hypot(S.x - E.x, S.y - E.y) + 0.003 * gauss(rand), sigmaM: 0.005 });
    }
  }
  const input: SolveInput = {
    datum: { originId: 'BAS01', axisPointId: 'BAS02', lengthM: L, sigmaM: 0.003 },
    photos,
    distances,
  };
  return { input, truth, edgeIds, centre: c, r };
}
