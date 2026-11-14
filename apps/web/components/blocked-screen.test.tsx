import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockedScreen } from './blocked-screen';
import { useSession } from './session-context';
import { AppShell } from './app-shell';
import { api } from '../lib/api';

vi.mock('next/navigation', () => ({ usePathname: vi.fn() }));
vi.mock('./session-context', () => ({ useSession: vi.fn() }));
vi.mock('../lib/api', () => ({ api: vi.fn(), API_URL_VALUE: '' }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockResolvedValue(undefined as never);
});
afterEach(cleanup);

describe('BlockedScreen (issue #149)', () => {
  it('показывает «врата закрыты» без навигации, кнопка «Выйти» разлогинивает', async () => {
    render(<BlockedScreen />);
    expect(screen.getByText('Гильдия закрыла свои врата для тебя')).toBeTruthy();
    // Ни меню, ни шапки — только сообщение и выход
    expect(document.querySelector('nav')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await waitFor(() =>
      expect(vi.mocked(api)).toHaveBeenCalledWith('/auth/logout', { method: 'POST' }),
    );
  });
});

describe('AppShell для заблокированного', () => {
  it('любая страница заменяется экраном блокировки', () => {
    vi.mocked(useSession).mockReturnValue({
      user: {
        userId: 'u',
        username: 'Ушедший',
        memberId: 'm',
        rank: 'MEMBER',
        isAdmin: false,
        blocked: true,
      },
      loading: false,
      reload: vi.fn(),
    });
    render(
      <AppShell>
        <p>Секретный контент страницы</p>
      </AppShell>,
    );
    expect(screen.getByText('Гильдия закрыла свои врата для тебя')).toBeTruthy();
    expect(screen.queryByText('Секретный контент страницы')).toBeNull();
  });
});
