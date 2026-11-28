import type { WeekEvent } from '@dkp/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function eventFixture({
  startsAt = new Date(2026, 0, 6, 17).toISOString(),
  ...overrides
}: Partial<WeekEvent> = {}): WeekEvent {
  return {
    id: 'e-1',
    name: '',
    eventTypeId: 'et-1',
    eventTypeName: 'Гильдбосс',
    mode: 'PVE',
    status: 'PLANNED',
    startsAt,
    endsAt: new Date(+new Date(startsAt) + 2 * 60 * 60 * 1000).toISOString(),
    dkpReward: 10,
    raidLeadId: 'm-rl',
    raidLeadName: 'РЛ',
    scope: 'GUILD',
    kpId: null,
    packId: null,
    scopeName: 'Вся гильдия',
    place: null,
    notes: null,
    invitedCount: 12,
    attendingCount: 10,
    canDecline: false,
    ...overrides,
  };
}

describe('SchedulePage', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date(2026, 0, 5, 12));
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.endsWith('/roster')) return [];
      if (path.endsWith('/participation'))
        return {
          invited: true,
          attending: true,
          canDecline: true,
          canAttend: true,
          absences: [],
          deadlineAt: '2027-01-01T00:00:00Z',
        };
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
      if (path.startsWith('/schedule/week')) return [eventFixture()];
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
    vi.useRealTimers();
  });

  it('рядовой видит неделю, счётчик и подсказку выбора, без кнопок управления', async () => {
    mockSession({
      userId: 'u3',
      username: 'test-member',
      memberId: 'm3',
      rank: 'MEMBER',
      isAdmin: false,
      blocked: false,
    });

    render(<SchedulePage />);

    expect(
      await screen.findByRole('button', { name: /10\s*\/12 · пойдут \/ приглашены/ }),
    ).toBeDefined();
    // «Гильдбосс» встречается в option фильтра и в списке ближайших — берём все.
    expect(screen.getAllByText('Гильдбосс').length).toBeGreaterThan(1);
    expect(screen.getByText('Выберите событие из списка')).toBeDefined();
    expect(screen.getByText(/РЛ: РЛ · 10 ДКП/)).toBeDefined();
    expect(screen.getAllByText('→').length).toBeGreaterThan(0);
    expect(screen.queryByText('Начать ивент')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Создать ивент' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Создать серию' })).toBeNull();
  });

  it('офицер без назначения РЛ видит управление и чек-ин в карточке ивента', async () => {
    mockSession({
      userId: 'u2',
      username: 'test-officer',
      memberId: 'm2',
      rank: 'OFFICER',
      isAdmin: false,
      blocked: false,
    });

    render(<SchedulePage />);

    // Ждём загрузки списка, затем кликаем по «Гильдбосс» в ближайших.
    await screen.findByRole('button', { name: /10\s*\/12 · пойдут \/ приглашены/ });
    await screen.findByText(/РЛ: РЛ · 10 ДКП/);
    expect(screen.getByRole('button', { name: 'Создать ивент' })).toBeDefined();
    const mentions = screen.getAllByText('Гильдбосс');
    mentions[mentions.length - 1]!.click();
    expect(await screen.findByText('Фазы игрового времени на длительность ивента:')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Начать ивент' })).toBeDefined();
    expect(api).toHaveBeenCalledWith('/events/e-1/checkin/code');
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

  it('группирует события по локальным дням и сортирует их по времени начала', async () => {
    mockSession({ userId: 'u', memberId: 'm3', rank: 'MEMBER', isAdmin: false });
    const mockApi = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path) => {
      if (!path.startsWith('/schedule/week')) return mockApi(path);
      return [
        eventFixture({
          id: 'sunday',
          name: 'Осада',
          startsAt: new Date(2026, 0, 11, 23, 30).toISOString(),
        }),
        eventFixture({
          id: 'late',
          name: 'Вечерний сбор',
          startsAt: new Date(2026, 0, 5, 21).toISOString(),
        }),
        eventFixture({ id: 'finished', name: 'Завершённый босс', status: 'FINISHED' }),
        eventFixture({
          id: 'early',
          name: 'Ранний сбор',
          status: 'RUNNING',
          startsAt: new Date(2026, 0, 5, 0, 30).toISOString(),
        }),
      ];
    });

    render(<SchedulePage />);

    const monday = await screen.findByRole('heading', { name: /понедельник, 5 января/i });
    const sunday = screen.getByRole('heading', { name: /воскресенье, 11 января/i });
    const [mondayEvents, sundayEvents] = screen.getAllByRole('list');
    expect(screen.getAllByRole('heading', { level: 2 })).toEqual([monday, sunday]);
    expect(within(mondayEvents).getAllByRole('button')).toEqual([
      screen.getByRole('button', { name: /00:30.*Ранний сбор/ }),
      screen.getByRole('button', { name: /21:00.*Вечерний сбор/ }),
    ]);
    expect(within(sundayEvents).getByRole('button', { name: /23:30.*Осада/ })).toBeDefined();
    expect(screen.queryByText('Завершённый босс')).toBeNull();
  });

  it('показывает пустое состояние недели из завершённых ивентов, доступных в календаре', async () => {
    mockSession({ userId: 'u', memberId: 'm3', rank: 'MEMBER', isAdmin: false });
    const mockApi = vi.mocked(api).getMockImplementation()!;
    const finished = eventFixture({
      name: 'Завершённый босс',
      status: 'FINISHED',
      startsAt: new Date(2026, 0, 13, 17).toISOString(),
      endsAt: new Date(2026, 0, 13, 19).toISOString(),
    });
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.startsWith('/schedule/week?')) {
        const from = new URLSearchParams(path.split('?')[1]).get('from');
        if (from === new Date(2026, 0, 12).toISOString()) return [finished];
      }
      if (path.startsWith('/events?')) return [finished];
      return mockApi(path);
    });

    render(<SchedulePage />);
    await screen.findByText(/РЛ: РЛ · 10 ДКП/);
    fireEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }));

    expect(await screen.findByText('На этой неделе событий нет')).toBeDefined();
    expect(screen.queryByText('Завершённый босс')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Календарь' }));
    await screen.findByTitle(/^Завершённый босс · 17:00/);
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
  it('переключает неделю и календарь, очищает выбранную карточку и показывает пустую неделю', async () => {
    mockSession({ userId: 'u', memberId: 'm3', rank: 'MEMBER', isAdmin: false });
    render(<SchedulePage />);
    await screen.findByRole('button', { name: /10\s*\/12 · пойдут \/ приглашены/ });
    fireEvent.click(screen.getByRole('button', { name: /10\s*\/12/ }));
    expect(await screen.findByText('Фазы игрового времени на длительность ивента:')).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Календарь' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringMatching(/^\/events\?/)));
    expect(screen.queryByText('Фазы игрового времени на длительность ивента:')).toBeNull();
    await screen.findByRole('button', { name: 'Следующий месяц' });
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.startsWith('/schedule/week')) return [];
      if (path === '/event-types') return [];
      if (path === '/settings/game-time') return GAME_TIME;
      return [];
    });
    fireEvent.click(screen.getByRole('button', { name: 'События' }));
    await screen.findByText('На этой неделе событий нет');
    const before = vi
      .mocked(api)
      .mock.calls.filter(([path]) => path.startsWith('/schedule/week'))
      .at(-1)![0];
    fireEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }));
    await waitFor(() => {
      const after = vi
        .mocked(api)
        .mock.calls.filter(([path]) => path.startsWith('/schedule/week'))
        .at(-1)![0];
      expect(after).not.toBe(before);
      const first = new URL(before, 'http://test');
      const second = new URL(after, 'http://test');
      expect(
        +new Date(second.searchParams.get('from')!) - +new Date(first.searchParams.get('from')!),
      ).toBeGreaterThan(6 * 86400000);
    });
  });
});
