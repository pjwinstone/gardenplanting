/**
 * Smoke: provisional OCC placement stays clearly off the A–B baseline.
 * Run: node scripts/check-occ-off-baseline.mjs
 */
function place(ax, ay, bx, by, measured, sideHint) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const minOff = Math.max(1.5, len * 0.2);
  const step = Math.max(0.8, len * 0.12);
  const side = sideHint || 1;
  let x;
  let y;
  if (measured.length) {
    const last = measured[measured.length - 1];
    const along = (last.x - ax) * ux + (last.y - ay) * uy;
    const nextAlong = along + step;
    x = ax + ux * nextAlong + nx * side * minOff;
    y = ay + uy * nextAlong + ny * side * minOff;
  } else {
    x = (ax + bx) / 2 + nx * side * minOff;
    y = (ay + by) / 2 + ny * side * minOff;
  }
  const dist = (x - ax) * nx + (y - ay) * ny;
  return { x, y, dist, minOff };
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

// Horizontal baseline 0–7 on X axis — spiral used to drift onto y≈0.
{
  const p0 = place(0, 0, 7, 0, [], 1);
  assert(Math.abs(p0.dist) >= p0.minOff * 0.85, `first point on baseline (dist=${p0.dist})`);
  assert(p0.y > 1, `first point should be clearly above baseline (y=${p0.y})`);

  const chain = [{ x: p0.x, y: p0.y }];
  for (let i = 0; i < 12; i++) {
    const p = place(0, 0, 7, 0, chain, 1);
    assert(Math.abs(p.dist) >= p.minOff * 0.85, `point ${i + 2} on baseline (dist=${p.dist})`);
    assert(p.y > 1, `point ${i + 2} flipped onto/near line (y=${p.y})`);
    chain.push({ x: p.x, y: p.y });
  }
}

// Opposite side stays below.
{
  const p = place(0, 0, 7, 0, [], -1);
  assert(p.y < -1, `should follow negative side (y=${p.y})`);
}

console.log('OK occ-off-baseline placement rules');
