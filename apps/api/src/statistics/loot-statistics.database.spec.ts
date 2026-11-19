import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { LootStatisticsService } from './loot-statistics.service';
import type { PrismaService } from '../prisma/prisma.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

/**
 * Сценарий приёмки #216: выпало без лота, открытый/отменённый/закрытый без
 * победителя лот, выдано позже в другом периоде, ручной победитель, дроп
 * и выдача хранилища; переводы после ивента не переносят выдачу новой
 * команде; суммы выдач сходятся со списаниями журнала.
 */
suite('Лут-статистика в PostgreSQL', () => {
  const suffix = randomUUID().slice(0, 8);
  const ids: {
    guild: string;
    kps: string[];
    packs: string[];
    members: string[];
    types: string[];
    items: string[];
    events: string[];
    drops: string[];
    auctions: string[];
    awards: string[];
    entries: string[];
  } = {
    guild: '',
    kps: [],
    packs: [],
    members: [],
    types: [],
    items: [],
    events: [],
    drops: [],
    auctions: [],
    awards: [],
    entries: [],
  };
  let db: PrismaClient;
  let service: LootStatisticsService;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    service = new LootStatisticsService(db as PrismaService);

    const old = new Date('2025-01-01T00:00:00Z');
    ids.guild = (
      await db.guild.create({
        data: { name: `lootstats-${suffix}`, gameTimeAnchor: old, createdAt: old },
      })
    ).id;
    for (const name of ['alpha', 'beta']) {
      ids.kps.push(
        (
          await db.kP.create({
            data: { name: `lootstats-${name}-${suffix}`, guildId: ids.guild, createdAt: old },
          })
        ).id,
      );
      ids.packs.push(
        (
          await db.pack.create({
            data: {
              name: `lootstats-${name}-${suffix}`,
              kpId: ids.kps[ids.kps.length - 1]!,
              createdAt: old,
            },
          })
        ).id,
      );
    }
    const [kp1, pack1, pack2] = [ids.kps[0]!, ids.packs[0]!, ids.packs[1]!];
    for (const nickname of ['alpha', 'beta']) {
      const member = await db.member.create({
        data: { nickname: `lootstats-${nickname}-${suffix}`, packId: pack1, createdAt: old },
      });
      ids.members.push(member.id);
    }
    const [alpha, beta] = ids.members;
    for (const name of ['raid', 'siege']) {
      ids.types.push(
        (await db.eventType.create({ data: { name: `lootstats-${name}-${suffix}` } })).id,
      );
    }
    const [raid, siege] = ids.types;
    for (const [name, isArchboss] of [
      ['sword', false],
      ['bow', true],
      ['staff', false],
    ] as const) {
      ids.items.push(
        (await db.item.create({ data: { name: `lootstats-${name}-${suffix}`, isArchboss } })).id,
      );
    }
    const [sword, bow, staff] = ids.items;

    // История принадлежности делает команды на момент ивентов известными.
    for (const memberId of ids.members) {
      await db.memberPackHistory.create({
        data: {
          memberId,
          previousPackId: pack1,
          packId: pack1,
          changedAt: new Date('2025-12-01T00:00:00Z'),
        },
      });
    }
    // Beta перешла во второй пак после ивентов: старые выдачи остаются первой команде.
    await db.memberPackHistory.create({
      data: {
        memberId: beta!,
        previousPackId: pack1,
        packId: pack2,
        changedAt: new Date('2026-07-01T00:00:00Z'),
      },
    });
    await db.member.update({ where: { id: beta! }, data: { packId: pack2 } });
    for (const [packId, kpId] of [
      [pack1, kp1],
      [pack2, ids.kps[1]!],
    ]) {
      await db.packMembershipHistory.create({
        data: { packId, previousKpId: kpId, kpId, changedAt: new Date('2025-12-01T00:00:00Z') },
      });
    }

    // e1 — рейд до периода (дроп мая, выдача июня), e2 — осада в периоде.
    const scenarios = [
      {
        id: 'e1',
        day: '2026-05-20',
        type: raid!,
        mode: 'PVE' as const,
        scope: 'GUILD' as const,
        packId: null,
      },
      {
        id: 'e2',
        day: '2026-06-04',
        type: siege!,
        mode: 'PVP' as const,
        scope: 'PACK' as const,
        packId: pack1,
      },
    ];
    for (const scenario of scenarios) {
      const startsAt = new Date(`${scenario.day}T16:00:00Z`);
      const event = await db.event.create({
        data: {
          name: `lootstats-${scenario.id}-${suffix}`,
          eventTypeId: scenario.type,
          mode: scenario.mode,
          scope: scenario.scope,
          packId: scenario.packId,
          status: 'FINISHED',
          raidLeadId: alpha!,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
          dkpReward: 0,
        },
      });
      ids.events.push(event.id);
    }
    const [e1, e2] = ids.events;

    // Дропы июня на осаде: выдача, без лота, открытый, отменённый,
    // закрытый без победителя, ручной победитель.
    const juneDrops: { item: string; at: string }[] = [
      { item: sword, at: '2026-06-04T17:00:00Z' },
      { item: sword, at: '2026-06-04T17:05:00Z' },
      { item: bow, at: '2026-06-04T17:10:00Z' },
      { item: bow, at: '2026-06-04T17:15:00Z' },
      { item: staff, at: '2026-06-04T17:20:00Z' },
      { item: staff, at: '2026-06-04T17:25:00Z' },
    ];
    for (const row of juneDrops) {
      const drop = await db.lootDrop.create({
        data: { itemId: row.item, eventId: e2, createdAt: new Date(row.at) },
      });
      ids.drops.push(drop.id);
    }
    // Дроп мая (рейд) и дроп хранилища (без ивента).
    for (const row of [
      { item: bow, eventId: e1, at: '2026-05-20T17:00:00Z' },
      { item: sword, eventId: null, at: '2026-06-20T10:00:00Z' },
    ]) {
      ids.drops.push(
        (
          await db.lootDrop.create({
            data: { itemId: row.item, eventId: row.eventId, createdAt: new Date(row.at) },
          })
        ).id,
      );
    }
    const [dSwordA, , dBowA, dBowB, dStaffA, dStaffB, dBowMay, dStorage] = ids.drops;

    // Лоты: открытый — без ставок и таймеров, свипер его не закрывает.
    const lots: { dropId: string; status: 'OPEN' | 'CLOSED' | 'CANCELLED' }[] = [
      { dropId: dSwordA!, status: 'CLOSED' },
      { dropId: dBowA!, status: 'OPEN' },
      { dropId: dBowB!, status: 'CANCELLED' },
      { dropId: dStaffA!, status: 'CLOSED' },
      { dropId: dStaffB!, status: 'CLOSED' },
      { dropId: dBowMay!, status: 'CLOSED' },
      { dropId: dStorage!, status: 'CLOSED' },
    ];
    for (const lot of lots) {
      ids.auctions.push(
        (
          await db.auction.create({
            data: { lootDropId: lot.dropId, durationSec: 60, status: lot.status },
          })
        ).id,
      );
    }
    const [aSwordA, , , , aStaffB, aBowMay, aStorage] = ids.auctions;
    // dSwordB — выпал без лота; dStaffA — закрыт без победителя.

    // Выдачи: победитель по ставке, ручной победитель, поздняя выдача
    // майского дропа и выдача хранилища — со связанными списаниями журнала.
    const awardRows = [
      {
        auctionId: aSwordA!,
        winnerId: alpha!,
        finalPrice: 30,
        markupPct: 10,
        at: '2026-06-05T10:00:00Z',
      },
      {
        auctionId: aStaffB!,
        winnerId: beta!,
        finalPrice: 5,
        markupPct: 0,
        at: '2026-06-10T09:00:00Z',
      },
      {
        auctionId: aBowMay!,
        winnerId: alpha!,
        finalPrice: 20,
        markupPct: 0,
        at: '2026-06-15T11:00:00Z',
      },
      {
        auctionId: aStorage!,
        winnerId: alpha!,
        finalPrice: 10,
        markupPct: 0,
        at: '2026-06-21T10:00:00Z',
      },
    ];
    for (const row of awardRows) {
      ids.awards.push(
        (
          await db.lootAward.create({
            data: {
              auctionId: row.auctionId,
              winnerId: row.winnerId,
              finalPrice: row.finalPrice,
              markupPct: row.markupPct,
              createdAt: new Date(row.at),
            },
          })
        ).id,
      );
      ids.entries.push(
        (
          await db.dkpEntry.create({
            data: {
              memberId: row.winnerId,
              type: 'AUCTION_SPEND',
              amount: -row.finalPrice,
              auctionId: row.auctionId,
              createdAt: new Date(row.at),
            },
          })
        ).id,
      );
    }
  });

  afterAll(async () => {
    if (!db) return;
    await db.dkpEntry.deleteMany({ where: { id: { in: ids.entries } } });
    await db.lootAward.deleteMany({ where: { id: { in: ids.awards } } });
    await db.auction.deleteMany({ where: { id: { in: ids.auctions } } });
    await db.lootDrop.deleteMany({ where: { id: { in: ids.drops } } });
    await db.event.deleteMany({ where: { id: { in: ids.events } } });
    await db.memberPackHistory.deleteMany({ where: { memberId: { in: ids.members } } });
    await db.packMembershipHistory.deleteMany({ where: { packId: { in: ids.packs } } });
    await db.member.deleteMany({ where: { id: { in: ids.members } } });
    await db.pack.deleteMany({ where: { id: { in: ids.packs } } });
    await db.kP.deleteMany({ where: { id: { in: ids.kps } } });
    await db.eventType.deleteMany({ where: { id: { in: ids.types } } });
    await db.item.deleteMany({ where: { id: { in: ids.items } } });
    await db.guild.deleteMany({ where: { id: ids.guild } });
    await db.$disconnect();
  });

  const june = { from: '2026-06-01', to: '2026-06-30' };
  const itemNames = (name: string) => `lootstats-${name}-${suffix}`;

  it('keeps every drop of the sample with shares summing to 100', async () => {
    const report = await service.get(june);
    expect(report.dropped.totals).toEqual({ drops: 6, items: 3 });
    // Поровну по два выпадения: порядок по имени, доли 34/33/33 — сумма 100.
    expect(report.dropped.items.map((row) => row.itemName)).toEqual([
      itemNames('bow'),
      itemNames('staff'),
      itemNames('sword'),
    ]);
    expect(report.dropped.items.map((row) => row.sharePct)).toEqual([34, 33, 33]);
    expect(report.dropped.items.reduce((sum, row) => sum + row.sharePct, 0)).toBe(100);
    // Статусы лотов объясняют отсутствие выдачи; один меч выпал без лота.
    const statuses = (name: string) =>
      report.dropped.items
        .find((row) => row.itemName === itemNames(name))!
        .details.map((row) => row.lotStatus)
        .sort();
    expect(statuses('sword')).toEqual(['CLOSED', null]);
    expect(statuses('bow')).toEqual(['CANCELLED', 'OPEN']);
    expect(statuses('staff')).toEqual(['CLOSED', 'CLOSED']);
    const sword = report.dropped.items.find((row) => row.itemName === itemNames('sword'))!;
    expect(sword.isArchboss).toBe(false);
    expect(sword.details).toHaveLength(2);
    // Команда дропа — область ивента на его дату.
    expect(sword.details[0]).toMatchObject({
      eventId: ids.events[1],
      mode: 'PVP',
      packId: ids.packs[0],
      kpId: ids.kps[0],
      teamStatus: 'KNOWN',
    });
    const bow = report.dropped.items.find((row) => row.itemName === itemNames('bow'))!;
    expect(bow.isArchboss).toBe(true);
    // Топ обзора — вся выборка «Выпало», «Остальное» не требуется.
    expect(report.top.map((row) => (row.kind === 'ITEM' ? row.itemName : 'REST'))).toEqual([
      itemNames('bow'),
      itemNames('staff'),
      itemNames('sword'),
    ]);
    expect(report.top.reduce((sum, row) => sum + row.sharePct, 0)).toBe(100);
  });

  it('counts only LootAward with actual spend and historical attribution', async () => {
    const report = await service.get(june);
    expect(report.awarded.totals).toEqual({ awards: 3, spent: 55 });
    // Свежие выдачи сверху: поздняя выдача майского дропа — тоже июньская.
    expect(report.awarded.awards.map((row) => row.finalPrice)).toEqual([20, 5, 30]);
    const [late, manual, won] = report.awarded.awards;
    expect(late).toMatchObject({
      memberId: ids.members[0],
      eventId: ids.events[0],
      mode: 'PVE',
      packId: ids.packs[0],
      kpId: ids.kps[0],
      teamStatus: 'KNOWN',
    });
    expect(late!.occurredAt).toBe('2026-06-15T11:00:00.000Z');
    // Ручной победитель — произвольная цена, выдача считается.
    expect(manual).toMatchObject({ memberId: ids.members[1], finalPrice: 5, markupPct: 0 });
    // Перевод beta после ивента не перенёс выдачу новой команде.
    expect(manual).toMatchObject({ packId: ids.packs[0], kpId: ids.kps[0], teamStatus: 'KNOWN' });
    expect(won).toMatchObject({ finalPrice: 30, markupPct: 10, discountPct: 0 });
    expect(report.awarded.members).toEqual([
      {
        id: ids.members[0],
        nickname: `lootstats-alpha-${suffix}`,
        totals: { awards: 2, spent: 50 },
      },
      { id: ids.members[1], nickname: `lootstats-beta-${suffix}`, totals: { awards: 1, spent: 5 } },
    ]);
    expect(report.awarded.packs).toEqual([
      { id: ids.packs[0], name: `lootstats-alpha-${suffix}`, totals: { awards: 3, spent: 55 } },
    ]);
    expect(report.awarded.kps).toEqual([
      { id: ids.kps[0], name: `lootstats-alpha-${suffix}`, totals: { awards: 3, spent: 55 } },
    ]);
    // Суммы выдач сходятся с фактическими списаниями журнала.
    const awardedAuctions = report.awarded.awards.map((row) => row.auctionId);
    const [eventSpend, storageSpend] = await Promise.all([
      db.dkpEntry.aggregate({
        _sum: { amount: true },
        where: { type: 'AUCTION_SPEND', auctionId: { in: awardedAuctions } },
      }),
      db.dkpEntry.aggregate({
        _sum: { amount: true },
        where: {
          type: 'AUCTION_SPEND',
          auctionId: { in: ids.auctions.filter((id) => !awardedAuctions.includes(id)) },
        },
      }),
    ]);
    expect(-(eventSpend._sum.amount ?? 0)).toBe(55);
    expect(-(storageSpend._sum.amount ?? 0)).toBe(10);
  });

  it('keeps storage drops and awards in a separate unfiltered category', async () => {
    const report = await service.get(june);
    expect(report.dropped.withoutEvent.totals).toEqual({ drops: 1, items: 1 });
    const [storageItem] = report.dropped.withoutEvent.items;
    expect(storageItem).toMatchObject({
      itemName: itemNames('sword'),
      count: 1,
      sharePct: 100,
    });
    expect(storageItem!.details[0]).toMatchObject({
      eventId: null,
      eventName: null,
      mode: null,
      packId: null,
      kpId: null,
      lotStatus: 'CLOSED',
    });
    expect(report.awarded.withoutEvent.totals).toEqual({ awards: 1, spent: 10 });
    expect(report.awarded.withoutEvent.members).toEqual([
      {
        id: ids.members[0],
        nickname: `lootstats-alpha-${suffix}`,
        totals: { awards: 1, spent: 10 },
      },
    ]);
    // Фильтры не трогают категорию «Без ивента».
    const pve = await service.get({ ...june, mode: 'PVE' });
    expect(pve.dropped.withoutEvent.totals).toEqual({ drops: 1, items: 1 });
    expect(pve.awarded.withoutEvent.totals).toEqual({ awards: 1, spent: 10 });
  });

  it('separates drop and award periods', async () => {
    const may = await service.get({ from: '2026-05-01', to: '2026-05-31' });
    // Май: дроп есть, выдачи ещё нет — выпуск не означает покупку.
    expect(may.dropped.totals).toEqual({ drops: 1, items: 1 });
    expect(may.dropped.items[0]).toMatchObject({
      itemName: itemNames('bow'),
      count: 1,
      sharePct: 100,
    });
    expect(may.dropped.items[0]!.details[0]).toMatchObject({
      eventId: ids.events[0],
      mode: 'PVE',
      packId: null,
      kpId: null,
      teamStatus: 'NO_HISTORICAL_DATA',
    });
    expect(may.dropped.withoutEvent.totals).toEqual({ drops: 0, items: 0 });
    expect(may.awarded.totals).toEqual({ awards: 0, spent: 0 });
    expect(may.awarded.awards).toEqual([]);
    expect(may.awarded.withoutEvent.totals).toEqual({ awards: 0, spent: 0 });
    // Июнь: тот дроп не выпадал, но выдача получена.
    const juneReport = await service.get(june);
    expect(juneReport.dropped.totals).toEqual({ drops: 6, items: 3 });
    expect(juneReport.awarded.totals).toEqual({ awards: 3, spent: 55 });
  });

  it('applies shared filters to both views without event facts', async () => {
    const pvp = await service.get({ ...june, mode: 'PVP' });
    expect(pvp.dropped.totals).toEqual({ drops: 6, items: 3 });
    expect(pvp.awarded.totals).toEqual({ awards: 2, spent: 35 });
    expect(pvp.awarded.awards.map((row) => row.finalPrice)).toEqual([5, 30]);
    const pve = await service.get({ ...june, mode: 'PVE' });
    expect(pve.dropped.totals).toEqual({ drops: 0, items: 0 });
    // Поздняя выдача майского дропа входит июньским PVE-срезом.
    expect(pve.awarded.totals).toEqual({ awards: 1, spent: 20 });
    const siege = await service.get({ ...june, eventTypeId: ids.types[1]! });
    expect(siege.dropped.totals.drops).toBe(6);
    expect(siege.awarded.totals).toEqual({ awards: 2, spent: 35 });
    // Историческая команда: чужой пак исключает известные attributions.
    const otherPack = await service.get({ ...june, packId: ids.packs[1]! });
    expect(otherPack.dropped.items).toEqual([]);
    expect(otherPack.awarded.totals).toEqual({ awards: 0, spent: 0 });
    const ownPack = await service.get({ ...june, packId: ids.packs[0]! });
    expect(ownPack.dropped.totals.drops).toBe(6);
    expect(ownPack.awarded.totals).toEqual({ awards: 3, spent: 55 });
    const ownKp = await service.get({ ...june, kpId: ids.kps[0]! });
    expect(ownKp.awarded.totals).toEqual({ awards: 3, spent: 55 });
    await expect(service.get({ ...june, kpId: 'missing' })).rejects.toThrow('Неизвестный фильтр');
  });
});
