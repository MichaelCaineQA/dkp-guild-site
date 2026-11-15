import type {
  AuctionCloseReason,
  AuctionLotRow,
  BidRow,
  LotAwardRow,
} from '@dkp/shared';

/**
 * Порт событий аукциона (issue #97, план §7). Сервисы сообщают об изменениях
 * строго ПОСЛЕ фиксации в БД: событие — уведомление, источник истины — сервер.
 * Отдельный интерфейс держит сервисы тестируемыми без Socket.IO.
 */
export interface AuctionEventsPort {
  /** Новый лот создан (канал списка лотов). */
  lotCreated(lot: AuctionLotRow): void;
  /** Принята ставка; endsAt — актуальное окончание (анти-снайп учтён). */
  bidPlaced(auctionId: string, bid: BidRow, endsAt: string | null): void;
  /**
   * Ставки лота сняты без изменения самого лота (блокировка участника,
   * issue #149): комнате уходит свежий полный срез — история ставок
   * заменяется целиком, ведущей становится лучшая из оставшихся.
   */
  bidsRemoved(auctionId: string): void;
  /** Изменение лота без закрытия: продление, ручная смена победителя. */
  lotUpdated(auctionId: string, lot: AuctionLotRow, winner: LotAwardRow | null): void;
  /**
   * Лот закрыт или отменён. Комнате лота gateway отправит свежий полный
   * срез (актуальный статус, ставки, выдача); в канале списка — лёгкое
   * событие без перезагрузки строки лота.
   */
  lotClosed(
    auctionId: string,
    winner: LotAwardRow | null,
    reason: AuctionCloseReason,
  ): void;
  /**
   * Доступ пользователя отозван — блокировка (issue #149) или выход:
   * все сокеты пользователя закрываются (аудит F02), включая другие
   * инстансы API через Redis adapter.
   */
  userAccessRevoked(userId: string): void;
}

/** Токен DI-провайдера порта (реализация — AuctionGateway). */
export const AUCTION_EVENTS = Symbol('AUCTION_EVENTS');

/** Заглушка для юнит-тестов сервисов и сервисов без realtime. */
export const NOOP_AUCTION_EVENTS: AuctionEventsPort = {
  lotCreated: () => {},
  bidPlaced: () => {},
  bidsRemoved: () => {},
  lotUpdated: () => {},
  lotClosed: () => {},
  userAccessRevoked: () => {},
};
