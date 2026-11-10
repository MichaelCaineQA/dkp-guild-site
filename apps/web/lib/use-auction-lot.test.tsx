import { act, renderHook, waitFor } from '@testing-library/react';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUCTION_SOCKET_EVENTS, type AuctionBidEvent, type AuctionLiveState } from '@dkp/shared';

class FakeSocket {
  private readonly bus = new EventEmitter();
  connected = false;
  sent: Array<{ event: string; payload?: unknown }> = [];
  on(event: string, listener: (...args: never[]) => void): this {
    this.bus.on(event, listener as never);
    return this;
  }
  emit(event: string, payload?: unknown): boolean {
    this.sent.push({ event, payload });
    return this.bus.emit(event, payload);
  }
  connect(): void {
    this.connected = true;
    this.emit('connect');
  }
  disconnect(): void {
    this.connected = false;
    this.bus.emit('disconnect');
  }
  removeAllListeners(): void {
    this.bus.removeAllListeners();
  }
}

let socket: FakeSocket;
const ioMock = vi.fn(() => socket);

vi.mock('socket.io-client', () => ({ io: () => ioMock() }));

import { useAuctionLot } from './use-auction-lot';

const LOT_ID = 'lot-1';

const SNAPSHOT: AuctionLiveState = {
  lot: {
    id: LOT_ID,
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
      id: 'bid-1',
      auctionId: LOT_ID,
      memberId: 'm-1',
      memberName: 'Игрок',
      amount: 100,
      fullCost: 100,
      markupPct: 0,
      createdAt: '2026-11-10T18:00:01.000Z',
    },
  ],
  serverTime: '2026-11-10T18:00:05.000Z',
};

function bidEvent(id: string, endsAt: string): AuctionBidEvent {
  return {
    auctionId: LOT_ID,
    bid: {
      id,
      auctionId: LOT_ID,
      memberId: 'm-2',
      memberName: 'Соперник',
      amount: 150,
      fullCost: 150,
      markupPct: 0,
      createdAt: '2026-11-10T18:00:10.000Z',
    },
    endsAt,
    serverTime: '2026-11-10T18:00:10.000Z',
  };
}

describe('useAuctionLot (realtime лота, #97)', () => {
  beforeEach(() => {
    socket = new FakeSocket();
    ioMock.mockClear();
  });

  it('после соединения подписывается и замещает состояние срезом сервера', async () => {
    const { result } = renderHook(() => useAuctionLot(LOT_ID));
    expect(result.current.connection.status).toBe('connecting');

    act(() => socket.connect());
    await waitFor(() => expect(result.current.connection.status).toBe('live'));
    expect(socket.sent).toContainEqual({
      event: AUCTION_SOCKET_EVENTS.join,
      payload: { auctionId: LOT_ID },
    });

    act(() => socket.emit(AUCTION_SOCKET_EVENTS.state, SNAPSHOT));
    expect(result.current.state).toEqual(SNAPSHOT);
  });

  it('ставка добавляется один раз: дубль события не удваивает список', async () => {
    const { result } = renderHook(() => useAuctionLot(LOT_ID));
    act(() => socket.connect());
    act(() => socket.emit(AUCTION_SOCKET_EVENTS.state, SNAPSHOT));

    const extended = '2026-11-10T18:02:00.000Z';
    act(() => socket.emit(AUCTION_SOCKET_EVENTS.bid, bidEvent('bid-2', extended)));
    expect(result.current.state?.bids.map((b) => b.id)).toEqual(['bid-1', 'bid-2']);
    expect(result.current.state?.lot.endsAt).toBe(extended);

    // повтор того же события (перепоставка) — без дубликата ставки
    act(() => socket.emit(AUCTION_SOCKET_EVENTS.bid, bidEvent('bid-2', extended)));
    expect(result.current.state?.bids).toHaveLength(2);
  });

  it('разрыв возвращает connecting, повторное соединение заново подписывается', async () => {
    const { result } = renderHook(() => useAuctionLot(LOT_ID));
    act(() => socket.connect());
    act(() => socket.emit(AUCTION_SOCKET_EVENTS.state, SNAPSHOT));

    act(() => {
      socket.connected = false;
      socket.emit('disconnect');
    });
    expect(result.current.connection.status).toBe('connecting');

    const joinsBefore = socket.sent.filter((s) => s.event === AUCTION_SOCKET_EVENTS.join).length;
    act(() => socket.connect()); // восстановление
    const joins = socket.sent.filter((s) => s.event === AUCTION_SOCKET_EVENTS.join);
    expect(joins.length).toBe(joinsBefore + 1);

    // свежий срез замещает локальное состояние (актуальное окончание)
    const fresh: AuctionLiveState = { ...SNAPSHOT, serverTime: '2026-11-10T18:00:30.000Z' };
    act(() => socket.emit(AUCTION_SOCKET_EVENTS.state, fresh));
    expect(result.current.state).toEqual(fresh);
  });

  it('закрытие лота меняет статус на CLOSED', async () => {
    const { result } = renderHook(() => useAuctionLot(LOT_ID));
    act(() => socket.connect());
    act(() => socket.emit(AUCTION_SOCKET_EVENTS.state, SNAPSHOT));

    act(() =>
      socket.emit(AUCTION_SOCKET_EVENTS.closed, {
        auctionId: LOT_ID,
        winner: { memberId: 'm-2', memberName: 'Соперник', finalPrice: 150, markupPct: 0 },
        reason: 'EXPIRED',
        serverTime: '2026-11-10T18:01:31.000Z',
      }),
    );
    expect(result.current.state?.lot.status).toBe('CLOSED');
    expect(result.current.state?.winner).toMatchObject({ memberName: 'Соперник' });
  });

  it('без lotId сокет не создаётся', () => {
    const { result } = renderHook(() => useAuctionLot(null));
    expect(ioMock).not.toHaveBeenCalled();
    expect(result.current.state).toBeNull();
  });
});
