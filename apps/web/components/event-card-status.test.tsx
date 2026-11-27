import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventCard } from './event-card';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
vi.mock('./session-context', () => ({
  useSession: () => ({ user: { memberId: 'm', rank: 'OFFICER' } }),
}));
vi.mock('./absent-members-panel', () => ({ AbsentMembersPanel: () => null }));
vi.mock('./event-roster', () => ({ EventRoster: () => null }));
vi.mock('./event-participation', () => ({ EventParticipation: () => null }));

interface CodeView {
  phase: string;
  windowState: string;
  code: string;
  windowOpensAt: string | null;
  windowClosesAt: string | null;
}
const NOT_LAUNCHED: CodeView = {
  phase: 'START',
  windowState: 'NOT_OPEN_YET',
  code: '',
  windowOpensAt: null,
  windowClosesAt: null,
};
/** Ивент с фиксированным статусом: родитель карточку не обновляет, как окно статистики. */
const EVENT = {
  id: 'e',
  name: 'Рейд',
  eventTypeName: 'Гильдбосс',
  mode: 'PVE',
  status: 'PLANNED',
  startsAt: '2030-01-01T17:00:00Z',
  endsAt: '2030-01-01T19:00:00Z',
  scopeName: 'Гильдия',
  dkpReward: 10,
  raidLeadId: 'm-rl',
  raidLeadName: 'РЛ',
};
let status: string;
let code: CodeView;
let statusBodies: Array<{ status: string }>;
let failStatus: number | undefined;
let codeRequests: number;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  vi.mocked(api).mockReset();
  status = 'PLANNED';
  code = NOT_LAUNCHED;
  statusBodies = [];
  failStatus = undefined;
  codeRequests = 0;
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/events/e/status') {
      if (failStatus) throw { status: failStatus };
      const body = JSON.parse(String(options?.body)) as { status: string };
      statusBodies.push(body);
      status = body.status;
      // Сервер открывает окно кода той же транзакцией, что меняет статус.
      code = {
        phase: body.status === 'FINISHED' ? 'END' : 'START',
        windowState: 'ACTIVE',
        code: body.status === 'FINISHED' ? '777' : '482',
        windowOpensAt: '2030-01-01T16:45:00Z',
        windowClosesAt: '2030-01-01T16:48:00Z',
      };
      return { id: 'e', status };
    }
    if (path === '/members')
      return [
        { id: 'm-rl', nickname: 'РЛ' },
        { id: 'm-new', nickname: 'Новый РЛ' },
      ];
    if (path === '/events/e' && options?.method === 'PATCH') return { id: 'e' };
    if (path === '/events/e/checkin/code') {
      codeRequests += 1;
      return { ...code };
    }
    if (path === '/events/e/checkin/me')
      return { phase: code.phase, windowState: code.windowState, choices: [], status: 'PENDING' };
    throw new Error(`unexpected ${path}`);
  });
});

afterEach(cleanup);

function renderCard(overrides: { status?: string; canManage?: boolean } = {}) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    <EventCard
      event={{ ...EVENT, ...overrides } as never}
      gameTime={null}
      canManage={overrides.canManage ?? false}
      canConduct
      onClose={onClose}
      onChanged={onChanged}
      presentation="panel"
    />,
  );
  return { onClose, onChanged };
}
const statusPosts = () => vi.mocked(api).mock.calls.filter(([path]) => path === '/events/e/status');

describe('EventCard: «Начать ивент» и «Завершить ивент»', () => {
  it('офицер может переназначить РЛ в запланированном ивенте через PATCH и карточка обновляется', async () => {
    const { onChanged } = renderCard({ canManage: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Сменить рейд-лида' }));
    fireEvent.change(await screen.findByLabelText('Рейд-лид'), { target: { value: 'm-new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить рейд-лида' }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/events/e', {
        method: 'PATCH',
        body: JSON.stringify({ raidLeadId: 'm-new' }),
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('ошибка API при смене РЛ остаётся видимой в диалоге', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/members') return [{ id: 'm-new', nickname: 'Новый РЛ' }] as never;
      if (path === '/events/e/checkin/me')
        return {
          phase: 'START',
          windowState: 'NOT_OPEN_YET',
          choices: [],
          status: 'PENDING',
        } as never;
      if (path === '/events/e/checkin/code') return { ...NOT_LAUNCHED } as never;
      throw new Error(`failed ${path}`);
    });
    renderCard({ canManage: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Сменить рейд-лида' }));
    fireEvent.change(await screen.findByLabelText('Рейд-лид'), { target: { value: 'm-new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить рейд-лида' }));
    expect(
      await screen.findByText('Не удалось изменить рейд-лида. Проверьте права и статус ивента.'),
    ).toBeTruthy();
  });

  it('до запуска говорит, что окно откроется кнопкой, и не придумывает время по расписанию', async () => {
    renderCard();
    expect(
      await screen.findByText(
        'Окно стартового кода откроется кнопкой «Начать ивент» — код появится здесь',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Запланирован')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Завершить ивент' })).toBeNull();
  });

  it('«Начать ивент» требует подтверждения: запрос уходит только после согласия', async () => {
    const { onClose, onChanged } = renderCard();
    await screen.findByRole('button', { name: 'Начать ивент' });

    fireEvent.click(screen.getByRole('button', { name: 'Начать ивент' }));
    const confirmation = screen.getByRole('dialog', { name: 'Начать ивент?' });
    expect(statusPosts()).toHaveLength(0);

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(statusPosts()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Начать ивент' }));
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await screen.findByText('Ивент начат — окно стартового кода открыто');

    expect(statusBodies).toEqual([{ status: 'RUNNING' }]);
    // Карточка остаётся открытой: код нужен сразу, а не после повторного открытия.
    expect(onClose).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByText('Идёт')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Завершить ивент' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Начать ивент' })).toBeNull();
  });

  it('после нажатия код перечитывается сразу, не дожидаясь опроса раз в 10 секунд', async () => {
    renderCard();
    await screen.findByRole('button', { name: 'Начать ивент' });
    const before = codeRequests;

    fireEvent.click(screen.getByRole('button', { name: 'Начать ивент' }));
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));

    expect(await screen.findByText('482')).toBeTruthy();
    expect(screen.getByText('Код чек-ина (старт) — назовите в голосовом чате')).toBeTruthy();
    // Один запрос при открытии карточки и один сразу после нажатия.
    expect(codeRequests).toBe(before + 1);
  });

  it('«Завершить ивент» требует подтверждения; после завершения карточка открыта и показывает финальный код', async () => {
    code = { ...NOT_LAUNCHED, windowState: 'CLOSED', code: '482' };
    const { onClose } = renderCard({ status: 'RUNNING' });
    await screen.findByRole('button', { name: 'Завершить ивент' });

    fireEvent.click(screen.getByRole('button', { name: 'Завершить ивент' }));
    expect(statusPosts()).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Завершить ивент?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Завершить' }));

    await screen.findByText('Ивент завершён — окно финального кода открыто');
    expect(statusBodies).toEqual([{ status: 'FINISHED' }]);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Завершён')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('777')).toBeTruthy();
    expect(screen.getByText('Код чек-ина (финал) — назовите в голосовом чате')).toBeTruthy();
  });

  it('действие уже выполнено другим управляющим (409) — карточка остаётся открытой с пояснением', async () => {
    failStatus = 409;
    const { onClose, onChanged } = renderCard();
    await screen.findByRole('button', { name: 'Начать ивент' });

    fireEvent.click(screen.getByRole('button', { name: 'Начать ивент' }));
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));

    expect(
      await screen.findByText('Действие уже выполнено — статус ивента изменился'),
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // Статус ивента перечитывается: ответ мог потеряться после выполнения.
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Начать ивент' })).toBeTruthy();
  });

  it('отмена ивента по-прежнему закрывает карточку', async () => {
    const { onClose } = renderCard({ canManage: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить' }));

    await waitFor(() => expect(statusBodies).toEqual([{ status: 'CANCELLED' }]));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('EventCard: чек-ин по статусу ивента', () => {
  it('завершённый ивент: игроку доступна отметка финальным кодом, управляющему — сам код', async () => {
    code = {
      phase: 'END',
      windowState: 'ACTIVE',
      code: '777',
      windowOpensAt: null,
      windowClosesAt: null,
    };
    renderCard({ status: 'FINISHED' });

    expect(await screen.findByText('777')).toBeTruthy();
    expect(vi.mocked(api).mock.calls.some(([path]) => path === '/events/e/checkin/me')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Завершить ивент' })).toBeNull();
  });

  it('отменённый ивент — только просмотр, без чек-ина и кода', async () => {
    renderCard({ status: 'CANCELLED' });
    expect(await screen.findByText('Отменён')).toBeTruthy();
    // Остальные панели карточки заменены заглушками: запросов нет вовсе.
    expect(vi.mocked(api).mock.calls.some(([path]) => path.includes('/checkin/'))).toBe(false);
    expect(screen.queryByText(/Код чек-ина/)).toBeNull();
  });

  it('завершённый без запущенного кода — блок говорит, что код не запускался', async () => {
    code = {
      phase: 'END',
      windowState: 'CLOSED',
      code: '',
      windowOpensAt: null,
      windowClosesAt: null,
    };
    renderCard({ status: 'FINISHED' });

    expect(await screen.findByText('Код не запускался')).toBeTruthy();
  });
});
