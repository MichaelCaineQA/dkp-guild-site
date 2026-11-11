import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DashboardScreen } from './dashboard';
import { api } from '../lib/api';
import { useSession } from './session-context';
vi.mock('../lib/api', () => ({ api: vi.fn() }));
vi.mock('./session-context', () => ({ useSession: vi.fn() }));
vi.mock('./event-card', () => ({
  EventCard: ({ event }: { event: { name: string } }) => (
    <div role="dialog">Карточка {event.name}</div>
  ),
}));
const summary = {
  generatedAt: new Date().toISOString(),
  events: [],
  team: null,
  auction: null,
  audit: [],
  gameTime: null,
};
const session = (rank: 'MEMBER' | 'OFFICER' | null, isAdmin = false) =>
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u', username: 'Игрок', memberId: isAdmin ? null : 'm', rank, isAdmin },
    loading: false,
    reload: vi.fn(),
  });
beforeEach(() => {
  session('MEMBER');
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/dashboard' ? summary : path === '/dashboard/wallet' ? null : [],
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('рядовой видит личный лог и пустые состояния', async () => {
  render(<DashboardScreen />);
  await screen.findByText('Сегодня отдыхаем!');
  expect(screen.getAllByRole('region')).toHaveLength(6);
  expect(
    screen.getByText('Здесь появится информация о твоём паке после того, как тебя распределят'),
  ).toBeDefined();
  expect(screen.getByText('Скоро тут будут ваши лоты')).toBeDefined();
  expect(screen.getByText('Записей пока нет')).toBeDefined();
  expect(screen.getByText('Перейти в лог действий')).toBeDefined();
  expect(api).toHaveBeenCalledWith('/dashboard');
});
it('Офицер видит 10 записей и переход в аудит', async () => {
  session('OFFICER');
  vi.mocked(api).mockResolvedValueOnce({
    ...summary,
    audit: [
      {
        id: 'log',
        actorName: 'Глава',
        action: 'EVENT_CREATE',
        createdAt: new Date().toISOString(),
        comment: 'Ивент создан',
      },
    ],
  });
  render(<DashboardScreen />);
  expect(await screen.findByText('Комментарий: Ивент создан')).toBeDefined();
  expect(screen.getByText('Перейти в лог действий')).toBeDefined();
});
it('событие открывает общую с календарём карточку', async () => {
  vi.mocked(api).mockResolvedValueOnce({
    ...summary,
    events: [
      {
        id: 'e',
        name: 'Поход',
        eventTypeName: 'Гильдбосс',
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
        status: 'PLANNED',
        raidLeadId: 'rl',
      },
    ],
  });
  render(<DashboardScreen />);
  fireEvent.click(await screen.findByRole('button', { name: /Поход/ }));
  expect(screen.getByRole('dialog').textContent).toContain('Поход');
});
it('резервный Админ видит все виджеты, без ожидания привязки', async () => {
  session(null, true);
  render(<DashboardScreen />);
  await screen.findByText('Сегодня отдыхаем!');
  expect(screen.getAllByRole('region')).toHaveLength(6);
  expect(screen.getByText('Кошелёк доступен участникам гильдии.')).toBeDefined();
  expect(api).not.toHaveBeenCalledWith('/dashboard/wallet');
  expect(screen.getByText('Перейти в лог действий')).toBeDefined();
});
it('ошибка сервера не маскируется под пустое расписание', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/dashboard') throw new Error('offline');
    if (path === '/dashboard/wallet') return null;
    return [];
  });
  render(<DashboardScreen />);
  expect(await screen.findByRole('alert')).toBeDefined();
  expect(screen.queryByText('Сегодня отдыхаем!')).toBeNull();
  expect(screen.getAllByRole('region')).toHaveLength(6);
});

  it('показывает до трёх активных отсутствий: текущие перед будущими, с локальными датами и отметкой', async () => {
    const now = Date.now();
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/dashboard') return summary;
      if (path === '/dashboard/wallet') return null;
      if (path === '/absences/mine')
      return [
        {
          id: 'future',
          dateFrom: new Date(now + 86_400_000).toISOString(),
          dateTo: new Date(now + 90_000_000).toISOString(),
          eventName: 'Рейд',
          reason: 'Причина',
          status: 'ACTIVE',
          seenBy: ['leader'],
        },
        {
          id: 'current',
          dateFrom: new Date(now - 3_600_000).toISOString(),
          dateTo: new Date(now + 3_600_000).toISOString(),
          eventName: null,
          reason: '',
          status: 'ACTIVE',
          seenBy: [],
        },
        {
          id: 'cancelled',
          dateFrom: new Date(now + 1_000).toISOString(),
          dateTo: new Date(now + 2_000).toISOString(),
          reason: '',
          status: 'CANCELLED',
          seenBy: [],
        },
        {
          id: 'later',
          dateFrom: new Date(now + 2 * 86_400_000).toISOString(),
          dateTo: new Date(now + 2 * 86_400_000 + 1000).toISOString(),
          reason: '',
          status: 'ACTIVE',
          seenBy: [],
        },
        {
          id: 'fourth',
          dateFrom: new Date(now + 3 * 86_400_000).toISOString(),
          dateTo: new Date(now + 3 * 86_400_000 + 1000).toISOString(),
          reason: '',
          status: 'ACTIVE',
          seenBy: [],
        },
      ];
    return [];
  });
  render(<DashboardScreen />);
  const region = await screen.findByRole('region', { name: 'Мои отсутствия' });
  expect(region.textContent).toContain('Рейд');
  expect(region.textContent).toContain('Причина');
  expect(region.textContent).toContain('Увидел');
  expect(region.querySelectorAll('li')).toHaveLength(3);
  expect(region.textContent).not.toContain('cancelled');
  expect(region.textContent).toContain('Все мои отсутствия');
  expect(region.textContent).toContain('Оформить отсутствие');
});

it('виджет «Мой аукцион»: лот из dashboard, переход в аукцион (#98)', async () => {
  vi.mocked(api).mockImplementation(async (path: string) =>
    path === '/dashboard'
      ? {
          ...summary,
          auction: {
            lotId: 'a-1',
            itemName: 'Клинок рассвета',
            rarity: 'Легендарный',
            status: 'OPEN',
            endsAt: '2026-11-10T18:01:30.000Z',
            topBid: { amount: 150, memberName: 'Целитель' },
          },
        }
      : path === '/dashboard/wallet'
        ? null
        : [],
  );
  render(<DashboardScreen />);
  const region = await screen.findByRole('region', { name: 'Мой аукцион' });
  expect(region.textContent).toContain('Клинок рассвета');
  expect(region.textContent).toContain('Окончание:');
  expect(region.textContent).toContain('150 ДКП');
  expect(region.textContent).toContain('Целитель');
  expect(screen.getByRole('button', { name: 'Открыть аукцион' })).toBeDefined();
});

it('кошелёк: баланс журнала, заморозка с наценкой, доступная сумма и ссылки (#81)', async () => {
  vi.mocked(api).mockImplementation(async (path: string) =>
    path === '/dashboard'
      ? summary
      : path === '/dashboard/wallet'
        ? {
            balance: 200,
            frozen: 198,
            available: 2,
            lots: [
              { lotId: 'near', itemName: 'Посох', fullCost: 88, endsAt: '2026-11-11T20:00:00Z' },
              { lotId: 'far', itemName: 'Клинок', fullCost: 110, endsAt: '2026-11-12T18:00:00Z' },
            ],
          }
        : [],
  );
  render(<DashboardScreen />);
  const region = await screen.findByRole('region', { name: 'Мой кошелёк' });
  expect(region.textContent).toContain('Баланс: 200 ДКП');
  expect(region.textContent).toContain('Заморожено: 198 ДКП');
  expect(region.textContent).toContain('Спишется, если вы выиграете текущие лоты');
  expect(region.textContent).toContain('Доступно для новых ставок: 2 ДКП');
  expect(region.textContent).toContain('Посох');
  expect(region.textContent).toContain('88 ДКП');
  expect(region.textContent).toContain('Клинок');
  expect(region.textContent).toContain('110 ДКП');
  const history = screen.getByRole('link', { name: 'История ДКП' }) as HTMLAnchorElement;
  expect(history.getAttribute('href')).toBe('/dkp');
  const lots = screen.getByRole('link', { name: 'Мои лоты' }) as HTMLAnchorElement;
  expect(lots.getAttribute('href')).toBe('/auction');
});

it('кошелёк без заморозки не показывает список лотов', async () => {
  vi.mocked(api).mockImplementation(async (path: string) =>
    path === '/dashboard/wallet'
      ? { balance: 55, frozen: 0, available: 55, lots: [] }
      : path === '/dashboard'
        ? summary
        : [],
  );
  render(<DashboardScreen />);
  const region = await screen.findByRole('region', { name: 'Мой кошелёк' });
  expect(region.textContent).toContain('Заморожено: 0 ДКП');
  expect(region.querySelectorAll('ul')).toHaveLength(0);
});

it('кошелёк: ошибка загрузки — предупреждение и повтор', async () => {
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path === '/dashboard/wallet') throw new Error('offline');
    if (path === '/dashboard') return summary;
    return [];
  });
  render(<DashboardScreen />);
  const region = await screen.findByRole('region', { name: 'Мой кошелёк' });
  expect(region.textContent).toContain('Не удалось загрузить кошелёк.');
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  expect(api).toHaveBeenCalledWith('/dashboard/wallet');
});
