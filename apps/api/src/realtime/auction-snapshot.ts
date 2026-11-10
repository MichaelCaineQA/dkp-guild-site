import { Injectable } from '@nestjs/common';
import type { AuctionLiveState, AuctionLotRow, BidRow, ItemTargetRole, LotStatus, LotTimerKind } from '@dkp/shared';

interface StoredBid {
  id: string;
  auctionId: string;
  memberId: string;
  amount: number;
  fullCost: number;
  markupPct: number;
  discountPct: number;
  createdAt: Date;
  member: { nickname: string };
}

interface StoredAuction {
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
  discountPct: number;
  targetRoles: ItemTargetRole[];
  firstBidAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  lootDrop: { item: { name: string } };
  bids: StoredBid[];
  award: {
    winnerId: string;
    finalPrice: number;
    markupPct: number;
    discountPct: number;
    winner: { nickname: string };
  } | null;
}

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface SnapshotDb {
  auction: {
    findUnique(args: {
      where: { id: string };
      include: {
        lootDrop: { include: { item: true } };
        bids: { include: { member: true } };
        award: { include: { winner: true } };
      };
    }): Promise<StoredAuction | null>;
  };
}

/**
 * Полный срез состояния лота (issue #97): ответ на подписку и повторное
 * соединение — клиент заменяет своё состояние целиком, поэтому потери и
 * дублирование отображаемых ставок исключены. serverTime — для расчёта
 * остатка таймера по единому серверному времени (план 6).
 */
@Injectable()
export class AuctionSnapshotService {
  constructor(
    private readonly db: SnapshotDb,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async liveState(auctionId: string): Promise<AuctionLiveState | null> {
    const auction = await this.db.auction.findUnique({
      where: { id: auctionId },
      include: {
        lootDrop: { include: { item: true } },
        bids: { include: { member: true } },
        award: { include: { winner: true } },
      },
    });
    if (!auction) return null;
    return {
      lot: toLotRow(auction),
      winner: auction.award
        ? {
            memberId: auction.award.winnerId,
            memberName: auction.award.winner.nickname,
            finalPrice: auction.award.finalPrice,
            markupPct: auction.award.markupPct,
            discountPct: auction.award.discountPct,
          }
        : null,
      bids: [...auction.bids]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((bid) => toBidRow(bid)),
      serverTime: this.now().toISOString(),
    };
  }
}

function toLotRow(auction: StoredAuction): AuctionLotRow {
  return {
    id: auction.id,
    status: auction.status as LotStatus,
    startPrice: auction.startPrice,
    step: auction.step,
    timerKind: (auction.timerFromFirstBid ? 'FIRST_BID' : 'OPENING') as LotTimerKind,
    durationSec: auction.durationSec,
    antiSnipeSec: auction.antiSnipeSec,
    antiSnipeExtendSec: auction.antiSnipeExtendSec,
    noBidTimeoutSec: auction.noBidTimeoutSec,
    markupPct: auction.markupPct,
    discountPct: auction.discountPct,
    firstBidAt: auction.firstBidAt?.toISOString() ?? null,
    endsAt: auction.endsAt?.toISOString() ?? null,
    createdAt: auction.createdAt.toISOString(),
  };
}

function toBidRow(bid: StoredBid): BidRow {
  return {
    id: bid.id,
    auctionId: bid.auctionId,
    memberId: bid.memberId,
    memberName: bid.member.nickname,
    amount: bid.amount,
    fullCost: bid.fullCost,
    markupPct: bid.markupPct,
    discountPct: bid.discountPct,
    createdAt: bid.createdAt.toISOString(),
  };
}
