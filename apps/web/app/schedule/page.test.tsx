import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SchedulePage from './page';

/** Мокаем api-клиент и сессию: расписание — UI над /events. */
vi.mock('../../lib/api', () => ({
  api: vi.fn(),
}));

vi.mock('../../components/session-context', () => ({
  useSession: vi.fn(),
}));

const { api } = await import('../../lib/api');
const { useSession } = await import('../../components/session-context');

function mockSession(user: Record<string, unknown> | null) {
  vi.mocked(useSession).mockReturnValue({
    user: user as never,
    loading: false,
    reload: vi.fn(),
  });
}

// Игровой цикл как в T&L: якорь 2026-01-01, день 90 мин, ночь 30 мин.
// Ивент 17:00–19:00 UTC накрывает несколько смен фаз.
const GAME_TIME = {
  gameTimeAnchor: '2026-01-01T00:00:00.000Z',
  gameTimeDayMinutes: 90,
  gameTimeNightMinutes: 30,
};

function eventFixture(overrides: Record<string, unknown> = {}) {
  // Дата в текущем месяце, чтобы попала в календарь и «ближайшие».
  const now = new Date();
  const startsAt = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(now.getUTCDate() + 1, 27), 17),
  );
  return {
    id: 'e-1',
    eventTypeId: 'et-1',
    eventTypeName: 'Гильдбосс',
    mode: 'PVE',
    status: 'PLANNED',
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    dkpReward: 10,
    raidLeadId: 'm-rl',
    raidLeadName: 'РЛ',
    place: null,
    notes: null,
    ...overrides,
  };
}

describe('SchedulePage', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith('/events') && path.endsWith('/checkin/me')) {
        // Чек-ин игрока: окно закрыто (ивент в будущем)
        return { phase: 'START', windowState: 'NOT_OPEN_YET', choices: [], status: 'PENDING' };
      }
      if (path.startsWith('/events') && path.endsWith('/checkin/code')) {
        // Код РЛ: окно ещё не открылось
        return {
          phase: 'START',
          windowState: 'NOT_OPEN_YET',
          code: '',
          windowOpensAt: '2026-03-03T16:57:00Z',
          windowClosesAt: '2026-03-03T17:00:00Z',
        };
      }
      if (path.startsWith('/events')) {
        return [eventFixture()];
      }
      if (path === '/event-types') {
        return [{ id: 'et-1', name: 'Гильдбосс' }];
      }
      if (path === '/settings/game-time') {
        return { ...GAME_TIME };
      }
      throw new Error(`unexpected path ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('рядовой видит календарь, ближайшие и карточку ивента, без кнопок управления', async () => {
    mockSession({
      userId: 'u3',
      username: 'test-member',
      memberId: 'm3',
      rank: 'MEMBER',
      isAdmin: false,
    });

    render(<SchedulePage />);

    expect(await screen.findByText('Ближайшие ивенты')).toBeDefined();
    // «Гильдбосс» встречается в option фильтра и в списке ближайших — берём все.
    expect(screen.getAllByText('Гильдбосс').length).toBeGreaterThan(1);
    expect(screen.getByText(/РЛ: РЛ · 10 ДКП/)).toBeDefined();
    expect(screen.getAllByText('→').length).toBeGreaterThan(0);
    expect(screen.queryByText('Начать ивент')).toBeNull();
    expect(screen.queryByText('Отменить')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Создать ивент' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Создать серию' })).toBeNull();
  });

  it('офицер управляет расписанием, но не видит коды и кнопки проведения', async () => {
    mockSession({
      userId: 'u2',
      username: 'test-officer',
      memberId: 'm2',
      rank: 'OFFICER',
      isAdmin: false,
    });

    render(<SchedulePage />);

    // Ждём загрузки списка, затем кликаем по «Гильдбосс» в ближайших.
    await screen.findByText('Ближайшие ивенты');
    await screen.findByText(/РЛ: РЛ · 10 ДКП/);
    expect(screen.getByRole('button', { name: 'Создать ивент' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Создать ивент' })).toBeDefined();
    const mentions = screen.getAllByText('Гильдбосс');
    mentions[mentions.length - 1]!.click();
    expect(await screen.findByText('Фазы игрового времени на длительность ивента:')).toBeDefined();
    expect(screen.queryByText('Начать ивент')).toBeNull();
    expect(api).not.toHaveBeenCalledWith('/events/e-1/checkin/code');
    expect(screen.getByText('Отменить')).toBeDefined();
    // Плата показана с пометкой фиксации (решение 1)
    expect(screen.getByText('10 (фиксирована при создании)')).toBeDefined();
  });

  it('непривязанному — подсказка про привязку, запросов нет', async () => {
    mockSession({ userId: 'u4', username: 'stranger', memberId: null, rank: null, isAdmin: false });

    render(<SchedulePage />);

    expect(await screen.findByText(/отправьте заявку на привязку ника/)).toBeDefined();
    expect(api).not.toHaveBeenCalled();
  });

  it.each(['MEMBER', 'OFFICER'])(
    'назначенный РЛ с рангом %s видит проведение своего ивента',
    async (rank) => {
      mockSession({ userId: 'rl', username: 'РЛ', memberId: 'm-rl', rank, isAdmin: false });
      render(<SchedulePage />);
      await screen.findByText(/РЛ: РЛ · 10 ДКП/);
      const mentions = screen.getAllByText('Гильдбосс');
      mentions[mentions.length - 1]!.click();
      expect(await screen.findByText('Начать ивент')).toBeDefined();
      await waitFor(() => expect(api).toHaveBeenCalledWith('/events/e-1/checkin/code'));
      if (rank === 'MEMBER')
        expect(screen.queryByRole('button', { name: 'Создать ивент' })).toBeNull();
    },
  );
});
