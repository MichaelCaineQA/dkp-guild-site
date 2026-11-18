import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuctionPage from './page';

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

const MEMBER = { memberId: 'm-1', rank: 'MEMBER', isAdmin: false, blocked: false };
const OFFICER = { memberId: 'm-2', rank: 'OFFICER', isAdmin: false, blocked: false };

const ITEMS = [
  {
    id: 'i-1',
    name: 'Клинок рассвета',
    rarity: 'Эпический 1',
    slot: 'Оружие',
    isArchboss: false,
    targetRoles: ['DPS', 'TANK'],
    defaultStartPrice: 120,
    lotsCount: 2,
  },
  {
    id: 'i-2',
    name: 'Плащ тени',
    rarity: null,
    slot: null,
    isArchboss: false,
    targetRoles: ['ALL'],
    defaultStartPrice: null,
    lotsCount: 0,
  },
  {
    id: 'i-3',
    name: 'Боевой клинок Тевента',
    rarity: 'Эпический 2',
    slot: 'Оружие',
    isArchboss: true,
    targetRoles: ['DPS'],
    defaultStartPrice: 300,
    lotsCount: 0,
  },
];

describe('AuctionPage (issue #92)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/items') return ITEMS.map((item) => ({ ...item }));
      throw new Error(`unexpected path ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('рядовому показывает справочник без кнопок ведения', async () => {
    mockSession(MEMBER);
    render(<AuctionPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Справочник предметов' }));
    expect(await screen.findByText('Клинок рассвета')).toBeTruthy();
    expect(screen.getByText('ДД, Танк')).toBeTruthy();
    expect(screen.getByText('Все')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Добавить предмет' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
  });

  it('офицеру доступны добавление и изменение; занятый предмет не удаляется', async () => {
    mockSession(OFFICER);
    render(<AuctionPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Справочник предметов' }));
    expect(await screen.findByRole('button', { name: 'Добавить предмет' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Изменить' })).toHaveLength(3);

    const deleteButtons = screen.getAllByRole('button', {
      name: 'Удалить',
    }) as HTMLButtonElement[];
    expect(deleteButtons[0]!.disabled).toBe(true); // 2 лота — история сохраняется
    expect(deleteButtons[1]!.disabled).toBe(false);
    expect(deleteButtons[2]!.disabled).toBe(false);
  });

  it('создаёт предмет через форму и перечитывает список', async () => {
    mockSession(OFFICER);
    render(<AuctionPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Справочник предметов' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить предмет' }));

    const nameInput = document.querySelector('dialog input')!;
    fireEvent.change(nameInput, { target: { value: 'Посох бури' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/items',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'Посох бури',
            rarity: null,
            slot: null,
            isArchboss: false,
            targetRoles: ['ALL'],
            defaultStartPrice: null,
          }),
        }),
      );
    });
  });

  it('помечает предмет «Архибосс» при создании и показывает бейдж в таблице (#208)', async () => {
    mockSession(OFFICER);
    render(<AuctionPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Справочник предметов' }));
    // Уже отмеченный предмет виден бейджем в таблице.
    expect(await screen.findAllByText('Архибосс')).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Добавить предмет' }));
    const nameInput = document.querySelector('dialog input')!;
    fireEvent.change(nameInput, { target: { value: 'Зачарованный клинок Белландир' } });
    fireEvent.click(screen.getByLabelText(/Оружие Архибоссов/));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/items',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'Зачарованный клинок Белландир',
            rarity: null,
            slot: null,
            isArchboss: true,
            targetRoles: ['ALL'],
            defaultStartPrice: null,
          }),
        }),
      );
    });
  });

  it('требует хотя бы одну целевую роль в форме', async () => {
    mockSession(OFFICER);
    render(<AuctionPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Справочник предметов' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить предмет' }));
    fireEvent.click(screen.getByLabelText('Все'));

    expect(screen.getByText('Выберите, кому нужен предмет')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
