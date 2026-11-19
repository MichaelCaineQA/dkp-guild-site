import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LootStatisticsReport } from '@dkp/shared';
import { StatisticsLootTab } from './statistics-loot';
import { lootReportFixture, statisticsApiMock } from './statistics-fixtures';
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

function renderTab(report: LootStatisticsReport = lootReportFixture()) {
  const mock = statisticsApiMock({ loot: report });
  vi.mocked(api).mockImplementation(mock.implementation as typeof api);
  render(<StatisticsLootTab query={QUERY} focus={null} options={OPTIONS} />);
  return mock;
}

it('«Выпало»: предмет с долей от всей выборки и раскрытие по ивентам', async () => {
  renderTab();
  expect(await screen.findByText('Выпавшие предметы')).toBeDefined();
  expect(screen.getByText(/Всего выпадений: 4/)).toBeDefined();
  const row = screen.getByRole('row', { name: /Детали выпадений: Клинок зари/ });
  expect(row.textContent).toContain('75%');
  fireEvent.click(row);
  // Детали: дата выпадения, ивент, лот со статусом.
  expect(screen.getByText(/Лот закрыт/)).toBeDefined();
  expect(screen.getByRole('button', { name: 'Вечерний гильдбосс' })).toBeDefined();
});

it('нераспределённый дроп объясняется статусом лота, «не выставлялся» тоже виден', async () => {
  renderTab(
    lootReportFixture({
      dropped: {
        totals: { drops: 2, items: 1 },
        items: [
          {
            itemId: 'i1',
            itemName: 'Клинок зари',
            rarity: null,
            slot: null,
            isArchboss: false,
            count: 2,
            sharePct: 100,
            details: [
              {
                id: 'drop-open',
                occurredAt: '2026-12-02T12:00:00.000Z',
                eventId: 'e1',
                eventName: 'Вечерний гильдбосс',
                eventStartsAt: '2026-12-05T18:00:00.000Z',
                eventTypeId: 't1',
                eventTypeName: 'Гильдбосс',
                mode: 'PVE',
                packId: null,
                kpId: null,
                teamStatus: 'KNOWN',
                lotId: 'a-open',
                lotStatus: 'OPEN',
              },
              {
                id: 'drop-nolot',
                occurredAt: '2026-12-03T12:00:00.000Z',
                eventId: null,
                eventName: null,
                eventStartsAt: null,
                eventTypeId: null,
                eventTypeName: null,
                mode: null,
                packId: null,
                kpId: null,
                teamStatus: 'KNOWN',
                lotId: null,
                lotStatus: null,
              },
            ],
          },
        ],
        withoutEvent: { totals: { drops: 0, items: 0 }, items: [] },
      },
    }),
  );
  fireEvent.click(await screen.findByRole('row', { name: /Детали выпадений: Клинок зари/ }));
  expect(screen.getByText('Лот ещё разыгрывается')).toBeDefined();
  expect(screen.getByText('не выставлялся')).toBeDefined();
  expect(screen.getByText('Без ивента (хранилище)')).toBeDefined();
});

it('переключение «Получено» сохраняет условия: цена и связи из API', async () => {
  renderTab();
  await screen.findByText('Выпавшие предметы');
  fireEvent.click(screen.getByRole('button', { name: 'Получено' }));
  await screen.findByText('Выдачи');
  expect(screen.getByText(/Получено предметов: 1/)).toBeDefined();
  expect(screen.getAllByText('150 ДКП').length).toBeGreaterThan(0);
  // Получатель — ссылка в профиль; лот — ссылка на аукцион.
  const profileLinks = screen.getAllByRole('link', { name: 'Игрок Один' });
  expect(profileLinks.length).toBeGreaterThan(0);
  expect(profileLinks[0]!.getAttribute('href')).toBe('/profiles/m1');
  expect(screen.getByRole('link', { name: 'лот' }).getAttribute('href')).toBe('/auction');
  // Дата получения отличается от даты выпадения — подпись представления.
  expect(screen.getByText(/фактические выдачи по дате выдачи/)).toBeDefined();
});

it('итоги по получателям: разрезы игрок/пак/КП с числом и суммой', async () => {
  renderTab();
  fireEvent.click(await screen.findByRole('button', { name: 'Получено' }));
  await screen.findByText('Итоги по получателям');
  // Разрез «Игроки» активен: итоговая таблица с колонкой получателя.
  expect(screen.getAllByRole('columnheader', { name: 'Получатель' }).length).toBeGreaterThan(1);
  fireEvent.click(screen.getByRole('button', { name: 'Паки' }));
  const packRow = await screen.findByRole('row', { name: /Пак Один/ });
  expect(packRow.textContent).toContain('150');
  fireEvent.click(screen.getByRole('button', { name: 'КП' }));
  expect(await screen.findByRole('row', { name: /КП Альфа/ })).toBeDefined();
});

it('«Без ивента» в обоих представлениях отдельно от выборки', async () => {
  renderTab(
    lootReportFixture({
      dropped: {
        totals: { drops: 4, items: 2 },
        items: [],
        withoutEvent: {
          totals: { drops: 1, items: 1 },
          items: [
            {
              itemId: 'i3',
              itemName: 'Сундук хранилища',
              rarity: null,
              slot: null,
              isArchboss: false,
              count: 1,
              sharePct: 100,
              details: [],
            },
          ],
        },
      },
    }),
  );
  await screen.findByText('Выпало без ивента');
  expect(screen.getByText(/в топ выпадений не входят/)).toBeDefined();
  expect(screen.getByText('Сундук хранилища')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Получено' }));
  await screen.findByText('Получено без ивента');
});

it('срез предмета из обзора раскрывает его строку; срез представления выбирает вид', async () => {
  const mock = statisticsApiMock({ loot: lootReportFixture() });
  vi.mocked(api).mockImplementation(mock.implementation as typeof api);
  const { rerender } = render(
    <StatisticsLootTab
      query={QUERY}
      focus={{ kind: 'lootItem', itemId: 'i1', name: 'Клинок зари' }}
      options={OPTIONS}
    />,
  );
  await screen.findByText('Ивент'); // колонка деталей раскрытой строки
  rerender(
    <StatisticsLootTab
      query={QUERY}
      focus={{ kind: 'lootView', view: 'awarded' }}
      options={OPTIONS}
    />,
  );
  await screen.findByText('Выдачи');
});

it('пустая выборка, ошибка и повтор различимы', async () => {
  let failed = true;
  const mock = statisticsApiMock({
    loot: () => (failed ? Promise.reject(new Error('offline')) : lootReportFixture()),
  });
  vi.mocked(api).mockImplementation(mock.implementation as typeof api);
  render(<StatisticsLootTab query={QUERY} focus={null} options={OPTIONS} />);
  await screen.findByRole('alert');
  failed = false;
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByText('Выпавшие предметы');
  // Пустой отчёт: без ошибки — нули и «Нет данных».
  const empty = statisticsApiMock({
    loot: lootReportFixture({
      dropped: {
        totals: { drops: 0, items: 0 },
        items: [],
        withoutEvent: { totals: { drops: 0, items: 0 }, items: [] },
      },
      awarded: {
        totals: { awards: 0, spent: 0 },
        awards: [],
        members: [],
        packs: [],
        kps: [],
        withoutEvent: { totals: { awards: 0, spent: 0 }, members: [] },
      },
    }),
  });
  vi.mocked(api).mockImplementation(empty.implementation as typeof api);
  rerenderEmpty();
});

function rerenderEmpty() {
  cleanup();
  render(<StatisticsLootTab query={QUERY} focus={null} options={OPTIONS} />);
  return screen.findByText('Нет данных за выбранный период');
}
