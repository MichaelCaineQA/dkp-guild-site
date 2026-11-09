import { Injectable, Logger } from '@nestjs/common';
import {
  lotExpired,
  winningBid,
  type LotCloseResult,
} from '@dkp/shared';
import { serializable } from '../prisma/serializable';

interface StoredBid {
  id: string;
  memberId: string;
  amount: number;
  fullCost: number;
  markupPct: number;
}

interface StoredAuction {
  id: string;
  status: string;
  timerFromFirstBid: boolean;
  noBidTimeoutSec: number | null;
  firstBidAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  lootDrop: { item: { name: string } };
  bids: Array<StoredBid & { member: { nickname: string } }>;
}

/** Лёгкая проекция для прохода свипера (без ставок). */
interface StoredOpenLot {
  id: string;
  timerFromFirstBid: boolean;
  noBidTimeoutSec: number | null;
  firstBidAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
}

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface CloseTx {
  auction: {
    findUnique(args: {
      where: { id: string };
      include: { lootDrop: { include: { item: true } }; bids: { include: { member: true } } };
    }): Promise<StoredAuction | null>;
    update(args: { where: { id: string }; data: { status: 'CLOSED' } }): Promise<unknown>;
  };
  lootAward: {
    create(args: {
      data: { auctionId: string; winnerId: string; finalPrice: number; markupPct: number };
    }): Promise<unknown>;
  };
  dkpEntry: {
    create(args: {
      data: {
        requestId: string;
        memberId: string;
        type: 'AUCTION_SPEND';
        amount: number;
        auctionId: string;
        comment: string;
      };
    }): Promise<unknown>;
  };
  auditLog: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface CloseDb extends CloseTx {
  auction: CloseTx['auction'] & {
    findMany(args: { where: { status: 'OPEN' } }): Promise<StoredOpenLot[]>;
  };
  $transaction<R>(
    work: (tx: CloseTx) => Promise<R>,
    options: { isolationLevel: 'Serializable'; timeout?: number },
  ): Promise<R>;
}

/**
 * Закрытие истёкших лотов, выдача предмета и атомарное списание ДКП
 * (issue #95, план 2.4 и 6, п. 3, 7 и 9).
 *
 * Источник истины — серверное время: свипер периодически проходит по открытым
 * лотам и закрывает просроченные, поэтому перезапуск обработчика безопасен —
 * после старта просроченные лоты закрываются первым же проходом. Каждое
 * закрытие — сериализуемая транзакция с повторным чтением статуса: повторный
 * или одновременный проход не создаёт дубликаты выдачи и списания (вторая
 * защита — уникальные LootAward.auctionId и DkpEntry.requestId).
 *
 * Победитель — автор последней (максимальной) валидной ставки; списывается
 * полная стоимость с применимой наценкой из ставки, запись в журнал ДКП —
 * единственная, append-only. Баланс может уйти в минус (план 6, п. 7).
 * Лот без ставок закрывается без победителя и расхода (план 6, п. 9).
 * Аудит пишется от системы (без автора-игрока) в той же транзакции.
 */
@Injectable()
export class AuctionCloseService {
  private readonly logger = new Logger(AuctionCloseService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  constructor(
    private readonly db: CloseDb,
    private readonly now: () => Date = () => new Date(),
    /** Период прохода свипера, мс; 0 — отключить (для тестов). */
    private readonly sweepIntervalMs = 1000,
  ) {}

  onModuleInit(): void {
    if (this.sweepIntervalMs <= 0) return;
    // Сразу закрываем лоты, просроченные за время простоя (рестарт/авария).
    void this.closeDue();
    this.timer = setInterval(() => void this.closeDue(), this.sweepIntervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Проход по открытым лотам: закрывает все истёкшие. Сбой одного лота
   * не прерывает остальные и будет повторён на следующем проходе.
   * Возвращает число закрытых лотов.
   */
  async closeDue(): Promise<number> {
    if (this.sweeping) return 0; // защита от наложения проходов
    this.sweeping = true;
    try {
      const now = this.now();
      const openLots = await this.db.auction.findMany({ where: { status: 'OPEN' } });
      let closed = 0;
      for (const lot of openLots) {
        if (!lotExpired(this.toExpiryParams(lot), now)) continue;
        try {
          const result = await this.closeExpiredLot(lot.id);
          if (result.closed) closed += 1;
        } catch (error) {
          this.logger.error(`Не удалось закрыть лот ${lot.id}`, error as Error);
        }
      }
      return closed;
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Идемпотентное закрытие одного лота: статус, выдача, списание и аудит
   * фиксируются согласованно в одной сериализуемой транзакции. Повторный
   * вызов (гонка свипера, ручной повтор) видит уже не OPEN и ничего не делает.
   */
  async closeExpiredLot(auctionId: string): Promise<LotCloseResult> {
    const now = this.now();
    return serializable(this.db, async (tx) => {
      const auction = await tx.auction.findUnique({
        where: { id: auctionId },
        include: { lootDrop: { include: { item: true } }, bids: { include: { member: true } } },
      });
      if (!auction || auction.status !== 'OPEN') {
        return { closed: false, skipped: true, winner: null };
      }
      if (!lotExpired(this.toExpiryParams(auction), now)) {
        return { closed: false, skipped: true, winner: null };
      }

      const itemName = auction.lootDrop.item.name;
      const top = winningBid(auction.bids);
      await tx.auction.update({ where: { id: auctionId }, data: { status: 'CLOSED' } });

      if (!top) {
        await tx.auditLog.create({
          data: {
            actorMemberId: null,
            actorIsAdmin: false,
            action: 'AUCTION_CLOSE',
            entityType: 'Auction',
            entityId: auctionId,
            comment: `Лот «${itemName}» завершён без ставок — предмет остаётся в гильдии`,
          },
        });
        return { closed: true, skipped: false, winner: null };
      }

      await tx.lootAward.create({
        data: {
          auctionId,
          winnerId: top.memberId,
          finalPrice: top.fullCost,
          markupPct: top.markupPct,
        },
      });
      await tx.dkpEntry.create({
        data: {
          requestId: `auction-close:${auctionId}`,
          memberId: top.memberId,
          type: 'AUCTION_SPEND',
          amount: -top.fullCost,
          auctionId,
          comment:
            `Трата на аукционе: «${itemName}» за ${top.fullCost}` +
            (top.markupPct > 0 ? ` (с наценкой ${top.markupPct}%)` : ''),
        },
      });
      await tx.auditLog.create({
        data: {
          actorMemberId: null,
          actorIsAdmin: false,
          action: 'AUCTION_CLOSE',
          entityType: 'Auction',
          entityId: auctionId,
          comment:
            `Лот «${itemName}» завершён: победитель ${top.member.nickname}, ` +
            `списано ${top.fullCost} ДКП` +
            (top.markupPct > 0 ? ` (с наценкой ${top.markupPct}%)` : ''),
        },
      });
      return {
        closed: true,
        skipped: false,
        winner: {
          memberId: top.memberId,
          memberName: top.member.nickname,
          finalPrice: top.fullCost,
          markupPct: top.markupPct,
        },
      };
    });
  }

  private toExpiryParams(lot: {
    timerFromFirstBid: boolean;
    noBidTimeoutSec: number | null;
    firstBidAt: Date | null;
    endsAt: Date | null;
    createdAt: Date;
  }) {
    return {
      timerKind: (lot.timerFromFirstBid ? 'FIRST_BID' : 'OPENING') as 'FIRST_BID' | 'OPENING',
      endsAt: lot.endsAt,
      firstBidAt: lot.firstBidAt,
      noBidTimeoutSec: lot.noBidTimeoutSec,
      createdAt: lot.createdAt,
    };
  }
}
