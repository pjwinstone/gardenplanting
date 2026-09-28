/**
 * Screenshot hamburger UI at iPhone 16 Pro Max viewport.
 * Usage: node scripts/screenshot-hamburger.mjs
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { join } from 'path';

const OUT = '/cursor/stores/bc-01a0d822-3f7c-74bb-8fe7-574d73452476/media';
const BASE = process.env.SHOT_URL || 'http://127.0.0.1:4177/gardenplanting/';
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
  path: join(OUT, 'hamburger-ui-closed.png'),
  fullPage: false,
});

await page.click('[data-testid="hamburger"]');
await page.waitForSelector('[data-testid="menu-drawer"]', { timeout: 5000 });
await page.screenshot({
  path: join(OUT, 'hamburger-ui-open.png'),
  fullPage: false,
});

await page.$eval('.menu-drawer__close', (el) => el.click());
await page.waitForFunction(
  () => !document.querySelector('[data-testid="menu-drawer"]'),
  { timeout: 5000 },
);

await page.evaluate(() => {
  const script = document.createElement('script');
  script.textContent =
    `setTimeout(() => { throw new Error('Screenshot demo error for red hamburger'); }, 30);`;
  document.documentElement.appendChild(script);
});
await page.waitForSelector('.hamburger--alert', { timeout: 5000 });
await page.screenshot({
  path: join(OUT, 'hamburger-ui-red-error.png'),
  fullPage: false,
});

console.log('Wrote screenshots to', OUT);
await browser.close();
