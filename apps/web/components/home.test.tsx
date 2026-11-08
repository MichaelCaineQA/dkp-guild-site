import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import HomePage from './home';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: vi.fn(), API_URL_VALUE: '/api' }));
vi.mock('./session-context', () => ({ useSession: () => ({ user: null, loading: false }) }));
vi.mock('./dashboard', () => ({ DashboardScreen: () => null }));
vi.mock('./onboarding', () => ({ OnboardingScreen: () => null }));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('при отложенном Discord показывает пояснение и сохраняет вход администратора', async () => {
  vi.mocked(api).mockResolvedValue({ discord: false });
  render(<HomePage />);
  await screen.findByText('Вход через Discord пока не настроен.');
  expect(screen.queryByRole('link', { name: 'Связать с Discord' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Вход для администратора' }));
  expect(screen.getByLabelText('Логин администратора')).toBeTruthy();
  expect(screen.getByLabelText('Пароль')).toBeTruthy();
});

it('включает Discord по ответу API без пересборки и использует общий префикс API', async () => {
  vi.mocked(api).mockResolvedValue({ discord: true });
  render(<HomePage />);
  expect(
    (await screen.findByRole('link', { name: 'Связать с Discord' })).getAttribute('href'),
  ).toBe('/api/auth/discord');
});

it('ошибка API не выдаётся за отключённый Discord и не блокирует форму админа', async () => {
  vi.mocked(api).mockRejectedValue(new Error('offline'));
  render(<HomePage />);
  expect((await screen.findByRole('alert')).textContent).toContain('Не удалось проверить');
  expect(screen.queryByText('Вход через Discord пока не настроен.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Вход для администратора' }));
  expect(screen.getByLabelText('Логин администратора')).toBeTruthy();
});
