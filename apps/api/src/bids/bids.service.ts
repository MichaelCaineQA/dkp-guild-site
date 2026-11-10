import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  bidFullCost,
  checkBidAllowed,
  computeBalance,
  endsAtAfterBid,
  hasAvailableBalance,
  isForeignBidder,
  minBidAmount,
  placeBidSchema,
  type BidLotParams,
  type BidRow,
  type ItemTargetRole,
  type LotStatus,
  type LotTimerKind,
  type PlaceBidResult,
} from '@dkp/shared';
import { serializable } from '../prisma/serializable';
import { NOOP_AUCTION_EVENTS, type AuctionEventsPort } from '../realtime/auction-events';

interface StoredAuction {
  id: string;
  status: string;
  startPrice: number;
  step: number;
  timerFromFirstBid: boolean;
  durationSec: number;
  antiSnipeSec: number;
  antiSnipeExtendSec: number;
  markupPct: number;
  targetRoles: ItemTargetRole[];
  firstBidAt: Date | null;
  endsAt: Date | null;
  lootDrop: { item: { name: string } };
}

interface StoredBid {
  id: string;
  auctionId: string;
  memberId: string;
  amount: number;
  fullCost: number;
  markupPct: number;
  createdAt: Date;
}

interface StoredMember {
  id: string;
  nickname: string;
  combatRole: 'DPS' | 'HEALER' | 'TANK' | null;
}

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface BidsTx {
  auction: {
    findUnique(args: {
      where: { id: string };
      include: { lootDrop: { include: { item: true } } };
    }): Promise<StoredAuction | null>;
    findMany(args: {
      where: { status: 'OPEN'; id: { not: string } };
      include: { bids: true };
    }): Promise<Array<Omit<StoredAuction, 'lootDrop'> & { bids: StoredBid[] }>>;
    update(args: {
      where: { id: string };
      data: { firstBidAt?: Date; endsAt?: Date | null };
    }): Promise<unknown>;
  };
  bid: {
    findMany(args: {
      where: { auctionId: string };
      orderBy: { createdAt: 'asc' };
      include: { member: true };
    }): Promise<Array<StoredBid & { member: StoredMember }>>;
    create(args: {
      data: {
        auctionId: string;
        memberId: string;
        amount: number;
        fullCost: number;
        markupPct: number;
      };
    }): Promise<StoredBid>;
  };
  member: {
    findUnique(args: { where: { id: string } }): Promise<StoredMember | null>;
  };
  dkpEntry: {
    findMany(args: {
      where: { memberId: string };
      select: { amount: true };
    }): Promise<Array<{ amount: number }>>;
  };
  auditLog: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface BidsDb extends BidsTx {
  $transaction<R>(
    work: (tx: BidsTx) => Promise<R>,
    options: { isolationLevel: 'Serializable'; timeout?: number },
  ): Promise<R>;
}

/** Актор ставки: memberId обязателен, резервный админ без Member не ставит. */
export interface BidsActor {
  memberId: string | null;
  isAdmin: boolean;
}

/**
 * Ставки открытого аукциона (issue #94, план 2.4 и 6, п. 2–5).
 * Вся проверка — в сериализуемой транзакции с повтором при гонке: две
 * конкурирующие ставки обрабатываются атомарно, отклонённая ставка не оставляет
 * побочных эффектов (ни записи, ни аудита). Время — только серверное.
 * Закрытие истёкших лотов и списание ДКП — задача #95.
 */
@Injectable()
export class BidsService {
  constructor(
    private readonly db: BidsDb,
    private readonly now: () => Date = () => new Date(),
    private readonly events: AuctionEventsPort = NOOP_AUCTION_EVENTS,
  ) {}

  /** Открытая история ставок лота (план 6: ставки видны всем членам). */
  async list(auctionId: string): Promise<BidRow[]> {
    const auction = await this.db.auction.findUnique({
      where: { id: auctionId },
      include: { lootDrop: { include: { item: true } } },
    });
    if (!auction) throw new NotFoundException('Лот не найден');
    const bids = await this.db.bid.findMany({
      where: { auctionId },
      orderBy: { createdAt: 'asc' },
      include: { member: true },
    });
    return bids.map((bid) => this.toBidRow(bid, bid.member.nickname));
  }

  /**
   * Приём ставки. Правила (план 6): первая — не ниже стартовой, следующие —
   * не ниже текущей плюс шаг; только действующий лот в пределах серверного
   * времени; полная стоимость с наценкой (округление вверх) вместе с
   * замороженными суммами по другим лотам не превышает баланс журнала.
   * Живая раздача запускает торговый таймер от первой ставки; ставка в окне
   * анти-снайпа (включая точную границу) прибавляет продление к окончанию.
   */
  async place(auctionId: string, body: unknown, actor: BidsActor): Promise<PlaceBidResult> {
    const parsed = placeBidSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Некорректная ставка');
    }
    if (!actor.memberId) {
      throw new ForbiddenException('Ставить может только член гильдии');
    }
    const amount = parsed.data.amount;
    const memberId = actor.memberId;
    const now = this.now();

    const result = await serializable(this.db, async (tx) => {
      const auction = await tx.auction.findUnique({
        where: { id: auctionId },
        include: { lootDrop: { include: { item: true } } },
      });
      if (!auction) throw new NotFoundException('Лот не найден');

      const lot = this.toLotParams(auction);
      const existing = await tx.bid.findMany({
        where: { auctionId },
        orderBy: { createdAt: 'asc' },
        include: { member: true },
      });
      const current =
        existing.length === 0 ? null : Math.max(...existing.map((bid) => bid.amount));
      const others = await tx.auction.findMany({
        where: { status: 'OPEN', id: { not: auctionId } },
        include: { bids: true },
      });

      const rejection = checkBidAllowed(lot, current, amount, now);
      if (rejection === 'LOT_NOT_OPEN') {
        throw new ConflictException('Лот не принимает ставки');
      }
      if (rejection === 'LOT_ENDED') {
        throw new ConflictException('Торги по лоту завершены');
      }
      if (rejection === 'BID_TOO_LOW') {
        throw new BadRequestException(`Минимальная ставка — ${minBidAmount(lot, current)}`);
      }

      const member = await tx.member.findUnique({ where: { id: memberId } });
      if (!member) throw new ForbiddenException('Ставить может только член гильдии');

      const foreign = isForeignBidder(lot.targetRoles, member.combatRole);
      const fullCost = bidFullCost(amount, lot.markupPct, foreign);
      const entries = await tx.dkpEntry.findMany({
        where: { memberId },
        select: { amount: true },
      });
      const balance = computeBalance(entries);
      const frozen = frozenOf(memberId, auction.id, others);
      if (!hasAvailableBalance(balance, frozen, fullCost)) {
        throw new BadRequestException(
          `Недостаточно доступного баланса: нужно ${fullCost}, доступно ${balance - frozen}`,
        );
      }

      const bid = await tx.bid.create({
        data: {
          auctionId,
          memberId,
          amount,
          fullCost,
          markupPct: foreign ? lot.markupPct : 0,
        },
      });
      const nextEndsAt = endsAtAfterBid(lot, now);
      const update: { firstBidAt?: Date; endsAt?: Date | null } = {};
      if (lot.firstBidAt === null) update.firstBidAt = now;
      if (nextEndsAt?.getTime() !== lot.endsAt?.getTime()) update.endsAt = nextEndsAt;
      if (Object.keys(update).length > 0) {
        await tx.auction.update({ where: { id: auctionId }, data: update });
      }

      await tx.auditLog.create({
        data: {
          actorMemberId: memberId,
          actorIsAdmin: actor.isAdmin,
          action: 'AUCTION_BID',
          entityType: 'Auction',
          entityId: auctionId,
          comment:
            `Ставка ${amount} на лот «${auction.lootDrop.item.name}»` +
            (foreign ? ` (полная стоимость ${fullCost} с наценкой ${lot.markupPct}%)` : ''),
        },
      });

      return {
        bid: this.toBidRow(bid, member.nickname),
        endsAt: (update.endsAt !== undefined ? update.endsAt : lot.endsAt)?.toISOString() ?? null,
      };
    });
    // Событие realtime — строго после фиксации в БД (issue #97): отклонённая
    // ставка до сюда не доходит, «выглядеть принятой» не может.
    this.events.bidPlaced(auctionId, result.bid, result.endsAt);
    return result;
  }

  private toLotParams(auction: StoredAuction): BidLotParams {
    return {
      status: auction.status as LotStatus,
      startPrice: auction.startPrice,
      step: auction.step,
      timerKind: auction.timerFromFirstBid ? ('FIRST_BID' as LotTimerKind) : ('OPENING' as LotTimerKind),
      durationSec: auction.durationSec,
      antiSnipeSec: auction.antiSnipeSec,
      antiSnipeExtendSec: auction.antiSnipeExtendSec,
      targetRoles: auction.targetRoles,
      markupPct: auction.markupPct,
      firstBidAt: auction.firstBidAt,
      endsAt: auction.endsAt,
    };
  }

  private toBidRow(bid: StoredBid, memberName: string): BidRow {
    return {
      id: bid.id,
      auctionId: bid.auctionId,
      memberId: bid.memberId,
      memberName,
      amount: bid.amount,
      fullCost: bid.fullCost,
      markupPct: bid.markupPct,
      createdAt: bid.createdAt.toISOString(),
    };
  }
}

/**
 * Замороженные средства игрока (план 6, п. 5): полные стоимости его
 * лидирующих ставок на других открытых лотах. Лидер — автор максимальной
 * ставки; при перебивании заморозка снимается автоматически (лидер меняется).
 */
function frozenOf(
  memberId: string,
  currentAuctionId: string,
  openLots: Array<{ id: string; bids: StoredBid[] }>,
): number {
  let frozen = 0;
  for (const lot of openLots) {
    if (lot.id === currentAuctionId) continue;
    const top = lot.bids.reduce<StoredBid | null>(
      (best, bid) => (best === null || bid.amount > best.amount ? bid : best),
      null,
    );
    if (top && top.memberId === memberId) frozen += top.fullCost;
  }
  return frozen;
}
