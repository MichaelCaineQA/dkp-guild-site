import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RosterPage from './page';

/** Мокаем api-клиента и сессию: страница состава — чистый UI над /members. */
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

const MEMBER = {
  userId: 'u1',
  username: 'test-member',
  memberId: 'm1',
  rank: 'MEMBER',
  isAdmin: false,
  blocked: false,
};
const LEADER = {
  userId: 'u2',
  username: 'test-leader',
  memberId: 'm-2',
  rank: 'GUILD_LEADER',
  isAdmin: false,
  blocked: false,
};
const ROWS = [
  { id: 'm1', nickname: 'Alpha', rank: 'MEMBER', combatRole: 'DPS', weapons: [], discord: null },
  { id: 'm2', nickname: 'Beta', rank: 'MEMBER', combatRole: null, weapons: [], discord: null },
];

/** Состав отдаёт таблицу, остальные запросы (КП и паки) — пустую структуру. */
function mockRoster(rows: unknown[] = ROWS) {
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith('/members') ? rows : { groups: [], members: [] },
  );
}

/** Клик по строке списка → открытое окно участника. */
async function openMember(nickname: string) {
  fireEvent.click((await screen.findByText(nickname)).closest('tr')!);
  return screen.getByRole('dialog');
}

describe('RosterPage', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom не открывает <dialog>: имитируем showModal, чтобы окно имелось с признаком open.
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
    mockSession(MEMBER);
  });

  it('рядовой видит таблицу состава с фильтрами, но не форму добавления', async () => {
    vi.mocked(api).mockResolvedValue([
      { id: 'm-1', nickname: 'Alpha', rank: 'OFFICER', combatRole: 'HEALER', discord: 'alpha' },
      { id: 'm-2', nickname: 'Beta', rank: 'MEMBER', combatRole: null, discord: null },
    ]);

    render(<RosterPage />);

    expect(await screen.findByText('Alpha')).toBeDefined();
    expect(screen.getByText('Beta')).toBeDefined();
    expect(screen.getAllByText('Офицер').length).toBeGreaterThan(0); // фильтр + ячейка
    expect(screen.getAllByText('Хил').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('все ранги')).toBeDefined();
    expect(screen.getByText('все роли')).toBeDefined();
    expect(screen.queryByText('Добавить члена')).toBeNull();
    // Без прав управления столбца действий и кнопок нет (PLAN 2.11: недоступное скрывается)
    expect(screen.queryByRole('columnheader', { name: 'Действия' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Изменить участника/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Переместить участника/ })).toBeNull();
  });

  it('Глава видит заявки вместо ручного добавления', async () => {
    mockSession(LEADER);
    vi.mocked(api).mockResolvedValue([]);

    render(<RosterPage />);

    expect(await screen.findByText('Заявки')).toBeDefined();
    expect(screen.queryByText('Добавить члена')).toBeNull();
  });

  it('не для членов гильдии — подсказка про привязку', async () => {
    mockSession({ userId: 'u3', username: 'stranger', memberId: null, rank: null, isAdmin: false });
    vi.mocked(api).mockResolvedValue([]);

    render(<RosterPage />);

    await waitFor(() => {
      expect(screen.getByText(/заявку на привязку ника/)).toBeDefined();
    });
    expect(api).not.toHaveBeenCalled();
  });

  it('Офицер читает состав без формы добавления и правки игроков', async () => {
    mockSession({
      userId: 'off',
      username: 'Офицер',
      memberId: 'off',
      rank: 'OFFICER',
      isAdmin: false,
      blocked: false,
    });
    vi.mocked(api).mockResolvedValue([
      {
        id: 'm1',
        nickname: 'Alpha',
        rank: 'MEMBER',
        combatRole: 'DPS',
        weapons: [],
        discord: null,
      },
    ]);
    render(<RosterPage />);
    expect(await screen.findByText('Alpha')).toBeDefined();
    expect(screen.queryByText('Добавить члена')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Изменить участника/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Переместить участника/ })).toBeNull();
  });

  it('Админ начисляет выбранному участнику положительную сумму с комментарием', async () => {
    mockSession({
      userId: 'admin:root',
      username: 'Админ',
      memberId: null,
      rank: null,
      isAdmin: true,
      blocked: false,
    });
    vi.mocked(api).mockImplementation(async (path) =>
      path.startsWith('/members')
        ? [
            {
              id: 'm1',
              nickname: 'Alpha',
              rank: 'MEMBER',
              combatRole: 'DPS',
              weapons: [],
              discord: null,
            },
          ]
        : { id: 'entry' },
    );
    render(<RosterPage />);
    fireEvent.click((await screen.findByText('Alpha')).closest('tr')!);
    fireEvent.change(screen.getByLabelText('Сумма ДКП'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'Помощь' } });
    fireEvent.click(screen.getByRole('button', { name: 'Начислить ДКП' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/dkp/admin-grants',
        expect.objectContaining({ method: 'POST', body: expect.stringContaining('"amount":10') }),
      ),
    );
  });

  it('клик по строке открывает окно участника поверх списка; «Закрыть» и Escape его закрывают', async () => {
    mockSession(LEADER);
    mockRoster();
    render(<RosterPage />);

    expect(screen.queryByRole('dialog')).toBeNull();
    const dialog = await openMember('Alpha');
    expect(dialog.getAttribute('open')).not.toBeNull();
    expect(within(dialog).getByText('Alpha')).toBeDefined();
    // Секции — по правам смотрящего: у Главы нет начисления ДКП (план 2.2).
    expect(within(dialog).getByText('Блокировка')).toBeDefined();
    expect(within(dialog).getByText('Смена ранга')).toBeDefined();
    expect(within(dialog).queryByText(/Начислить ДКП/)).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    const second = await openMember('Beta');
    expect(within(second).getByText('Beta')).toBeDefined();
    fireEvent(second, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('окно участника открывается с клавиатуры кнопкой «Изменить»; фокус возвращается на неё', async () => {
    mockSession(LEADER);
    mockRoster();
    render(<RosterPage />);
    await screen.findByText('Alpha');

    // Строка таблицы фокуса не получает; у кнопок каждой строки имя с ником —
    // иначе скринридер слышит одинаковые «Изменить» без контекста.
    expect(screen.getByRole('columnheader', { name: 'Действия' })).toBeDefined();
    const changeBeta = screen.getByRole('button', { name: 'Изменить участника Beta' });
    expect(screen.getByRole('button', { name: 'Изменить участника Alpha' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Переместить участника Beta' })).toBeDefined();

    changeBeta.focus();
    expect(document.activeElement).toBe(changeBeta);
    fireEvent.click(changeBeta); // Enter/Space на настоящей кнопке — обычный click
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Beta')).toBeDefined();
    expect(within(dialog).queryByText('Alpha')).toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(changeBeta);
  });

  it('поля, заполненные для одного участника, не переходят на другого', async () => {
    mockSession(LEADER);
    mockRoster();
    render(<RosterPage />);

    let dialog = await openMember('Alpha');
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'OFFICER' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/Комментарий/), {
      target: { value: 'Повысить за рейд' },
    });
    const changeRank = () =>
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Изменить ранг',
      }) as HTMLButtonElement;
    expect(changeRank().disabled).toBe(false);

    // Форма пересоздаётся на каждого участника — даже если выбор сменился без закрытия.
    fireEvent.click(screen.getByText('Beta').closest('tr')!);
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Beta')).toBeDefined();
    expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('MEMBER');
    expect((within(dialog).getByPlaceholderText(/Комментарий/) as HTMLInputElement).value).toBe('');
    expect(changeRank().disabled).toBe(true);
  });

  it('Глава меняет ранг выбранному участнику с комментарием; ранг «Глава» не предлагает', async () => {
    mockSession(LEADER);
    mockRoster();
    render(<RosterPage />);

    const dialog = await openMember('Alpha');
    const rank = within(dialog).getByRole('combobox') as HTMLSelectElement;
    expect([...rank.options].map((option) => option.textContent)).toEqual(['Офицер', 'Рядовой']);

    fireEvent.change(rank, { target: { value: 'OFFICER' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/Комментарий/), {
      target: { value: 'Повысить за рейд' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Изменить ранг' }));

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/members/m1/change-rank',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"rank":"OFFICER"'),
        }),
      ),
    );
  });

  it('блокировка — только Рядовым и Офицерам и только с причиной', async () => {
    mockSession(LEADER);
    mockRoster([...ROWS, { ...ROWS[1], id: 'm3', nickname: 'Gamma', rank: 'GUILD_LEADER' }]);
    render(<RosterPage />);

    const own = await openMember('Gamma');
    expect(within(own).queryByText('Блокировка')).toBeNull();
    expect(within(own).getByText('Смена ранга')).toBeDefined();
    fireEvent.click(within(own).getByRole('button', { name: 'Закрыть' }));

    const dialog = await openMember('Alpha');
    const block = within(dialog).getByRole('button', {
      name: 'Заблокировать',
    }) as HTMLButtonElement;
    expect(block.disabled).toBe(true);
    fireEvent.change(within(dialog).getByPlaceholderText(/Причина блокировки/), {
      target: { value: 'Покинул гильдию' },
    });
    expect(block.disabled).toBe(false);
    fireEvent.click(block);

    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/members/m1/block',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Покинул гильдию'),
        }),
      ),
    );
  });

  it('пока запрос в полёте, «Закрыть» и Escape не закрывают окно', async () => {
    mockSession(LEADER);
    let finish!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.startsWith('/members?')) return ROWS; // список; действие висит до finish()
      if (path.startsWith('/org/roster')) return { groups: [], members: [] };
      return new Promise((done) => {
        finish = done;
      });
    });
    render(<RosterPage />);

    const dialog = await openMember('Alpha');
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'OFFICER' } });
    fireEvent.change(within(dialog).getByPlaceholderText(/Комментарий/), {
      target: { value: 'Повысить за рейд' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Изменить ранг' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/members/m1/change-rank', expect.anything()),
    );

    const close = within(dialog).getByRole('button', { name: 'Закрыть' }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.getByRole('dialog')).toBe(dialog);

    finish({ id: 'm1' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('рядовому окно участника показывает только сведения, без действий', async () => {
    mockSession(MEMBER);
    mockRoster();
    render(<RosterPage />);

    const dialog = await openMember('Alpha');
    expect(dialog.textContent).toContain('Ранг: Рядовой · Роль: ДД');
    expect(within(dialog).queryByText('Блокировка')).toBeNull();
    expect(within(dialog).queryByText('Смена ранга')).toBeNull();
    expect(within(dialog).queryByText(/Начислить ДКП/)).toBeNull();
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toEqual(['Закрыть окно', 'Закрыть']);
  });
});
