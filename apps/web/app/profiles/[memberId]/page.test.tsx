import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProfilePage from './page';
import { api } from '../../../lib/api';
import { useSession } from '../../../components/session-context';
vi.mock('../../../lib/api', () => ({ api: vi.fn() }));
vi.mock('../../../components/session-context', () => ({ useSession: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ memberId: 'm1' }) }));
const profile = {
  id: 'm1',
  nickname: 'Алистер',
  discord: 'alister',
  rank: 'MEMBER',
  combatRole: 'DPS',
  balance: 75,
  recentEntries: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u1', username: 'alister', memberId: 'm1', rank: 'MEMBER', isAdmin: false },
    loading: false,
    reload: vi.fn(),
  });
  vi.mocked(api).mockImplementation(async (_path, init) =>
    init?.method === 'PATCH' ? { ok: true } : profile,
  );
});
afterEach(cleanup);

it('непривязанному аккаунту не загружает профиль', () => {
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u2', username: 'guest', memberId: null, rank: null, isAdmin: false },
    loading: false,
    reload: vi.fn(),
  });
  render(<ProfilePage />);
  expect(screen.getByText(/Профили доступны только членам/)).toBeDefined();
  expect(api).not.toHaveBeenCalled();
});

it('показывает профиль, баланс и сохраняет свою роль с комментарием', async () => {
  render(<ProfilePage />);
  expect(await screen.findByText('Профиль: Алистер')).toBeDefined();
  expect(screen.getByText('75')).toBeDefined();
  expect(screen.getByText('Операций пока нет')).toBeDefined();
  fireEvent.change(screen.getByLabelText('Роль в бою'), { target: { value: 'HEALER' } });
  fireEvent.change(screen.getByLabelText('Комментарий'), {
    target: { value: 'Перешёл на лечение' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить роль' }));
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Роль в бою сохранена');
  expect(api).toHaveBeenCalledWith('/profiles/m1', {
    method: 'PATCH',
    body: JSON.stringify({ combatRole: 'HEALER', comment: 'Перешёл на лечение' }),
  });
});

it('в чужом профиле нет формы самостоятельного редактирования', async () => {
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u2', username: 'other', memberId: 'm2', rank: 'MEMBER', isAdmin: false },
    loading: false,
    reload: vi.fn(),
  });
  render(<ProfilePage />);
  await screen.findByText('Профиль: Алистер');
  expect(screen.queryByText('Изменить свою роль в бою')).toBeNull();
});

it('показывает 404 и сохраняет поля при ошибке изменения роли', async () => {
  vi.mocked(api).mockRejectedValueOnce({ status: 404 });
  const first = render(<ProfilePage />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Игрок не найден');
  first.unmount();
  render(<ProfilePage />);
  await screen.findByText('Профиль: Алистер');
  vi.mocked(api).mockRejectedValueOnce({ status: 500 });
  fireEvent.change(screen.getByLabelText('Роль в бою'), { target: { value: 'TANK' } });
  fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'Новая роль' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить роль' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Не удалось сохранить'),
  );
  expect((screen.getByLabelText('Комментарий') as HTMLInputElement).value).toBe('Новая роль');
});
