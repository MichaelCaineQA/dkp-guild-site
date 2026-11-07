import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useParams: () => ({ eventId: 'e-1' }) }));
vi.mock('../../../../lib/api', () => ({ api: vi.fn() }));
vi.mock('../../../../components/session-context', () => ({ useSession: vi.fn() }));
const { api } = await import('../../../../lib/api');
const { useSession } = await import('../../../../components/session-context');
const ConductPage = (await import('./page')).default;
const EVENT = {
  id: 'e-1',
  name: 'Сбор',
  eventTypeName: 'Гильдбосс',
  status: 'RUNNING',
  startsAt: '2026-03-03T17:00:00Z',
  dkpReward: 10,
  raidLeadId: 'm-rl',
  raidLeadName: 'РЛ',
};
const CHECKLIST = [
  {
    memberId: 'm-1',
    memberName: 'Первый',
    attendanceStatus: 'PRESENT',
    automaticStatus: 'PRESENT',
    statusIsManual: false,
    checkinStart: 'PASSED',
    checkinEnd: 'PASSED',
    dkpEarned: 10,
  },
  {
    memberId: 'm-2',
    memberName: 'Второй',
    attendanceStatus: 'NO_SHOW',
    automaticStatus: 'NO_SHOW',
    statusIsManual: false,
    checkinStart: 'PENDING',
    checkinEnd: 'PENDING',
    dkpEarned: 0,
  },
];
function session(memberId = 'm-rl', rank: 'MEMBER' | 'OFFICER' | null = 'MEMBER', isAdmin = false) {
  vi.mocked(useSession).mockReturnValue({
    user: { userId: 'u', username: 'User', memberId: isAdmin ? null : memberId, rank, isAdmin },
    loading: false,
    reload: vi.fn(),
  });
}
let status: string;
let failSummary: boolean;
let failStatus: number | undefined;
let summaryRepeated: boolean;
beforeEach(() => {
  vi.resetAllMocks();
  status = 'RUNNING';
  failSummary = false;
  failStatus = undefined;
  summaryRepeated = false;
  session();
  vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/events/e-1') return { ...EVENT, status };
    if (path.endsWith('/conduct/checklist')) return CHECKLIST.map((row) => ({ ...row }));
    if (path.startsWith('/absences/for-event')) return [];
    if (path.endsWith('/checkin/code'))
      return {
        phase: 'START',
        windowState: 'NOT_OPEN_YET',
        code: '',
        windowOpensAt: EVENT.startsAt,
        windowClosesAt: EVENT.startsAt,
      };
    if (path.endsWith('/conduct/summary')) {
      if (failSummary) {
        if (failStatus) throw { status: failStatus };
        throw new Error('response lost');
      }
      return {
        ok: true,
        applied: JSON.parse(options!.body as string).actions.length,
        repeated: summaryRepeated,
      };
    }
    throw new Error('unexpected path ' + path);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function prepareDkp() {
  fireEvent.click(await screen.findByRole('button', { name: 'ДКП: Второй' }));
  fireEvent.change(screen.getByLabelText('ДКП'), { target: { value: '-3' } });
  fireEvent.change(screen.getByLabelText('Обоснование'), {
    target: { value: 'Исправление ошибки' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'В черновик' }));
}
describe('Итоги ивента', () => {
  it('РЛ готовит изменения локально и применяет только общей кнопкой', async () => {
    render(<ConductPage />);
    await prepareDkp();
    expect(vi.mocked(api).mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false);
    expect(screen.getByText(/Второй: ДКП -3/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Подвести итоги' }));
    await screen.findByText(/Итоги сохранены. Корректировок: 1/);
    const call = vi.mocked(api).mock.calls.find(([path]) => path.endsWith('/conduct/summary'))!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      requestId: '00000000-0000-4000-8000-000000000001',
      actions: [{ kind: 'DKP', memberId: 'm-2', amount: -3, comment: 'Исправление ошибки' }],
    });
    expect(screen.getByText('Корректировок пока нет')).toBeDefined();
  });
  it('потерянный ответ сохраняет пакет и повторяет тот же requestId и payload', async () => {
    failSummary = true;
    render(<ConductPage />);
    await prepareDkp();
    fireEvent.click(screen.getByRole('button', { name: 'Подвести итоги' }));
    await screen.findByText(/Результат не подтверждён/);
    expect(
      (screen.getByRole('button', { name: 'ДКП: Второй' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    failSummary = false;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить применение' }));
    await screen.findByText(/Итоги сохранены/);
    const requests = vi.mocked(api).mock.calls.filter(([p]) => p.endsWith('/conduct/summary'));
    expect(requests).toHaveLength(2);
    expect(requests[0]![1]!.body).toBe(requests[1]![1]!.body);
  });
  it.each(['MEMBER', 'OFFICER'] as const)('%s без назначения видит только чтение', async (rank) => {
    session('other', rank);
    render(<ConductPage />);
    await screen.findByText('Чек-лист участников');
    expect(screen.queryByRole('button', { name: 'ДКП: Второй' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Подвести итоги' })).toBeNull();
  });
  it('завершённый ивент допускает пакетные корректировки, отменённый скрывает их', async () => {
    status = 'FINISHED';
    render(<ConductPage />);
    await screen.findByRole('button', { name: 'ДКП: Второй' });
    expect(screen.queryByRole('button', { name: 'Завершить ивент' })).toBeNull();
    cleanup();
    status = 'CANCELLED';
    render(<ConductPage />);
    await screen.findByText('Ивент отменён — только просмотр.');
    expect(screen.queryByRole('button', { name: 'ДКП: Второй' })).toBeNull();
  });
  it('резервный админ без Member загружает список и может подготовить пакет', async () => {
    session('', null, true);
    render(<ConductPage />);
    await screen.findByRole('button', { name: 'ДКП: Второй' });
  });
  it('код имеет предварительный статус, до применения запросов нет; черновик можно убрать', async () => {
    render(<ConductPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить код: Второй' }));
    fireEvent.change(screen.getByLabelText('Обоснование'), { target: { value: 'Был на старте' } });
    fireEvent.click(screen.getByRole('button', { name: 'В черновик' }));
    expect(screen.getByText('После применения: Ушёл раньше')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Убрать корректировку 1' }));
    expect(screen.queryByText('После применения: Ушёл раньше')).toBeNull();
    expect(vi.mocked(api).mock.calls.some(([, o]) => o?.method === 'POST')).toBe(false);
  });
  it('на HTTP по LAN генерирует UUID без crypto.randomUUID', async () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) });
    render(<ConductPage />);
    await prepareDkp();
    fireEvent.click(screen.getByRole('button', { name: 'Подвести итоги' }));
    await screen.findByText(/Итоги сохранены/);
    const call = vi.mocked(api).mock.calls.find(([p]) => p.endsWith('/conduct/summary'))!;
    expect(JSON.parse(call[1]!.body as string).requestId).toBe(
      '07070707-0707-4707-8707-070707070707',
    );
  });
  it('отклонённый первый пакет сохраняет черновик и разрешает исправление', async () => {
    failSummary = true;
    failStatus = 409;
    render(<ConductPage />);
    await prepareDkp();
    fireEvent.click(screen.getByRole('button', { name: 'Подвести итоги' }));
    await screen.findByText(/Запрос отклонён: данные изменились/);
    expect(
      (screen.getByRole('button', { name: 'ДКП: Второй' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Убрать корректировку 1' }));
    expect(screen.getByText('Корректировок пока нет')).toBeDefined();
  });
  it('после неизвестного результата отказ в доступе не разблокирует пакет под новым ID', async () => {
    failSummary = true;
    render(<ConductPage />);
    await prepareDkp();
    fireEvent.click(screen.getByRole('button', { name: 'Подвести итоги' }));
    await screen.findByText(/Результат не подтверждён/);
    failStatus = 403;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить применение' }));
    await waitFor(() =>
      expect(
        vi.mocked(api).mock.calls.filter(([p]) => p.endsWith('/conduct/summary')),
      ).toHaveLength(2),
    );
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Повторить применение' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByRole('button', { name: 'ДКП: Второй' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('уважительная причина попадает в пакет с обязательным текстом и предварительным статусом', async () => {
    status = 'FINISHED';
    render(<ConductPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Уважительная причина: Второй' }));
    fireEvent.change(screen.getByLabelText('Причина'), {
      target: { value: 'Работа в ночную смену' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'В черновик' }));
    expect(screen.getByText('После применения: Отсутствовал по ув. причине')).toBeDefined();
    expect(vi.mocked(api).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Подвести итоги' }));
    await screen.findByText(/Итоги сохранены/);
    const call = vi.mocked(api).mock.calls.find(([p]) => p.endsWith('/conduct/summary'))!;
    expect(JSON.parse(call[1]!.body as string).actions).toEqual([
      { kind: 'EXCUSE', memberId: 'm-2', reason: 'Работа в ночную смену' },
    ]);
  });
  it('после потери ответа можно подтвердить прежний пакет даже если ивент уже отменили', async () => {
    failSummary = true;
    render(<ConductPage />);
    await prepareDkp();
    fireEvent.click(screen.getByRole('button', { name: 'Подвести итоги' }));
    await screen.findByText(/Результат не подтверждён/);
    status = 'CANCELLED';
    fireEvent.click(screen.getByRole('button', { name: 'Обновить список' }));
    await screen.findByText('Ивент отменён — только просмотр.');
    failSummary = false;
    summaryRepeated = true;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить применение' }));
    await screen.findByText(/повтор запроса без новых начислений/);
    const calls = vi.mocked(api).mock.calls.filter(([p]) => p.endsWith('/conduct/summary'));
    expect(calls).toHaveLength(2);
    expect(calls[0]![1]!.body).toBe(calls[1]![1]!.body);
    expect(screen.queryByRole('button', { name: 'ДКП: Второй' })).toBeNull();
  });
});
