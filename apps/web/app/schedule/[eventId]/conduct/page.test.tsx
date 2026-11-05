import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useParams: () => ({ eventId: 'e-1' }),
}));

vi.mock('../../../../lib/api', () => ({
  api: vi.fn(),
}));

vi.mock('../../../../components/session-context', () => ({
  useSession: vi.fn(),
}));

const { api } = await import('../../../../lib/api');
const { useSession } = await import('../../../../components/session-context');
const ConductPage = (await import('./page')).default;

function mockSession(user: Record<string, unknown> | null) {
  vi.mocked(useSession).mockReturnValue({
    user: user as never,
    loading: false,
    reload: vi.fn(),
  });
}

const EVENT = {
  id: 'e-1',
  eventTypeName: 'Гильдбосс',
  mode: 'PVE',
  status: 'RUNNING',
  startsAt: '2026-03-03T17:00:00.000Z',
  endsAt: '2026-03-03T19:00:00.000Z',
  dkpReward: 10,
  raidLeadId: 'm-rl',
  raidLeadName: 'РЛ',
};

const CHECKLIST = [
  {
    memberId: 'm-1',
    memberName: 'Первый',
    attendanceStatus: 'PRESENT',
    checkinStart: 'PASSED',
    checkinEnd: 'PASSED',
    dkpEarned: 10,
  },
  {
    memberId: 'm-2',
    memberName: 'Второй',
    attendanceStatus: null,
    checkinStart: 'PENDING',
    checkinEnd: 'PENDING',
    dkpEarned: 0,
  },
];

describe('ConductPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/events/e-1') {
        return { ...EVENT };
      }
      if (path === '/events/e-1/conduct/checklist') {
        return CHECKLIST.map((row) => ({ ...row }));
      }
      if (path.startsWith('/absences/for-event')) {
        return [];
      }
      throw new Error(`unexpected path ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('РЛ видит чек-лист, статусы чек-инов и кнопки ручных действий', async () => {
    mockSession({
      userId: 'u-rl',
      username: 'rl',
      memberId: 'm-rl',
      rank: 'MEMBER',
      isAdmin: false,
    });

    render(<ConductPage />);

    expect(await screen.findByText('Чек-лист участников')).toBeDefined();
    expect(screen.getByText('Первый')).toBeDefined();
    expect(screen.getAllByText('✅ сам')).toHaveLength(2); // старт и финал у Первого
    expect(screen.getAllByText('отметка…').length).toBe(2); // селектор в каждой строке
    expect(screen.getAllByText('+старт').length).toBe(1); // только Второй
    expect(screen.getByText('Досрочно запустить финальный код')).toBeDefined();
    expect(screen.getByText('Завершить ивент')).toBeDefined();
  });

  it('рядовой-не-РЛ видит чек-лист только для чтения', async () => {
    mockSession({
      userId: 'u-3',
      username: 'test-member',
      memberId: 'm-3',
      rank: 'MEMBER',
      isAdmin: false,
    });

    render(<ConductPage />);

    expect(await screen.findByText('Чек-лист участников')).toBeDefined();
    expect(screen.queryByText('отметка…')).toBeNull();
    expect(screen.queryByText('Досрочно запустить финальный код')).toBeNull();
    expect(screen.queryByText('Завершить ивент')).toBeNull();
  });

  it('итоговая статистика сводится по строкам', async () => {
    mockSession({
      userId: 'u-rl',
      username: 'rl',
      memberId: 'm-rl',
      rank: 'MEMBER',
      isAdmin: false,
    });

    render(<ConductPage />);

    expect(await screen.findByText(/1 был · 0 опоздал · 0 уважительная · всего начислено 10 ДКП/)).toBeDefined();
  });
});
