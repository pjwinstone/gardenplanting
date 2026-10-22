import { expect, test, type Page } from '@playwright/test';

async function typeInto(p: Page, id: string, text: string) {
  const f = p.getByTestId(id);
  await f.tap();
  await f.fill('');
  await p.keyboard.type(text);
  await expect(f).toBeFocused();
  await expect(f).toHaveValue(text);
}

test('base point form: add BAS01 and BAS02, tap to edit, type in every field, save', async ({ page: p }) => {
  await p.goto('./');
  await p.getByTestId('base-list-add').tap();
  await expect(p.getByTestId('base-modal-title')).toHaveText('New base point');
  await p.getByTestId('btn-save').tap();
  await expect(p.getByTestId('base-row-BAS01')).toBeVisible();

  await p.getByTestId('base-list-add').tap();
  await p.getByTestId('in-from').selectOption('BAS01');
  await typeInto(p, 'in-north', '3');
  await typeInto(p, 'in-east', '4');
  await typeInto(p, 'in-diagonal', '5');
  await expect(p.getByTestId('diagonal-check')).toContainText('passed');
  await p.getByTestId('btn-save').tap();
  await expect(p.getByTestId('base-row-BAS02')).toContainText('3.000 N, 4.000 E');

  await p.getByTestId('base-row-BAS02').tap();
  await expect(p.getByTestId('base-modal-title')).toHaveText('Edit base point BAS02');
  await expect(p.getByTestId('in-north')).toHaveValue('3');
  await typeInto(p, 'in-north', '2.5');
  await p.getByTestId('in-north-minus').tap();
  await expect(p.getByTestId('in-north')).toHaveValue('2.5');
  await typeInto(p, 'in-east', '6');
  await p.getByTestId('in-east-minus').tap();
  await typeInto(p, 'in-diagonal', '6.6');
  await expect(p.getByTestId('diagonal-check')).toContainText('Diagonal off by');
  await p.getByTestId('post-toggle').tap();
  await typeInto(p, 'in-separation', '0.45');
  // Above everything, inputs at least 16 px (no iOS zoom).
  const z = await p.getByTestId('base-modal').evaluate((n) => Number(getComputedStyle(n).zIndex));
  expect(z).toBeGreaterThanOrEqual(1000);
  const font = await p.getByTestId('in-north').evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
  expect(font).toBeGreaterThanOrEqual(16);
  await p.getByTestId('btn-save').tap();
  await expect(p.getByTestId('base-row-BAS02')).toContainText(/-2\.\d+ N, -6\.\d+ E .* two-sleeve post 0\.45 m/);
});
