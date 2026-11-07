import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LinkRequestsPage from './page';

vi.mock('../../lib/api', () => ({ api: vi.fn() }));
vi.mock('../../components/session-context', () => ({ useSession: vi.fn() }));
const { api } = await import('../../lib/api');
const { useSession } = await import('../../components/session-context');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue([]);
});
afterEach(cleanup);
const session = (rank: 'MEMBER' | 'OFFICER' | 'GUILD_LEADER' | null, isAdmin = false) => {
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u1', username: 'Тест', memberId: isAdmin ? null : 'm1', rank, isAdmin },
    loading: false,
    reload: vi.fn(),
  });
};
it.each(['MEMBER', 'OFFICER'] as const)(
  '%s не запрашивает очередь и не видит управление',
  async (rank) => {
    session(rank);
    render(<LinkRequestsPage />);
    expect(await screen.findByText('Раздел доступен Главе и Админу.')).toBeDefined();
    expect(api).not.toHaveBeenCalled();
    expect(screen.queryByText('Принять в гильдию')).toBeNull();
  },
);
it.each([false, true])('Глава/резервный Админ загружает очередь, isAdmin=%s', async (isAdmin) => {
  session(isAdmin ? null : 'GUILD_LEADER', isAdmin);
  render(<LinkRequestsPage />);
  expect(await screen.findByText('Новых заявок нет')).toBeDefined();
  expect(api).toHaveBeenCalledWith('/auth/link-requests');
});
