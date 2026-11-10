import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, Socket } from 'socket.io';
import { createClient } from 'redis';
import {
  AUCTION_SOCKET_EVENTS,
  type AuctionCloseReason,
  type AuctionLotRow,
  type BidRow,
  type LotAwardRow,
  type SessionUser,
} from '@dkp/shared';
import { readSessionUser } from '../auth/session';
import type { AuctionEventsPort } from './auction-events';
import { AuctionSnapshotService } from './auction-snapshot';

/** Комната одного лота. */
export const roomOf = (auctionId: string): string => `auction:${auctionId}`;

/** Общий канал: создание/закрытие лотов для списка аукциона. */
export const AUCTIONS_ROOM = 'auctions';

/**
 * Realtime аукциона (issue #97, план §7): Socket.IO gateway + Redis adapter.
 *
 * Аутентификация — та же cookie-сессия, что у REST: handshake читает store
 * по cookie (readSessionUser), без сессии соединение закрывается. Ставки
 * видны всем членам гильдии (план 6), отдельной комнаты-привилегии нет.
 *
 * Восстановление: клиент повторяет `auction:join` при каждом (пере)соединении
 * и получает полный срез `auction:state` — замена состояния вместо
 * накопления, поэтому дубликатов ставок не бывает.
 */
@WebSocketGateway({
  path: '/socket.io',
  // Без завершающего слэша: дев-прокси Next срезает его 308-редиректом,
  // Caddy — префикс /api; оба варианта доходят одинаковым путём.
  addTrailingSlash: false,
  cors: { origin: process.env.WEB_URL ?? 'http://localhost:3000', credentials: true },
})
export class AuctionGateway
  implements AuctionEventsPort, OnGatewayInit, OnGatewayConnection
{
  private readonly logger = new Logger(AuctionGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly snapshots: AuctionSnapshotService) {}

  /** Redis adapter при REDIS_URL — события видны всем инстансам API (§7). */
  async afterInit(server: Server): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return; // одиночный инстанс — встроенный in-memory adapter
    const pub = createClient({ url: redisUrl });
    const sub = pub.duplicate();
    pub.on('error', (error: Error) => this.logger.warn(`Redis pub: ${error.message}`));
    sub.on('error', (error: Error) => this.logger.warn(`Redis sub: ${error.message}`));
    await Promise.all([pub.connect(), sub.connect()]);
    server.adapter(createAdapter(pub, sub));
  }

  /** Соединение — только вошедшим (план 2.5: аукцион видят члены гильдии). */
  async handleConnection(client: Socket): Promise<void> {
    let user: SessionUser | null = null;
    try {
      user = await readSessionUser(client.request);
    } catch {
      user = null;
    }
    if (!user || (!user.memberId && !user.isAdmin)) {
      // Мягкое отключение: пакет ошибки успевает уйти до закрытия; клиент
      // socket.io не переподключается после server-side disconnect.
      client.emit('auction:error', 'Аукцион доступен членам гильдии после входа');
      client.disconnect();
      return;
    }
    client.data.user = user;
    await client.join(AUCTIONS_ROOM);
  }

  /** Подписка на лот: полный срез состояния взамен накопления (issue #97). */
  @SubscribeMessage(AUCTION_SOCKET_EVENTS.join)
  async handleJoin(
    client: Socket,
    payload: unknown,
  ): Promise<{ event: string; data: unknown }> {
    const auctionId = parseJoinPayload(payload);
    if (!auctionId) {
      return { event: 'auction:error', data: 'Некорректный идентификатор лота' };
    }
    const state = await this.snapshots.liveState(auctionId);
    if (!state) {
      return { event: 'auction:error', data: 'Лот не найден' };
    }
    await client.join(roomOf(auctionId));
    return { event: AUCTION_SOCKET_EVENTS.state, data: state };
  }

  lotCreated(lot: AuctionLotRow): void {
    this.server.to(AUCTIONS_ROOM).emit(AUCTION_SOCKET_EVENTS.created, {
      lot,
      serverTime: new Date().toISOString(),
    });
  }

  bidPlaced(
    auctionId: string,
    bid: BidRow,
    endsAt: string | null,
  ): void {
    this.server.to(roomOf(auctionId)).emit(AUCTION_SOCKET_EVENTS.bid, {
      auctionId,
      bid,
      endsAt,
      serverTime: new Date().toISOString(),
    });
  }

  lotUpdated(
    auctionId: string,
    lot: AuctionLotRow,
    winner: LotAwardRow | null,
  ): void {
    this.server.to(roomOf(auctionId)).emit(AUCTION_SOCKET_EVENTS.lot, {
      auctionId,
      lot,
      winner,
      serverTime: new Date().toISOString(),
    });
  }

  lotClosed(
    auctionId: string,
    winner: LotAwardRow | null,
    reason: AuctionCloseReason,
  ): void {
    // Комнате лота — свежий полный срез после фиксации (статус, ставки,
    // выдача); срез читается уже после коммита закрывшего сервиса.
    void this.snapshots
      .liveState(auctionId)
      .then((state) => {
        if (state) this.server.to(roomOf(auctionId)).emit(AUCTION_SOCKET_EVENTS.state, state);
      })
      .catch(() => undefined);
    this.server
      .to(roomOf(auctionId))
      .to(AUCTIONS_ROOM)
      .emit(AUCTION_SOCKET_EVENTS.closed, {
        auctionId,
        winner,
        reason,
        serverTime: new Date().toISOString(),
      });
  }
}

function parseJoinPayload(payload: unknown): string | null {
  const raw =
    typeof payload === 'string'
      ? payload
      : typeof payload === 'object' && payload !== null && 'auctionId' in payload
        ? (payload as { auctionId?: unknown }).auctionId
        : null;
  if (typeof raw !== 'string') return null;
  return /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
}
