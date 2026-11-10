import { Injectable } from '@nestjs/common';
import {
  winningBid,
  lootLogQuerySchema,
  type AuctionListRow,
  type AuctionListStatus,
  type DashboardAuction,
  type ItemTargetRole,
  type LootLogPage,
  type LootLogQuery,
  type LootLogRow,
} from '@dkp/shared';

interface StoredBid {
  id: string;
  memberId: string;
  amount: number;
  fullCost: number;
  member: { nickname: string };
}

interface StoredLot {
  id: string;
  status: string;
  startPrice: number;
  step: number;
  timerFromFirstBid: boolean;
  durationSec: number;
  antiSnipeSec: number;
  antiSnipeExtendSec: number;
  noBidTimeoutSec: number | null;
  markupPct: number;
  firstBidAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  lootDrop: { item: { name: string; rarity: string | null; targetRoles: ItemTargetRole[] } };
  bids: StoredBid[];
  award: { winnerId: string; finalPrice: number; markupPct: number; winner: { nickname: string } } | null;
}

/** Выдача лут-лога: лот → дроп → предмет и событие, получатель, цена. */
interface StoredAward {
  id: string;
  finalPrice: number;
  markupPct: number;
  createdAt: Date;
  winner: { id: string; nickname: string };
  auction: {
    id: string;
    lootDrop: {
      event: { id: string; name: string; startsAt: Date };
      item: { name: string; rarity: string | null };
    };
  };
}

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface AuctionsDb {
  auction: {
    findMany(args: {
      where: { status: string };
      orderBy: Array<{ endsAt?: 'asc' | 'desc'; createdAt?: 'asc' | 'desc' }>;
      include: {
        lootDrop: { include: { item: true } };
        bids: { include: { member: true } };
        award: { include: { winner: true } };
      };
    }): Promise<StoredLot[]>;
  };
  lootAward: {
    findMany(args: {
      where: {
        winnerId?: string;
        auction?: { lootDrop?: { eventId?: string; itemId?: string } };
      };
      orderBy: Array<{ createdAt?: 'desc'; id?: 'desc' }>;
      take?: number;
      skip: number;
      include: {
        winner: true;
        auction: { include: { lootDrop: { include: { event: true; item: true } } } };
      };
    }): Promise<StoredAward[]>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
}

/**
 * Список лотов для экрана аукциона (issue #98, план 2.4/6 п. 10) и данные
 * виджета «Мой аукцион» (план 2.8). Ставки видны всем членам гильдии;
 * myBid — только собственные ставки просматривающего.
 */
@Injectable()
export class AuctionsService {
  constructor(private readonly db: AuctionsDb) {}

  /** Лоты одной вкладки: открытые — по ближайшему окончанию, архив — новые сверху. */
  async list(status: AuctionListStatus, viewerMemberId: string | null): Promise<AuctionListRow[]> {
    const orderBy: Array<{ endsAt?: 'asc' | 'desc'; createdAt?: 'asc' | 'desc' }> =
      status === 'OPEN'
        ? [{ endsAt: 'asc' }, { createdAt: 'asc' }]
        : [{ createdAt: 'desc' }];
    const lots = await this.db.auction.findMany({
      where: { status },
      orderBy,
      include: {
        lootDrop: { include: { item: true } },
        bids: { include: { member: true } },
        award: { include: { winner: true } },
      },
    });
    return lots.map((lot) => this.toRow(lot, viewerMemberId));
  }

  /**
   * Виджет «Мой аукцион»: среди открытых лотов со ставкой игрока — лот
   * с ближайшим окончанием (план 2.8). null — ставок нет.
   */
  async myNearestBidLot(memberId: string | null): Promise<DashboardAuction | null> {
    if (!memberId) return null;
    const lots = await this.db.auction.findMany({
      where: { status: 'OPEN' },
      orderBy: [{ endsAt: 'asc' }, { createdAt: 'asc' }],
      include: {
        lootDrop: { include: { item: true } },
        bids: { include: { member: true } },
        award: { include: { winner: true } },
      },
    });
    const mine = lots.find((lot) => lot.bids.some((bid) => bid.memberId === memberId));
    if (!mine) return null;
    const top = winningBid(mine.bids);
    return {
      lotId: mine.id,
      itemName: mine.lootDrop.item.name,
      rarity: mine.lootDrop.item.rarity,
      status: 'OPEN',
      endsAt: mine.endsAt?.toISOString() ?? null,
      topBid: top
        ? { amount: top.amount, memberName: top.member.nickname }
        : null,
    };
  }

  /**
   * Лут-лог (issue #99, план 2.4/2.9): публичная история фактических выдач —
   * LootAward, поэтому отменённые лоты и лоты без выдачи не представлены
   * как полученный лут. Фильтры (игрок/ивент/предмет) соединяются через И;
   * finalPrice — фактическое списание из append-only журнала (смена победителя
   * обновляет выдачу и дописывает записи журнала, а не переписывает их).
   */
  async lootLog(query: unknown): Promise<LootLogPage> {
    const filters: LootLogQuery = lootLogQuerySchema.parse(query);
    const where = this.lootLogWhere(filters);
    const [rows, total] = await Promise.all([
      this.db.lootAward.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: filters.limit,
        skip: filters.offset,
        include: {
          winner: true,
          auction: { include: { lootDrop: { include: { event: true, item: true } } } },
        },
      }),
      this.db.lootAward.count({ where }),
    ]);
    return { entries: rows.map((row) => this.toLootRow(row)), total };
  }

  private lootLogWhere(filters: LootLogQuery) {
    const where: {
      winnerId?: string;
      auction?: { lootDrop?: { eventId?: string; itemId?: string } };
    } = {};
    if (filters.memberId) where.winnerId = filters.memberId;
    if (filters.eventId || filters.itemId) {
      where.auction = {
        lootDrop: {
          ...(filters.eventId ? { eventId: filters.eventId } : {}),
          ...(filters.itemId ? { itemId: filters.itemId } : {}),
        },
      };
    }
    return where;
  }

  private toLootRow(row: StoredAward): LootLogRow {
    const drop = row.auction.lootDrop;
    return {
      awardId: row.id,
      lotId: row.auction.id,
      itemName: drop.item.name,
      rarity: drop.item.rarity,
      winnerId: row.winner.id,
      winnerName: row.winner.nickname,
      finalPrice: row.finalPrice,
      markupPct: row.markupPct,
      eventId: drop.event.id,
      eventName: drop.event.name,
      eventStartsAt: drop.event.startsAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toRow(lot: StoredLot, viewerMemberId: string | null): AuctionListRow {
    const top = winningBid(lot.bids);
    const mine = viewerMemberId
      ? lot.bids
          .filter((bid) => bid.memberId === viewerMemberId)
          .sort((a, b) => a.amount - b.amount)
          .pop() ?? null
      : null;
    return {
      id: lot.id,
      status: lot.status as AuctionListRow['status'],
      itemName: lot.lootDrop.item.name,
      rarity: lot.lootDrop.item.rarity,
      targetRoles: lot.lootDrop.item.targetRoles,
      startPrice: lot.startPrice,
      step: lot.step,
      markupPct: lot.markupPct,
      timerKind: lot.timerFromFirstBid ? 'FIRST_BID' : 'OPENING',
      antiSnipeSec: lot.antiSnipeSec,
      antiSnipeExtendSec: lot.antiSnipeExtendSec,
      noBidTimeoutSec: lot.noBidTimeoutSec,
      firstBidAt: lot.firstBidAt?.toISOString() ?? null,
      endsAt: lot.endsAt?.toISOString() ?? null,
      createdAt: lot.createdAt.toISOString(),
      topBid: top
        ? {
            memberId: top.memberId,
            memberName: top.member.nickname,
            amount: top.amount,
            fullCost: top.fullCost,
          }
        : null,
      myBid: mine ? { amount: mine.amount, leading: top?.id === mine.id } : null,
      winner: lot.award
        ? {
            memberId: lot.award.winnerId,
            memberName: lot.award.winner.nickname,
            finalPrice: lot.award.finalPrice,
            markupPct: lot.award.markupPct,
          }
        : null,
    };
  }
}
