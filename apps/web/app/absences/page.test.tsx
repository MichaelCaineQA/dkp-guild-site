import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AbsencesPage from './page';

/** Мокаем api-клиент и сессию: страница отсутствий — UI над /absences. */
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

const MINE = [
  {
    id: 'a-1',
    memberId: 'm-3',
    memberName: 'ТестРядовой',
    dateFrom: '2026-03-20T00:00:00.000Z',
    dateTo: '2026-03-21T00:00:00.000Z',
    reason: 'Отпуск',
    status: 'ACTIVE',
    seenBy: ['m-off'],
  },
];

const ALL = [
  ...MINE,
  {
    id: 'a-2',
    memberId: 'm-4',
    memberName: 'ТестРядовой2',
    dateFrom: '2026-03-25T00:00:00.000Z',
    dateTo: '2026-03-25T00:00:00.000Z',
    reason: 'Работа',
    status: 'ACTIVE',
    seenBy: [],
  },
];

describe('AbsencesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/absences/mine') {
        return [...MINE];
      }
      if (path === '/absences') {
        return ALL.map((row) => ({ ...row }));
      }
      throw new Error(`unexpected path ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('рядовый видит форму, свои заявки, но не список гильдии', async () => {
    mockSession({
      userId: 'u3',
      username: 'test-member',
      memberId: 'm-3',
      rank: 'MEMBER',
      isAdmin: false,
    });

    render(<AbsencesPage />);

    expect(await screen.findByText('Подать заявку')).toBeDefined();
    expect(await screen.findByText('Отпуск')).toBeDefined();
    expect(screen.getByText('1 видели')).toBeDefined(); // «Увидели» в своей заявке
    expect(screen.getByText('Отменить')).toBeDefined();
    expect(screen.queryByText('Все заявки гильдии')).toBeNull();
    expect(api).not.toHaveBeenCalledWith('/absences');
  });

  it('глава видит и список всех заявок с кнопкой «Увидел» (офицер — нет, решение владельца)', async () => {
    mockSession({
      userId: 'u1',
      username: 'test-leader',
      memberId: 'm-off',
      rank: 'GUILD_LEADER',
      isAdmin: false,
    });

    render(<AbsencesPage />);

    expect(await screen.findByText('Все заявки гильдии')).toBeDefined();
    expect(screen.getByText('Работа')).toBeDefined();
    expect(screen.getByText('Увидел')).toBeDefined(); // непросмотренная заявка
    expect(screen.getByText('✓ Увидено')).toBeDefined(); // уже видел
  });

  it('непривязанному — подсказка про привязку', async () => {
    mockSession({ userId: 'u4', username: 'stranger', memberId: null, rank: null, isAdmin: false });

    render(<AbsencesPage />);

    expect(await screen.findByText(/заявку на привязку ника/)).toBeDefined();
    expect(api).not.toHaveBeenCalled();
  });
  it('резервный админ читает общий список без запроса чужих заявок как своих', async () => {
    mockSession({
      userId: 'admin:root',
      username: 'Админ',
      memberId: null,
      rank: null,
      isAdmin: true,
    });
    render(<AbsencesPage />);
    expect(await screen.findByText('Все заявки гильдии')).toBeDefined();
    expect(api).toHaveBeenCalledWith('/absences');
    expect(api).not.toHaveBeenCalledWith('/absences/mine');
    expect(screen.queryByRole('button', { name: 'Подать' })).toBeNull();
  });
  it('отправляет точный интервал через полночь в UTC', async () => {
    mockSession({
      userId: 'u',
      username: 'Игрок',
      memberId: 'm-3',
      rank: 'MEMBER',
      isAdmin: false,
    });
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === '/absences' && init?.method === 'POST') return { id: 'new' };
      if (path === '/absences/mine') return [];
      throw new Error(`unexpected path ${path}`);
    });
    render(<AbsencesPage />);
    fireEvent.change(screen.getByLabelText('Режим'), { target: { value: 'interval' } });
    fireEvent.change(screen.getByLabelText('С'), { target: { value: '2026-12-10' } });
    fireEvent.change(screen.getByLabelText('По (необязательно)'), {
      target: { value: '2026-12-11' },
    });
    fireEvent.change(screen.getByLabelText('Время начала'), { target: { value: '23:30' } });
    fireEvent.change(screen.getByLabelText('Время окончания'), { target: { value: '01:00' } });
    fireEvent.change(screen.getByLabelText('Причина (видна вам и руководству)'), {
      target: { value: 'Работа' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Подать' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/absences',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            dateFrom: new Date('2026-12-10T23:30').toISOString(),
            dateTo: new Date('2026-12-11T01:00').toISOString(),
            allDay: false,
            reason: 'Работа',
          }),
        }),
      ),
    );
  });
});
