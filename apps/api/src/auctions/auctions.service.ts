import { Injectable } from '@nestjs/common';
import {
  winningBid,
  type AuctionListRow,
  type AuctionListStatus,
  type DashboardAuction,
  type ItemTargetRole,
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
