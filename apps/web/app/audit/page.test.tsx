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

it('рядовой не делает запросов к закрытому журналу', () => {
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u2', username: 'Игрок', memberId: 'm2', rank: 'MEMBER', isAdmin: false },
    loading: false,
    reload: vi.fn(),
  });
  render(<AuditPage />);
  expect(screen.getByText(/Журнал доступен офицерам/)).toBeDefined();
  expect(api).not.toHaveBeenCalled();
});

it('показывает журнал, фильтрует и сбрасывает страницу при смене фильтра', async () => {
  render(<AuditPage />);
  expect(await screen.findByText('Назначен офицером')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Далее' }));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/audit?limit=50&offset=50'));
  fireEvent.change(screen.getByLabelText('Кто'), { target: { value: 'm1' } });
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/audit?limit=50&offset=0&actorMemberId=m1'),
  );
  fireEvent.change(screen.getByLabelText('Действие'), { target: { value: 'ROLE_CHANGE' } });
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      '/audit?limit=50&offset=0&actorMemberId=m1&action=ROLE_CHANGE',
    ),
  );
});

it('показывает ошибку загрузки', async () => {
  vi.mocked(api).mockRejectedValue(new Error('offline'));
  render(<AuditPage />);
  expect(await screen.findByRole('alert')).toBeDefined();
});
