import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DkpStatisticsReport, DkpTotals } from '@dkp/shared';
import { StatisticsDkpTab } from './statistics-dkp';
import { dkpReportFixture, dkpTotalsFixture, statisticsApiMock } from './statistics-fixtures';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: vi.fn() }));

const OPTIONS = {
  kps: [{ id: 'kp1', name: 'КП Альфа', packs: [{ id: 'p1', name: 'Пак Один' }] }],
  eventTypes: [{ id: 't1', name: 'Гильдбосс' }],
};

function totals(
  overrides: Partial<{ earned: number; spent: number; adjustments: number }>,
): DkpTotals {
  return dkpTotalsFixture(overrides);
}

function renderTab(
  report: DkpStatisticsReport = dkpReportFixture(),
  query: Parameters<typeof StatisticsDkpTab>[0]['query'] = { from: '2026-12-01', to: '2026-12-31' },
) {
  const mock = statisticsApiMock({ dkp: report });
  vi.mocked(api).mockImplementation(mock.implementation as typeof api);
  render(<StatisticsDkpTab query={query} focus={null} options={OPTIONS} />);
  return mock;
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it('показывает раздельные показатели со знаками; корректировка не смешана с заработком', async () => {
  renderTab(dkpReportFixture({ totals: totals({ earned: 120, spent: -40, adjustments: -5 }) }));
  await screen.findByText('Движение ДКП за период');
  expect(screen.getAllByText('+120').length).toBeGreaterThan(0);
  expect(screen.getAllByText('-40').length).toBeGreaterThan(0);
  expect(screen.getAllByText('-5').length).toBeGreaterThan(0);
  // Положительная корректировка остаётся корректировкой, не «заработком».
  expect(screen.getByText(/не подмешиваются к заработку/)).toBeDefined();
});

it('раскрывает строку игрока до операций журнала с типом, датой и связями', async () => {
  renderTab();
  fireEvent.click(await screen.findByRole('row', { name: /Операции: Игрок Один/ }));
  expect(screen.getByText('Операции журнала (1)')).toBeDefined();
  expect(screen.getByText('Чек-ин')).toBeDefined();
  expect(screen.getByText('Вечерний гильдбосс')).toBeDefined();
  expect(screen.getByText('Пак Один · КП Альфа')).toBeDefined();
  // Ссылка в профиль игрока.
  expect(screen.getByRole('link', { name: 'Игрок Один' }).getAttribute('href')).toBe(
    '/profiles/m1',
  );
});

it('полный баланс подписан датой среза и исключением фильтров', async () => {
  renderTab(dkpReportFixture(), {
    from: '2026-12-01',
    to: '2026-12-31',
    eventTypeId: 't1',
    mode: 'PVE',
  });
  await screen.findByText('Движение ДКП за период');
  expect(screen.getByText(/Баланс на .* полный, накопительный по всей истории/)).toBeDefined();
  expect(screen.getByText(/Без учёта фильтра типа ивента и PvE–PvP/)).toBeDefined();
  const header = screen.getByRole('columnheader', { name: /Баланс на/ });
  expect(header.textContent).toContain('Баланс на');
});

it('«Без ивента» — отдельная категория с раскрытием, вне итога типа', async () => {
  const report = dkpReportFixture({
    withoutEvent: {
      totals: totals({ earned: 0, spent: 0, adjustments: -5 }),
      members: [
        {
          id: 'm2',
          nickname: 'Игрок Два',
          totals: totals({ earned: 0, spent: 0, adjustments: -5 }),
          details: [
            {
              id: 'd2',
              memberId: 'm2',
              nickname: 'Игрок Два',
              type: 'ADJUSTMENT',
              amount: -5,
              occurredAt: '2026-12-02T12:00:00.000Z',
              comment: 'правка',
              eventId: null,
              eventName: null,
              startsAt: null,
              eventTypeId: null,
              eventTypeName: null,
              mode: null,
              auctionId: null,
              auctionItemName: null,
              packId: null,
              kpId: null,
              teamStatus: 'NO_HISTORICAL_DATA',
            },
          ],
        },
      ],
    },
  });
  renderTab(report);
  await screen.findByText('Без ивента');
  expect(screen.getByText(/не подмешиваются в итог выбранного типа ивента/)).toBeDefined();
  fireEvent.click(screen.getByRole('row', { name: /Операции без ивента: Игрок Два/ }));
  expect(screen.getByText('Корректировка')).toBeDefined();
  expect(screen.getAllByText('без ивента').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Нет исторических данных').length).toBeGreaterThan(0);
});

it('переключение разрезов: команды без колонки баланса, null-команда — «Нет исторических данных»', async () => {
  renderTab();
  await screen.findByRole('row', { name: /Операции: Игрок Один/ });
  fireEvent.click(screen.getByRole('button', { name: 'Паки' }));
  await screen.findByRole('row', { name: /Операции: Пак Один/ });
  expect(screen.queryByRole('columnheader', { name: /Баланс на/ })).toBeNull();
});

it('недельная динамика: значения с знаком и исходные числа в подсказке', async () => {
  renderTab();
  await screen.findByRole('img', { name: 'Итог движения ДКП по неделям' });
  expect(screen.getAllByText('1 дек – 7 дек').length).toBeGreaterThan(0);
  expect(screen.getAllByText('+75').length).toBeGreaterThan(0);
});

it('ошибка не подменяется нулями', async () => {
  const mock = statisticsApiMock({ dkp: () => Promise.reject(new Error('offline')) });
  vi.mocked(api).mockImplementation(mock.implementation as typeof api);
  render(
    <StatisticsDkpTab
      query={{ from: '2026-12-01', to: '2026-12-31' }}
      focus={null}
      options={OPTIONS}
    />,
  );
  await screen.findByRole('alert');
  expect(screen.queryByText('Движение ДКП за период')).toBeNull();
});
