// Visual check of the base point form on iPhone 13 (WebKit). Needs `npm run build` and
// `npx vite preview --port 4173`. Writes /workspace/petri/review/shots/edit-*.png.
import { webkit, devices } from 'playwright';
const URL = process.env.APP_URL ?? 'http://localhost:4173/gardenplanting/';
const OUT = process.env.SHOTS ?? '/workspace/petri/review/shots';
const b = await webkit.launch();
const ctx = await b.newContext({ ...devices['iPhone 13'] });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
const shot = (n) => p.screenshot({ path: `${OUT}/edit-${n}.png` });
const val = (id) => p.locator(`[data-testid="${id}"]`).inputValue();
const active = () => p.evaluate(() => document.activeElement?.dataset?.testid ?? document.activeElement?.tagName);
async function typeInto(id, text) {
  await p.tap(`[data-testid="${id}"]`);
  await p.keyboard.press('Meta+A').catch(() => {});
  await p.locator(`[data-testid="${id}"]`).fill('');
  await p.keyboard.type(text, { delay: 30 });
  await p.waitForTimeout(150);
  const v = await val(id);
  const a = await active();
  console.log(`typed ${id}: value=${JSON.stringify(v)} focused=${a}`);
  if (v !== text) throw new Error(`${id}: expected ${text}, got ${v}`);
}
await p.goto(URL);
await p.waitForTimeout(1000);
await shot('0-home');
// BAS01
await p.tap('[data-testid="base-list-add"]');
await p.waitForSelector('[data-testid="base-modal"]');
await shot('1-new-bas01');
await p.tap('[data-testid="btn-save"]');
await p.waitForSelector('[data-testid="base-row-BAS01"]');
// BAS02 via the form
await p.tap('[data-testid="base-list-add"]');
await p.waitForSelector('[data-testid="base-modal"]');
await p.selectOption('[data-testid="in-from"]', 'BAS01');
await typeInto('in-north', '3');
await typeInto('in-east', '4');
await typeInto('in-diagonal', '5');
console.log('check:', await p.textContent('[data-testid="diagonal-check"]'));
await shot('2-new-bas02-filled');
await p.tap('[data-testid="btn-save"]');
await p.waitForSelector('[data-testid="base-row-BAS02"]');
console.log('row before edit:', (await p.textContent('[data-testid="base-row-BAS02"]')).trim());
await shot('3-list');
// Tap the row to edit
await p.tap('[data-testid="base-row-BAS02"]');
await p.waitForSelector('[data-testid="base-modal"]');
console.log('title:', await p.textContent('[data-testid="base-modal-title"]'), 'prefilled', await val('in-north'), await val('in-east'), await val('in-diagonal'));
await shot('4-edit-open');
await typeInto('in-north', '2.5');
await p.tap('[data-testid="in-north-minus"]');
await p.waitForTimeout(200);
console.log('after S toggle north still', await val('in-north'));
await typeInto('in-east', '6');
await p.tap('[data-testid="in-east-minus"]');
await typeInto('in-diagonal', '6.6');
await p.tap('[data-testid="post-toggle"]');
await p.waitForSelector('[data-testid="in-separation"]');
await typeInto('in-separation', '0.45');
console.log('check:', await p.textContent('[data-testid="diagonal-check"]'));
await shot('5-edit-typed');
await p.tap('[data-testid="in-diagonal"]');
await p.waitForTimeout(400);
await shot('6-edit-focused-diagonal');
await p.tap('[data-testid="btn-save"]');
await p.waitForSelector('[data-testid="base-row-BAS02"]');
const after = (await p.textContent('[data-testid="base-row-BAS02"]')).trim();
console.log('row after edit:', after);
await shot('7-list-after');
if (!/2\\.500 N|-2\\.500/.test(after) && !after.includes('-2.5')) console.log('WARN row text did not show new north');
console.log('page errors:', errs.length ? errs : 'none');
await b.close();
