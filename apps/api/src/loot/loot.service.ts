import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  can,
  createDropSchema,
  createLotSchema,
  lotDurationSec,
  suggestLotDefaults,
  type AuctionLotRow,
  type ItemTargetRole,
  type LotDefaults,
  type LootDropRow,
  type LotStatus,
} from '@dkp/shared';
import { NOOP_AUCTION_EVENTS, type AuctionEventsPort } from '../realtime/auction-events';
import { readAuctionSettings } from '../settings/auction-settings';
import type { EventsActor } from '../events/events.service';
import type { AuditWriter } from '../members/members.service';

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

interface StoredDrop {
  id: string;
  eventId: string;
  itemId: string;
  createdAt: Date;
  item: StoredItem;
  auction: StoredAuction | null;
}

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface LootDb {
  event: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      status: string;
      raidLeadId: string;
      creatorId?: string | null;
    } | null>;
  };
  item: {
    findUnique(args: { where: { id: string } }): Promise<StoredItem | null>;
  };
  lootDrop: {
    findMany(args: {
      where: { eventId: string };
      include: { item: true; auction: true };
      orderBy: { createdAt: 'asc' };
    }): Promise<StoredDrop[]>;
    findUnique(args: {
      where: { id: string };
      include: { item: true; auction: true };
    }): Promise<StoredDrop | null>;
    create(args: {
      data: { eventId: string; itemId: string };
    }): Promise<{ id: string; createdAt: Date }>;
  };
  auction: {
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
  setting: {
    findMany(args: {
      where: { key: { in: string[] } };
      select: { key: true; value: true };
    }): Promise<{ key: string; value: unknown }[]>;
  };
  auditLog: AuditWriter;
}

/**
 * Дроп и создание лота в проведении ивента (issue #93, план 2.4 и 6).
 * Права — управляющие ивента (events.conduct, план 2.6); каждое действие
 * пишется в AuditLog. Ограничения статусов по 2.6: фиксация дропа и создание
 * лота — на запланированном или идущем ивенте; завершённый — только
 * корректировка итогов, отменённый — только просмотр. Уже созданные лоты
 * продолжают торги независимо от статуса ивента.
 */
@Injectable()
export class LootService {
  constructor(
    private readonly db: LootDb,
    private readonly events: AuctionEventsPort = NOOP_AUCTION_EVENTS,
  ) {}

  /** Дропы ивента с лотами — просмотр управляющим на любом статусе. */
  async listForActor(
    eventId: string,
    actor: EventsActor,
    actorRank: string | null,
  ): Promise<LootDropRow[]> {
    await this.assertCanConduct(eventId, actor, actorRank);
    const drops = await this.db.lootDrop.findMany({
      where: { eventId },
      include: { item: true, auction: true },
      orderBy: { createdAt: 'asc' },
    });
    return drops.map((drop) => this.toDropRow(drop));
  }

  /** Начальные значения лота из настроек и предмета (план 6, п. 1). */
  async defaultsForActor(
    eventId: string,
    itemId: string,
    actor: EventsActor,
    actorRank: string | null,
  ): Promise<LotDefaults> {
    await this.assertCanConduct(eventId, actor, actorRank);
    const item = await this.mustGetItem(itemId);
    const settings = await readAuctionSettings(this.db);
    return suggestLotDefaults(item, settings);
  }

  /** Фиксация выпавшего предмета из справочника. */
  async createDrop(
    eventId: string,
    body: unknown,
    actor: EventsActor,
    actorRank: string | null,
  ): Promise<LootDropRow> {
    const parsed = createDropSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Выберите предмет из справочника');
    await this.assertCanConduct(eventId, actor, actorRank, true);
    const item = await this.mustGetItem(parsed.data.itemId);

    const drop = await this.db.lootDrop.create({
      data: { eventId, itemId: item.id },
    });
    await this.audit(
      actor,
      'LOOT_DROP_CREATE',
      'LootDrop',
      drop.id,
      `Зафиксирован дроп «${item.name}» на ивенте ${eventId}`,
    );
    return this.toDropRow({ ...drop, itemId: item.id, eventId, item, auction: null });
  }

  /**
   * Создание открытого лота по дропу (план 6, п. 1–3): живой раздаче таймер
   * запускается от первой ставки (до неё endsAt пуст, без ставок лот закроет
   * тайм-аут noBidTimeoutSec), длинный лот отсчитывается от открытия.
   * Наценка и разметка предмета фиксируются на лоте (план 6, п. 6).
   */
  async createLot(
    eventId: string,
    dropId: string,
    body: unknown,
    actor: EventsActor,
    actorRank: string | null,
  ): Promise<AuctionLotRow> {
    const parsed = createLotSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Некорректные параметры лота',
      );
    }
    const input = parsed.data;
    await this.assertCanConduct(eventId, actor, actorRank, true);

    const drop = await this.db.lootDrop.findUnique({
      where: { id: dropId },
      include: { item: true, auction: true },
    });
    if (!drop || drop.eventId !== eventId) throw new NotFoundException('Дроп не найден');
    if (drop.auction) throw new ConflictException('Лот по этому дропу уже создан');

    const settings = await readAuctionSettings(this.db);
    const durationSec = lotDurationSec(input.durationValue, input.durationUnit);
    const fromFirstBid = input.timerKind === 'FIRST_BID';
    const antiSnipeExtendSec =
      input.antiSnipeExtendSec ??
      (fromFirstBid ? settings.antiSnipeExtendLiveSec : settings.antiSnipeExtendLongSec);
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
        targetRoles: drop.item.targetRoles,
        endsAt: fromFirstBid ? null : new Date(Date.now() + durationSec * 1000),
      },
    });
    await this.audit(
      actor,
      'AUCTION_CREATE',
      'Auction',
      auction.id,
      `Лот «${drop.item.name}» (дроп ${drop.id}, ивент ${eventId}): старт ${input.startPrice}, ` +
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
   * Права: управляющие ивента (план 2.6). Ограничения статусов: запись —
   * только на запланированном или идущем ивенте; завершённый и отменённый —
   * просмотр (2.6), созданные лоты при этом живут своими таймерами (2.4).
   */
  private async assertCanConduct(
    eventId: string,
    actor: EventsActor,
    actorRank: string | null,
    forWrite = false,
  ) {
    const event = await this.db.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Ивент не найден');
    const allowed = can(
      { rank: actorRank as never, isAdmin: actor.isAdmin, memberId: actor.memberId },
      'events.conduct',
      event,
    );
    if (!allowed) {
      throw new ForbiddenException('Дроп и лоты — Главе, Админу и управляющим ивента');
    }
    if (forWrite && event.status !== 'PLANNED' && event.status !== 'RUNNING') {
      throw new ConflictException(
        'Дроп и лоты фиксируются на запланированном или идущем ивенте',
      );
    }
    return event;
  }

  private async mustGetItem(itemId: string): Promise<StoredItem> {
    const item = await this.db.item.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Предмет не найден');
    return item;
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

  private toDropRow(drop: StoredDrop): LootDropRow {
    return {
      id: drop.id,
      eventId: drop.eventId,
      itemId: drop.itemId,
      itemName: drop.item.name,
      rarity: drop.item.rarity,
      slot: drop.item.slot,
      targetRoles: drop.item.targetRoles,
      createdAt: drop.createdAt.toISOString(),
      lot: drop.auction ? this.toLotRow(drop.auction) : null,
    };
  }

  private async audit(
    actor: EventsActor,
    action: string,
    entityType: string,
    entityId: string,
    comment: string,
  ) {
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
}
