import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RosterPage from './page';

/** Мокаем api-клиент и сессию: страница состава — чистый UI над /members. */
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

describe('RosterPage', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession({
      userId: 'u1',
      username: 'test-member',
      memberId: 'm1',
      rank: 'MEMBER',
      isAdmin: false,
    });
  });

  it('рядовой видит таблицу состава с фильтрами, но не форму добавления', async () => {
    vi.mocked(api).mockResolvedValue([
      { id: 'm-1', nickname: 'Alpha', rank: 'OFFICER', combatRole: 'HEALER', discord: 'alpha' },
      { id: 'm-2', nickname: 'Beta', rank: 'MEMBER', combatRole: null, discord: null },
    ]);

    render(<RosterPage />);

    expect(await screen.findByText('Alpha')).toBeDefined();
    expect(screen.getByText('Beta')).toBeDefined();
    expect(screen.getAllByText('Офицер').length).toBeGreaterThan(0); // фильтр + ячейка
    expect(screen.getAllByText('Хил').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—')).toHaveLength(2); // у Beta: роль и Discord не указаны
    expect(screen.getByText('все ранги')).toBeDefined();
    expect(screen.getByText('все роли')).toBeDefined();
    expect(screen.queryByText('Добавить члена')).toBeNull();
  });

  it('Глава видит заявки вместо ручного добавления', async () => {
    mockSession({
      userId: 'u2',
      username: 'test-leader',
      memberId: 'm-2',
      rank: 'GUILD_LEADER',
      isAdmin: false,
    });
    vi.mocked(api).mockResolvedValue([]);

    render(<RosterPage />);

    expect(await screen.findByText('Заявки')).toBeDefined();
    expect(screen.queryByText('Добавить члена')).toBeNull();
  });

  it('не для членов гильдии — подсказка про привязку', async () => {
    mockSession({ userId: 'u3', username: 'stranger', memberId: null, rank: null, isAdmin: false });
    vi.mocked(api).mockResolvedValue([]);

    render(<RosterPage />);

    await waitFor(() => {
      expect(screen.getByText(/заявку на привязку ника/)).toBeDefined();
    });
    expect(api).not.toHaveBeenCalled();
  });

  it('Офицер читает состав без формы добавления и правки игроков', async () => {
    mockSession({
      userId: 'off',
      username: 'Офицер',
      memberId: 'off',
      rank: 'OFFICER',
      isAdmin: false,
    });
    vi.mocked(api).mockResolvedValue([
      {
        id: 'm1',
        nickname: 'Alpha',
        rank: 'MEMBER',
        combatRole: 'DPS',
        weapons: [],
        discord: null,
      },
    ]);
    render(<RosterPage />);
    expect(await screen.findByText('Alpha')).toBeDefined();
    expect(screen.queryByText('Добавить члена')).toBeNull();
  });

  it('Админ начисляет выбранному участнику положительную сумму с комментарием', async () => {
    mockSession({
      userId: 'admin:root',
      username: 'Админ',
      memberId: null,
      rank: null,
      isAdmin: true,
    });
    vi.mocked(api).mockImplementation(async (path) =>
      path.startsWith('/members')
        ? [
            {
              id: 'm1',
              nickname: 'Alpha',
              rank: 'MEMBER',
              combatRole: 'DPS',
              weapons: [],
              discord: null,
            },
          ]
        : { id: 'entry' },
    );
    render(<RosterPage />);
    fireEvent.click((await screen.findByText('Alpha')).closest('tr')!);
    fireEvent.change(screen.getByLabelText('Сумма ДКП'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'Помощь' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начислить ДКП' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/dkp/admin-grants',
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('"amount":10') }),
      ),
    );
  });
});
