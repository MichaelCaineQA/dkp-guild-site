import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RulesPage from './page';
import { api } from '../../../lib/api';
import { useSession } from '../../../components/session-context';
vi.mock('../../../lib/api', () => ({ api: vi.fn() }));
vi.mock('../../../components/session-context', () => ({ useSession: vi.fn() }));
vi.mock('next/navigation', () => ({ useParams: () => ({ slug: 'guild-rules' }) }));
const current = {
  slug: 'guild-rules',
  title: 'Правила гильдии',
  contentMd: '# Участие ✅',
  version: 2,
  updatedAt: '2026-11-06T12:00:00Z',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u1', username: 'Глава', memberId: 'm1', rank: 'GUILD_LEADER', isAdmin: false },
    loading: false,
    reload: vi.fn(),
  });
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (init?.method === 'PUT')
      return { ...current, version: 3, contentMd: JSON.parse(init.body as string).contentMd };
    if (init?.method === 'POST') return { ...current, version: 3, contentMd: '# Прежний текст' };
    if (path.endsWith('/versions'))
      return [
        { version: 2, createdAt: current.updatedAt },
        { version: 1, createdAt: current.updatedAt },
      ];
    if (path.endsWith('/versions/1'))
      return { version: 1, contentMd: '# Прежний текст', createdAt: current.updatedAt };
    return current;
  });
});
afterEach(cleanup);

it('офицер читает правила без кнопки редактирования', async () => {
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u2', username: 'Офицер', memberId: 'm2', rank: 'OFFICER', isAdmin: false },
    loading: false,
    reload: vi.fn(),
  });
  render(<RulesPage />);
  expect(await screen.findByRole('heading', { name: 'Участие ✅' })).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Редактировать' })).toBeNull();
});

it('непривязанный аккаунт не запрашивает правила', () => {
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u2', username: 'Новый', memberId: null, rank: null, isAdmin: false },
    loading: false,
    reload: vi.fn(),
  });
  render(<RulesPage />);
  expect(screen.getByText(/Правила доступны членам/)).toBeDefined();
  expect(api).not.toHaveBeenCalled();
});

it('глава редактирует с предпросмотром и публикует новую версию', async () => {
  render(<RulesPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Редактировать' }));
  fireEvent.change(screen.getByLabelText('Текст правил'), {
    target: { value: '# Новая редакция' },
  });
  expect(screen.getByRole('heading', { name: 'Новая редакция' })).toBeDefined();
  fireEvent.change(screen.getByLabelText('Комментарий'), {
    target: { value: 'Уточнили формулировку' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Опубликована версия 3');
  expect(api).toHaveBeenCalledWith('/rules/guild-rules', {
    method: 'PUT',
    body: JSON.stringify({
      contentMd: '# Новая редакция',
      expectedVersion: 2,
      comment: 'Уточнили формулировку',
    }),
  });
});

it('просматривает и восстанавливает предыдущую версию новой публикацией', async () => {
  render(<RulesPage />);
  await screen.findByRole('button', { name: 'Редактировать' });
  fireEvent.change(screen.getByLabelText('Версия'), { target: { value: '1' } });
  expect(await screen.findByRole('heading', { name: 'Прежний текст' })).toBeDefined();
  fireEvent.change(screen.getByLabelText('Причина восстановления'), {
    target: { value: 'Возвращаем прежний текст' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Восстановить версию 1' }));
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Опубликована версия 3');
  expect(api).toHaveBeenCalledWith('/rules/guild-rules/restore', {
    method: 'POST',
    body: JSON.stringify({
      sourceVersion: 1,
      expectedVersion: 2,
      comment: 'Возвращаем прежний текст',
    }),
  });
});

it('конфликт сохраняет черновик и требует явного выбора актуальной основы', async () => {
  render(<RulesPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Редактировать' }));
  fireEvent.change(screen.getByLabelText('Текст правил'), { target: { value: '# Мой черновик' } });
  fireEvent.change(screen.getByLabelText('Комментарий'), {
    target: { value: 'Новая формулировка' },
  });
  vi.mocked(api).mockRejectedValueOnce({ status: 409 });
  fireEvent.click(screen.getByRole('button', { name: 'Опубликовать' }));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Текст правил') as HTMLTextAreaElement).value).toBe(
    '# Мой черновик',
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Опубликовать' }).hasAttribute('disabled')).toBe(
      true,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Продолжить с актуальной версией' }));
  expect(screen.getByRole('button', { name: 'Опубликовать' }).hasAttribute('disabled')).toBe(false);
});
