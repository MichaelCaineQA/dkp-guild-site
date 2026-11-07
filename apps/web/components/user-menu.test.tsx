import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UserMenu } from './user-menu';
import { useSession } from './session-context';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
vi.mock('./session-context', () => ({ useSession: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: vi.fn() }));
vi.mock('../lib/api', () => ({ api: vi.fn() }));
const reload = vi.fn(async () => {});
const replace = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u', username: 'discord-login', memberId: 'm', rank: 'MEMBER', isAdmin: false },
    loading: false,
    reload,
  });
  vi.mocked(useRouter).mockReturnValue({ replace } as never);
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/auth/logout'
      ? { ok: true }
      : { memberId: 'm', memberName: 'ИгровойНик', balance: 15 },
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);
it('шапка показывает игровой ник и некликабельный баланс из журнала', async () => {
  render(<UserMenu />);
  expect((await screen.findByRole('link', { name: 'Мой профиль' })).textContent).toContain(
    'ИгровойНик',
  );
  const balance = screen.getByLabelText('Баланс ДКП');
  expect(balance.textContent).toContain('15 ДКП');
  expect(balance.closest('a')).toBeNull();
  expect(screen.getByText('Рядовой')).toBeDefined();
});
it('до подтверждения выхода запрос не отправляется; Отмена сохраняет сессию', async () => {
  render(<UserMenu />);
  await screen.findByText('ИгровойНик');
  fireEvent.click(screen.getByText('Выход'));
  expect(screen.getByRole('dialog')).toBeDefined();
  expect(api).not.toHaveBeenCalledWith('/auth/logout', expect.anything());
  fireEvent.click(screen.getByText('Отмена'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(reload).not.toHaveBeenCalled();
});
it('подтверждённый выход обновляет сессию и ведёт на приветствие', async () => {
  render(<UserMenu />);
  await screen.findByText('ИгровойНик');
  fireEvent.click(screen.getByText('Выход'));
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Выйти'));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  expect(api).toHaveBeenCalledWith('/auth/logout', { method: 'POST' });
  expect(reload).toHaveBeenCalled();
});
it('ошибка выхода остаётся в модалке и не скрывает вошедшего игрока', async () => {
  render(<UserMenu />);
  await screen.findByText('ИгровойНик');
  vi.mocked(api).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByText('Выход'));
  fireEvent.click(within(screen.getByRole('dialog')).getByText('Выйти'));
  expect(await screen.findByRole('alert')).toBeDefined();
  expect(screen.getByRole('dialog')).toBeDefined();
  expect(reload).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});
it('событие начисления ДКП обновляет сумму', async () => {
  render(<UserMenu />);
  await screen.findByText('ИгровойНик');
  vi.mocked(api).mockResolvedValue({ memberId: 'm', memberName: 'ИгровойНик', balance: 20 });
  fireEvent(window, new Event('dkp:changed'));
  await waitFor(() => expect(screen.getByLabelText('Баланс ДКП').textContent).toContain('20 ДКП'));
});
it('резервный Админ без Member не запрашивает игровой баланс', () => {
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'admin:a', username: 'a', memberId: null, rank: null, isAdmin: true },
    loading: false,
    reload,
  });
  render(<UserMenu />);
  expect(screen.getByText('Админ')).toBeDefined();
  expect(api).not.toHaveBeenCalled();
});
