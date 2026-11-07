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
  weapons: ['STAFF', 'WAND'],
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

it('старый профиль заполняет оружия без смены роли', async () => {
  vi.mocked(api).mockResolvedValueOnce({ ...profile, weapons: [] });
  render(<ProfilePage />);
  await screen.findByText('Профиль: Алистер');
  expect(screen.getByText(/Старые данные сохранены/)).toBeDefined();
  fireEvent.change(screen.getByLabelText('Первое оружие'), { target: { value: 'SPEAR' } });
  fireEvent.change(screen.getByLabelText('Второе оружие'), { target: { value: 'DAGGERS' } });
  fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'Заполняю оружия' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }));
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Профиль сохранён');
  expect(api).toHaveBeenCalledWith('/profiles/m1', {
    method: 'PATCH',
    body: JSON.stringify({
      combatRole: 'DPS',
      weapons: ['SPEAR', 'DAGGERS'],
      avatar: null,
      avatarColor: null,
      comment: 'Заполняю оружия',
    }),
  });
});

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
  fireEvent.change(screen.getByLabelText('Роль'), { target: { value: 'HEALER' } });
  fireEvent.change(screen.getByLabelText('Комментарий'), {
    target: { value: 'Перешёл на лечение' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }));
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Профиль сохранён');
  expect(api).toHaveBeenCalledWith('/profiles/m1', {
    method: 'PATCH',
    body: JSON.stringify({
      combatRole: 'HEALER',
      weapons: ['STAFF', 'WAND'],
      avatar: null,
      avatarColor: null,
      comment: 'Перешёл на лечение',
    }),
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
  expect(screen.queryByText('Изменить профиль')).toBeNull();
});

it('сохраняет выбранный аватар и уведомляет шапку', async () => {
  const changed = vi.fn();
  window.addEventListener('profile:changed', changed);
  render(<ProfilePage />);
  await screen.findByText('Профиль: Алистер');
  fireEvent.click(screen.getByLabelText('Океан'));
  fireEvent.click(screen.getByLabelText('Синий'));
  fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'Новый аватар' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }));
  await screen.findByRole('status');
  expect(api).toHaveBeenCalledWith(
    '/profiles/m1',
    expect.objectContaining({ body: expect.stringContaining('"avatar":"OCEAN"') }),
  );
  expect(changed).toHaveBeenCalledOnce();
  expect(api).toHaveBeenCalledWith(
    '/profiles/m1',
    expect.objectContaining({ body: expect.stringContaining('"avatarColor":"BLUE"') }),
  );
  window.removeEventListener('profile:changed', changed);
});

it('показывает 404 и сохраняет поля при ошибке изменения роли', async () => {
  vi.mocked(api).mockRejectedValueOnce({ status: 404 });
  const first = render(<ProfilePage />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Игрок не найден');
  first.unmount();
  render(<ProfilePage />);
  await screen.findByText('Профиль: Алистер');
  vi.mocked(api).mockRejectedValueOnce({ status: 500 });
  fireEvent.change(screen.getByLabelText('Роль'), { target: { value: 'TANK' } });
  fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'Новая роль' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить профиль' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Не удалось сохранить'),
  );
  expect((screen.getByLabelText('Комментарий') as HTMLInputElement).value).toBe('Новая роль');
});
