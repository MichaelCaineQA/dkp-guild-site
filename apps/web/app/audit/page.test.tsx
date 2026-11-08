import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AuditPage from './page';
import { api } from '../../lib/api';
import { useSession } from '../../components/session-context';
vi.mock('../../lib/api', () => ({ api: vi.fn() }));
vi.mock('../../components/session-context', () => ({ useSession: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u1', username: 'Офицер', memberId: 'm1', rank: 'OFFICER', isAdmin: false },
    loading: false,
    reload: vi.fn(),
  });
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/members') return [{ id: 'm1', nickname: 'Глава' }];
    if (path === '/audit/actions') return ['ROLE_CHANGE'];
    return {
      entries: [
        {
          id: 'a1',
          actorMemberId: 'm1',
          actorName: 'Глава',
          action: 'ROLE_CHANGE',
          entityType: 'Member',
          entityId: 'm2',
          comment: 'Назначен офицером',
          createdAt: '2026-11-06T12:00:00Z',
        },
      ],
      total: 100,
    };
  });
});
afterEach(cleanup);

it('рядовой открывает личный журнал', async () => {
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u2', username: 'Игрок', memberId: 'm2', rank: 'MEMBER', isAdmin: false },
    loading: false,
    reload: vi.fn(),
  });
  render(<AuditPage />);
  expect(await screen.findByText('Комментарий: Назначен офицером')).toBeDefined();
  expect(api).toHaveBeenCalledWith('/audit?limit=50&offset=0');
});

it('показывает журнал, фильтрует и сбрасывает страницу при смене фильтра', async () => {
  render(<AuditPage />);
  expect(await screen.findByText('Комментарий: Назначен офицером')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/audit?limit=50&offset=50'));
  fireEvent.change(screen.getByLabelText('Кто'), { target: { value: 'm1' } });
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/audit?limit=50&offset=0&actorMemberId=m1'),
  );
  fireEvent.change(screen.getByLabelText('Сущность'), { target: { value: 'Member' } });
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/audit?limit=50&offset=0&actorMemberId=m1&entityType=Member'),
  );
});

it('показывает ошибку загрузки', async () => {
  vi.mocked(api).mockRejectedValue(new Error('offline'));
  render(<AuditPage />);
  expect(await screen.findByRole('alert')).toBeDefined();
});

it('лента без ссылок и счётчика, Система, размеры и совместные даты', async () => {
  render(<AuditPage />);
  const feed = await screen.findByRole('list', { name: 'Записи журнала' });
  expect(feed.querySelectorAll('a')).toHaveLength(0);
  expect(screen.queryByText(/Найдено записей/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Записей на странице'), { target: { value: '10' } });
  await waitFor(() => expect(api).toHaveBeenCalledWith('/audit?limit=10&offset=0'));
  fireEvent.change(screen.getByLabelText('Кто'), { target: { value: '__system__' } });
  fireEvent.change(screen.getByLabelText('Сущность'), { target: { value: 'Event' } });
  fireEvent.change(screen.getByLabelText('С'), { target: { value: '2026-11-01T12:00' } });
  fireEvent.change(screen.getByLabelText('По'), { target: { value: '2026-11-07T12:00' } });
  await waitFor(() => {
    const path = vi
      .mocked(api)
      .mock.calls.filter(([p]) => p.startsWith('/audit?'))
      .at(-1)![0];
    const q = new URL(path, 'http://test').searchParams;
    expect(Object.fromEntries(q)).toEqual({
      limit: '10',
      offset: '0',
      system: 'true',
      entityType: 'Event',
      from: new Date('2026-11-01T12:00').toISOString(),
      to: new Date('2026-11-07T12:00').toISOString(),
    });
  });
  fireEvent.change(screen.getByLabelText('Записей на странице'), { target: { value: '100' } });
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.stringMatching(/^\/audit\?limit=100&offset=0&system=true&entityType=Event/),
    ),
  );
});
it('запись без автора показывает Систему', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/members'
      ? []
      : {
          entries: [
            {
              id: 'sys',
              actorName: null,
              entityType: 'Event',
              entityId: 'e',
              action: 'EVENT_STATUS_CHANGE',
              comment: 'Автоматическое завершение',
              createdAt: '2026-11-07T12:00:00Z',
            },
          ],
          total: 1,
        },
  );
  render(<AuditPage />);
  const feed = await screen.findByRole('list', { name: 'Записи журнала' });
  expect(feed.textContent).toContain('Система');
});
