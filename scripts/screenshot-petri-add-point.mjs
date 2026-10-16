/**
 * Portrait screenshots for Petri + Point workflow PR.
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { join } from 'path';

const OUT = '/opt/cursor/artifacts/screenshots';
const BASE = process.env.SHOT_URL || 'http://127.0.0.1:4180/gardenplanting/';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 3 });

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => {
  localStorage.removeItem('garden-survey-seen-build');
  localStorage.removeItem('garden-survey-doc');
  localStorage.setItem('garden-survey:petri-add-point', '1');
});
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('[data-testid="hamburger"]', { timeout: 15000 });

await page.click('[data-testid="hamburger"]');
await page.waitForSelector('[data-testid="menu-drawer"]', { timeout: 5000 });
await page.$eval('[data-testid="menu-acc-tools"] > summary', (el) => el.click());
await page.waitForSelector('[data-testid="toggle-petri-add-point"]', { timeout: 5000 });
await page.screenshot({
  path: join(OUT, 'petri-settings-toggle-portrait.png'),
  fullPage: false,
});

await page.click('[data-testid="tools-open-add-point"]');
await page.waitForSelector('[data-testid="petri-add-point"]', { timeout: 8000 });
await page.screenshot({
  path: join(OUT, 'petri-pick-layer-portrait.png'),
  fullPage: false,
});

await page.click('[data-cmd="petri-pick-layer"][data-layer-rule="baseline"]');
await page.waitForFunction(
  () => document.querySelector('[data-cmd="petri-pick-fix"]'),
  { timeout: 5000 },
);
await page.screenshot({
  path: join(OUT, 'petri-pick-fix-portrait.png'),
  fullPage: false,
});

await browser.close();
console.log('Wrote petri screenshots to', OUT);
