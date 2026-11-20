import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AttendanceReport, DkpStatisticsReport, LootStatisticsReport } from '@dkp/shared';
import { StatisticsOverview } from './statistics-overview';
import {
  attendanceReportFixture,
  attendanceTotalsFixture,
  dkpReportFixture,
  lootReportFixture,
  statisticsApiMock,
} from './statistics-fixtures';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: vi.fn() }));

const QUERY = { from: '2026-12-01', to: '2026-12-31' };
const go = vi.fn();

function renderOverview(options?: {
  attendance?: AttendanceReport | (() => AttendanceReport | Promise<AttendanceReport>);
  dkp?: () => DkpStatisticsReport | Promise<DkpStatisticsReport>;
  loot?: LootStatisticsReport | Promise<LootStatisticsReport>;
  canViewGearScore?: boolean;
}) {
  const mock = statisticsApiMock({
    attendance:
      typeof options?.attendance === 'function'
        ? (options.attendance as () => AttendanceReport | Promise<AttendanceReport>)
        : options?.attendance,
    dkp: options?.dkp,
    loot: options?.loot,
  });
  vi.mocked(api).mockImplementation(mock.implementation as typeof api);
  render(
    <StatisticsOverview
      query={QUERY}
      eventFilterActive={false}
      canViewGearScore={options?.canViewGearScore ?? false}
      go={go}
    />,
  );
  return mock;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

it('показывает карточки и недельные графики из серверных отчётов', async () => {
  renderOverview();
  expect(await screen.findByText('Активные участники')).toBeDefined();
  expect(screen.getByRole('button', { name: /Активные участники/ }).textContent).toContain('3');
  expect(screen.getByRole('button', { name: /Завершено ивентов/ }).textContent).toContain('2');
  // Посещаемость 12/16 за 8 ивентов = 75% с исходными числами рядом.
  expect(screen.getByRole('button', { name: /Посещаемость 75%/ }).textContent).toContain('75%');
  expect(screen.getByText('12 отметок из 16 · 8 ивентов')).toBeDefined();
  expect(screen.getByRole('button', { name: /Начислено ДКП/ }).textContent).toContain('120');
  // Оба графика с подписью фактических дат недели.
  expect(screen.getByRole('img', { name: 'Посещаемость по неделям, процентов' })).toBeDefined();
  expect(screen.getByRole('img', { name: 'Завершённые ивенты по неделям' })).toBeDefined();
  expect(screen.getAllByText('1 дек – 7 дек').length).toBeGreaterThan(0);
  // График завершённых ивентов считает разные ивенты (2), не участия (5) (#251).
  expect(
    screen.getByRole('button', { name: '1 дек – 7 дек: 2. Завершённых ивентов 2' }),
  ).toBeDefined();
});

it('клик по карточке, неделе графика и топу открывает вкладку с срезом', async () => {
  renderOverview();
  await screen.findByText('Активные участники');
  fireEvent.click(screen.getByRole('button', { name: /Активные участники/ }));
  expect(go).toHaveBeenCalledWith('activity', { kind: 'activityTable', table: 'members' });
  fireEvent.click(screen.getByRole('button', { name: /Завершено ивентов/ }));
  expect(go).toHaveBeenCalledWith('activity', { kind: 'activityTable', table: 'events' });
  // Столбец недели: подпись дат + значение + исходные числа в подсказке.
  fireEvent.click(
    screen.getByRole('button', { name: '1 дек – 7 дек: 80%. Отметки 8 из 10, участий 5' }),
  );
  expect(go).toHaveBeenCalledWith('attendance', {
    kind: 'week',
    start: '2026-11-30T21:00:00.000Z',
    end: '2026-12-07T21:00:00.000Z',
  });
  fireEvent.click(screen.getByRole('button', { name: /Посещаемость Игрок Один: 100%/ }));
  expect(go).toHaveBeenCalledWith('attendance', {
    kind: 'attendanceMember',
    memberId: 'm1',
    nickname: 'Игрок Один',
  });
});

it('N=0 показывает «—» и пояснение вместо нуля', async () => {
  renderOverview({
    attendance: attendanceReportFixture({
      overview: {
        activeMembers: 0,
        finishedEvents: 0,
        totals: attendanceTotalsFixture({ checks: 0, events: 0, percentage: null }),
      },
      top: [],
      weeks: [],
    }),
  });
  await screen.findByText('Активные участники');
  expect(screen.getByText('—')).toBeDefined();
  expect(screen.getByText('Нет ивентов для расчёта')).toBeDefined();
  expect(screen.queryByRole('button', { name: /Посещаемость Игрок/ })).toBeNull();
});

it('ошибка ДКП не превращается в ноль: карточка с повтором', async () => {
  let failed = true;
  renderOverview({
    dkp: () =>
      failed ? Promise.reject(new Error('offline')) : Promise.resolve(dkpReportFixture()),
  });
  await screen.findByText('Начислено ДКП');
  expect(screen.getByText('Не удалось загрузить')).toBeDefined();
  // Повтор загружает отчёт — значение появляется.
  failed = false;
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByText('120');
});

it('ошибка посещаемости не подменяет карточки нулями', async () => {
  renderOverview({ attendance: () => Promise.reject(new Error('offline')) });
  await screen.findByRole('alert');
  expect(screen.getByText('Не удалось загрузить отчёт')).toBeDefined();
  expect(screen.queryByText('Активные участники')).toBeNull();
});

it('рядовой не запрашивает свежесть GS, Глава видит блок', async () => {
  const memberMock = renderOverview({ canViewGearScore: false });
  await screen.findByText('Активные участники');
  expect(memberMock.paths('/statistics/gear-score')).toEqual([]);
  expect(screen.queryByText('Свежесть GS')).toBeNull();

  const leaderMock = renderOverview({ canViewGearScore: true });
  await screen.findByText('Свежесть GS');
  expect(leaderMock.paths('/statistics/gear-score').length).toBeGreaterThan(0);
  expect(screen.getByText('Актуальные: 3')).toBeDefined();
  expect(screen.getByText('Устаревшие: 2')).toBeDefined();
  expect(screen.getByText('Без скриншота: 1')).toBeDefined();
  expect(screen.getByText('Доля устаревших: 33%')).toBeDefined();
  expect(screen.getByText(/Срез на /)).toBeDefined();
});

it('типы ивентов и топ лута со строкой «Остальное» раскрывают срезы', async () => {
  renderOverview({
    loot: lootReportFixture({
      top: [
        {
          kind: 'ITEM',
          itemId: 'i1',
          itemName: 'Клинок зари',
          rarity: 'Легендарный',
          slot: 'Оружие',
          isArchboss: false,
          count: 3,
          sharePct: 50,
        },
        { kind: 'REST', count: 3, sharePct: 50 },
      ],
    }),
  });
  await screen.findByText('Активность по типам ивентов');
  fireEvent.click(screen.getByRole('row', { name: /Гильдбосс/ }));
  expect(go).toHaveBeenCalledWith('activity', {
    kind: 'activityType',
    eventTypeId: 't1',
    name: 'Гильдбосс',
  });
  await screen.findByText('Чаще всего выпадает');
  expect(screen.getByText('Остальное')).toBeDefined();
  expect(screen.getByText('Всего выпадений в выборке: 4')).toBeDefined();
  fireEvent.click(screen.getByRole('row', { name: /Клинок зари/ }));
  expect(go).toHaveBeenCalledWith('loot', { kind: 'lootItem', itemId: 'i1', name: 'Клинок зари' });
});

it('фильтр типа/режима подписывает игнорирование среза GS', async () => {
  const mock = statisticsApiMock({});
  vi.mocked(api).mockImplementation(mock.implementation as typeof api);
  render(<StatisticsOverview query={QUERY} eventFilterActive canViewGearScore go={go} />);
  await screen.findByText('Свежесть GS');
  expect(screen.getByText('Тип ивента и режим не влияют на срез свежести GS.')).toBeDefined();
});
