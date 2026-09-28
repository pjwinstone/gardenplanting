/**
 * iPhone screenshots for 0.7.1 accordion UI:
 * 1) closed plan (garden + hamburger only)
 * 2) Recommended next accordion open
 * 3) + Point accordion open alone
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { join } from 'path';

const OUT = '/cursor/stores/bc-01a0d822-3f7c-74bb-8fe7-574d73452476/media';
const BASE = process.env.SHOT_URL || 'http://127.0.0.1:4179/gardenplanting/';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('[data-testid="hamburger"]', { timeout: 15000 });

await page.screenshot({
  path: join(OUT, 'iphone-accordion-closed.png'),
  fullPage: false,
});

await page.click('[data-testid="hamburger"]');
await page.waitForSelector('[data-testid="menu-drawer"]', { timeout: 5000 });
await page.waitForSelector('[data-testid="menu-acc-recommend"][open]', { timeout: 5000 });
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({
  path: join(OUT, 'iphone-accordion-recommend.png'),
  fullPage: false,
});

// Prefer Recommend → + Point shortcut if present; else open + Point accordion.
const pointShortcut = await page.$('[data-section="add-point"][data-cmd="open-menu-section"]');
if (pointShortcut) {
  await pointShortcut.click();
} else {
  await page.$eval('[data-testid="menu-acc-add-point"] > summary', (el) => el.click());
}
await page.waitForSelector('[data-testid="menu-acc-add-point"][open]', { timeout: 5000 });
await page.waitForFunction(
  () => !document.querySelector('[data-testid="menu-acc-recommend"][open]'),
  { timeout: 5000 },
);
await page.waitForSelector('[data-testid="add-point-panel"]', { timeout: 5000 });
await new Promise((r) => setTimeout(r, 250));
await page.screenshot({
  path: join(OUT, 'iphone-accordion-add-point.png'),
  fullPage: false,
});

console.log('Wrote screenshots to', OUT);
await browser.close();
