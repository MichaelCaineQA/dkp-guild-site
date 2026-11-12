import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  winningBid,
  lootLogQuerySchema,
  prefersItemAtLotCreation,
  createStandaloneLotSchema,
  lotDurationSec,
  suggestLotDefaults,
  type AuctionListRow,
  type AuctionListStatus,
  type AuctionLotRow,
  type DashboardAuction,
  type ItemTargetRole,
  type LotDefaults,
  type LotStatus,
  type LootLogPage,
  type LootLogQuery,
  type LootLogRow,
} from '@dkp/shared';
import { NOOP_AUCTION_EVENTS, type AuctionEventsPort } from '../realtime/auction-events';
import { readAuctionSettings, type AuctionSettingsDb } from '../settings/auction-settings';
import type { EventsActor } from '../events/events.service';
import type { AuditWriter } from '../members/members.service';

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
  discountPct: number;
  firstBidAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  lootDrop: {
    itemId: string;
    item: { name: string; rarity: string | null; targetRoles: ItemTargetRole[] };
  };
  bids: StoredBid[];
  award: {
    winnerId: string;
    finalPrice: number;
    markupPct: number;
    discountPct: number;
    winner: { nickname: string };
  } | null;
}

/** Выдача лут-лога: лот → дроп → предмет и событие, получатель, цена. */
interface StoredAward {
  id: string;
  finalPrice: number;
  markupPct: number;
  discountPct: number;
  createdAt: Date;
  winner: { id: string; nickname: string };
  auction: {
    id: string;
    lootDrop: {
      /** null — лот вне ивента, «хранилище гильдии» (#137). */
      event: { id: string; name: string; startsAt: Date } | null;
      item: { name: string; rarity: string | null };
    };
  };
}

interface StoredItem {
  id: string;
  name: string;
  rarity: string | null;
  slot: string | null;
  targetRoles: ItemTargetRole[];
  defaultStartPrice: number | null;
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
  firstBidAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
}

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface AuctionsDb extends AuctionSettingsDb {
  item: {
    findUnique(args: { where: { id: string } }): Promise<StoredItem | null>;
  };
  lootDrop: {
    create(args: {
      data: { eventId: null; itemId: string };
    }): Promise<{ id: string; createdAt: Date }>;
  };
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
    create(args: {
      data: {
        lootDropId: string;
        startPrice: number;
        step: number;
        durationSec: number;
        timerFromFirstBid: boolean;
        antiSnipeSec: number;
        antiSnipeExtendSec: number;
        noBidTimeoutSec: number | null;
        markupPct: number;
        discountPct: number;
        targetRoles: ItemTargetRole[];
        endsAt: Date | null;
      };
    }): Promise<StoredAuction>;
  };
  member: {
    findUnique(args: {
      where: { id: string };
    }): Promise<{
      id: string;
      preferredItemId: string | null;
      prevPreferredItemId: string | null;
      preferredItemChangedAt: Date | null;
    } | null>;
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
  auditLog: AuditWriter;
}

/**
 * Список лотов для экрана аукциона (issue #98, план 2.4/6 п. 10) и данные
 * виджета «Мой аукцион» (план 2.8). Ставки видны всем членам гильдии;
 * myBid — только собственные ставки просматривающего.
 */
@Injectable()
export class AuctionsService {
  constructor(
    private readonly db: AuctionsDb,
    private readonly events: AuctionEventsPort = NOOP_AUCTION_EVENTS,
  ) {}

  /** Лоты одной вкладки: открытые — по ближайшему окончанию, архив — новые сверху. */
  async list(status: AuctionListStatus, viewerMemberId: string | null): Promise<AuctionListRow[]> {
    const orderBy: Array<{ endsAt?: 'asc' | 'desc'; createdAt?: 'asc' | 'desc' }> =
      status === 'OPEN'
        ? [{ endsAt: 'asc' }, { createdAt: 'asc' }]
        : [{ createdAt: 'desc' }];
    const [lots, viewer] = await Promise.all([
      this.db.auction.findMany({
        where: { status },
        orderBy,
        include: {
          lootDrop: { include: { item: true } },
          bids: { include: { member: true } },
          award: { include: { winner: true } },
        },
      }),
      // Снимок предпочтения просматривающего (решение 18): myPreferred —
      // на момент создания каждого лота, не текущий выбор.
      viewerMemberId ? this.db.member.findUnique({ where: { id: viewerMemberId } }) : null,
    ]);
    return lots.map((lot) => this.toRow(lot, viewerMemberId, viewer));
  }

  /** Начальные значения лота вне ивента (план 6, п. 1) — из настроек и предмета. */
  async defaultsForItem(itemId: string): Promise<LotDefaults> {
    const item = await this.mustGetItem(itemId);
    const settings = await readAuctionSettings(this.db);
    return suggestLotDefaults(item, settings);
  }

  /**
   * Создание лота вне ивента — «хранилище гильдии» (#137, план 2.4): дроп
   * без ивента + лот с теми же снапшотами и таймерами, что у лота по дропу
   * ивента (план 6, п. 1–3 и 6). Права auctions.create (Глава/Админ) уже
   * проверены гардом на контроллере — цели-ивента здесь нет.
   */
  async createLot(body: unknown, actor: EventsActor): Promise<AuctionLotRow> {
    const parsed = createStandaloneLotSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Некорректные параметры лота',
      );
    }
    const input = parsed.data;
    const item = await this.mustGetItem(input.itemId);
    const settings = await readAuctionSettings(this.db);
    const durationSec = lotDurationSec(input.durationValue, input.durationUnit);
    const fromFirstBid = input.timerKind === 'FIRST_BID';
    const antiSnipeExtendSec =
      input.antiSnipeExtendSec ??
      (fromFirstBid ? settings.antiSnipeExtendLiveSec : settings.antiSnipeExtendLongSec);
    const drop = await this.db.lootDrop.create({
      data: { eventId: null, itemId: item.id },
    });
    const auction = await this.db.auction.create({
      data: {
        lootDropId: drop.id,
        startPrice: input.startPrice,
        step: input.step,
        durationSec,
        timerFromFirstBid: fromFirstBid,
        antiSnipeSec: input.antiSnipeSec,
        antiSnipeExtendSec,
        noBidTimeoutSec: fromFirstBid ? (input.noBidTimeoutSec ?? null) : null,
        markupPct: settings.foreignClassMarkupPct,
        discountPct: settings.preferredItemDiscountPct,
        targetRoles: item.targetRoles,
        endsAt: fromFirstBid ? null : new Date(Date.now() + durationSec * 1000),
      },
    });
    await this.audit(
      actor,
      'AUCTION_CREATE',
      'Auction',
      auction.id,
      `Лот «${item.name}» (хранилище гильдии): старт ${input.startPrice}, ` +
        `шаг ${input.step}, ${
          fromFirstBid
            ? `живая раздача ${durationSec} сек от первой ставки, тайм-аут без ставок ${input.noBidTimeoutSec} сек`
            : `длинный лот ${durationSec} сек от открытия`
        }, анти-снайп ${input.antiSnipeSec} сек (продление ${antiSnipeExtendSec} сек), ` +
        `наценка ${settings.foreignClassMarkupPct}%, скидка ${settings.preferredItemDiscountPct}%`,
    );
    const lot = this.toLotRow(auction);
    // Новый лот — в общий канал списка сразу после фиксации (issue #97).
    this.events.lotCreated(lot);
    return lot;
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
      discountPct: row.discountPct,
      eventId: drop.event?.id ?? null,
      eventName: drop.event?.name ?? null,
      eventStartsAt: drop.event?.startsAt.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toLotRow(auction: StoredAuction): AuctionLotRow {
    return {
      id: auction.id,
      status: auction.status as LotStatus,
      startPrice: auction.startPrice,
      step: auction.step,
      timerKind: auction.timerFromFirstBid ? 'FIRST_BID' : 'OPENING',
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

  private async mustGetItem(itemId: string): Promise<StoredItem> {
    const item = await this.db.item.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Предмет не найден');
    return item;
  }

  private async audit(
    actor: EventsActor,
    action: string,
    entityType: string,
    entityId: string,
    comment: string,
  ): Promise<void> {
    await this.db.auditLog.create({
      data: {
        actorMemberId: actor.memberId,
        actorIsAdmin: actor.isAdmin,
        action,
        entityType,
        entityId,
        comment,
      },
    });
  }

  private toRow(
    lot: StoredLot,
    viewerMemberId: string | null,
    viewer: Awaited<ReturnType<AuctionsDb['member']['findUnique']>>,
  ): AuctionListRow {
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
      discountPct: lot.discountPct,
      myPreferred: viewer
        ? prefersItemAtLotCreation(viewer, lot.createdAt, lot.lootDrop.itemId)
        : false,
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
            discountPct: lot.award.discountPct,
          }
        : null,
    };
  }
}
