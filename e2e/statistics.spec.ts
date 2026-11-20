import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { seedStatisticsE2e } from '../apps/api/prisma/statistics-e2e';

let fixture: Awaited<ReturnType<typeof seedStatisticsE2e>>;

test.beforeAll(async () => {
  fixture = await seedStatisticsE2e();
});

test.afterAll(async () => {
  await fixture?.cleanup();
});

async function login(context: BrowserContext, username: string) {
  await expect(await context.request.post('/api/auth/test-login', { data: { username } })).toBeOK();
  const session = await context.request.get('/api/auth/me');
  await expect(session).toBeOK();
  expect((await session.json()).user.memberId).toBeTruthy();
}

async function selectHistoricalPeriod(page: Page) {
  await page.getByRole('combobox', { name: /^Период:/ }).selectOption('range');
  await page.getByLabel('С:', { exact: true }).fill('2025-01-02');
  await page.getByLabel('По:', { exact: true }).fill('2025-01-12');
  await page.getByRole('combobox', { name: /^Тип ивента:/ }).selectOption(fixture.type.id);
  await page.getByRole('combobox', { name: /^Режим:/ }).selectOption('PVE');
}

for (const timezoneId of ['America/Los_Angeles', 'Asia/Tokyo']) {
  test.describe(`часовой пояс ${timezoneId}`, () => {
    test.use({ timezoneId });

    test('фильтры, детали и скачанный CSV используют московские даты и историческую команду', async ({
      page,
      context,
    }) => {
      await login(context, 'test-member');
      await page.goto('/statistics?tab=attendance');
      await selectHistoricalPeriod(page);
      await page.getByRole('combobox', { name: /^КП:/ }).selectOption(fixture.pastKp.id);

      const row = page.getByRole('row', { name: `Детали: ${fixture.player.nickname}` });
      await expect(row).toContainText('75%');
      await row.click();
      // Состояние раскрытия держит кнопка: мышь и клавиатура синхронны (#252).
      const toggle = page.getByRole('button', { name: `Детали: ${fixture.player.nickname}` });
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByText('Старт периода по Москве', { exact: true })).toBeVisible();
      // Полночь Москвы (2 января 00:00 МСК) — одна календарная дата, не диапазон (#254).
      await expect(page.getByText('2 янв', { exact: true })).toBeVisible();
      await expect(page.getByText('2 янв – 1 янв', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Ивент второй недели', { exact: true })).toBeVisible();
      await expect(page.getByText('Пак до перевода · КП до перевода', { exact: true })).toHaveCount(
        2,
      );
      await expect(page.getByText('До московской границы', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Ивент другого режима', { exact: true })).toHaveCount(0);

      const pendingDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Скачать CSV: детали посещаемости' }).click();
      const file = await pendingDownload;
      const csv = await readFile(await file.path(), 'utf8');
      expect(file.suggestedFilename()).toMatch(/^statistics-attendance-details-.*\.csv$/);
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      expect(csv).toContain('02.01.2025–12.01.2025');
      const rows = csv.split('\r\n').filter((line) => line.startsWith(fixture.player.nickname));
      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain('Старт периода по Москве');
      expect(rows[1]).toContain('Ивент второй недели');
      for (const detail of rows)
        expect(detail).toContain(`${fixture.pastPack.id} / ${fixture.pastKp.id}`);
    });
  });
}

test('детали посещаемости раскрываются и сворачиваются с клавиатуры (#252)', async ({
  page,
  context,
}) => {
  await login(context, 'test-member');
  await page.goto('/statistics?tab=attendance');
  await selectHistoricalPeriod(page);

  const toggle = page.getByRole('button', { name: `Детали: ${fixture.player.nickname}` });
  await expect(toggle).toBeVisible();
  await toggle.focus();
  await expect(toggle).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Ивент второй недели', { exact: true })).toBeVisible();

  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('пустой период не скрывает свежесть GS от Главы (#253)', async ({ page, context }) => {
  await login(context, 'test-leader');
  await page.goto('/statistics');
  // Период без ивентов и операций, но с участниками исторического среза GS.
  await page.getByRole('combobox', { name: /^Период:/ }).selectOption('range');
  await page.getByLabel('С:', { exact: true }).fill('2025-02-01');
  await page.getByLabel('По:', { exact: true }).fill('2025-02-10');
  await expect(page.getByText('Нет данных за выбранный период', { exact: true })).toBeVisible();
  await expect(page.getByText('Свежесть GS', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скачать CSV: свежесть GS' })).toBeVisible();
  await expect(page.getByText(/участников среза/)).toBeVisible();
});

test('CSV деталей посещаемости сохраняет выбранную неделю (#249)', async ({ page, context }) => {
  await login(context, 'test-member');
  await page.goto('/statistics');
  await selectHistoricalPeriod(page);
  // Столбец первой недели на графике обзора открывает вкладку с срезом недели.
  await page
    .getByRole('button', { name: /2 янв – 5 янв/ })
    .first()
    .click();
  await expect(page.getByText(/Неделя: 2 янв – 5 янв/)).toBeVisible();

  const row = page.getByRole('row', { name: `Детали: ${fixture.player.nickname}` });
  await row.click();
  // На экране остаются только ивенты первой недели.
  await expect(page.getByText('Старт периода по Москве', { exact: true })).toBeVisible();
  await expect(page.getByText('Ивент второй недели', { exact: true })).toHaveCount(0);

  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать CSV: детали посещаемости' }).click();
  const file = await pendingDownload;
  const csv = await readFile(await file.path(), 'utf8');
  // Период выгрузки — границы выбранной недели по Москве; строки совпадают с экраном.
  expect(csv).toContain('02.01.2025–05.01.2025');
  const rows = csv.split('\r\n').filter((line) => line.startsWith(fixture.player.nickname));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toContain('Старт периода по Москве');
});

test('детали посещаемости раскрываются и сворачиваются с клавиатуры (#252)', async ({
  page,
  context,
}) => {
  await login(context, 'test-member');
  await page.goto('/statistics?tab=attendance');
  await selectHistoricalPeriod(page);

  const toggle = page.getByRole('button', { name: `Детали: ${fixture.player.nickname}` });
  await expect(toggle).toBeVisible();
  await toggle.focus();
  await expect(toggle).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Ивент второй недели', { exact: true })).toBeVisible();

  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

for (const { role, username, allowed } of [
  { role: 'Глава', username: 'test-leader', allowed: true },
  { role: 'Офицер', username: 'test-officer', allowed: false },
  {
    role: 'Рядовой с назначениями КП, пака и РЛ',
    username: 'test-statistics-player',
    allowed: false,
  },
]) {
  test(`${role}: доступ к свежести GS согласован в интерфейсе, API и CSV`, async ({
    page,
    context,
  }) => {
    await login(context, username);
    await page.goto('/statistics');
    await selectHistoricalPeriod(page);
    await expect(
      page.getByRole('button', { name: /Посещаемость Игрок после перевода/ }),
    ).toBeVisible();
    await expect(page.getByText('Свежесть GS', { exact: true })).toHaveCount(allowed ? 1 : 0);
    await expect(page.getByRole('button', { name: 'Скачать CSV: свежесть GS' })).toHaveCount(
      allowed ? 1 : 0,
    );

    const period = 'from=2025-01-02&to=2025-01-12';
    const report = await context.request.get(`/api/statistics/gear-score?${period}`);
    const csv = await context.request.get(`/api/statistics/export.csv?table=gear-score&${period}`);
    expect(report.status()).toBe(allowed ? 200 : 403);
    expect(csv.status()).toBe(allowed ? 200 : 403);
  });
}
