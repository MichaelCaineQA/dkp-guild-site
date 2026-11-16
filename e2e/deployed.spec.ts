import { test, expect } from '@playwright/test';

test('развёрнут проверенный SHA, страница входа открывается в браузере', async ({
  page,
  request,
}) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBe(true);
  const health = await response.json();
  expect(health).toMatchObject({ status: 'ok', db: 'up', commit: process.env.E2E_EXPECTED_SHA });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Вход для администратора' })).toBeVisible();
});
