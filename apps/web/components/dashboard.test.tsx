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
  vi.mocked(api).mockImplementation(async (path) => (path === '/dashboard' ? summary : []));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('рядовой видит личный лог и пустые состояния', async () => {
  render(<DashboardScreen />);
  await screen.findByText('Сегодня отдыхаем!');
  expect(screen.getAllByRole('region')).toHaveLength(5);
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
it('резервный Админ видит четыре виджета, без ожидания привязки', async () => {
  session(null, true);
  render(<DashboardScreen />);
  await screen.findByText('Сегодня отдыхаем!');
  expect(screen.getAllByRole('region')).toHaveLength(5);
  expect(screen.getByText('Перейти в лог действий')).toBeDefined();
});
it('ошибка сервера не маскируется под пустое расписание', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/dashboard') throw new Error('offline');
    return [];
  });
  render(<DashboardScreen />);
  expect(await screen.findByRole('alert')).toBeDefined();
  expect(screen.queryByText('Сегодня отдыхаем!')).toBeNull();
  expect(screen.getAllByRole('region')).toHaveLength(5);
});

it('показывает до трёх активных отсутствий: текущие перед будущими, с локальными датами и отметкой', async () => {
  const now = Date.now();
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/dashboard') return summary;
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
