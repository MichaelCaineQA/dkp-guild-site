'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  AUCTION_SOCKET_EVENTS,
  type AuctionBidEvent,
  type AuctionClosedEvent,
  type AuctionLiveState,
  type AuctionLotEvent,
} from '@dkp/shared';

/** Соединение живо и срез получен. */
export type AuctionConnection =
  | { status: 'connecting' }
  | { status: 'live' }
  | { status: 'unauthorized' }
  | { status: 'error' };

/**
 * Realtime лота (issue #97, план §6): ставки, таймеры и закрытие без
 * обновления страницы. Источник истины — сервер: на (пере)соединение клиент
 * подписывается и получает ПОЛНЫЙ срез состояния, которым замещает локальное,
 * поэтому потери и дублирования отображаемых ставок нет. Таймер считается
 * от serverTime среза/события, а не от часов браузера.
 *
 * Экран аукциона — #98; хук — транспорт, не вёрстка.
 */
export function useAuctionLot(lotId: string | null) {
  const [state, setState] = useState<AuctionLiveState | null>(null);
  const [connection, setConnection] = useState<AuctionConnection>({ status: 'connecting' });
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!lotId) {
      setState(null);
      setConnection({ status: 'connecting' });
      return;
    }
    const base = process.env.NEXT_PUBLIC_API_URL ?? '/api';
    const sameOrigin = base.startsWith('/');
    const socket = io(sameOrigin ? window.location.origin : base, {
      path: sameOrigin ? `${base}/socket.io` : '/socket.io',
      addTrailingSlash: false,
      withCredentials: true,
    });
    socketRef.current = socket;

    // (Пере)соединение всегда начинает с подписки: сервер ответит полным
    // срезом — восстановление без потери и удвоения ставок.
    const join = () => socket.emit(AUCTION_SOCKET_EVENTS.join, { auctionId: lotId });
    socket.on('connect', () => {
      setConnection({ status: 'live' });
      join();
    });
    socket.on('disconnect', () => setConnection({ status: 'connecting' }));
    socket.on('connect_error', (error: { message?: string }) => {
      setConnection(
        /вход|Unauthorized|401/i.test(error.message ?? '')
          ? { status: 'unauthorized' }
          : { status: 'error' },
      );
    });

    socket.on(AUCTION_SOCKET_EVENTS.state, (snapshot: AuctionLiveState | null) => {
      // Замена состояния целиком — идемпотентно к повторам и дублям.
      setState(snapshot);
    });
    socket.on(AUCTION_SOCKET_EVENTS.bid, (event: AuctionBidEvent) => {
      setState((prev) => applyBid(prev, event, lotId));
    });
    socket.on(AUCTION_SOCKET_EVENTS.lot, (event: AuctionLotEvent) => {
      setState((prev) => (prev && event.auctionId === lotId ? { ...prev, lot: event.lot } : prev));
    });
    socket.on(AUCTION_SOCKET_EVENTS.closed, (event: AuctionClosedEvent) => {
      // итог завершения приходит в событии; свежий срез следом подтвердит
      setState((prev) =>
        prev && event.auctionId === lotId
          ? {
              ...prev,
              lot: { ...prev.lot, status: 'CLOSED' as const },
              winner: event.winner,
            }
          : prev,
      );
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [lotId]);

  /** Повторная подписка без пересоздания сокета (после долгого сна вкладки). */
  const rejoin = () => {
    const socket = socketRef.current;
    if (socket?.connected) socket.emit(AUCTION_SOCKET_EVENTS.join, { auctionId: lotId });
    else socket?.connect();
  };

  return { state, connection, rejoin };
}

/** Ставка добавляется один раз (по id) и обновляет окончание лота. */
function applyBid(
  prev: AuctionLiveState | null,
  event: AuctionBidEvent,
  lotId: string,
): AuctionLiveState | null {
  if (!prev || event.auctionId !== lotId) return prev;
  if (prev.bids.some((bid) => bid.id === event.bid.id)) {
    return event.endsAt === prev.lot.endsAt ? prev : { ...prev, lot: { ...prev.lot, endsAt: event.endsAt } };
  }
  return {
    ...prev,
    lot: { ...prev.lot, endsAt: event.endsAt ?? prev.lot.endsAt },
    bids: [...prev.bids, event.bid],
  };
}
