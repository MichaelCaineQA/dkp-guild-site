import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StatisticsActivityTab } from './statistics-activity';
import { activityReportFixture, statisticsApiMock } from './statistics-fixtures';
import { api } from '../lib/api';
import { useSession } from './session-context';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
vi.mock('./session-context', () => ({ useSession: vi.fn() }));
vi.mock('./event-card', () => ({ EventCard: vi.fn(() => <div>Карточка ивента</div>) }));

const QUERY = { from: '2026-12-01', to: '2026-12-31' };
const OPTIONS = {
  kps: [{ id: 'kp1', name: 'КП Альфа', packs: [{ id: 'p1', name: 'Пак Один' }] }],
  eventTypes: [{ id: 't1', name: 'Гильдбосс' }],
};

const EVENT_ROW = {
  scope: 'GUILD' as const,
  kpId: null,
  packId: null,
  scopeName: 'Гильдия',
  id: 'e1',
  name: 'Вечерний гильдбосс',
  eventTypeId: 't1',
  eventTypeName: 'Гильдбосс',
  mode: 'PVE' as const,
  status: 'FINISHED',
  startsAt: '2026-12-05T18:00:00.000Z',
  endsAt: '2026-12-05T20:00:00.000Z',
  dkpReward: 10,
  raidLeadId: 'm1',
  raidLeadName: 'Игрок Один',
  place: null,
  notes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSession).mockReturnValue({
    user: {
      userId: 'u',
      username: 'Тест',
      memberId: 'm1',
      rank: 'MEMBER',
      isAdmin: false,
      blocked: false,
    },
    loading: false,
    reload: vi.fn(),
  });
});
afterEach(cleanup);

function renderTab(focus?: Parameters<typeof StatisticsActivityTab>[0]['focus']) {
  const mock = statisticsApiMock({ activity: activityReportFixture() });
  vi.mocked(api).mockImplementation(mock.implementation as typeof api);
  render(<StatisticsActivityTab query={QUERY} focus={focus ?? null} options={OPTIONS} />);
  return mock;
}

it('показывает таблицы типов и режимов с исходными серверными числами', async () => {
  renderTab();
  expect(await screen.findByText('Активность по типам ивентов')).toBeDefined();
  const typeRow = screen.getByRole('row', { name: 'Активность: Гильдбосс' });
  expect(typeRow.textContent).toContain('2');
  expect(typeRow.textContent).toContain('75%');
  expect(screen.getByRole('row', { name: /^PvE/ }).textContent).toContain('75%');
  // Пустой режим — нет знаменателя: «—», а не 0%.
  expect(screen.getByRole('row', { name: /^PvP/ }).textContent).toContain('—');
});

it('динамика и пик активности по московскому времени подписаны', async () => {
  renderTab();
  await screen.findByText('Динамика по неделям');
  expect(screen.getByRole('img', { name: 'Посещённые участия по неделям' })).toBeDefined();
  expect(screen.getByText('Пик активности')).toBeDefined();
  expect(screen.getByRole('img', { name: 'Пик активности по дням недели' })).toBeDefined();
  expect(screen.getByRole('img', { name: 'Пик активности по часам Москвы' })).toBeDefined();
  expect(screen.getByText(/московское время \(UTC\+3\)/)).toBeDefined();
  // Пик: пятница 18:00 из фикстуры.
  expect(screen.getByRole('img', { name: 'Пик активности по часам Москвы' }).textContent).toContain(
    '18',
  );
});

it('таблица игроков раскрывает участия с исторической командой', async () => {
  renderTab();
  const row = await screen.findByRole('row', { name: /Детали активности: Игрок Один/ });
  fireEvent.click(row);
  expect(screen.getAllByText('Гильдбосс').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Пак Один · КП Альфа').length).toBeGreaterThan(0);
  // Ссылка в профиль сохраняет право целевого экрана проверять доступ.
  expect(screen.getByRole('link', { name: 'Игрок Один' }).getAttribute('href')).toBe(
    '/profiles/m1',
  );
});

it('дата одиночного ивента в полночь Москвы — один день, а не диапазон (#254)', async () => {
  // 2 января 00:00 МСК = 21:00 UTC предыдущих суток: таблица ивентов и детали участий.
  const midnight = '2026-01-01T21:00:00.000Z';
  vi.mocked(api).mockImplementation(
    statisticsApiMock({
      activity: activityReportFixture({
        events: [{ ...activityReportFixture().events[0]!, startsAt: midnight }],
        members: [
          {
            ...activityReportFixture().members[0]!,
            details: [{ ...activityReportFixture().members[0]!.details[0]!, startsAt: midnight }],
          },
        ],
      }),
    }).implementation as typeof api,
  );
  render(<StatisticsActivityTab query={QUERY} focus={null} options={OPTIONS} />);
  expect(await screen.findAllByRole('row', { name: /Ивент: Вечерний гильдбосс/ })).toBeDefined();
  expect(screen.getByRole('row', { name: /Ивент: Вечерний гильдбосс/ }).textContent).toContain(
    '2 янв',
  );
  expect(screen.queryByText(/1 янв/)).toBeNull();
  fireEvent.click(screen.getByRole('row', { name: /Детали активности: Игрок Один/ }));
  // Таблица ивентов и раскрытые детали участий — обе с одной датой «2 янв».
  expect(screen.getAllByText('2 янв', { exact: true }).length).toBe(2);
});

it('клик по ивенту открывает общую карточку ивента', async () => {
  const mock = statisticsApiMock({
    activity: activityReportFixture(),
  });
  vi.mocked(api).mockImplementation(((path: string) => {
    if (path === '/settings/game-time')
      return Promise.resolve({
        gameTimeAnchor: '2026-01-01T00:00:00.000Z',
        gameTimeDayMinutes: 90,
        gameTimeNightMinutes: 30,
      });
    if (path === '/events/e1') return Promise.resolve(EVENT_ROW);
    return mock.implementation(path);
  }) as typeof api);
  render(<StatisticsActivityTab query={QUERY} focus={null} options={OPTIONS} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Вечерний гильдбосс' }));
  await screen.findByText('Карточка ивента');
  expect(vi.mocked(api).mock.calls.some(([path]) => path === '/events/e1')).toBe(true);
});

it('срез типа фильтрует таблицы и скрывает недели/пик с пояснением', async () => {
  renderTab({ kind: 'activityType', eventTypeId: 't1', name: 'Гильдбосс' });
  await screen.findByText('Активность по типам ивентов');
  expect(screen.getByText(/Недели и пик активности считают всю выборку/)).toBeDefined();
  expect(screen.queryByRole('img', { name: 'Посещённые участия по неделям' })).toBeNull();
});

it('ошибка отчёта отличима и повторяется', async () => {
  let failed = true;
  const mock = statisticsApiMock({
    activity: () => (failed ? Promise.reject(new Error('offline')) : activityReportFixture()),
  });
  vi.mocked(api).mockImplementation(mock.implementation as typeof api);
  render(<StatisticsActivityTab query={QUERY} focus={null} options={OPTIONS} />);
  await screen.findByRole('alert');
  failed = false;
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByText('Активность по типам ивентов');
  await waitFor(() => expect(mock.paths('/statistics/activity').length).toBe(2));
});
