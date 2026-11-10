import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuctionListRow, AuctionLiveState } from '@dkp/shared';
import { AuctionLots } from './auction-lots';
import { api } from '../lib/api';
import { useAuctionLot } from '../lib/use-auction-lot';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
vi.mock('../lib/use-auction-lot', () => ({ useAuctionLot: vi.fn() }));

const row = (overrides: Partial<AuctionListRow> = {}): AuctionListRow => ({
  id: 'a-1',
  status: 'OPEN',
  itemName: 'Клинок рассвета',
  rarity: 'Легендарный',
  targetRoles: ['DPS'],
  startPrice: 100,
  step: 5,
  markupPct: 50,
  timerKind: 'FIRST_BID',
  antiSnipeSec: 30,
  antiSnipeExtendSec: 30,
  noBidTimeoutSec: 120,
  firstBidAt: '2026-11-10T18:00:00.000Z',
  endsAt: '2026-11-10T18:01:30.000Z',
  createdAt: '2026-11-10T17:59:00.000Z',
  topBid: { memberId: 'm-2', memberName: 'Целитель', amount: 150, fullCost: 150 },
  myBid: { amount: 100, leading: false },
  winner: null,
  ...overrides,
});

const state = (overrides: Partial<AuctionLiveState> = {}): AuctionLiveState => ({
  lot: {
    id: 'a-1',
    status: 'OPEN',
    startPrice: 100,
    step: 5,
    timerKind: 'FIRST_BID',
    durationSec: 90,
    antiSnipeSec: 30,
    antiSnipeExtendSec: 30,
    noBidTimeoutSec: 120,
    markupPct: 50,
    firstBidAt: '2026-11-10T18:00:00.000Z',
    endsAt: '2026-11-10T18:01:30.000Z',
    createdAt: '2026-11-10T17:59:00.000Z',
  },
  winner: null,
  bids: [
    {
      id: 'b-1',
      auctionId: 'a-1',
      memberId: 'm-1',
      memberName: 'Воин',
      amount: 100,
      fullCost: 150,
      markupPct: 50,
      createdAt: '2026-11-10T18:00:01.000Z',
    },
    {
      id: 'b-2',
      auctionId: 'a-1',
      memberId: 'm-2',
      memberName: 'Целитель',
      amount: 150,
      fullCost: 150,
      markupPct: 0,
      createdAt: '2026-11-10T18:00:20.000Z',
    },
  ],
  serverTime: '2026-11-10T18:00:30.000Z',
  ...overrides,
});

beforeEach(() => {
  // jsdom не умеет <dialog>.showModal — общий полифилл как в соседних тестах
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  vi.mocked(useAuctionLot).mockReturnValue({
    state: null,
    connection: { status: 'connecting' },
    rejoin: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuctionLots: список (issue #98)', () => {
  it('открытые лоты с ведущей ставкой и автором; пустой список — пояснение', async () => {
    vi.mocked(api).mockImplementation(
      async (path: string) =>
        path === '/auctions?status=OPEN' ? [row()] : path === '/auctions?status=CLOSED' ? [] : [],
    );
    render(<AuctionLots viewerMemberId="m-1" viewerRole="DPS" />);

    expect(await screen.findByText('Клинок рассвета')).toBeDefined();
    expect(screen.getByText('150 ДКП')).toBeDefined();
    expect(screen.getByText('ведёт Целитель')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Завершённые' }));
    await screen.findByText('Завершённых лотов пока нет.');
  });

  it('карточка лота: параметры, родной класс, история ставок и форма', async () => {
    vi.mocked(api).mockResolvedValue([row()]);
    vi.mocked(useAuctionLot).mockReturnValue({
      state: state(),
      connection: { status: 'live' },
      rejoin: vi.fn(),
    });
    render(<AuctionLots viewerMemberId="m-1" viewerRole="DPS" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть' }));

    expect(await screen.findByText('Лот: Клинок рассвета')).toBeDefined();
    expect(screen.getByText('Стартовая цена')).toBeDefined();
    expect(screen.getByText('100 ДКП')).toBeDefined();
    expect(screen.getByText('Шаг ставки')).toBeDefined();
    expect(screen.getByText('5 ДКП')).toBeDefined();
    expect(screen.getByText(/родной вам/)).toBeDefined();
    // история — свежие сверху
    const cells = screen.getAllByRole('cell');
    expect(cells.some((cell) => cell.textContent === 'Целитель')).toBe(true);
    expect(
      screen.getByText((_, el) => el?.textContent === 'Текущая ставка: 150 ДКП — Целитель' && el.tagName === 'DIV'),
    ).toBeDefined();
    // форма: минимум от живой ведущей, итог с наценкой для «чужого»
    expect(screen.getByText('Ваша ставка (мин. 155 ДКП)')).toBeDefined();
    expect(screen.getByText('Сделать ставку')).toBeDefined();
  });

  it('чужой класс: подсказка наценки и полная стоимость у формы', async () => {
    vi.mocked(api).mockResolvedValue([row()]);
    vi.mocked(useAuctionLot).mockReturnValue({
      state: state(),
      connection: { status: 'live' },
      rejoin: vi.fn(),
    });
    render(<AuctionLots viewerMemberId="m-1" viewerRole="HEALER" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть' }));
    expect(screen.getByText(/чужой \(наценка \+50%\)/)).toBeDefined();
    // 155 * 1.5 = 233 (округление вверх)
    expect(await screen.findByText(/233 ДКП/)).toBeDefined();
  });

  it('без Member форма скрыта пояснением', async () => {
    vi.mocked(api).mockResolvedValue([row()]);
    render(<AuctionLots viewerMemberId={null} viewerRole={null} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть' }));
    expect(
      screen.getByText('Ставки доступны членам гильдии с привязанным профилем.'),
    ).toBeDefined();
    expect(screen.queryByText('Сделать ставку')).toBeNull();
  });

  it('ставка отправляется; ошибка сервера показывается', async () => {
    let posted = 0;
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/auctions/a-1/bids' && init?.method === 'POST') {
        posted += 1;
        if (posted === 1) {
          // конкурентная ставка между вводом и отправкой — сервер отвергает
          throw Object.assign(new Error('API'), {
            status: 400,
            body: { message: 'Минимальная ставка — 155' },
          });
        }
        return { bid: { id: 'b-3' }, endsAt: null };
      }
      return [row()];
    });
    vi.mocked(useAuctionLot).mockReturnValue({
      state: state(),
      connection: { status: 'live' },
      rejoin: vi.fn(),
    });
    render(<AuctionLots viewerMemberId="m-1" viewerRole="DPS" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть' }));

    const input = screen.getByLabelText('Сумма ставки');
    fireEvent.change(input, { target: { value: '160' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сделать ставку' }));
    expect(await screen.findByText('Минимальная ставка — 155')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Сделать ставку' }));
    await waitFor(() =>
      expect(vi.mocked(api)).toHaveBeenCalledWith(
        '/auctions/a-1/bids',
        expect.objectContaining({ method: 'POST', body: '{"amount":160}' }),
      ),
    );
  });

  it('завершённый лот показывает победителя, формы нет', async () => {
    vi.mocked(api).mockResolvedValue([
      row({
        status: 'CLOSED',
        topBid: null,
        myBid: null,
        winner: { memberId: 'm-2', memberName: 'Целитель', finalPrice: 225, markupPct: 50 },
        endsAt: '2026-11-10T18:01:31.000Z',
      }),
    ]);
    vi.mocked(useAuctionLot).mockReturnValue({
      state: state({
        lot: { ...state().lot, status: 'CLOSED', endsAt: '2026-11-10T18:01:31.000Z' },
        winner: { memberId: 'm-2', memberName: 'Целитель', finalPrice: 225, markupPct: 50 },
      }),
      connection: { status: 'live' },
      rejoin: vi.fn(),
    });
    render(<AuctionLots viewerMemberId="m-1" viewerRole="DPS" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Открыть' }));

    expect(await screen.findByText(/получил Целитель/)).toBeDefined();
    expect(screen.getAllByText(/225 ДКП/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Сделать ставку')).toBeNull();
  });
});
