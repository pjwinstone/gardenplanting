import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

/**
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

async function addVisible(p: Page) {
  const add = p.getByTestId('edge-add');
  await expect(add).toBeVisible();
  const box = (await add.boundingBox())!;
  const vp = p.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + 20).toBeLessThanOrEqual(vp.height);
  await expect(p.getByTestId('edge-substages')).toHaveAttribute('data-place', 'list');
}

const PX: Record<string, number> = { BAS01: 2781, BAS02: 1339, BAS03: 3596, BAS04: 649, BAS05: 2076 };

async function photoAndSave(p: Page, name?: string) {
  await p.getByTestId('edge-add').tap();
  await expect(p.getByTestId('photo-tap-prompt')).toContainText('Tap BAS01', { timeout: 15000 });
  await p.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>('[data-testid="photo-tap-stage"] img'); return !i || (i.complete && i.naturalWidth > 0); });
  await p.waitForTimeout(500);
  for (let k = 0; k < 20; k += 1) {
    const m = /Tap (BAS\d\d)/.exec((await p.getByTestId('photo-tap-prompt').textContent()) ?? '');
    if (!m) break;
    if (PX[m[1]!]) {
      const r = (await p.locator('[data-testid="photo-tap-stage"] img, [data-testid="photo-tap-stage"] canvas').first().boundingBox())!;
      await p.touchscreen.tap(r.x + (PX[m[1]!]! / 4032) * r.width, r.y + 0.5 * r.height);
    } else await p.getByTestId('photo-tap-skip').tap();
    await p.waitForTimeout(200);
  }
  await p.getByTestId('photo-tap-save').tap();
  await expect(p.locator('.photo-tap')).toHaveCount(0);
  await addVisible(p);
  if (name) await shot(p, name);
  // Sideways, as the phone is after the camera: Add edge point is still pinned on screen.
  await p.setViewportSize({ width: 844, height: 390 });
  await p.waitForTimeout(300);
  await addVisible(p);
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(300);
}

test('Add edge point: photo, taps, Save three times; back on the list with Add each time', async ({ page: p }) => {
  test.setTimeout(240000);
  p.on('dialog', (d) => d.accept());
  await p.goto('./');
  await addVisible(p);
  await shot(p, 'engine-1-list-add-pinned');
  for (let i = 1; i <= 3; i += 1) {
    await photoAndSave(p, i === 1 ? 'engine-2-after-1st-save' : i === 3 ? 'engine-3-after-3rd-save' : undefined);
    await expect(p.locator('[data-testid^="edge-row-EDG"]')).toHaveCount(i);
    await expect(p.getByTestId(`edge-item-EDG0${i}`)).toHaveClass(/edge-item--focus/);
  }
});

test('Add edge point: Cancel in the camera returns to the list with nothing added', async ({ page: p }) => {
  await p.goto('./');
  await p.evaluate(() => { (window as unknown as Record<string, unknown>).__cancel = true; });
  await p.getByTestId('edge-add').tap();
  await p.waitForTimeout(800);
  await addVisible(p);
  await expect(p.locator('[data-testid^="edge-row-EDG"]')).toHaveCount(0);
  await shot(p, 'engine-4-after-camera-cancel');
});

test('step buttons and Help (hierarchy)', async ({ page: p }) => {
  await p.goto('./');
  await expect(p.getByTestId('step-bar')).toBeVisible();
  await expect(p.locator('.roller-wheel')).toHaveCount(0);
  await p.getByTestId('step-all').tap();
  await expect(p.getByTestId('step-list')).toBeVisible();
  await shot(p, 'engine-5-step-buttons');
  await p.getByTestId('step-all').tap();
  await p.getByTestId('step-help').tap();
  await expect(p.getByTestId('eng-help-here')).toBeVisible();
  await p.getByTestId('eng-help-here').scrollIntoViewIfNeeded();
  await shot(p, 'engine-6-help-hierarchy');
});
