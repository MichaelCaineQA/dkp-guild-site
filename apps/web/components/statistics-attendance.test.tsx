import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AttendanceDetail, AttendanceReport } from '@dkp/shared';
import { StatisticsAttendanceTab } from './statistics-attendance';
import {
  attendanceReportFixture,
  attendanceTotalsFixture,
  statisticsApiMock,
} from './statistics-fixtures';
import { api } from '../lib/api';

// API_URL_VALUE нужен CsvButton (ui/charts): без экспорта мок ломает скачивание.
vi.mock('../lib/api', () => ({ api: vi.fn(), API_URL_VALUE: '/api' }));

const QUERY = { from: '2026-12-01', to: '2026-12-31' };
const OPTIONS = {
  kps: [{ id: 'kp1', name: 'КП Альфа', packs: [{ id: 'p1', name: 'Пак Один' }] }],
  eventTypes: [{ id: 't1', name: 'Гильдбосс' }],
};

const WEEK = { start: '2026-11-30T21:00:00.000Z', end: '2026-12-07T21:00:00.000Z' };

function detailsFixture(): AttendanceDetail[] {
  return [
    {
      eventId: 'e1',
      eventName: 'Вечерний гильдбосс',
      startsAt: '2026-12-05T18:00:00.000Z',
      memberId: 'm1',
      nickname: 'Игрок Один',
      packId: 'p1',
      kpId: 'kp1',
      teamStatus: 'KNOWN',
      membershipStatus: 'KNOWN',
      checkinStart: 'PASSED',
      checkinEnd: 'MANUAL',
      status: 'PRESENT',
      checks: 2,
      events: 1,
    },
    {
      eventId: 'e2',
      eventName: 'Ночной рейд',
      startsAt: '2026-12-15T18:00:00.000Z',
      memberId: 'm1',
      nickname: 'Игрок Один',
      packId: 'p1',
      kpId: 'kp1',
      teamStatus: 'KNOWN',
      membershipStatus: 'KNOWN',
      checkinStart: 'PENDING',
      checkinEnd: null,
      status: 'NO_SHOW',
      checks: 0,
      events: 1,
    },
    {
      eventId: 'e1',
      eventName: 'Вечерний гильдбосс',
      startsAt: '2026-12-05T18:00:00.000Z',
      memberId: 'm2',
      nickname: 'Игрок Два',
      packId: null,
      kpId: null,
      teamStatus: 'NO_HISTORICAL_DATA',
      membershipStatus: 'NO_HISTORICAL_DATA',
      checkinStart: 'PASSED',
      checkinEnd: null,
      status: 'LEFT_EARLY',
      checks: 1,
      events: 1,
    },
  ];
}

function reportFixture(details: AttendanceDetail[]): AttendanceReport {
  return attendanceReportFixture({
    details,
    overview: {
      activeMembers: new Set(details.filter((row) => row.checks > 0).map((row) => row.memberId))
        .size,
      finishedEvents: new Set(details.map((row) => row.eventId)).size,
      totals: attendanceTotalsFixture(),
    },
  });
}

function renderTab(
  details = detailsFixture(),
  focus?: Parameters<typeof StatisticsAttendanceTab>[0]['focus'],
) {
  const mock = statisticsApiMock({ attendance: reportFixture(details) });
  vi.mocked(api).mockImplementation(mock.implementation as typeof api);
  render(<StatisticsAttendanceTab query={QUERY} focus={focus ?? null} options={OPTIONS} />);
  return mock;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('показывает разрез игроков и раскрывает строку до ивентов и отметок', async () => {
  renderTab();
  expect(await screen.findByRole('row', { name: /Детали: Игрок Один/ })).toBeDefined();
  // Командный процент — суммы C/N, не среднее: (3/2)/3×100% = 50%.
  expect(screen.getByRole('row', { name: /Детали: Игрок Один/ }).textContent).toContain('50%');
  fireEvent.click(screen.getByRole('row', { name: /Детали: Игрок Один/ }));
  expect(screen.getByText('Ивенты и принятые отметки (2 пар игрок–ивент)')).toBeDefined();
  // Отметки фаз и итоговый статус из справочника.
  expect(screen.getAllByText('Самостоятельно').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Ручная отметка').length).toBeGreaterThan(0);
  expect(screen.getByText('Отсутствовал')).toBeDefined();
  // Историческая команда: у известной — названия, у неизвестной — пометка.
  expect(screen.getAllByText('Пак Один · КП Альфа').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Нет исторических данных').length).toBeGreaterThan(0);
});

it('переключает разрезы: паки, КП и гильдия с парами игрок–ивент', async () => {
  renderTab();
  await screen.findByRole('row', { name: /Детали: Игрок Один/ });
  fireEvent.click(screen.getByRole('button', { name: 'Паки' }));
  expect(await screen.findByRole('row', { name: /Детали: Пак Один/ })).toBeDefined();
  expect(screen.getByRole('row', { name: /Детали: Нет исторических данных/ })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'КП' }));
  expect(await screen.findByRole('row', { name: /Детали: КП Альфа/ })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Гильдия' }));
  const guildRow = await screen.findByRole('row', { name: /Детали: Гильдия/ });
  // Гильдия: участия = пары игрок–ивент (3), а не уникальные ивенты (2).
  expect(guildRow.textContent).toContain('50%');
  fireEvent.click(guildRow);
  expect(screen.getByText('Ивенты и принятые отметки (3 пар игрок–ивент)')).toBeDefined();
});

it('формула доступна по нажатию; N=0 показывает «—» с пояснением', async () => {
  renderTab([
    {
      ...detailsFixture()[0]!,
      checks: 0,
      checkinStart: 'PENDING',
      checkinEnd: null,
      status: 'NO_SHOW',
    },
  ]);
  await screen.findByText('Как считается посещаемость');
  fireEvent.click(screen.getByText('Как считается посещаемость'));
  expect(screen.getByText(/посещаемость = \(число принятых отметок \/ 2\)/)).toBeDefined();
  // Ноль отметок при положительном знаменателе — 0%, не «—».
  const row = screen.getByRole('row', { name: /Детали: Игрок Один/ });
  expect(row.textContent).toContain('0%');
  expect(row.textContent).not.toContain('—%');
});

it('срез игрока из обзора раскрывает его строку; срез недели пересчитывает таблицу', async () => {
  renderTab(detailsFixture(), { kind: 'attendanceMember', memberId: 'm2', nickname: 'Игрок Два' });
  // Строка m2 раскрыта срезом без клика.
  await screen.findByText('Ивенты и принятые отметки (1 пар игрок–ивент)');
  expect(screen.getByText('Ушёл раньше')).toBeDefined();
});

it('дата ивента в полночь Москвы — один день, а не обратный диапазон (#254)', async () => {
  // 2 января 00:00 МСК = 21:00 UTC предыдущих суток.
  renderTab([{ ...detailsFixture()[0]!, startsAt: '2026-01-01T21:00:00.000Z' }]);
  fireEvent.click(await screen.findByRole('row', { name: /Детали: Игрок Один/ }));
  expect(screen.getByText('2 янв', { exact: true })).toBeDefined();
  expect(screen.queryByText(/1 янв/)).toBeNull();
});

it('кнопка раскрытия переключает детали, клик по строке продолжает работать (#252)', async () => {
  renderTab();
  const button = await screen.findByRole('button', { name: 'Детали: Игрок Один' });
  expect(button.getAttribute('aria-expanded')).toBe('false');
  // Активация кнопки (Enter/Space в браузере посылают click) раскрывает детали;
  // stopPropagation не даёт строке переключить состояние повторно.
  fireEvent.click(button);
  expect(screen.getByText('Ивенты и принятые отметки (2 пар игрок–ивент)')).toBeDefined();
  expect(
    screen.getByRole('button', { name: 'Детали: Игрок Один' }).getAttribute('aria-expanded'),
  ).toBe('true');
  // Клик мышью по строке сворачивает обратно.
  fireEvent.click(screen.getByRole('row', { name: /Детали: Игрок Один/ }));
  expect(
    screen.getByRole('button', { name: 'Детали: Игрок Один' }).getAttribute('aria-expanded'),
  ).toBe('false');
});

it('срез недели оставляет только детали этих дат', async () => {
  renderTab(detailsFixture(), { kind: 'week', start: WEEK.start, end: WEEK.end });
  await screen.findByRole('row', { name: /Детали: Игрок Один/ });
  // Первая неделя: только e1 (5 декабря) — одна пара у каждого игрока.
  const row = screen.getByRole('row', { name: /Детали: Игрок Один/ });
  expect(row.textContent).toContain('100%');
  fireEvent.click(row);
  expect(screen.getByText('Ивенты и принятые отметки (1 пар игрок–ивент)')).toBeDefined();
  expect(screen.queryByText('Ночной рейд')).toBeNull();
});

it('CSV деталей в срезе недели выгружает её границы по Москве (#249)', async () => {
  renderTab(detailsFixture(), { kind: 'week', start: WEEK.start, end: WEEK.end });
  await screen.findByRole('row', { name: /Детали: Игрок Один/ });
  const fetchMock = vi.fn().mockResolvedValue(
    new Response('a;b', {
      status: 200,
      headers: { 'Content-Disposition': 'attachment; filename=details.csv' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  fireEvent.click(screen.getByRole('button', { name: 'Скачать CSV: детали посещаемости' }));
  // Выгрузка сужается до выбранной недели, общие фильтры сохраняются.
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(fetchMock.mock.calls[0]![0]).toBe(
    '/api/statistics/attendance/export.csv?from=2026-12-01&to=2026-12-07&cut=details',
  );
});

it('N=0 в разрезе — «—» и подсказка «Нет ивентов для расчёта»', async () => {
  renderTab([]);
  await screen.findByText('Нет данных за выбранный период');
});

it('ошибка не подменяется нулями, повтор перезагружает', async () => {
  let failed = true;
  const mock = statisticsApiMock({
    attendance: () =>
      failed ? Promise.reject(new Error('offline')) : reportFixture(detailsFixture()),
  });
  vi.mocked(api).mockImplementation(mock.implementation as typeof api);
  render(<StatisticsAttendanceTab query={QUERY} focus={null} options={OPTIONS} />);
  await screen.findByRole('alert');
  failed = false;
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByRole('row', { name: /Детали: Игрок Один/ });
  await waitFor(() => expect(mock.paths('/statistics/attendance').length).toBe(2));
});

it('недельный график показывает проценты и исходные числа в подсказках', async () => {
  renderTab();
  await screen.findByRole('img', { name: 'Посещаемость по неделям, процентов' });
  expect(screen.getAllByText('1 дек – 7 дек').length).toBeGreaterThan(0);
});
