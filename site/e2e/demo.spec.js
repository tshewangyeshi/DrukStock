// End-to-end tests against the test build (dist-test, ER-D6 standalone flag).
import { test, expect } from '@playwright/test';

async function readLog(page) {
  return page.evaluate(() => new Promise(resolve => {
    const req = indexedDB.open('drukstock-demo');
    req.onsuccess = () => {
      const get = req.result.transaction('kv').objectStore('kv').get('log');
      get.onsuccess = () => resolve(get.result);
    };
  }));
}

async function ready(page) {
  await page.goto('/');
  await expect(page.getByText('● Offline ready')).toBeVisible({ timeout: 15000 });
}

async function startInterview(page) {
  await page.getByRole('button', { name: 'Hand over' }).click();
  await page.getByRole('button', { name: 'Try it' }).click();
  await expect(page.getByText('Customers owe you')).toBeVisible();
}

async function typeAmount(page, digits) {
  for (const d of digits) await page.getByRole('button', { name: d, exact: true }).click();
}

test('first credit: confirmation, balance and logged timing (D5, D34)', async ({ page }) => {
  await ready(page);
  await startInterview(page);
  await page.getByRole('button', { name: /Karma Dorji/ }).click();
  await typeAmount(page, ['4', '5', '0']);
  await page.getByRole('button', { name: 'Gave credit' }).click();
  await expect(page.getByText('Nu 450 written for Karma Dorji')).toBeVisible();
  await expect(page.getByText('owes Nu 4,240')).toBeVisible();
  const log = await readLog(page);
  const iv = log.interviews.at(-1);
  expect(iv.firstCreditAt).toBeGreaterThan(iv.firstTouchAt);
  expect(iv.taps).toBeGreaterThanOrEqual(5); // Try it, row, 3 digits (Gave credit is the commit)
});

test('a double tap on Gave credit records one credit (D5; amount clearing + lockout)', async ({ page }) => {
  await ready(page);
  await startInterview(page);
  await page.getByRole('button', { name: /Sonam Wangmo/ }).click();
  await typeAmount(page, ['1', '0']);
  const gave = page.getByRole('button', { name: 'Gave credit' });
  await gave.click();
  await gave.click({ force: true });
  await expect(page.getByText('owes Nu 1,330')).toBeVisible();
});

test('keypad ignores a 7th digit and shows Indian grouping (D7)', async ({ page }) => {
  await ready(page);
  await startInterview(page);
  await page.getByRole('button', { name: /Pema Choden/ }).click();
  await typeAmount(page, ['9', '9', '9', '9', '9', '9', '9']);
  await expect(page.locator('.dock .amount-box')).toHaveText('Nu 9,99,999');
});

test('"Gave credit" stays fully visible at 360x640 (ER-D12)', async ({ page }) => {
  await ready(page);
  await startInterview(page);
  await page.getByRole('button', { name: /Karma Dorji/ }).click();
  const box = await page.getByRole('button', { name: 'Gave credit' }).boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(640);
});

test('back gesture: customer → list, end → list, history stays short (ER-D5)', async ({ page }) => {
  await ready(page);
  await startInterview(page);
  const length0 = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: /Karma Dorji/ }).click();
  await page.goBack();
  await expect(page.getByText('Customers owe you')).toBeVisible();
  await page.getByRole('button', { name: /Tashi Lhamo/ }).click();
  await typeAmount(page, ['5']);
  await page.getByRole('button', { name: 'Gave credit' }).click();
  await page.getByRole('button', { name: '← Customers' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Want this for your shop?')).toBeVisible();
  await page.goBack();
  await expect(page.getByText('Customers owe you')).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(length0 + 1);
});

test('One month later ages debts and shows the banner (D12)', async ({ page }) => {
  await ready(page);
  await startInterview(page);
  await page.getByRole('button', { name: /Ugyen Tshering/ }).click();
  await typeAmount(page, ['1', '0']);
  await page.getByRole('button', { name: 'Gave credit' }).click();
  await page.getByRole('button', { name: '← Customers' }).click();
  await page.getByRole('button', { name: 'One month later →' }).click();
  await expect(page.locator('#banner')).toHaveText('30 days later: Karma Dorji has not paid');
  await expect(page.getByText('71 days unpaid')).toBeVisible();
});

test('works offline after one visit (D24)', async ({ page, context }) => {
  await ready(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('● Offline ready')).toBeVisible();
  await startInterview(page);
  await expect(page.getByText('Nu 12,480')).toBeVisible();
});

test('reload mid-interview restores entries and flags the session (ER-D11)', async ({ page }) => {
  await ready(page);
  await startInterview(page);
  await page.getByRole('button', { name: /Tashi Lhamo/ }).click();
  await typeAmount(page, ['9', '8', '0']);
  await page.getByRole('button', { name: 'Got payment' }).click();
  await expect(page.getByText('owes Nu 0')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Nu 11,500')).toBeVisible();
  const log = await readLog(page);
  expect(log.interviews.at(-1).reloaded).toBe(true);
});

test('founder log: abandoned session and Next shopkeeper alternate the variant (ER-D4)', async ({ page }) => {
  await ready(page);
  const meta = await page.locator('.start-meta').textContent();
  await startInterview(page);
  await page.keyboard.press('Shift+L'); // test-build stand-in for the two-finger hold
  await expect(page.getByText('Founder log')).toBeVisible();
  await page.getByRole('button', { name: 'Next shopkeeper' }).click();
  const log = await readLog(page);
  expect(log.interviews.at(-1).abandoned).toBe(true);
  const next = await page.locator('.start-meta').textContent();
  expect(next).not.toBe(meta);
});
