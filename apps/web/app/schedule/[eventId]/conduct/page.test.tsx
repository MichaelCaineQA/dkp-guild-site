import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  scope: 'GUILD',
  kpId: null,
  packId: null,
  scopeName: 'Вся гильдия',
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
    user: {
      userId: 'u',
      username: 'User',
      memberId: isAdmin ? null : memberId,
      rank,
      isAdmin,
      blocked: false,
    },
    loading: false,
    reload: vi.fn(),
  });
}
let status: string;
let failSummary: boolean;
let failStatus: number | undefined;
let summaryRepeated: boolean;
/** Ответ `/checkin/code`: меняется, когда кнопка открывает окно. */
let codeView: {
  phase: string;
  windowState: string;
  code: string;
  windowOpensAt: string | null;
  windowClosesAt: string | null;
};
let statusFail: number | undefined;
let statusBodies: Array<{ status: string }>;
const NOT_LAUNCHED = {
  phase: 'START',
  windowState: 'NOT_OPEN_YET',
  code: '',
  windowOpensAt: null,
  windowClosesAt: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  status = 'RUNNING';
  failSummary = false;
  failStatus = undefined;
  summaryRepeated = false;
  codeView = NOT_LAUNCHED;
  statusFail = undefined;
  statusBodies = [];
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
    if (path === '/events/e-1/status') {
      if (statusFail) throw { status: statusFail };
      const body = JSON.parse(options!.body as string) as { status: string };
      statusBodies.push(body);
      status = body.status;
      // Сервер открывает окно кода той же транзакцией, что меняет статус.
      codeView = {
        phase: body.status === 'FINISHED' ? 'END' : 'START',
        windowState: 'ACTIVE',
        code: body.status === 'FINISHED' ? '777' : '482',
        windowOpensAt: '2026-03-03T16:45:00Z',
        windowClosesAt: '2026-03-03T16:48:00Z',
      };
      return { id: 'e-1', status };
    }
    if (path.endsWith('/conduct/checklist')) return CHECKLIST.map((row) => ({ ...row }));
    if (path.startsWith('/absences/for-event')) return [];
    if (path.endsWith('/checkin/code')) return { ...codeView };
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
describe('«Начать ивент» и «Завершить ивент» (решение 23)', () => {
  const statusPosts = () =>
    vi.mocked(api).mock.calls.filter(([path]) => path === '/events/e-1/status');
  const confirm = (title: string, label: string) => {
    const dialog = screen.getByRole('dialog', { name: title });
    fireEvent.click(within(dialog).getByRole('button', { name: label }));
  };

  it('Офицер без назначения РЛ подтверждает начало ивента и видит стартовый код', async () => {
    session('other', 'OFFICER');
    status = 'PLANNED';
    render(<ConductPage />);
    expect(
      await screen.findByText(
        'Окно стартового кода откроется кнопкой «Начать ивент» — код появится здесь',
      ),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Завершить ивент' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Начать ивент' }));
    expect(screen.getByRole('dialog', { name: 'Начать ивент?' })).toBeDefined();
    expect(statusPosts()).toHaveLength(0);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Начать ивент?' })).getByRole('button', {
        name: 'Отмена',
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(statusPosts()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Начать ивент' }));
    confirm('Начать ивент?', 'Начать');

    expect(statusBodies).toEqual([{ status: 'RUNNING' }]);
    expect(await screen.findByText('Ивент начат — окно стартового кода открыто')).toBeDefined();
    expect(await screen.findByText('482')).toBeDefined();
    expect(screen.getByText(/· Идёт$/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Завершить ивент' })).toBeDefined();
  });

  it('«Завершить ивент» просит подтверждение; после завершения финальный код виден на странице', async () => {
    render(<ConductPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить ивент' }));
    expect(statusPosts()).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Завершить ивент?' })).toBeDefined();
    confirm('Завершить ивент?', 'Завершить');

    expect(statusBodies).toEqual([{ status: 'FINISHED' }]);
    expect(await screen.findByText('Ивент завершён — окно финального кода открыто')).toBeDefined();
    // Финальное окно действует ещё windowSec после завершения — код остаётся на странице.
    expect(await screen.findByText('777')).toBeDefined();
    expect(screen.getByText('Код чек-ина (финал) — назовите в голосовом чате')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Завершить ивент' })).toBeNull();
  });

  it('действие уже выполнено другим управляющим (409) — пояснение и статус сервера', async () => {
    status = 'PLANNED';
    statusFail = 409;
    render(<ConductPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Начать ивент' }));
    confirm('Начать ивент?', 'Начать');

    expect(
      await screen.findByText('Действие уже выполнено — статус ивента изменился.'),
    ).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Статус перечитывается и при сбое: ответ мог потеряться после выполнения.
    expect(
      vi.mocked(api).mock.calls.filter(([path]) => path === '/events/e-1').length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Начать ивент' })).toBeDefined();
  });

  it('рядовой без назначения не видит кнопок запуска и завершения', async () => {
    session('other', 'MEMBER');
    render(<ConductPage />);
    await screen.findByText('Чек-лист участников');
    expect(screen.queryByRole('button', { name: 'Завершить ивент' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Начать ивент' })).toBeNull();
    expect(screen.queryByText(/Управление ивентом/)).toBeNull();
  });
});

describe('Итоги ивента', () => {
  it('Офицер без назначения РЛ готовит изменения локально и применяет их общей кнопкой', async () => {
    session('other', 'OFFICER');
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
  it('рядовой без назначения РЛ видит только чтение', async () => {
    session('other', 'MEMBER');
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
