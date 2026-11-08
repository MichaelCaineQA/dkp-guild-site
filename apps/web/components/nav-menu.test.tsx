import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NavMenu } from './nav-menu';
import { useSession } from './session-context';
import { usePathname } from 'next/navigation';
import type { AnchorHTMLAttributes } from 'react';
vi.mock('next/link', () => ({
  default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({ usePathname: vi.fn() }));
vi.mock('./session-context', () => ({ useSession: vi.fn() }));
function session(rank: 'MEMBER' | 'OFFICER' | 'GUILD_LEADER' | null, isAdmin = false) {
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u', username: 'Тест', memberId: isAdmin ? null : 'm', rank, isAdmin },
    loading: false,
    reload: vi.fn(),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  session('MEMBER');
  vi.mocked(usePathname).mockReturnValue('/schedule');
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(cleanup);
it('по умолчанию свёрнуто, активный пункт отмечен, недоступные разделы скрыты', () => {
  render(<NavMenu />);
  expect(screen.getByRole('complementary').getAttribute('data-expanded')).toBe('false');
  expect(screen.getByRole('link', { name: 'Расписание' }).getAttribute('aria-current')).toBe(
    'page',
  );
  expect(screen.queryByRole('link', { name: 'Настройки' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Лог действий' })).toBeDefined();
});
it('раскрытие сохраняется при смене страницы и новом монтировании', async () => {
  const view = render(<NavMenu />);
  fireEvent.click(screen.getByRole('button', { name: 'Развернуть меню' }));
  expect(localStorage.getItem('dkp.navigation.expanded')).toBe('true');
  vi.mocked(usePathname).mockReturnValue('/dkp');
  view.rerender(<NavMenu />);
  expect(screen.getByRole('complementary').getAttribute('data-expanded')).toBe('true');
  view.unmount();
  render(<NavMenu />);
  await waitFor(() =>
    expect(screen.getByRole('complementary').getAttribute('data-expanded')).toBe('true'),
  );
});
it('мобильное меню закрывается по отмене и не меняет desktop-предпочтение', () => {
  render(<NavMenu />);
  fireEvent.click(screen.getByRole('button', { name: 'Открыть меню' }));
  const dialog = screen.getByRole('dialog', { name: 'Меню разделов' });
  expect(within(dialog).getByRole('link', { name: 'Дашборд' })).toBeDefined();
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(localStorage.getItem('dkp.navigation.expanded')).toBeNull();
});
it('Офицер видит лог, а настройки — только Глава и резервный Админ', () => {
  session('OFFICER');
  const view = render(<NavMenu />);
  expect(screen.getByRole('link', { name: 'Лог действий' })).toBeDefined();
  expect(screen.queryByRole('link', { name: 'Настройки' })).toBeNull();
  session(null, true);
  view.rerender(<NavMenu />);
  expect(screen.getByRole('link', { name: 'Настройки' })).toBeDefined();
});
