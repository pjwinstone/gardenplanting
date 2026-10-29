import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function seed(page: Page, n: number) {
  const doc = readFileSync(`e2e/fixtures/circle-${n}.json`, 'utf8');
  await page.addInitScript((d) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('garden-survey:document', d);
      sessionStorage.setItem('seeded', '1');
    }
  }, doc);
  page.on('dialog', (d) => d.accept());
  await page.goto('./');
  await expect(page.getByTestId('edge-point-list')).toBeVisible();
}

async function drag(page: Page, testid: string, dx: number, dy: number) {
  await page.getByTestId(testid).evaluate((n, [dx, dy]) => {
    const r = n.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const pe = (type: string, X: number, Y: number) => n.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: X, clientY: Y, pointerType: 'touch' }));
    pe('pointerdown', x, y);
    for (let i = 1; i <= 6; i++) pe('pointermove', x + (dx * i) / 6, y + (dy * i) / 6);
    pe('pointerup', x + dx, y + dy);
    n.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, [dx, dy]);
}

test('circle fits from 3 edge points', async ({ page }) => {
  await seed(page, 3);
  await expect(page.getByTestId('edge-fit')).toContainText(/⌀ 12\.\d{3} m .* 3 points/);
});

test('edge points: tap opens the pop-up, note typing, save; swipe delete refits; restore', async ({ page }) => {
  await seed(page, 8);
  await expect(page.locator('[data-testid^="edge-row-"]')).toHaveCount(8);
  await drag(page, 'edge-row-EDG02', 0, -120);
  await expect(page.getByTestId('edge-modal')).toHaveCount(0);
  await page.getByTestId('edge-row-EDG05').tap();
  await expect(page.getByTestId('edge-modal-title')).toHaveText('Edge point EDG05');
  const note = page.getByTestId('edge-modal-note');
  await note.tap();
  await page.keyboard.type('Peg leaning');
  await expect(note).toBeFocused();
  await expect(note).toHaveValue('Peg leaning');
  await page.getByTestId('edge-modal-save').tap();
  await expect(page.getByTestId('edge-modal')).toHaveCount(0);

  await drag(page, 'edge-row-EDG03', -110, 4);
  await expect(page.getByTestId('edge-item-EDG03')).toHaveClass(/base-list-swiped/);
  await page.getByTestId('edge-delete-EDG03').tap();
  await expect(page.getByTestId('edge-fit')).toContainText('7 points');
  await page.getByTestId('edge-restore-EDG03').tap();
  await expect(page.getByTestId('edge-fit')).toContainText('8 points');
});

test('Photos viewer scrolls to the last photo', async ({ page }) => {
  await seed(page, 8);
  await page.getByTestId('workflow-photos').tap();
  const body = page.getByTestId('viewer-body');
  await body.evaluate((b) => { b.scrollTop = b.scrollHeight; });
  const last = page.locator('[data-testid="viewer-body"] [data-testid="photo-retake"]').last();
  await expect(last).toBeInViewport();
  await expect(page.getByTestId('workflow-photos-close')).toBeInViewport();
});

test('edge point pop-up: Retake photo opens the retake screen; the new photo refits the circle', async ({ page }) => {
  test.setTimeout(90_000);
  // Headless WebKit has no camera (getUserMedia crashes it), so the app uses its camera file input.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'mediaDevices', { get() { return undefined; }, configurable: true });
    HTMLInputElement.prototype.click = function () { (window as unknown as { __cam: HTMLInputElement }).__cam = this; };
  });
  await seed(page, 8);
  const fit0 = await page.getByTestId('edge-fit').textContent();
  const row0 = await page.getByTestId('edge-row-EDG04').textContent();
  await page.getByTestId('edge-row-EDG04').tap();
  const btn = page.getByTestId('edge-modal-retake');
  await expect(btn).toHaveText('Retake photo of EDG04');
  await expect(btn).toBeInViewport({ ratio: 1 });
  await btn.tap();
  await expect(page.getByTestId('edge-modal')).toHaveCount(0);
  const viewer = page.getByTestId('workflow-photos-viewer');
  await expect(viewer).toContainText('EDG04 · edge4.jpg');
  await viewer.getByTestId('photo-retake').tap();
  await expect(page.getByTestId('edge-fit')).toContainText('7 points');
  const cam = await page.evaluateHandle(() => (window as unknown as { __cam: HTMLInputElement }).__cam);
  await cam.asElement()!.setInputFiles('e2e/fixtures/edge4-retake.jpg');
  await expect(page.getByTestId('photo-tap-prompt')).toContainText('Tap BAS01');
  await page.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>('[data-testid="photo-tap-stage"] img'); return !i || (i.complete && i.naturalWidth > 0); });
  await page.waitForTimeout(500);
  const PX: Record<string, number> = { BAS01: 2781, BAS02: 1339, BAS03: 3596, BAS04: 649, BAS05: 2076 };
  for (let k = 0; k < 20; k++) {
    const m = /Tap (BAS\d\d)/.exec((await page.getByTestId('photo-tap-prompt').textContent()) ?? '');
    if (!m) break;
    if (PX[m[1]!]) {
      const r = (await page.locator('[data-testid="photo-tap-stage"] img, [data-testid="photo-tap-stage"] canvas').first().boundingBox())!;
      await page.touchscreen.tap(r.x + (PX[m[1]!]! / 4032) * r.width, r.y + 0.5 * r.height);
    } else await page.getByTestId('photo-tap-skip').tap();
    await page.waitForTimeout(200);
  }
  await page.getByTestId('photo-tap-save').tap();
  await expect(page.getByTestId('edge-fit')).toContainText('8 points');
  expect(await page.getByTestId('edge-fit').textContent()).not.toBe(fit0);
  expect(await page.getByTestId('edge-row-EDG04').textContent()).not.toBe(row0);
  await page.getByTestId('edge-row-EDG04').tap();
  await page.getByTestId('edge-modal-retake').tap();
  await expect(page.getByTestId('viewer-previous')).toContainText('Previous photo · edge4.jpg');
  await expect(page.getByTestId('workflow-photos-viewer')).toContainText('Current photo · EDG04');
});
