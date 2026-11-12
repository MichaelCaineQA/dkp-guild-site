import { NotFoundException } from '@nestjs/common';
import type { AuditWriter } from '../members/members.service';
import type { ItemTargetRole } from '@dkp/shared';
import { AuctionsService, type AuctionsDb } from './auctions.service';

/** Настройки аукциона как Map Setting-строк (как в loot.service.spec). */
const SETTINGS = new Map<string, number>([
  ['auction.step', 5],
  ['auction.liveDurationSec', 90],
  ['auction.longDurationDays', 2],
  ['auction.antiSnipeLiveSec', 30],
  ['auction.antiSnipeExtendLiveSec', 30],
  ['auction.antiSnipeLongSec', 600],
  ['auction.antiSnipeExtendLongSec', 600],
  ['auction.noBidTimeoutSec', 120],
  ['auction.foreignClassMarkupPct', 50],
  ['auction.preferredItemDiscountPct', 10],
]);

const settingsDb = () => ({
  setting: {
    findMany: async () =>
      [...SETTINGS.entries()].map(([key, value]) => ({ key, value })),
  },
});

const auditDb = () => {
  const audit: Array<Record<string, unknown>> = [];
  return { audit, auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audit.push(data); } } as AuditWriter };
};

const noopAudit: AuditWriter = { create: async () => undefined };

interface LotSeed {
  id: string;
  status?: string;
  endsAt?: Date | null;
  createdAt?: Date;
  itemName?: string;
  itemId?: string;
  rarity?: string | null;
  targetRoles?: ItemTargetRole[];
  bids?: Array<{ memberId: string; nickname: string; amount: number; fullCost?: number }>;
  award?: { winnerId: string; nickname: string; finalPrice: number } | null;
}

/** Просматривающий со снимком предпочтения (решение 18). */
function makeDb(
  lots: LotSeed[],
  viewer?: {
    id: string;
    preferredItemId: string | null;
    prevPreferredItemId?: string | null;
    preferredItemChangedAt?: Date | null;
  },
): AuctionsDb & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    ...settingsDb(),
    auditLog: noopAudit,
    item: { findUnique: async () => null },
    lootDrop: { create: async () => { throw new Error('не должен вызываться'); } },
    auction: {
      create: async () => { throw new Error('не должен вызываться'); },
      findMany: async ({ where, orderBy }) => {
        queries.push(JSON.stringify({ where, orderBy }));
        const matched = lots.filter((lot) => (lot.status ?? 'OPEN') === where.status);
        // применяем orderBy как настоящая БД (иначе тесты врут о порядке)
        if (JSON.stringify(orderBy).includes('"createdAt":"desc"')) {
          matched.sort(
            (a, b) =>
              (b.createdAt ?? new Date('2026-11-10T17:00:00Z')).getTime() -
              (a.createdAt ?? new Date('2026-11-10T17:00:00Z')).getTime(),
          );
        } else {
          matched.sort((a, b) => {
            const ae = a.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
            const be = b.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
            return ae - be;
          });
        }
        return matched
          .map((lot) => ({
            id: lot.id,
            status: lot.status ?? 'OPEN',
            startPrice: 100,
            step: 5,
            timerFromFirstBid: true,
            durationSec: 90,
            antiSnipeSec: 30,
            antiSnipeExtendSec: 30,
            noBidTimeoutSec: 120,
            markupPct: 50,
            discountPct: 10,
            firstBidAt: lot.bids?.length ? new Date('2026-11-10T18:00:00Z') : null,
            endsAt: lot.endsAt ?? null,
            createdAt: lot.createdAt ?? new Date('2026-11-10T17:00:00Z'),
            lootDrop: {
              itemId: lot.itemId ?? 'item-1',
              item: {
                name: lot.itemName ?? 'Предмет',
                rarity: lot.rarity ?? null,
                targetRoles: lot.targetRoles ?? (['ALL'] as ItemTargetRole[]),
              },
            },
            bids: (lot.bids ?? []).map((bid, index) => ({
              id: `${lot.id}-b${index + 1}`,
              memberId: bid.memberId,
              amount: bid.amount,
              fullCost: bid.fullCost ?? bid.amount,
              member: { nickname: bid.nickname },
            })),
            award: lot.award
              ? {
                  winnerId: lot.award.winnerId,
                  finalPrice: lot.award.finalPrice,
                  markupPct: 0,
                  discountPct: 0,
                  winner: { nickname: lot.award.nickname },
                }
              : null,
          }));
      },
    },
    member: {
      findUnique: async ({ where }) =>
        viewer && viewer.id === where.id
          ? {
              id: viewer.id,
              preferredItemId: viewer.preferredItemId,
              prevPreferredItemId: viewer.prevPreferredItemId ?? null,
              preferredItemChangedAt: viewer.preferredItemChangedAt ?? null,
            }
          : null,
    },
    lootAward: { findMany: async () => [], count: async () => 0 },
  } as AuctionsDb & { queries: string[] };
}

describe('AuctionsService (issue #98)', () => {
  it('открытые лоты: ведущая ставка, моя ставка и лидирую ли я', async () => {
    const db = makeDb([
      {
        id: 'a-1',
        endsAt: new Date('2026-11-10T18:01:30Z'),
        bids: [
          { memberId: 'm-1', nickname: 'Воин', amount: 100 },
          { memberId: 'm-2', nickname: 'Целитель', amount: 150, fullCost: 225 },
        ],
      },
    ]);
    const rows = await new AuctionsService(db).list('OPEN', 'm-1');

    expect(rows).toHaveLength(1);
    expect(rows[0]!.topBid).toMatchObject({ memberName: 'Целитель', amount: 150, fullCost: 225 });
    expect(rows[0]!.myBid).toEqual({ amount: 100, leading: false });
    // та же ставка максимальная у автора — leading: true
    const mineLead = await new AuctionsService(makeDb([
      { id: 'a-1', bids: [{ memberId: 'm-1', nickname: 'Воин', amount: 100 }] },
    ])).list('OPEN', 'm-1');
    expect(mineLead[0]!.myBid).toEqual({ amount: 100, leading: true });
  });

  it('без ставок просматривающего myBid=null; без входа — тоже', async () => {
    const rows = await new AuctionsService(
      makeDb([{ id: 'a-1', bids: [{ memberId: 'm-2', nickname: 'Хил', amount: 10 }] }]),
    ).list('OPEN', null);
    expect(rows[0]!.myBid).toBeNull();
  });

  it('myPreferred — снимок предпочтения на момент создания лота (#101)', async () => {
    const lots = [
      { id: 'old', createdAt: new Date('2026-11-01T10:00:00Z') },
      { id: 'new', createdAt: new Date('2026-11-09T10:00:00Z') },
    ];
    // Предмет выбирали до обоих лотов, сменили 10-го — после создания обоих.
    const viewer = {
      id: 'm-1',
      preferredItemId: 'item-2',
      prevPreferredItemId: 'item-1',
      preferredItemChangedAt: new Date('2026-11-10T10:00:00Z'),
    };
    const rows = await new AuctionsService(makeDb(lots, viewer)).list('OPEN', 'm-1');
    expect(rows.map((row) => row.myPreferred)).toEqual([true, true]);
    expect(rows.map((row) => row.discountPct)).toEqual([10, 10]);

    // Смена до создания нового лота: старый лот — со скидкой, новый — без.
    const viewer2 = {
      id: 'm-1',
      preferredItemId: 'item-2',
      prevPreferredItemId: 'item-1',
      preferredItemChangedAt: new Date('2026-11-05T10:00:00Z'),
    };
    const rows2 = await new AuctionsService(makeDb(lots, viewer2)).list('OPEN', 'm-1');
    expect(rows2.map((row) => row.myPreferred)).toEqual([true, false]);

    // Другой предмет в предпочтениях — скидки нет на любом лоте.
    const viewer3 = { id: 'm-1', preferredItemId: 'item-other' };
    const rows3 = await new AuctionsService(makeDb(lots, viewer3)).list('OPEN', 'm-1');
    expect(rows3.map((row) => row.myPreferred)).toEqual([false, false]);
  });

  it('завершённый лот несёт победителя, архив сортируется свежими сверху', async () => {
    const db = makeDb([
      { id: 'old', status: 'CLOSED', createdAt: new Date('2026-11-09T10:00:00Z'), award: { winnerId: 'm-2', nickname: 'Хил', finalPrice: 300 } },
      { id: 'new', status: 'CLOSED', createdAt: new Date('2026-11-10T10:00:00Z') },
    ]);
    const rows = await new AuctionsService(db).list('CLOSED', 'm-2');
    expect(rows.map((row) => row.id)).toEqual(['new', 'old']);
    expect(rows[1]!.winner).toMatchObject({ memberName: 'Хил', finalPrice: 300 });
    expect(db.queries[0]).toContain('"createdAt":"desc"');
  });

  it('виджет «Мой аукцион»: открытый лот с ближайшим окончанием среди моих ставок', async () => {
    const db = makeDb([
      {
        id: 'a-first',
        endsAt: new Date('2026-11-10T18:05:00Z'),
        itemName: 'Клинок',
        bids: [{ memberId: 'm-1', nickname: 'Воин', amount: 100 }],
      },
      {
        id: 'a-mine-later',
        endsAt: new Date('2026-11-10T19:00:00Z'),
        bids: [{ memberId: 'm-1', nickname: 'Воин', amount: 50 }],
      },
      {
        id: 'a-not-mine',
        endsAt: new Date('2026-11-10T18:01:00Z'),
        bids: [{ memberId: 'm-9', nickname: 'Чужой', amount: 500 }],
      },
    ]);
    const widget = await new AuctionsService(db).myNearestBidLot('m-1');
    expect(widget).toMatchObject({
      lotId: 'a-first',
      itemName: 'Клинок',
      status: 'OPEN',
      endsAt: '2026-11-10T18:05:00.000Z',
      topBid: { amount: 100, memberName: 'Воин' },
    });
  });

  it('виджет без ставок или без Member — null', async () => {
    const db = makeDb([{ id: 'a-1', bids: [{ memberId: 'm-9', nickname: 'Чужой', amount: 5 }] }]);
    expect(await new AuctionsService(db).myNearestBidLot('m-1')).toBeNull();
    expect(await new AuctionsService(db).myNearestBidLot(null)).toBeNull();
  });
});

/** Лут-лог (issue #99): строка — только фактическая выдача (LootAward). */
interface AwardSeed {
  id: string;
  winnerId?: string;
  winnerName?: string;
  finalPrice?: number;
  markupPct?: number;
  createdAt?: Date;
  lotId?: string;
  itemId?: string;
  eventId?: string | null;
  eventName?: string;
}

function makeLootDb(
  awards: AwardSeed[],
): AuctionsDb & { findWhere: Array<Record<string, unknown>>; page: Array<Record<string, unknown>> } {
  const findWhere: Array<Record<string, unknown>> = [];
  const page: Array<Record<string, unknown>> = [];
  const db: AuctionsDb & {
    findWhere: Array<Record<string, unknown>>;
    page: Array<Record<string, unknown>>;
  } = {
    findWhere,
    page,
    ...settingsDb(),
    auditLog: noopAudit,
    item: { findUnique: async () => null },
    lootDrop: { create: async () => { throw new Error('не должен вызываться'); } },
    auction: {
      create: async () => { throw new Error('не должен вызываться'); },
      findMany: async () => [],
    },
    member: {
      findUnique: async () => null,
    },
    lootAward: {
      findMany: async ({ where, take, skip }) => {
        findWhere.push(where);
        page.push({ take, skip });
        return awards
          .filter((award) => !where.winnerId || award.winnerId === where.winnerId)
          .slice(skip, take === undefined ? undefined : skip + take)
          .map((award) => ({
            id: award.id,
            finalPrice: award.finalPrice ?? 100,
            markupPct: award.markupPct ?? 0,
            discountPct: 0,
            createdAt: award.createdAt ?? new Date('2026-11-10T19:00:00Z'),
            winner: { id: award.winnerId ?? 'm-1', nickname: award.winnerName ?? 'Воин' },
            auction: {
              id: award.lotId ?? 'a-1',
              lootDrop: {
                event:
                  award.eventId === null
                    ? null
                    : {
                        id: award.eventId ?? 'e-1',
                        name: award.eventName ?? 'Поход',
                        startsAt: new Date('2026-11-10T18:00:00Z'),
                      },
                item: { name: 'Клинок', rarity: 'эпический' },
              },
            },
          }));
      },
      count: async ({ where }) =>
        awards.filter((award) => !where.winnerId || award.winnerId === where.winnerId).length,
    },
  };
  return db as never;
}

describe('AuctionsService.lootLog (issue #99)', () => {
  it('строка лут-лога: предмет, получатель, событие, фактическая стоимость с наценкой', async () => {
    const service = new AuctionsService(
      makeLootDb([{ id: 'w-1', finalPrice: 225, markupPct: 50 }]),
    );
    const result = await service.lootLog({});
    expect(result.total).toBe(1);
    expect(result.entries[0]).toMatchObject({
      awardId: 'w-1',
      lotId: 'a-1',
      itemName: 'Клинок',
      rarity: 'эпический',
      winnerId: 'm-1',
      winnerName: 'Воин',
      finalPrice: 225,
      markupPct: 50,
      eventId: 'e-1',
      eventName: 'Поход',
      eventStartsAt: '2026-11-10T18:00:00.000Z',
      createdAt: '2026-11-10T19:00:00.000Z',
    });
  });

  it('фильтр по игроку уходит в запрос как winnerId', async () => {
    const db = makeLootDb([]);
    await new AuctionsService(db).lootLog({ memberId: 'm-2' });
    expect(db.findWhere[0]).toEqual({ winnerId: 'm-2' });
  });

  it('фильтры по событию и предмету идут через лот и дроп, вместе с игроком', async () => {
    const db = makeLootDb([]);
    await new AuctionsService(db).lootLog({ eventId: 'e-9' });
    expect(db.findWhere[0]).toEqual({ auction: { lootDrop: { eventId: 'e-9' } } });

    await new AuctionsService(db).lootLog({ itemId: 'i-7' });
    expect(db.findWhere[1]).toEqual({ auction: { lootDrop: { itemId: 'i-7' } } });

    await new AuctionsService(db).lootLog({ memberId: 'm-2', eventId: 'e-9', itemId: 'i-7' });
    expect(db.findWhere[2]).toEqual({
      winnerId: 'm-2',
      auction: { lootDrop: { eventId: 'e-9', itemId: 'i-7' } },
    });
  });

  it('без фильтров where пуст — все выдачи; пагинация применяется', async () => {
    const db = makeLootDb([
      { id: 'w-1', createdAt: new Date('2026-11-10T19:00:00Z') },
      { id: 'w-2', createdAt: new Date('2026-11-09T19:00:00Z') },
    ]);
    const service = new AuctionsService(db);
    const first = await service.lootLog({});
    expect(first.total).toBe(2);
    expect(db.findWhere[0]).toEqual({});
    expect(db.page[0]).toEqual({ take: 50, skip: 0 });

    const second = await service.lootLog({ limit: 1, offset: 1 });
    expect(second.entries.map((row) => row.awardId)).toEqual(['w-2']);
    expect(second.total).toBe(2);
  });

  it('некорректный запрос отклоняется до БД', async () => {
    const db = makeLootDb([]);
    await expect(new AuctionsService(db).lootLog({ limit: 999 })).rejects.toThrow();
    expect(db.findWhere).toHaveLength(0);
  });

  it('выдача лота вне ивента: event-поля null (#137)', async () => {
    const result = await new AuctionsService(makeLootDb([{ id: 'w-1', eventId: null }])).lootLog(
      {},
    );
    expect(result.entries[0]).toMatchObject({
      awardId: 'w-1',
      eventId: null,
      eventName: null,
      eventStartsAt: null,
    });
  });
});

/** Фейк БД для создания лота вне ивента (#137). */
function makeCreateDb(item: {
  id: string;
  name: string;
  targetRoles?: ItemTargetRole[];
  defaultStartPrice?: number | null;
} | null) {
  const { audit, auditLog } = auditDb();
  const created = {
    drop: null as { data: { eventId: null; itemId: string } } | null,
    auction: null as Record<string, unknown> | null,
  };
  const emitted: unknown[] = [];
  const events = {
    lotCreated: (lot: unknown) => {
      emitted.push(lot);
    },
    bidPlaced: () => undefined,
    lotUpdated: () => undefined,
    lotClosed: () => undefined,
  };
  const db = {
    ...settingsDb(),
    auditLog,
    item: {
      findUnique: async () =>
        item
          ? {
              id: item.id,
              name: item.name,
              rarity: null,
              slot: null,
              targetRoles: item.targetRoles ?? (['DPS'] as ItemTargetRole[]),
              defaultStartPrice: item.defaultStartPrice ?? null,
            }
          : null,
    },
    lootDrop: {
      create: async ({ data }: { data: { eventId: null; itemId: string } }) => {
        created.drop = { data: { ...data } };
        return { id: 'drop-1', createdAt: new Date('2026-11-12T10:00:00Z') };
      },
    },
    auction: {
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        created.auction = { ...data };
        return {
          id: 'auc-1',
          status: 'OPEN',
          ...data,
          firstBidAt: null,
          createdAt: new Date('2026-11-12T10:00:00Z'),
        } as never;
      },
    },
    member: { findUnique: async () => null },
    lootAward: { findMany: async () => [], count: async () => 0 },
  };
  return { db: db as unknown as AuctionsDb, created, audit, emitted, events };
}

const LONG_LOT_BODY = {
  itemId: 'item-1',
  startPrice: 120,
  step: 5,
  timerKind: 'OPENING',
  durationValue: 2,
  durationUnit: 'DAYS',
  antiSnipeSec: 600,
  noBidTimeoutSec: undefined,
};

describe('AuctionsService.createLot — лот вне ивента (#137)', () => {
  it('дефолты по предмету: рекомендованная цена и настройки', async () => {
    const { db } = makeCreateDb({ id: 'item-1', name: 'Клинок', defaultStartPrice: 120 });
    const defaults = await new AuctionsService(db).defaultsForItem('item-1');
    expect(defaults).toMatchObject({
      startPrice: 120,
      step: 5,
      markupPct: 50,
      discountPct: 10,
      long: { durationValue: 2, durationUnit: 'DAYS', antiSnipeSec: 600 },
    });
  });

  it('дефолты: предмет не найден — 404', async () => {
    const { db } = makeCreateDb(null);
    await expect(new AuctionsService(db).defaultsForItem('nope')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('длинный лот: дроп без ивента, снапшоты настроек, endsAt от открытия', async () => {
    const fake = makeCreateDb({ id: 'item-1', name: 'Клинок' });
    const before = Date.now();
    const lot = await new AuctionsService(fake.db as AuctionsDb, fake.events as never).createLot(
      LONG_LOT_BODY,
      { memberId: 'm-1', isAdmin: false },
    );
    expect(fake.created.drop).toEqual({ data: { eventId: null, itemId: 'item-1' } });
    expect(fake.created.auction).toMatchObject({
      lootDropId: 'drop-1',
      startPrice: 120,
      step: 5,
      durationSec: 2 * 86_400,
      timerFromFirstBid: false,
      antiSnipeSec: 600,
      antiSnipeExtendSec: 600, // из настроек для длинного лота
      noBidTimeoutSec: null,
      markupPct: 50,
      discountPct: 10,
      targetRoles: ['DPS'],
    });
    const endsAt = fake.created.auction!.endsAt as Date;
    expect(endsAt.getTime()).toBeGreaterThanOrEqual(before + 2 * 86_400 * 1000);
    expect(lot).toMatchObject({ id: 'auc-1', status: 'OPEN', timerKind: 'OPENING' });
    // аудит и рассылка нового лота в общий канал
    expect(fake.audit[0]).toMatchObject({
      action: 'AUCTION_CREATE',
      entityType: 'Auction',
      entityId: 'auc-1',
      actorMemberId: 'm-1',
    });
    expect(String(fake.audit[0]!.comment)).toContain('хранилище гильдии');
    expect(fake.emitted).toHaveLength(1);
  });

  it('живая раздача: endsAt=null до первой ставки, тайм-аут без ставок', async () => {
    const fake = makeCreateDb({ id: 'item-1', name: 'Клинок' });
    await new AuctionsService(fake.db as AuctionsDb, fake.events as never).createLot(
      {
        ...LONG_LOT_BODY,
        timerKind: 'FIRST_BID',
        durationValue: 1.5,
        durationUnit: 'MINUTES',
        antiSnipeSec: 30,
        noBidTimeoutSec: 120,
      },
      { memberId: null, isAdmin: true },
    );
    expect(fake.created.auction).toMatchObject({
      timerFromFirstBid: true,
      durationSec: 90,
      endsAt: null,
      noBidTimeoutSec: 120,
      antiSnipeExtendSec: 30, // из настроек для живой раздачи
    });
    expect(fake.audit[0]).toMatchObject({ actorMemberId: null, actorIsAdmin: true });
  });

  it('некорректные параметры и неизвестный предмет отклоняются', async () => {
    const fake = makeCreateDb({ id: 'item-1', name: 'Клинок' });
    const service = new AuctionsService(fake.db as AuctionsDb);
    await expect(service.createLot({ ...LONG_LOT_BODY, durationValue: 15 }, { memberId: 'm-1', isAdmin: false })).rejects.toThrow();
    await expect(service.createLot({ ...LONG_LOT_BODY, itemId: '' }, { memberId: 'm-1', isAdmin: false })).rejects.toThrow();
    await expect(
      new AuctionsService(makeCreateDb(null).db).createLot(LONG_LOT_BODY, { memberId: 'm-1', isAdmin: false }),
    ).rejects.toThrow(NotFoundException);
  });
});
