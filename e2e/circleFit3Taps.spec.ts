import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

/**
 * Paul, 31 Oct 2026: three tapped edge points must give the exact fit. Same real photo path as
 * circleAddExit.spec.ts; each photo is tapped where EDG01-03 see the base points (circle-3.json).
 * Add edge point through the real native photo callback (Capacitor GardenCamera mocked at the
 * bridge, not a fixture injection): camera, the tap screen, Save (3 times) and Cancel. The phone
 * is landscape for the camera and the tap screen, as on the iPhone. Every exit lands on the edge
 * point list with Add edge point on screen (the TestFlight bug: it was scrolled away).
 */
const SHOTS = process.env.SHOTS_DIR;
const shot = async (p: Page, name: string) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ context }) => {
  const docText = readFileSync('e2e/fixtures/circle-0.json', 'utf8');
  await context.addInitScript((d) => { if (!sessionStorage.getItem('s')) { localStorage.setItem('garden-survey:document', d); sessionStorage.setItem('s', '1'); } }, docText);
  await context.addInitScript(() => {
    let n = 0;
    const w = window as unknown as Record<string, unknown>;
    w.CapacitorCustomPlatform = { name: 'ios' };
    w.Capacitor = {
      PluginHeaders: [{ name: 'GardenCamera', methods: [{ name: 'capture', rtype: 'promise' }, { name: 'release', rtype: 'promise' }] }],
      nativePromise: async (pl: string, m: string) => {
        if (pl === 'GardenCamera' && m === 'capture') {
          if (w.__cancel) return { cancelled: true };
          n += 1;
          return { path: `/cam/${n}.jpg`, webPath: `/__cam/${n}.jpg`, fileName: `IMG_${n}.jpg`, mimeType: 'image/jpeg', byteSize: 1, source: 'shutter', videoZoomFactor: 1 };
        }
        if (pl === 'GardenCamera') return {};
        throw Object.assign(new Error('UNIMPLEMENTED'), { code: 'UNIMPLEMENTED' });
      },
      convertFileSrc: (p: string) => p,
    };
  });
  await context.route('**/__cam/*', (r) => r.fulfill({ path: 'e2e/fixtures/edge4-retake.jpg', contentType: 'image/jpeg' }));
});

const TAPS: Record<string, number>[] = [
  { BAS01: 1229, BAS02: 275, BAS03: 2704, BAS04: 3678, BAS05: 2016 },
  { BAS01: 1727, BAS02: 345, BAS03: 3163, BAS04: 3178, BAS05: 2016 },
  { BAS01: 2223, BAS02: 778, BAS03: 3520, BAS04: 1772, BAS05: 2016 },
];

async function addTappedPoint(p: Page, px: Record<string, number>) {
  await p.getByTestId('edge-add').tap();
  await expect(p.getByTestId('photo-tap-prompt')).toContainText('Tap BAS01', { timeout: 15000 });
  await p.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>('[data-testid="photo-tap-stage"] img'); return !i || (i.complete && i.naturalWidth > 0); });
  await p.waitForTimeout(500);
  for (let k = 0; k < 20; k += 1) {
    const m = /Tap (BAS\d\d)/.exec((await p.getByTestId('photo-tap-prompt').textContent()) ?? '');
    if (!m) break;
    if (px[m[1]!]) {
      const r = (await p.locator('[data-testid="photo-tap-stage"] img, [data-testid="photo-tap-stage"] canvas').first().boundingBox())!;
      await p.touchscreen.tap(r.x + (px[m[1]!]! / 4032) * r.width, r.y + 0.5 * r.height);
    } else await p.getByTestId('photo-tap-skip').tap();
    await p.waitForTimeout(200);
  }
  await p.getByTestId('photo-tap-save').tap();
  await expect(p.locator('.photo-tap')).toHaveCount(0);
}

test('3 tapped and saved edge points give the exact fit', async ({ page: p }) => {
  test.setTimeout(180000);
  p.on('dialog', (d) => d.accept());
  await p.goto('./');
  for (let i = 0; i < 3; i += 1) {
    await addTappedPoint(p, TAPS[i]!);
    await expect(p.locator('[data-testid^="edge-row-EDG"]')).toHaveCount(i + 1);
    const summary = await p.getByTestId('edge-summary').textContent();
    expect(summary).not.toContain('not in the fit');
    if (i < 2) await expect(p.getByTestId('edge-point-list')).toContainText(`Goes into the fit when 3 points have their taps (${i + 1} now)`);
  }
  await expect(p.getByTestId('edge-fit-open')).toBeEnabled();
  await expect(p.getByTestId('edge-fit-open')).toContainText('exact fit, no check possible');
  await p.evaluate(() => document.querySelector('.workflow-roller-sheet')?.scrollTo(0, 0));
  await shot(p, 'fit3-list-after-3-saves');
  await p.getByTestId('edge-fit-open').tap();
  await expect(p.getByTestId('edge-fit-panel')).toContainText('Exact fit through 3 points');
  await p.getByTestId('edge-fit-panel').scrollIntoViewIfNeeded();
  await shot(p, 'fit3-fit-result');
});
