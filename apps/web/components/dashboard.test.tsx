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
  audit: null,
  gameTime: null,
};
const session = (rank: 'MEMBER' | 'OFFICER' | null, isAdmin = false) =>
  vi
    .mocked(useSession)
    .mockReturnValue({
      user: { userId: 'u', username: 'Игрок', memberId: isAdmin ? null : 'm', rank, isAdmin },
      loading: false,
      reload: vi.fn(),
    });
beforeEach(() => {
  session('MEMBER');
  vi.mocked(api).mockResolvedValue(summary);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('четыре виджета и точные пустые состояния одинаковы у рядового; нет кнопки полного аудита', async () => {
  render(<DashboardScreen />);
  await screen.findByText('Сегодня отдыхаем!');
  expect(screen.getAllByRole('region')).toHaveLength(4);
  expect(
    screen.getByText('Здесь появится информация о твоём паке после того, как тебя распределят'),
  ).toBeDefined();
  expect(screen.getByText('Скоро тут будут ваши лоты')).toBeDefined();
  expect(screen.getByText('Журнал действий доступен Офицеру, Главе и Админу')).toBeDefined();
  expect(screen.queryByText('Перейти в лог действий')).toBeNull();
  expect(api).toHaveBeenCalledWith('/dashboard');
});
it('Офицер видит 10 записей и переход в аудит', async () => {
  session('OFFICER');
  vi.mocked(api).mockResolvedValue({
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
  expect(await screen.findByText('Ивент создан')).toBeDefined();
  expect(screen.getByText('Перейти в лог действий')).toBeDefined();
});
it('событие открывает общую с календарём карточку', async () => {
  vi.mocked(api).mockResolvedValue({
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
  expect(screen.getAllByRole('region')).toHaveLength(4);
  expect(screen.getByText('Перейти в лог действий')).toBeDefined();
});
it('ошибка сервера не маскируется под пустое расписание', async () => {
  vi.mocked(api).mockRejectedValue(new Error('offline'));
  render(<DashboardScreen />);
  expect(await screen.findByRole('alert')).toBeDefined();
  expect(screen.queryByText('Сегодня отдыхаем!')).toBeNull();
  expect(screen.getAllByRole('region')).toHaveLength(4);
});
