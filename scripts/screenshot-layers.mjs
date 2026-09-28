/**
 * Screenshots for layers/objects 0.7.0
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { join } from 'path';

const OUT = '/cursor/stores/bc-01a0d822-3f7c-74bb-8fe7-574d73452476/media';
const BASE = process.env.SHOT_URL || 'http://127.0.0.1:4178/gardenplanting/';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('[data-testid="add-point-panel"]', { timeout: 15000 });
await page.screenshot({ path: join(OUT, 'layers-objects-start.png'), fullPage: false });

await page.click('[data-testid="hamburger"]');
await page.waitForSelector('[data-testid="menu-drawer"]', { timeout: 5000 });
await page.click('[data-cmd="load-synthetic"]');
await new Promise((r) => setTimeout(r, 700));
await page.waitForFunction(
  () => !document.querySelector('[data-testid="menu-drawer"]'),
  { timeout: 5000 },
).catch(async () => {
  const close = await page.$('.menu-drawer__close');
  if (close) await page.$eval('.menu-drawer__close', (el) => el.click());
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: join(OUT, 'layers-objects-after-demo.png'), fullPage: false });

await page.click('[data-testid="add-photo"]');
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: join(OUT, 'layers-objects-add-photo.png'), fullPage: false });

await page.$eval('[data-point-id]', (el) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true })),
);
await page.waitForSelector('[data-testid="inspector-panel"]', { timeout: 5000 });
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: join(OUT, 'layers-objects-inspector.png'), fullPage: false });

console.log('Wrote screenshots to', OUT);
await browser.close();
