/**
 * Screenshots for 0.7.3 — bottom-right hamburger, no mode chip.
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
  localStorage.removeItem('garden-survey:document');
});
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('[data-testid="hamburger"]', { timeout: 15000 });

const pos = await page.$eval('[data-testid="hamburger"]', (el) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
});
if (pos.top < 700 || pos.right < 350) {
  throw new Error(`Hamburger not bottom-right: ${JSON.stringify(pos)}`);
}
const chip = await page.$('.mode-hint, .mode-hint__btn, [data-testid="mode-hint"]');
if (chip) throw new Error('Mode chip still present on plan');

await page.screenshot({
  path: join(OUT, 'hamburger-bottom-right-closed.png'),
  fullPage: false,
});

// Open dialog briefly to show coexists with bottom-right ☰
await page.click('[data-testid="hamburger"]');
await page.waitForSelector('[data-testid="menu-drawer"]', { timeout: 5000 });
await page.$eval('[data-testid="menu-acc-tools"] > summary', (el) => el.click());
await new Promise((r) => setTimeout(r, 150));
await page.click('[data-cmd="load-synthetic"]');
await page.waitForFunction(
  () => !document.querySelector('[data-testid="menu-drawer"]'),
  { timeout: 8000 },
);
await new Promise((r) => setTimeout(r, 300));
await page.click('[data-testid="hamburger"]');
await page.waitForSelector('[data-testid="menu-drawer"]', { timeout: 5000 });
await page.$eval('[data-testid="menu-acc-tools"] > summary', (el) => el.click());
await new Promise((r) => setTimeout(r, 150));
await page.click('[data-testid="tools-panel"] [data-cmd="open-point-dialog"]');
await page.waitForSelector('[data-testid="point-dialog"]', { timeout: 8000 });
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({
  path: join(OUT, 'hamburger-bottom-right-with-dialog.png'),
  fullPage: false,
});

console.log('Hamburger at', pos);
console.log('Wrote screenshots to', OUT);
await browser.close();
