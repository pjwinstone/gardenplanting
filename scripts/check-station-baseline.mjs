/**
 * Smoke: station-from-baseline subtended-distance geometry.
 * Run: node scripts/check-station-baseline.mjs
 */

function station(ax, ay, bx, by, angleRad, side = 1) {
  const dx = bx - ax;
  const dy = by - ay;
  const blLen = Math.hypot(dx, dy);
  const half = angleRad / 2;
  const dist = half > 1e-4 ? blLen / 2 / Math.tan(half) : blLen * 1.2;
  const ux = dx / blLen;
  const uy = dy / blLen;
  const nx = -uy;
  const ny = ux;
  const midX = (ax + bx) / 2;
  const midY = (ay + by) / 2;
  return {
    x: midX + nx * side * dist,
    y: midY + ny * side * dist,
    dist,
  };
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// Horizontal baseline; 20° subtended → camera north of midline.
{
  const angle = (20 * Math.PI) / 180;
  const s = station(0, 0, 7, 0, angle, 1);
  assert(s.y > 1, `station should be off baseline (y=${s.y})`);
  assert(Math.abs(s.x - 3.5) < 0.2, `station roughly at mid-x (x=${s.x})`);
  assert(s.dist > 5 && s.dist < 40, `plausible distance (d=${s.dist})`);
}

console.log('OK station-from-baseline geometry');
