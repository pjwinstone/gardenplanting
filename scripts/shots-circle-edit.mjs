// iPhone 13 (WebKit) check of the circle test edge points: fit from 3, the list, the pop-up,
// the Photos viewer, swipe-delete and restore. Needs `npm run build`, `npx vite preview --port 4173`
// and the fixtures in e2e/fixtures (`WRITE_FIXTURE=e2e/fixtures npx vitest run tests/circleFixture.test.ts`).
import { webkit, devices } from 'playwright';
import { readFileSync } from 'node:fs';
const URL = process.env.APP_URL ?? 'http://localhost:4173/gardenplanting/';
const FX = process.env.FIXTURES ?? 'e2e/fixtures';
const OUT = process.env.SHOTS ?? '/workspace/petri/review/shots';
const b = await webkit.launch();
const fails = [];
const check = (ok, what) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };

async function open(n) {
  const ctx = await b.newContext({ ...devices['iPhone 13'] });
  const doc = readFileSync(`${FX}/circle-${n}.json`, 'utf8');
  await ctx.addInitScript((d) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('garden-survey:document', d); sessionStorage.setItem('seeded', '1'); } }, doc);
  // Headless WebKit on Linux has no camera and crashes on getUserMedia (also on main), so the app takes
  // its no-live-view path: the system camera file input. The test hands that input a photo file.
  await ctx.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'mediaDevices', { get() { return undefined; }, configurable: true });
    HTMLInputElement.prototype.click = function () { window.__cameraInput = this; window.__cameraOpened = (window.__cameraOpened ?? 0) + 1; };
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => fails.push(`pageerror ${e.message}`));
  p.on('dialog', (d) => d.accept());
  await p.goto(URL);
  await p.waitForSelector('[data-testid="edge-point-list"]');
  await p.waitForTimeout(500);
  return p;
}
const shot = (p, name) => p.screenshot({ path: `${OUT}/circle-${name}.png` });
const step = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('garden-survey:document')).workflowProgress.runs['circle-field-test'].currentStepId);
const run = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('garden-survey:document')).workflowProgress.runs['circle-field-test']);
/** What a finger at the centre of `sel` would hit: true when it is `sel` or inside it. */
const hittable = (p, sel) => p.evaluate((s) => { const n = document.querySelector(s); if (!n) return false; const r = n.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && (n === hit || n.contains(hit)) && r.bottom <= innerHeight && r.top >= 0; }, sel);
/** A finger drag on `sel` (pointer + touch events, as WebKit sends them). */
async function drag(p, sel, dx, dy) {
  await p.evaluate(({ s, dx, dy }) => {
    const n = document.querySelector(s);
    const r = n.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const pe = (type, X, Y) => n.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: X, clientY: Y, pointerType: 'touch' }));
    pe('pointerdown', x, y);
    for (let i = 1; i <= 6; i++) pe('pointermove', x + (dx * i) / 6, y + (dy * i) / 6);
    pe('pointerup', x + dx, y + dy);
    n.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x + dx, clientY: y + dy }));
  }, { s: sel, dx, dy });
  await p.waitForTimeout(300);
}

// 1. Three edge points: the circle is fitted and shown on the edge photo step.
{
  const p = await open(3);
  const fit = await p.textContent('[data-testid="edge-fit-open"]').catch(() => '');
  check(/⌀ 12\.\d{3} m/.test(fit), `fit shown with 3 edge points: ${fit.replace(/\s+/g, ' ').slice(0, 120)}`);
  await p.locator('[data-testid="edge-point-list"]').scrollIntoViewIfNeeded();
  await shot(p, '1-fit-three-points');
  await p.context().close();
}

const p = await open(8);
const step0 = await step(p);
// 2. The list: 8 rows, colour and residual.
const rows = await p.locator('[data-testid^="edge-row-"]').evaluateAll((n) => n.map((x) => x.textContent));
check(rows.length === 8, `8 edge rows: ${rows.map((r) => r.slice(0, 30)).join(' | ')}`);
check(rows.every((r) => /Residual [+-]?\d+ mm/.test(r)), 'every row shows its residual');
await p.locator('[data-testid="edge-point-list"]').scrollIntoViewIfNeeded();
await shot(p, '2-edge-list');
// 3. Scroll the list by a finger drag and by its own scroll: the roller stays on its step.
await drag(p, '[data-testid="edge-row-EDG02"]', 0, -120);
check((await p.locator('[data-testid="edge-modal"]').count()) === 0, 'a vertical drag on a row does not open it');
await p.evaluate(() => { const l = document.querySelector('[data-testid="edge-point-list"]'); l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event('scroll')); });
await p.waitForTimeout(400);
check((await step(p)) === step0, `roller did not move (still ${step0})`);
await shot(p, '3-list-scrolled');
// 3b. The step's buttons stay reachable: the panel scrolls, and keeps its place over a redraw.
await p.evaluate(() => { const s = document.querySelector('.workflow-roller-sheet'); s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event('scroll')); });
await p.waitForTimeout(200);
check(await hittable(p, '[data-testid="workflow-photos"]'), 'Photos button reachable after scrolling the panel');
await shot(p, '3b-panel-bottom');
// 4. Real tap on a row opens its pop-up, above everything.
await p.tap('[data-testid="edge-row-EDG05"]');
await p.waitForSelector('[data-testid="edge-modal"]');
check((await p.textContent('[data-testid="edge-modal-title"]')) === 'Edge point EDG05', 'pop-up heading Edge point EDG05');
const ham = await p.evaluate(() => { const h = document.querySelector('[data-testid="hamburger"]').getBoundingClientRect(); const hit = document.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2); return !!hit?.closest('[data-testid="edge-modal"]'); });
check(ham, 'z-order: the hamburger is under the pop-up');
check(await hittable(p, '[data-testid="edge-modal-save"]'), 'Save visible and tappable at the bottom');
await shot(p, '4-edge-modal');
// 5. The body scrolls; the note at the bottom takes typing without a redraw.
const sc = await p.evaluate(() => { const b = document.querySelector('[data-testid="edge-modal-body"]'); return { sh: b.scrollHeight, ch: b.clientHeight, ov: getComputedStyle(b).overflowY }; });
check(sc.ov === 'auto' && sc.ch > 0 && sc.ch < 844, `pop-up body is its own bounded scroll area (${sc.sh}/${sc.ch})`);
await p.locator('[data-testid="edge-modal-note"]').scrollIntoViewIfNeeded();
check(await hittable(p, '[data-testid="edge-modal-note"]'), 'note reachable');
await p.evaluate(() => { window.__mut = 0; new MutationObserver((m) => { window.__mut += m.length; }).observe(document.body, { childList: true, subtree: true }); });
await p.tap('[data-testid="edge-modal-note"]');
await p.keyboard.type('Peg leaning, re-set', { delay: 20 });
const typed = await p.inputValue('[data-testid="edge-modal-note"]');
const focused = await p.evaluate(() => document.activeElement?.dataset?.testid);
const mut = await p.evaluate(() => window.__mut);
check(typed === 'Peg leaning, re-set' && focused === 'edge-modal-note', `typed into the note, still focused (${focused})`);
check(mut === 0, `no redraw while typing (${mut} DOM changes)`);
await shot(p, '5-modal-note-typed');
await p.tap('[data-testid="edge-modal-save"]');
await p.waitForTimeout(400);
check((await run(p)).edgeNotes?.EDG05 === 'Peg leaning, re-set', 'note saved on the run');
check((await p.locator('[data-testid="edge-modal"]').count()) === 0, 'Save closes the pop-up');
// 6. Photos viewer: full screen, scrolls to the last photo.
await p.tap('[data-testid="workflow-photos"]');
await p.waitForSelector('[data-testid="workflow-photos-viewer"]');
await shot(p, '6-viewer-top');
await p.evaluate(() => { const b = document.querySelector('[data-testid="viewer-body"]'); b.scrollTop = b.scrollHeight; });
await p.waitForTimeout(300);
const lastRetake = await p.evaluate(() => { const all = document.querySelectorAll('[data-testid="viewer-body"] [data-testid="photo-retake"]'); const n = all[all.length - 1]; const r = n.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { ok: hit === n, top: Math.round(r.top), count: all.length }; });
check(lastRetake.ok, `last photo's Retake reachable after scrolling (${lastRetake.count} photos, at y=${lastRetake.top})`);
await shot(p, '7-viewer-bottom');
await p.tap('[data-testid="workflow-photos-close"]');
await p.waitForTimeout(300);
// 7. Swipe left reveals Delete; Delete (confirm) refits; Restore.
const fitBefore = await p.textContent('[data-testid="edge-fit-open"]');
await drag(p, '[data-testid="edge-row-EDG03"]', -110, 4);
check(await p.evaluate(() => document.querySelector('[data-testid="edge-item-EDG03"]').classList.contains('base-list-swiped')), 'swipe left shows Delete');
check((await p.locator('[data-testid="edge-modal"]').count()) === 0, 'swipe does not open the row');
await p.locator('[data-testid="edge-item-EDG03"]').scrollIntoViewIfNeeded();
await shot(p, '8-swiped-delete');
await p.tap('[data-testid="edge-delete-EDG03"]');
await p.waitForTimeout(500);
const fitAfter = await p.textContent('[data-testid="edge-fit-open"]');
check(/7 points/.test(fitAfter) && fitAfter !== fitBefore, `refit without EDG03: ${fitAfter.replace(/\s+/g, ' ').slice(0, 90)}`);
check(await p.evaluate(() => document.querySelector('[data-testid="edge-row-EDG03"]').classList.contains('base-list-deleted')), 'EDG03 greyed with Restore');
await p.locator('[data-testid="edge-item-EDG03"]').scrollIntoViewIfNeeded();
await shot(p, '9-deleted');
await p.tap('[data-testid="edge-restore-EDG03"]');
await p.waitForTimeout(500);
check(/8 points/.test(await p.textContent('[data-testid="edge-fit-open"]')), 'Restore refits with 8 points');
await shot(p, '10-restored');
// 8. Edit taps from the pop-up: the tap screen comes up on top.
await p.tap('[data-testid="edge-row-EDG02"]');
await p.waitForSelector('[data-testid="edge-modal"]');
await p.tap('[data-testid="edge-modal-taps"]');
await p.waitForTimeout(800);
const top = await p.evaluate(() => { const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return hit?.closest('[data-testid="edge-modal"]') ? 'edge-modal' : (hit?.closest('.photo-tap, .photo-mark') ? 'tap-screen' : hit?.className); });
check(top === 'tap-screen', `Edit taps: tap screen above the pop-up (${top})`);
await shot(p, '11-edit-taps');
await p.tap('[data-testid="photo-tap-close"]').catch(() => {});
await p.waitForTimeout(400);
await p.context().close();

// 9. Retake from the edge point pop-up: the button is near the photo, opens the retake screen,
//    the new photo takes EDG04's place, the circle refits and EDG04's residual and colour update.
{
  const p = await open(8);
  const rowText = async (id) => (await p.textContent(`[data-testid="edge-row-${id}"]`)).replace(/\s+/g, ' ');
  const fit0 = (await p.textContent('[data-testid="edge-fit-open"]')).replace(/\s+/g, ' ');
  const row0 = await rowText('EDG04');
  await p.tap('[data-testid="edge-row-EDG04"]');
  await p.waitForSelector('[data-testid="edge-modal"]');
  const btnBox = await p.evaluate(() => { const n = document.querySelector('[data-testid="edge-modal-retake"]'); const r = n.getBoundingClientRect(); const img = document.querySelector('[data-testid="edge-modal"] img'); const ir = img?.getBoundingClientRect(); return { text: n.textContent, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), vw: innerWidth, gap: ir ? Math.round(ir.top - r.bottom) : null, primary: n.classList.contains('screen-primary') }; });
  check(await hittable(p, '[data-testid="edge-modal-retake"]'), `Retake visible without scrolling and tappable (top ${btnBox.top}px)`);
  check(btnBox.text === 'Retake photo of EDG04' && btnBox.primary, `labelled primary button: "${btnBox.text}"`);
  check(btnBox.w >= btnBox.vw - 40 && btnBox.h >= 56, `full width ${btnBox.w}/${btnBox.vw} px, ${btnBox.h} px tall`);
  check(btnBox.gap !== null && btnBox.gap >= 0 && btnBox.gap < 40, `right above the photo (gap ${btnBox.gap}px)`);
  await shot(p, '4-edge-modal');
  await p.tap('[data-testid="edge-modal-retake"]');
  await p.waitForSelector('[data-testid="workflow-photos-viewer"]');
  check((await p.locator('[data-testid="edge-modal"]').count()) === 0, 'pop-up closed, the retake screen is the only layer');
  const v = await p.textContent('[data-testid="workflow-photos-viewer"]');
  check(/EDG04 · edge4\.jpg/.test(v) && (await p.locator('[data-testid="viewer-body"] .workflow-photo-item').count()) === 1, 'retake screen opened on EDG04\'s photo only');
  const vz = await p.evaluate(() => { const h = document.querySelector('[data-testid="hamburger"]').getBoundingClientRect(); return !!document.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2)?.closest('[data-testid="workflow-photos-viewer"]'); });
  check(vz, 'z-order: the retake screen covers the hamburger');
  check(await hittable(p, '[data-testid="workflow-photos-viewer"] [data-testid="photo-retake"]'), 'its Retake is visible and tappable');
  const vb = await p.evaluate(() => { const n = document.querySelector('[data-testid="workflow-photos-viewer"] [data-testid="photo-retake"]'); const r = n.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), bg: getComputedStyle(n).backgroundColor }; });
  check(vb.w >= 340 && vb.h >= 56 && vb.bg !== 'rgba(0, 0, 0, 0)', `retake screen's Retake is a full-width primary button (${vb.w}x${vb.h}, ${vb.bg})`);
  await shot(p, '12-retake-screen-from-popup');
  await p.tap('[data-testid="workflow-photos-viewer"] [data-testid="photo-retake"]');
  await p.waitForTimeout(500);
  check((await p.evaluate(() => window.__cameraOpened)) === 1, 'Retake opened the camera once');
  const mid = (await p.textContent('[data-testid="edge-fit-open"]')).replace(/\s+/g, ' ');
  check(/7 points/.test(mid), `old EDG04 photo out of the fit while waiting: ${mid.slice(0, 60)}`);
  // The new photo: the sleeves sit 60 px right of where they were (the camera moved a little).
  await (await p.evaluateHandle(() => window.__cameraInput)).asElement().setInputFiles(process.env.RETAKE_PHOTO ?? 'e2e/fixtures/edge4-retake.jpg');
  await p.waitForSelector('[data-testid="photo-tap-prompt"]');
  await p.waitForTimeout(500);
  await shot(p, '13-retake-tap-screen');
  const PX = { BAS01: 2781, BAS02: 1339, BAS03: 3596, BAS04: 649, BAS05: 2076 };
  for (let k = 0; k < 20; k++) {
    const m = /Tap (BAS\d\d)/.exec(await p.textContent('[data-testid="photo-tap-prompt"]'));
    if (!m) break;
    if (PX[m[1]]) {
      const r = await p.evaluate(() => { const b = document.querySelector('[data-testid="photo-tap-stage"] img, [data-testid="photo-tap-stage"] canvas').getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; });
      await p.touchscreen.tap(r[0] + (PX[m[1]] / 4032) * r[2], r[1] + 0.5 * r[3]);
    } else await p.tap('[data-testid="photo-tap-skip"]');
    await p.waitForTimeout(200);
  }
  await p.tap('[data-testid="photo-tap-save"]');
  await p.waitForTimeout(800);
  const fit1 = (await p.textContent('[data-testid="edge-fit-open"]')).replace(/\s+/g, ' ');
  const row1 = await rowText('EDG04');
  check(/8 points/.test(fit1) && fit1 !== fit0, `circle refitted: "${fit0.slice(0, 45)}" -> "${fit1.slice(0, 45)}"`);
  check(row1 !== row0, `EDG04 row updated: "${row0.slice(0, 32)}" -> "${row1.slice(0, 32)}"`);
  const photos = await p.evaluate(() => JSON.parse(localStorage.getItem('garden-survey:document')).photos.map((x) => ({ f: x.originalFile?.fileName, s: !!x.supersededAt })));
  const e4 = photos.filter((x) => x.f === 'edge4.jpg');
  check(e4.length === 1 && e4[0].s && photos.filter((x) => !x.s).length === photos.length - 1, 'old edge4.jpg superseded (archived), new photo current');
  await p.locator('[data-testid="edge-item-EDG04"]').scrollIntoViewIfNeeded();
  await shot(p, '14-after-retake-list');
  // Reopen: the retake screen now shows previous vs current.
  await p.tap('[data-testid="edge-row-EDG04"]');
  await p.waitForSelector('[data-testid="edge-modal"]');
  await shot(p, '15-edge-modal-after-retake');
  await p.tap('[data-testid="edge-modal-retake"]');
  await p.waitForSelector('[data-testid="workflow-photos-viewer"]');
  const v2 = await p.textContent('[data-testid="workflow-photos-viewer"]');
  check(/Previous photo · edge4\.jpg/.test(v2) && /Current photo · EDG04/.test(v2), `retake screen: previous vs current (${v2.replace(/\s+/g, ' ').match(/Previous[^R]*/)?.[0]?.slice(0, 80)})`);
  await shot(p, '16-retake-screen-previous-current');
  await p.context().close();
}
console.log(fails.length ? `\n${fails.length} FAILED:\n${fails.join('\n')}` : '\nALL OK');
await b.close();
process.exit(fails.length ? 1 : 0);
