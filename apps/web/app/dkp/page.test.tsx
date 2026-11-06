import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DkpPage from './page';

vi.mock('../../lib/api', () => ({
  api: vi.fn(),
}));

vi.mock('../../components/session-context', () => ({
  useSession: vi.fn(),
}));

const { api } = await import('../../lib/api');
const { useSession } = await import('../../components/session-context');

function mockSession(user: Record<string, unknown> | null) {
  vi.mocked(useSession).mockReturnValue({
    user: user as never,
    loading: false,
    reload: vi.fn(),
  });
}

const ENTRIES = {
  entries: [
    {
      id: 'd-1',
      memberId: 'm-1',
      memberName: 'Первый',
      type: 'CHECKIN_EARN',
      amount: 5,
      comment: 'Чек-ин старт: код верный',
      eventId: 'e-1',
      createdAt: '2026-03-03T17:00:00.000Z',
    },
    {
      id: 'd-2',
      memberId: 'm-1',
      memberName: 'Первый',
      type: 'ADJUSTMENT',
      amount: -3,
      comment: 'Ошибка прошлого начисления',
      eventId: null,
      createdAt: '2026-03-04T18:00:00.000Z',
    },
  ],
  total: 2,
};

const BALANCES = [
  { memberId: 'm-1', memberName: 'Первый', balance: 2 },
  { memberId: 'm-2', memberName: 'Второй', balance: 0 },
];

const MEMBERS = [
  { id: 'm-1', nickname: 'Первый' },
  { id: 'm-2', nickname: 'Второй' },
];

describe('DkpPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path.startsWith('/dkp/entries')) {
        return { entries: ENTRIES.entries.map((e) => ({ ...e })), total: ENTRIES.total };
      }
      if (path === '/dkp/balances') {
        return BALANCES.map((b) => ({ ...b }));
      }
      if (path === '/members') {
        return MEMBERS.map((m) => ({ ...m }));
      }
      throw new Error(`unexpected path ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('рядовый видит балансы гильдии, свой баланс и цепочку операций', async () => {
    mockSession({
      userId: 'u1',
      username: 'test-member',
      memberId: 'm-1',
      rank: 'MEMBER',
      isAdmin: false,
    });

    render(<DkpPage />);

    expect(await screen.findByText('Балансы гильдии')).toBeDefined();
    // Текст «Ваш баланс: N ДКП» разбит спанами — ищем по подстроке
    expect(screen.getByText(/Ваш баланс/).textContent).toContain('2');
    expect(screen.getAllByText('Первый').length).toBeGreaterThan(0);
    expect(screen.getAllByText('корректировка').length).toBeGreaterThan(0); // бейдж в таблице + опция фильтра
    expect(screen.getByText('-3')).toBeDefined();
    expect(screen.getByText('Чек-ин старт: код верный')).toBeDefined();
  });

  it('клик по игроку в балансах фильтрует операции', async () => {
    mockSession({
      userId: 'u2',
      username: 'test-member2',
      memberId: 'm-2',
      rank: 'MEMBER',
      isAdmin: false,
    });

    render(<DkpPage />);
    await screen.findByText('Операции');

    fireEvent.click(screen.getAllByText('Первый')[0]!); // плитка балансов
    await screen.findByText('Операции');
    const call = vi.mocked(api).mock.calls.find((c) => String(c[0]).includes('memberId=m-1'));
    expect(String(call?.[0])).toContain('memberId=m-1');
  });

  it('непривязанному — подсказка про привязку', async () => {
    mockSession({ userId: 'u4', username: 'stranger', memberId: null, rank: null, isAdmin: false });

    render(<DkpPage />);
    expect(await screen.findByText(/заявку на привязку ника/)).toBeDefined();
    expect(api).not.toHaveBeenCalled();
  });
});
