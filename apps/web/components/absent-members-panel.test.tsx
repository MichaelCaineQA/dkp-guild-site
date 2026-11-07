import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AbsentMembersPanel } from './absent-members-panel';
import { useSession } from './session-context';
import { api } from '../lib/api';
vi.mock('./session-context', () => ({ useSession: vi.fn() }));
vi.mock('../lib/api', () => ({ api: vi.fn() }));
const row = { id: 'a', memberId: 'm', memberName: 'Игрок', reason: '', seenBy: [] as string[] };
function session(
  rank: 'MEMBER' | 'OFFICER' | 'GUILD_LEADER' | null,
  memberId: string | null = 'head',
  isAdmin = false,
) {
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u', username: 'User', rank, memberId, isAdmin },
    loading: false,
    reload: vi.fn(),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api).mockResolvedValue([row]);
});
afterEach(cleanup);
it.each(['MEMBER', 'OFFICER'] as const)('%s видит причину, без кнопки Увидел', async (rank) => {
  session(rank);
  render(<AbsentMembersPanel eventId="e" eventStartsAt="2027-04-01T00:00:00Z" />);
  await screen.findByText('Игрок');
  expect(screen.getByText(/Без причины/)).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Увидел' })).toBeNull();
});
it('Глава отмечает и получает ту же seenBy, повторная кнопка недоступна', async () => {
  session('GUILD_LEADER');
  let seen = false;
  vi.mocked(api).mockImplementation(async (_path, options) => {
    if (options?.method === 'POST') {
      seen = true;
      return { ok: true };
    }
    return [{ ...row, seenBy: seen ? ['head'] : [] }];
  });
  render(<AbsentMembersPanel eventId="e" eventStartsAt="2027-04-01T00:00:00Z" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Увидел' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/absences/a/seen', { method: 'POST' }));
  expect(
    ((await screen.findByRole('button', { name: '✓ Увидено' })) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it('резервный админ узнаёт свою отметку без игрового профиля', async () => {
  session(null, null, true);
  vi.mocked(api).mockResolvedValue([{ ...row, seenBy: ['system-admin'] }]);
  render(<AbsentMembersPanel eventId="e" eventStartsAt="2027-04-01T00:00:00Z" />);
  expect(
    ((await screen.findByRole('button', { name: '✓ Увидено' })) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it('ошибка записи остаётся видимой, кнопку можно повторить', async () => {
  session('GUILD_LEADER');
  vi.mocked(api).mockImplementation(async (_p, options) => {
    if (options?.method === 'POST') throw new Error('offline');
    return [row];
  });
  render(<AbsentMembersPanel eventId="e" eventStartsAt="2027-04-01T00:00:00Z" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Увидел' }));
  await screen.findByText(/Не удалось отметить/);
  expect((screen.getByRole('button', { name: 'Увидел' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});
