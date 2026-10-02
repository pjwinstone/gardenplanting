/**
 * Bearings.
 * Image +x is clockwise in plan, so the level click is atan2(cx − px, fx).
 * Gravity is already in the camera frame: +x right, +y down, +z along the
 * optical axis. A level phone reads about (0, +1, 0). Mapping DeviceMotion
 * axes onto that frame is still the follow-up in GEOMETRY_DESIGN.md §9.
 */

export function wrap(rad: number): number {
  return Math.atan2(Math.sin(rad), Math.cos(rad));
}

export function clickBearingUnlevelled(px: number, cx: number, fx: number): number {
  return Math.atan2(cx - px, fx);
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function rx(p: number): number[][] {
  const c = Math.cos(p);
  const s = Math.sin(p);
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
}

function rz(r: number): number[][] {
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}

function mul3(a: number[][], v: Vec3): Vec3 {
  return {
    x: a[0][0] * v.x + a[0][1] * v.y + a[0][2] * v.z,
    y: a[1][0] * v.x + a[1][1] * v.y + a[1][2] * v.z,
    z: a[2][0] * v.x + a[2][1] * v.y + a[2][2] * v.z,
  };
}

function mulMat(a: number[][], b: number[][]): number[][] {
  const o = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      o[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return o;
}

/**
 * Pitch (positive optical axis down) and roll recovered from gravity.
 * R = Rx(pitch) Rz(roll) maps the camera ray into a level frame and matches
 * the published tilt table. Any leftover yaw is absorbed by ψ.
 */
export function pitchRollFromGravity(g: Vec3): { pitch: number; roll: number } {
  const n = Math.hypot(g.x, g.y, g.z) || 1;
  const x = g.x / n;
  const y = g.y / n;
  const z = g.z / n;
  const pitch = Math.atan2(-z, Math.hypot(x, y));
  const roll = Math.atan2(x, y);
  return { pitch, roll };
}

/** Levelled camera ray. y in the input ray is downward. */
export function levelRay(ray: Vec3, gravity: Vec3): Vec3 {
  const { pitch, roll } = pitchRollFromGravity(gravity);
  const R = mulMat(rx(pitch), rz(roll));
  return mul3(R, ray);
}

/**
 * ∂β/∂fx for the unlevelled click, β = atan2(cx − px, fx).
 */
export function clickBearingFxDerivative(px: number, cx: number, fx: number): number {
  const u = cx - px;
  return -u / (fx * fx + u * u);
}

/**
 * ∂β/∂s where fx = fx₀(1+s) and fy = fy₀(1+s).
 * The ray is evaluated at the current focal length. ∂β/∂fx is then multiplied
 * by fx₀, not by the current fx, so the factor (1+s) is not applied twice.
 */
export function levelledBearingScaleDerivative(opts: {
  px: number;
  py: number;
  cx: number;
  cy: number;
  /** Current focal length, fx₀(1+s). */
  fx: number;
  fy: number;
  /** Nominal focal length fx₀. Defaults to `fx`, which is exact only at s = 0. */
  fx0?: number;
  fy0?: number;
  gravity?: Vec3 | null;
}): number {
  const fx = opts.fx;
  const fy = opts.fy;
  const fx0 = opts.fx0 ?? fx;
  const fy0 = opts.fy0 ?? fy;
  if (!opts.gravity) return clickBearingFxDerivative(opts.px, opts.cx, fx) * fx0;
  const up = opts.px - opts.cx;
  const vp = opts.py - opts.cy;
  const { pitch, roll } = pitchRollFromGravity(opts.gravity);
  const R = mulMat(rx(pitch), rz(roll));
  const ray = mul3(R, { x: up / fx, y: vp / fy, z: 1 });
  const drdx = mul3(R, { x: -up / (fx * fx), y: 0, z: 0 });
  const drdy = mul3(R, { x: 0, y: -vp / (fy * fy), z: 0 });
  const n2 = ray.x * ray.x + ray.z * ray.z || 1e-18;
  const dBeta = (dRay: Vec3) => (-ray.z / n2) * dRay.x + (ray.x / n2) * dRay.z;
  return dBeta(drdx) * fx0 + dBeta(drdy) * fy0;
}

/**
 * Extra bearing σ from a residual tilt.
 * Roll ε contributes about ε·v/fx. Pitch δ contributes about δ·u·v/(fx²+u²).
 */
export function tiltBearingSigma(opts: {
  tiltSigmaRad: number;
  px: number;
  py: number;
  cx: number;
  cy: number;
  fx: number;
}): number {
  const u = opts.px - opts.cx;
  const v = opts.py - opts.cy;
  const roll = opts.tiltSigmaRad * (v / opts.fx);
  const pitch = (opts.tiltSigmaRad * u * v) / (opts.fx * opts.fx + u * u);
  return Math.hypot(roll, pitch);
}

/**
 * Horizontal bearing of one click.
 * Without gravity this is the unlevelled atan2(cx − px, fx), which is only
 * honest when a bubble has already forced the phone level.
 */
export function levelledBearing(opts: {
  px: number;
  py: number;
  cx: number;
  cy: number;
  fx: number;
  fy: number;
  gravity?: Vec3 | null;
}): number {
  if (!opts.gravity) return clickBearingUnlevelled(opts.px, opts.cx, opts.fx);
  const ray = levelRay(
    { x: (opts.px - opts.cx) / opts.fx, y: (opts.py - opts.cy) / opts.fy, z: 1 },
    opts.gravity,
  );
  return Math.atan2(-ray.x, ray.z);
}

/** Predicted bearing of a world point from a camera. */
export function predictedBearing(
  px: number,
  py: number,
  cx: number,
  cy: number,
  yaw: number,
): number {
  return wrap(Math.atan2(py - cy, px - cx) - yaw);
}

/**
 * σ_β² = (σ_px / fx)² + (σ_centring / d)².
 * Pole plumb is a station offset, not a term on every ray.
 */
export function bearingSigma(opts: {
  sigmaPx: number;
  fx: number;
  sigmaCentringM?: number;
  rangeM?: number;
}): number {
  const pixel = opts.sigmaPx / opts.fx;
  const centring =
    opts.sigmaCentringM && opts.rangeM && opts.rangeM > 1e-6
      ? opts.sigmaCentringM / opts.rangeM
      : 0;
  return Math.hypot(pixel, centring);
}

/** Circular mean of angles. */
export function circularMean(angles: number[]): number {
  let x = 0;
  let y = 0;
  for (const a of angles) {
    x += Math.cos(a);
    y += Math.sin(a);
  }
  return Math.atan2(y, x);
}
