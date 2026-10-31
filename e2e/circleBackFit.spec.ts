import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';

/** Back on every step (to the previous one), and the 3-point fit shown as exact, not an error. */
const SHOTS = process.env.SHOTS_DIR;
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ context }) => {
  const d = readFileSync('e2e/fixtures/circle-3.json', 'utf8');
  await context.addInitScript((t) => { if (!sessionStorage.getItem('s')) { localStorage.setItem('garden-survey:document', t); sessionStorage.setItem('s', '1'); } }, d);
});

test('every step has Back to the previous step', async ({ page: p }) => {
  test.setTimeout(120000);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  await p.goto('./');
  await p.getByTestId('step-all').tap();
  const ids = await p.locator('[data-testid^="step-pick-"]').evaluateAll((bs) => bs.map((b) => (b as HTMLElement).dataset.step!));
  await p.getByTestId('step-all').tap();
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    await p.getByTestId('step-all').tap();
    await p.getByTestId(`step-pick-${ids[i]}`).tap();
    const back = p.getByTestId('step-back');
    await expect(back).toBeVisible();
    if (i === 0) await expect(back).toBeDisabled();
    else await expect(back).toBeEnabled();
    await p.evaluate(() => document.querySelector('.workflow-roller-sheet')?.scrollTo(0, 0));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/back-step-${String(i).padStart(2, '0')}-${ids[i]}.png` });
    if (i > 0) {
      await back.tap();
      await expect(p.getByTestId('step-current-btn')).toHaveAttribute('data-step', ids[i - 1]!);
    }
  }
});

test('3 points: exact fit, no check possible', async ({ page: p }) => {
  await p.goto('./');
  await expect(p.getByTestId('edge-fit-open')).toContainText('exact fit, no check possible');
  await p.getByTestId('edge-fit-open').tap();
  const panel = p.getByTestId('edge-fit-panel');
  await expect(panel).toContainText('Exact fit through 3 points');
  await expect(panel).not.toContainText('Inconclusive');
  await panel.scrollIntoViewIfNeeded();
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/fit-3-points.png` });
});
