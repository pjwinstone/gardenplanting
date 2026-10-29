// iPhone 13 (WebKit) check of the circle test sub-nets: list with summary and child buttons, edit
// Save / delete / restore keep you on the row (in view, highlighted), Add edge point after 12,
// the level-2 Edge points button and Back, Circle fit. Needs `npm run build`, `npx vite preview
// --port 4173` and e2e/fixtures (`WRITE_FIXTURE=e2e/fixtures npx vitest run tests/circleFixture.test.ts`).
import { webkit, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const URL = process.env.APP_URL ?? 'http://localhost:4173/gardenplanting/';
const OUT = process.env.SHOTS ?? '/workspace/petri/review/shots';
const b = await webkit.launch();
const fails = [];
const check = (ok, what) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
const ctx = await b.newContext({ ...devices['iPhone 13'] });
await ctx.addInitScript((d) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('garden-survey:document', d); sessionStorage.setItem('seeded', '1'); } }, readFileSync('e2e/fixtures/circle-12.json', 'utf8'));
// Headless WebKit has no camera (getUserMedia crashes it): the app uses its camera file input.
await ctx.addInitScript(() => {
  Object.defineProperty(Navigator.prototype, 'mediaDevices', { get() { return undefined; }, configurable: true });
  HTMLInputElement.prototype.click = function () { window.__cam = this; };
});
const p = await ctx.newPage();
p.on('pageerror', (e) => fails.push(`pageerror ${e.message}`));
p.on('dialog', (d) => d.accept());
await p.goto(URL);
await p.waitForSelector('[data-testid="edge-point-list"]');
await p.waitForTimeout(500);
const shot = (n) => p.screenshot({ path: `${OUT}/flow-${n}.png` });
const step = () => p.evaluate(() => JSON.parse(localStorage.getItem('garden-survey:document')).workflowProgress.runs['circle-field-test'].currentStepId);
/** On screen and what a finger there would hit. */
const hittable = (sel) => p.evaluate((s) => { const n = document.querySelector(s); if (!n) return false; const r = n.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20)); return !!hit && (n === hit || n.contains(hit)) && r.top >= 0 && r.bottom <= innerHeight; }, sel);
const focused = (id) => p.evaluate((i) => document.querySelector(`[data-testid="edge-row-${i}"]`)?.classList.contains('edge-row--focus'), id);
const noRedBanner = async (where) => check((await p.locator('.refuse--overlay').count()) === 0, `${where}: no red message area`);
async function bringListIntoView() {
  await p.evaluate(() => { const l = document.querySelector('[data-testid="edge-point-list"]'); l.scrollIntoView({ block: 'start' }); });
  await p.waitForTimeout(150);
}
async function swipe(sel, dx) {
  await p.evaluate(({ s, dx }) => {
    const n = document.querySelector(s); const r = n.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 20);
    const pe = (t, X, Y) => n.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: X, clientY: Y, pointerType: 'touch' }));
    pe('pointerdown', x, y); for (let i = 1; i <= 6; i++) pe('pointermove', x + (dx * i) / 6, y + 2); pe('pointerup', x + dx, y + 2);
    n.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, { s: sel, dx });
  await p.waitForTimeout(400);
}

// 1. The list: one-line summary, the child buttons with their status and why.
const summary = await p.textContent('[data-testid="edge-summary"]');
check(/^12 points · \d+ pass · \d+ amber · \d+ red · 0 deleted/.test(summary), `summary: "${summary}"`);
const add = await p.evaluate(() => { const n = document.querySelector('[data-testid="edge-add"]'); return { dis: n.disabled, text: n.textContent }; });
check(!add.dis && /Add edge point/.test(add.text) && /EDG13/.test(add.text), `Add edge point available with 12 photos: "${add.text}"`);
check(await hittable('[data-testid="edge-add"]'), 'Add edge point visible without scrolling');
const back = await p.evaluate(() => { const n = document.querySelector('[data-testid="edge-back"]'); return { dis: n.disabled, why: n.dataset.why }; });
check(back.dis && !!back.why, `Back shown disabled with its reason: "${back.why}"`);
await noRedBanner('list');
await shot('1-list');

// 2. Edit: open EDG10 (low in the list), type a note, Save: back on the list, EDG10 in view and highlighted.
await bringListIntoView();
await p.evaluate(() => { const l = document.querySelector('[data-testid="edge-point-list"]'); l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event('scroll')); });
await p.waitForTimeout(200);
const step0 = await step();
await p.tap('[data-testid="edge-row-EDG10"]');
await p.waitForSelector('[data-testid="edge-modal"]');
await p.evaluate(() => { const b = document.querySelector('[data-testid="edge-modal-body"]'); b.scrollTop = b.scrollHeight; });
await p.tap('[data-testid="edge-modal-note"]');
await p.keyboard.type('Peg moved', { delay: 10 });
await p.tap('[data-testid="edge-modal-save"]');
await p.waitForTimeout(500);
check((await p.locator('[data-testid="edge-modal"]').count()) === 0, 'Save closes the pop-up (your tap)');
check(await focused('EDG10'), 'after Save: EDG10 highlighted');
check(await hittable('[data-testid="edge-row-EDG10"]'), 'after Save: EDG10 in view, list not jumped to the top');
check((await step()) === step0, 'roller did not move');
await shot('2-after-edit-save');

// 3. Delete EDG11 by swipe: it stays in place, greyed, with Restore, in view and highlighted.
await swipe('[data-testid="edge-row-EDG11"]', -110);
await p.tap('[data-testid="edge-delete-EDG11"]');
await p.waitForTimeout(500);
check(await p.evaluate(() => document.querySelector('[data-testid="edge-row-EDG11"]').classList.contains('base-list-deleted')), 'EDG11 greyed (deleted)');
check(await focused('EDG11'), 'after Delete: EDG11 highlighted');
check(await hittable('[data-testid="edge-restore-EDG11"]'), 'after Delete: its Restore in view and tappable');
check(/1 deleted/.test(await p.textContent('[data-testid="edge-summary"]')), `summary counts it: "${await p.textContent('[data-testid="edge-summary"]')}"`);
check((await step()) === step0, 'roller did not move');
await shot('3-after-delete');

// 4. Restore: stays in place, highlighted.
await p.tap('[data-testid="edge-restore-EDG11"]');
await p.waitForTimeout(500);
check(!(await p.evaluate(() => document.querySelector('[data-testid="edge-row-EDG11"]').classList.contains('base-list-deleted'))), 'EDG11 restored');
check(await focused('EDG11') && await hittable('[data-testid="edge-row-EDG11"]'), 'after Restore: EDG11 in view and highlighted');
check(/0 deleted/.test(await p.textContent('[data-testid="edge-summary"]')), 'summary back to 0 deleted');
await shot('4-after-restore');

// 5. Delete from the pop-up: the pop-up stays (with Restore), no jump; Cancel returns to the row.
await p.tap('[data-testid="edge-row-EDG06"]');
await p.waitForSelector('[data-testid="edge-modal"]');
await p.evaluate(() => { const b = document.querySelector('[data-testid="edge-modal-body"]'); b.scrollTop = b.scrollHeight; });
await p.tap('[data-testid="edge-modal-delete"]');
await p.waitForTimeout(400);
check((await p.locator('[data-testid="edge-modal-restore"]').count()) === 1, 'pop-up Delete: the pop-up stays, now with Restore');
await p.tap('[data-testid="edge-modal-restore"]');
await p.waitForTimeout(300);
await p.tap('[data-testid="edge-modal-cancel"]');
await p.waitForTimeout(400);
check(await focused('EDG06') && await hittable('[data-testid="edge-row-EDG06"]'), 'Cancel: back on the list at EDG06, highlighted');

// 6. Circle fit (child button), then Back to the list.
await p.evaluate(() => document.querySelector('[data-testid="edge-substages"]').scrollIntoView({ block: 'start' }));
await p.tap('[data-testid="edge-fit-open"]');
await p.waitForTimeout(300);
check(await p.isVisible('[data-testid="edge-fit-panel"] .edge-fit-num'), 'Circle fit opens the fit');
await shot('5-fit');
await p.tap('[data-testid="edge-fit-close"]');
await p.waitForTimeout(300);

// 7. Add edge point with 12 already in: camera, the photo, its tap screen, Save: EDG13 in the list, highlighted.
await p.evaluate(() => document.querySelector('[data-testid="edge-substages"]').scrollIntoView({ block: 'start' }));
await p.tap('[data-testid="edge-add"]');
await p.waitForTimeout(400);
await (await p.evaluateHandle(() => window.__cam)).asElement().setInputFiles('e2e/fixtures/edge4-retake.jpg');
await p.waitForSelector('[data-testid="photo-tap-prompt"]');
await p.waitForFunction(() => { const i = document.querySelector('[data-testid="photo-tap-stage"] img'); return !i || (i.complete && i.naturalWidth > 0); });
await p.waitForTimeout(400);
await shot('6-add-point-tap-screen');
const PX = { BAS01: 2781, BAS02: 1339, BAS03: 3596, BAS04: 649, BAS05: 2076 };
for (let k = 0; k < 20; k++) {
  const m = /Tap (BAS\d\d)/.exec(await p.textContent('[data-testid="photo-tap-prompt"]'));
  if (!m) break;
  if (PX[m[1]]) {
    const r = await p.evaluate(() => { const x = document.querySelector('[data-testid="photo-tap-stage"] img, [data-testid="photo-tap-stage"] canvas').getBoundingClientRect(); return [x.x, x.y, x.width, x.height]; });
    await p.touchscreen.tap(r[0] + (PX[m[1]] / 4032) * r[2], r[1] + 0.5 * r[3]);
  } else await p.tap('[data-testid="photo-tap-skip"]');
  await p.waitForTimeout(200);
}
await p.tap('[data-testid="photo-tap-save"]');
await p.waitForTimeout(800);
check((await p.locator('[data-testid="edge-row-EDG13"]').count()) === 1, 'EDG13 added (13th point, past the 12 planned)');
check(await focused('EDG13') && await hittable('[data-testid="edge-row-EDG13"]'), 'after Add: EDG13 in view and highlighted');
check(/^13 points/.test(await p.textContent('[data-testid="edge-summary"]')), `summary: "${await p.textContent('[data-testid="edge-summary"]')}"`);
check((await step()) === step0, 'roller did not move');
await noRedBanner('after add');
await shot('7-after-add');

// 8. Level 2: on another step the Edge points button is there; it opens the list, Back returns.
await p.evaluate(() => { const s = document.querySelector('.workflow-roller-sheet'); s.scrollTop = 0; });
// A finger scroll of the roller wheel onto row 9 (WebKit has no wheel: set its scroll, as a drag ends).
await p.evaluate(() => { const r = document.querySelector('.roller-row[data-step-id="tape-diameter"]'); const l = r.closest('[data-roller-list]'); l.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' })); l.scrollTop = r.offsetTop - (l.clientHeight - r.offsetHeight) / 2; l.dispatchEvent(new Event('scroll')); l.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })); });
await p.waitForTimeout(1200);
check((await step()) === 'tape-diameter', `roller on Tape the diameter (${await step()})`);
check((await p.locator('[data-testid="edge-point-list"]').count()) === 0, 'no list on this step…');
await p.locator('[data-testid="edge-points-open"]').scrollIntoViewIfNeeded();
check(await hittable('[data-testid="edge-points-open"]') && /Edge points \(13\)/.test(await p.textContent('[data-testid="edge-points-open"]')), '…but the Edge points (13) button, with the summary');
check(await p.isVisible('[data-testid="circle-substages"] [data-testid="workflow-pause"]'), 'Pause (back to Home) shown as a button');
await shot('8-other-step-edge-points-button');
await p.tap('[data-testid="edge-points-open"]');
await p.waitForTimeout(600);
check((await step()) === 'edge-photos' && (await p.locator('[data-testid="edge-point-list"]').count()) === 1, 'Edge points opens the list');
const backNow = await p.evaluate(() => { const n = document.querySelector('[data-testid="edge-back"]'); return { dis: n.disabled, text: n.textContent }; });
check(!backNow.dis && /Back to Tape the diameter/.test(backNow.text), `Back enabled: "${backNow.text}"`);
await shot('9-list-with-back');
await p.evaluate(() => document.querySelector('[data-testid="edge-back"]').scrollIntoView({ block: 'center' }));
await p.tap('[data-testid="edge-back"]');
await p.waitForTimeout(600);
check((await step()) === 'tape-diameter', 'Back pops one level: Tape the diameter again');
console.log(fails.length ? `\n${fails.length} FAILED:\n${fails.join('\n')}` : '\nALL OK');
await b.close();
process.exit(fails.length ? 1 : 0);
