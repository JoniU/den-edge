import { expect, test } from '@playwright/test';
import { E2E_ORIGIN } from './base-url.mjs';

test('TV Services keeps its reserved height when provider discovery settles unavailable', async ({
  page,
}) => {
  await page.goto(`${E2E_ORIGIN}/test/services-row.html`);

  const row = page.getByRole('region', { name: 'Services' });
  await expect(row).toHaveAttribute('data-layout-state', 'pending');
  const pending = await row.evaluate((section) => {
    const box = section.getBoundingClientRect();
    return { top: box.top + scrollY, height: box.height };
  });

  await row.scrollIntoViewIfNeeded();
  await expect(row).toHaveAttribute('data-layout-state', 'settled');
  await expect(row.getByText('Services unavailable')).toBeVisible();
  const settled = await row.evaluate((section) => {
    const box = section.getBoundingClientRect();
    return { top: box.top + scrollY, height: box.height };
  });

  expect(settled).toEqual(pending);
});
