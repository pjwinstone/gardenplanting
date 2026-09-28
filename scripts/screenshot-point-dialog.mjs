/**
 * Screenshots for 0.7.2 — translucent draggable point dialog + clean plan.
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { join } from 'path';

const OUT = '/cursor/stores/bc-01a0d822-3f7c-74bb-8fe7-574d73452476/media';
const BASE = process.env.SHOT_URL || 'http://127.0.0.1:4180/gardenplanting/';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => {
  localStorage.removeItem('garden-survey-seen-build');
  localStorage.removeItem('garden-survey-doc');
});
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('[data-testid="hamburger"]', { timeout: 15000 });

// 1) Clean plan — garden + hamburger only
await page.screenshot({
  path: join(OUT, 'point-dialog-plan-closed.png'),
  fullPage: false,
});

// 2) First ☰ after new build → Version accordion
await page.click('[data-testid="hamburger"]');
await page.waitForSelector('[data-testid="menu-drawer"]', { timeout: 5000 });
await page.waitForSelector('[data-testid="menu-acc-version"][open]', { timeout: 5000 });
await new Promise((r) => setTimeout(r, 200));
await page.screenshot({
  path: join(OUT, 'menu-version-first-open.png'),
  fullPage: false,
});

// Load synthetic demo so + Point is meaningful
await page.$eval('[data-testid="menu-acc-tools"] > summary', (el) => el.click());
await new Promise((r) => setTimeout(r, 200));
await page.click('[data-cmd="load-synthetic"]');
await page.waitForFunction(
  () => !document.querySelector('[data-testid="menu-drawer"]'),
  { timeout: 8000 },
);
await new Promise((r) => setTimeout(r, 400));

// Open menu → Recommended → + Point (or Tools → + Point)
await page.click('[data-testid="hamburger"]');
await page.waitForSelector('[data-testid="menu-drawer"]', { timeout: 5000 });
await page.$eval('[data-testid="menu-acc-recommend"] > summary', (el) => el.click());
await new Promise((r) => setTimeout(r, 200));

let opened = false;
const recommendAdd = await page.$('[data-testid="recommend-add-point"]');
if (recommendAdd) {
  await recommendAdd.click();
  opened = true;
} else {
  await page.$eval('[data-testid="menu-acc-tools"] > summary', (el) => el.click());
  await new Promise((r) => setTimeout(r, 150));
  await page.click('[data-testid="tools-panel"] [data-cmd="open-point-dialog"]');
  opened = true;
}

if (!opened) throw new Error('Could not open point dialog');
await page.waitForSelector('[data-testid="point-dialog"]', { timeout: 8000 });
await page.waitForFunction(
  () => !document.querySelector('[data-testid="menu-drawer"]'),
  { timeout: 5000 },
);
await new Promise((r) => setTimeout(r, 300));

// 3) Dialog open translucent over plan
await page.screenshot({
  path: join(OUT, 'point-dialog-open-translucent.png'),
  fullPage: false,
});

// 4) Drag via header
const handle = await page.$('[data-testid="point-dialog"] [data-drag-handle]');
const box = await handle.boundingBox();
if (!box) throw new Error('No drag handle box');
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 180, {
  steps: 14,
});
await page.mouse.up();
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({
  path: join(OUT, 'point-dialog-dragged.png'),
  fullPage: false,
});

console.log('Wrote screenshots to', OUT);
await browser.close();
