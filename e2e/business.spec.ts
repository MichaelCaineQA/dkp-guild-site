import { test, expect } from '@playwright/test';

test('участник входит, открывает расписание и свой профиль; чужой GS закрыт', async ({
  page,
  context,
}) => {
  const login = await context.request.post('/api/auth/test-login', {
    data: { username: 'test-member' },
  });
  expect(login.ok()).toBe(true);
  const { user: me } = await (await context.request.get('/api/auth/me')).json();
  expect(me.memberId).toBeTruthy();
  await page.goto('/schedule');
  await expect(page.getByRole('heading', { name: 'Расписание' })).toBeVisible();
  await page.getByRole('button', { name: 'Календарь', exact: true }).click();
  await expect(page.getByRole('button', { name: /Создать ивент/ })).toHaveCount(0);
  await page.goto(`/profiles/${me.memberId}`);
  await expect(page.getByRole('heading', { name: /Профиль:/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Обновить GS' })).toBeVisible();
  if (process.env.CAPTURE_SCREENSHOTS) {
    await page.screenshot({ path: 'docs/screenshots/audit-gs-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'docs/screenshots/audit-gs-mobile.png', fullPage: true });
  }
  const roster = await (await context.request.get('/api/members')).json();
  const other = roster.find((row: { id: string }) => row.id !== me.memberId);
  expect(other).toBeTruthy();
  const profile = await (await context.request.get(`/api/profiles/${other.id}`)).json();
  expect(profile.gearScore).toBeUndefined();
  expect(
    (await context.request.post(`/api/profiles/${other.id}/gear-score`, { data: {} })).status(),
  ).toBe(403);
});

test('офицер создаёт ивент, игрок видит приглашение и может отказаться', async ({ browser }) => {
  const officer = await browser.newContext({ baseURL: 'http://localhost:3090' });
  const member = await browser.newContext({
    baseURL: 'http://localhost:3090',
    viewport: { width: 390, height: 844 },
  });
  let eventId: string | undefined;
  try {
    await officer.request.post('/api/auth/test-login', { data: { username: 'test-officer' } });
    const { user: me } = await (await officer.request.get('/api/auth/me')).json();
    const types = await (await officer.request.get('/api/event-types')).json();
    const startsAt = new Date(Date.now() + 3600000).toISOString();
    const created = await officer.request.post('/api/events', {
      data: {
        name: 'Браузерная проверка',
        eventTypeId: types[0].id,
        mode: 'PVE',
        startsAt,
        endsAt: new Date(Date.now() + 90000000).toISOString(),
        raidLeadId: me.memberId,
        dkpReward: 10,
      },
    });
    expect(created.ok()).toBe(true);
    eventId = (await created.json()).id;
    await member.request.post('/api/auth/test-login', { data: { username: 'test-member' } });
    await member.request.get('/api/auth/me');
    const page = await member.newPage();
    await page.goto('/schedule');
    await expect(page.getByRole('button', { name: /Браузерная проверка/ }).first()).toBeVisible();
    await page
      .getByRole('button', { name: /Браузерная проверка/ })
      .first()
      .click();
    await expect(page.getByRole('button', { name: 'Не приду', exact: true }).first()).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole('button', { name: 'Календарь', exact: true }).click();
    await expect(page.getByLabel('События месяца')).toContainText('Браузерная проверка');
    if (process.env.CAPTURE_SCREENSHOTS) {
      await page.screenshot({ path: 'docs/screenshots/audit-calendar-mobile.png', fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({
        path: 'docs/screenshots/audit-calendar-desktop.png',
        fullPage: true,
      });
    }
  } finally {
    if (eventId) expect((await officer.request.delete(`/api/events/${eventId}`)).ok()).toBe(true);
    await officer.close();
    await member.close();
  }
});

test('чек-ин в браузере подтверждается один раз и начисляет половину ДКП', async ({ browser }) => {
  const officer = await browser.newContext({ baseURL: 'http://localhost:3090' });
  const member = await browser.newContext({
    baseURL: 'http://localhost:3090',
    viewport: { width: 390, height: 844 },
  });
  let eventId: string | undefined;
  try {
    await officer.request.post('/api/auth/test-login', { data: { username: 'test-officer' } });
    const { user: me } = await (await officer.request.get('/api/auth/me')).json();
    const types = await (await officer.request.get('/api/event-types')).json();
    const created = await officer.request.post('/api/events', {
      data: {
        name: 'Проверка чек-ина',
        eventTypeId: types[0].id,
        mode: 'PVE',
        startsAt: new Date(Date.now() + 90000).toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
        raidLeadId: me.memberId,
        dkpReward: 10,
      },
    });
    expect(created.ok()).toBe(true);
    eventId = (await created.json()).id;
    await member.request.post('/api/auth/test-login', { data: { username: 'test-member' } });
    await member.request.get('/api/auth/me');
    const before = await (await member.request.get('/api/dashboard/wallet')).json();
    const codeResponse = await officer.request.get(`/api/events/${eventId}/checkin/code`);
    const code = await codeResponse.json();
    expect(codeResponse.ok(), JSON.stringify(code)).toBe(true);
    expect(code.windowState).toBe('ACTIVE');
    const page = await member.newPage();
    await page.goto('/schedule');
    await page
      .getByRole('button', { name: /Проверка чек-ина/ })
      .first()
      .click();
    const choice = page.getByRole('button', { name: code.code, exact: true });
    await choice.click();
    const dialog = page.getByRole('dialog', { name: `Код ${code.code} — подтвердить?` });
    await expect(dialog).toBeVisible();
    if (process.env.CAPTURE_SCREENSHOTS)
      await page.screenshot({ path: 'docs/screenshots/audit-checkin-mobile.png' });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(choice).toBeFocused();
    await choice.click();
    await dialog.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(page.getByText(/Отмечены.*ДКП начислены/)).toBeVisible();
    const after = await (await member.request.get('/api/dashboard/wallet')).json();
    expect(after.balance - before.balance).toBe(5);
    expect(
      (
        await member.request.post(`/api/events/${eventId}/checkin/me`, {
          data: { code: code.code },
        })
      ).status(),
    ).toBe(409);
  } finally {
    if (eventId)
      await officer.request.post(`/api/events/${eventId}/status`, {
        data: { status: 'CANCELLED' },
      });
    await officer.close();
    await member.close();
  }
});

test('мобильный аукцион принимает ставку и сохраняет доступную ширину окна', async ({
  browser,
}) => {
  const itemName = `Лот браузерной проверки ${Date.now()}`;
  const leader = await browser.newContext({ baseURL: 'http://localhost:3090' });
  const member = await browser.newContext({
    baseURL: 'http://localhost:3090',
    viewport: { width: 390, height: 844 },
  });
  let lotId: string | undefined;
  try {
    await leader.request.post('/api/auth/test-login', { data: { username: 'test-leader' } });
    await leader.request.get('/api/auth/me');
    const item = await leader.request.post('/api/items', {
      data: { name: itemName, targetRoles: ['ALL'], defaultStartPrice: 1 },
    });
    expect(item.ok()).toBe(true);
    const lot = await leader.request.post('/api/auctions', {
      data: {
        itemId: (await item.json()).id,
        startPrice: 1,
        step: 1,
        timerKind: 'OPENING',
        durationValue: 2,
        durationUnit: 'DAYS',
        antiSnipeSec: 0,
      },
    });
    expect(lot.ok()).toBe(true);
    lotId = (await lot.json()).id;
    await member.request.post('/api/auth/test-login', { data: { username: 'test-member' } });
    await member.request.get('/api/auth/me');
    const page = await member.newPage();
    await page.goto('/auction');
    await page
      .getByRole('group', { name: `Лот ${itemName}`, exact: true })
      .getByRole('button', { name: 'Открыть' })
      .click();
    const dialog = page.getByRole('dialog', { name: `Лот: ${itemName}` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/История ставок/)).toBeVisible();
    await dialog.getByLabel('Сумма ставки').fill('1');
    await dialog.getByRole('button', { name: 'Сделать ставку' }).click();
    await expect(dialog.getByText('Ставка принята.')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    if (process.env.CAPTURE_SCREENSHOTS) {
      await page.screenshot({ path: 'docs/screenshots/audit-auction-mobile.png' });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: 'docs/screenshots/audit-auction-desktop.png' });
    }
  } finally {
    if (lotId)
      expect(
        (
          await leader.request.post(`/api/auctions/${lotId}/cancel`, {
            data: { comment: 'Завершение браузерной проверки' },
          })
        ).ok(),
      ).toBe(true);
    await leader.close();
    await member.close();
  }
});
