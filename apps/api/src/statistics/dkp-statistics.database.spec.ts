import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { aggregateDkpTotals } from '@dkp/shared';
import { DkpStatisticsService } from './dkp-statistics.service';
import type { PrismaService } from '../prisma/prisma.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

/**
 * Сценарий приёмки #215: начисление, покупка, положительная и отрицательная
 * корректировки, поздняя корректировка ивента до периода и операции без ивента
 * (админ-начисление и лот хранилища).
 */
suite('ДКП-статистика в PostgreSQL', () => {
  const suffix = randomUUID().slice(0, 8);
  const ids: {
    guild: string;
    kp: string;
    pack: string;
    members: string[];
    types: string[];
    events: string[];
    entries: string[];
    auctions: string[];
    drops: string[];
    item: string;
  } = {
    guild: '',
    kp: '',
    pack: '',
    members: [],
    types: [],
    events: [],
    entries: [],
    auctions: [],
    drops: [],
    item: '',
  };
  let db: PrismaClient;
  let service: DkpStatisticsService;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    service = new DkpStatisticsService(db as PrismaService);

    const old = new Date('2025-01-01T00:00:00Z');
    ids.guild = (
      await db.guild.create({
        data: { name: `dkpstats-${suffix}`, gameTimeAnchor: old, createdAt: old },
      })
    ).id;
    ids.kp = (
      await db.kP.create({
        data: { name: `dkpstats-${suffix}`, guildId: ids.guild, createdAt: old },
      })
    ).id;
    ids.pack = (
      await db.pack.create({ data: { name: `dkpstats-${suffix}`, kpId: ids.kp, createdAt: old } })
    ).id;
    for (const nickname of ['alpha', 'beta']) {
      const member = await db.member.create({
        data: { nickname: `dkpstats-${nickname}-${suffix}`, packId: ids.pack, createdAt: old },
      });
      ids.members.push(member.id);
    }
    for (const name of ['raid', 'siege']) {
      ids.types.push(
        (await db.eventType.create({ data: { name: `dkpstats-${name}-${suffix}` } })).id,
      );
    }
    // История принадлежности делает команды на момент ивентов известными.
    for (const memberId of ids.members) {
      await db.memberPackHistory.create({
        data: {
          memberId,
          previousPackId: ids.pack,
          packId: ids.pack,
          changedAt: new Date('2025-12-01T00:00:00Z'),
        },
      });
    }
    await db.packMembershipHistory.create({
      data: {
        packId: ids.pack,
        previousKpId: ids.kp,
        kpId: ids.kp,
        changedAt: new Date('2025-12-01T00:00:00Z'),
      },
    });
    ids.item = (await db.item.create({ data: { name: `dkpstats-sword-${suffix}` } })).id;

    // e0 — рейд до периода (для поздней корректировки и добалансовой истории),
    // e1 — осада в периоде, e2 — ивент без движений.
    const scenarios = [
      { id: 'e0', day: '2026-05-20', type: ids.types[0]!, mode: 'PVE' as const },
      { id: 'e1', day: '2026-06-04', type: ids.types[1]!, mode: 'PVP' as const },
      { id: 'e2', day: '2026-06-18', type: ids.types[0]!, mode: 'PVE' as const },
    ];
    for (const scenario of scenarios) {
      const startsAt = new Date(`${scenario.day}T16:00:00Z`);
      const event = await db.event.create({
        data: {
          name: `dkpstats-${scenario.id}-${suffix}`,
          eventTypeId: scenario.type,
          mode: scenario.mode,
          scope: 'GUILD',
          status: 'FINISHED',
          raidLeadId: ids.members[0]!,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
          dkpReward: 0,
        },
      });
      ids.events.push(event.id);
    }
    const [e0, e1] = ids.events;

    // Лот осады и лот хранилища (без ивента).
    for (const eventId of [e1, null]) {
      const drop = await db.lootDrop.create({
        data: { itemId: ids.item, eventId, createdAt: new Date('2026-06-04T17:00:00Z') },
      });
      ids.drops.push(drop.id);
      ids.auctions.push(
        (await db.auction.create({ data: { lootDropId: drop.id, durationSec: 60 } })).id,
      );
    }
    const [auctionEvent, auctionStorage] = ids.auctions;

    const rows = [
      // История до периода: в движения не попадает, в полный баланс входит.
      {
        member: 0,
        type: 'CHECKIN_EARN' as const,
        amount: 100,
        eventId: e0,
        auctionId: null,
        createdAt: new Date('2026-05-20T18:00:00Z'),
      },
      // Начисление за чек-ин на осаде.
      {
        member: 0,
        type: 'CHECKIN_EARN' as const,
        amount: 10,
        eventId: e1,
        auctionId: null,
        createdAt: new Date('2026-06-04T18:00:00Z'),
      },
      // Покупка на аукционе ивента.
      {
        member: 0,
        type: 'AUCTION_SPEND' as const,
        amount: -30,
        eventId: null,
        auctionId: auctionEvent,
        createdAt: new Date('2026-06-05T10:00:00Z'),
      },
      // Положительная корректировка остаётся корректировкой.
      {
        member: 0,
        type: 'ADJUSTMENT' as const,
        amount: 5,
        eventId: e1,
        auctionId: null,
        createdAt: new Date('2026-06-06T10:00:00Z'),
      },
      // Поздняя корректировка: запись июня, ивент мая — команда на дату ивента.
      {
        member: 1,
        type: 'ADJUSTMENT' as const,
        amount: -7,
        eventId: e0,
        auctionId: null,
        createdAt: new Date('2026-06-15T12:00:00Z'),
      },
      // Админ-начисление без ивента.
      {
        member: 1,
        type: 'MANUAL_EARN' as const,
        amount: 50,
        eventId: null,
        auctionId: null,
        createdAt: new Date('2026-06-10T09:00:00Z'),
      },
      // Трата на лоте хранилища — операция без ивента.
      {
        member: 0,
        type: 'AUCTION_SPEND' as const,
        amount: -20,
        eventId: null,
        auctionId: auctionStorage,
        createdAt: new Date('2026-06-20T09:00:00Z'),
      },
    ];
    for (const row of rows) {
      ids.entries.push(
        (
          await db.dkpEntry.create({
            data: {
              memberId: ids.members[row.member]!,
              type: row.type,
              amount: row.amount,
              eventId: row.eventId,
              auctionId: row.auctionId,
              createdAt: row.createdAt,
            },
          })
        ).id,
      );
    }
  });

  afterAll(async () => {
    if (!db) return;
    await db.dkpEntry.deleteMany({ where: { id: { in: ids.entries } } });
    await db.auction.deleteMany({ where: { id: { in: ids.auctions } } });
    await db.lootDrop.deleteMany({ where: { id: { in: ids.drops } } });
    await db.event.deleteMany({ where: { id: { in: ids.events } } });
    await db.memberPackHistory.deleteMany({ where: { memberId: { in: ids.members } } });
    await db.packMembershipHistory.deleteMany({ where: { packId: ids.pack } });
    await db.member.deleteMany({ where: { id: { in: ids.members } } });
    await db.pack.deleteMany({ where: { id: ids.pack } });
    await db.kP.deleteMany({ where: { id: ids.kp } });
    await db.guild.deleteMany({ where: { id: ids.guild } });
    await db.eventType.deleteMany({ where: { id: { in: ids.types } } });
    await db.item.deleteMany({ where: { id: ids.item } });
    await db.$disconnect();
  });

  const june = { from: '2026-06-01', to: '2026-06-30' };
  const totals = { earned: 10, spent: -30, adjustments: -2, net: -22 };

  it('splits movements, keeps the full-history balance and converges drill-downs', async () => {
    const report = await service.get(june);
    expect(report.balanceAsOf).toBe('2026-06-30T21:00:00.000Z');
    expect(report.balanceIgnoresFilters).toEqual([]);
    // Движения периода: начисление, покупка, корректировки обоих знаков.
    expect(report.totals).toEqual(totals);
    expect(report.members).toHaveLength(2);
    const [alphaRow, betaRow] = report.members;
    expect(alphaRow).toMatchObject({
      id: ids.members[0],
      nickname: `dkpstats-alpha-${suffix}`,
    });
    // Полный баланс — вся история до границы периода, включая запись до периода
    // и операции без ивента, а не сумма движений периода (-15).
    expect(alphaRow!.balance).toBe(100 + 10 - 30 + 5 - 20);
    expect(alphaRow!.totals).toEqual({ earned: 10, spent: -30, adjustments: 5, net: -15 });
    expect(betaRow).toMatchObject({ id: ids.members[1] });
    expect(betaRow!.balance).toBe(50 - 7);
    expect(betaRow!.totals).toEqual({ earned: 0, spent: 0, adjustments: -7, net: -7 });
    // Раскрытия сходятся с агрегатами строк, команд и общего итога.
    for (const row of [...report.members, ...report.packs, ...report.kps]) {
      expect(aggregateDkpTotals(row.details)).toEqual(row.totals);
    }
    expect(aggregateDkpTotals(report.members.flatMap((row) => row.details))).toEqual(report.totals);
    expect(report.weeks.reduce((sum, week) => sum + week.totals.net, 0)).toBe(report.totals.net);
    expect(report.weeks.map((week) => week.totals.net)).toEqual([-15, 0, -7, 0, 0]);
    // Поздняя корректировка: период записи, команда ивента на его дату.
    const late = betaRow!.details[0]!;
    expect(late).toMatchObject({
      eventId: ids.events[0],
      occurredAt: '2026-06-15T12:00:00.000Z',
      packId: ids.pack,
      kpId: ids.kp,
      teamStatus: 'KNOWN',
    });
    expect(late.startsAt).toBe('2026-05-20T16:00:00.000Z');
    // Команды получают только атрибутированные движения.
    expect(report.packs).toEqual([
      expect.objectContaining({ id: ids.pack, name: `dkpstats-${suffix}`, totals }),
    ]);
    expect(report.kps).toEqual([expect.objectContaining({ id: ids.kp, totals })]);
  });

  it('keeps operations without event separate and unfiltered', async () => {
    const report = await service.get(june);
    // Админ-начисление и лот хранилища — отдельная категория «Без ивента».
    expect(report.withoutEvent.totals).toEqual({ earned: 50, spent: -20, adjustments: 0, net: 30 });
    expect(report.withoutEvent.members.map((row) => row.nickname)).toEqual([
      `dkpstats-beta-${suffix}`,
      `dkpstats-alpha-${suffix}`,
    ]);
    const storage = report.withoutEvent.members[1]!.details[0]!;
    expect(storage).toMatchObject({
      type: 'AUCTION_SPEND',
      amount: -20,
      eventId: null,
      eventName: null,
      mode: null,
      packId: null,
      kpId: null,
      auctionId: ids.auctions[1],
      auctionItemName: `dkpstats-sword-${suffix}`,
    });
    // Категория не подмешивается в итоги отфильтрованных движений и команды.
    expect(report.totals.net).toBe(-22);
    expect(report.packs[0]!.details).toHaveLength(4);
    // Фильтр типа/режима не ограничивает категорию «Без ивента».
    const filtered = await service.get({ ...june, eventTypeId: ids.types[0]! });
    expect(filtered.withoutEvent.totals).toEqual(report.withoutEvent.totals);
    expect(filtered.withoutEvent.members).toHaveLength(2);
  });

  it('changes movements with type/mode but never trims the full balance', async () => {
    const siege = await service.get({ ...june, eventTypeId: ids.types[1]! });
    expect(siege.balanceIgnoresFilters).toEqual(['eventTypeId']);
    // Осада: движения alpha; beta без совпавших движений остаётся в таблице
    // с нулевыми показателями и полным балансом (#264).
    expect(siege.members).toEqual([
      expect.objectContaining({
        id: ids.members[0],
        totals: { earned: 10, spent: -30, adjustments: 5, net: -15 },
        balance: 100 + 10 - 30 + 5 - 20,
      }),
      expect.objectContaining({
        id: ids.members[1],
        totals: { earned: 0, spent: 0, adjustments: 0, net: 0 },
        balance: 50 - 7,
      }),
    ]);
    // Рейд: только поздняя корректировка beta; alpha — нули с тем же балансом.
    const raid = await service.get({ ...june, eventTypeId: ids.types[0]! });
    expect(raid.members).toEqual([
      expect.objectContaining({
        id: ids.members[0],
        totals: { earned: 0, spent: 0, adjustments: 0, net: 0 },
        balance: 100 + 10 - 30 + 5 - 20,
      }),
      expect.objectContaining({
        id: ids.members[1],
        totals: { earned: 0, spent: 0, adjustments: -7, net: -7 },
        balance: 50 - 7,
      }),
    ]);
    // PvE–PvP меняет движения так же, полный баланс не урезается.
    const pvp = await service.get({ ...june, mode: 'PVP' });
    expect(pvp.balanceIgnoresFilters).toEqual(['mode']);
    expect(pvp.members.map((row) => row.id)).toEqual(ids.members);
    expect(pvp.members.map((row) => row.balance)).toEqual([65, 43]);
    const pve = await service.get({ ...june, mode: 'PVE' });
    expect(pve.members.map((row) => row.id)).toEqual(ids.members);
    // Пустая выборка отличима от отсутствия данных: нули, а не вымысел;
    // выбранные игроки остаются с полным балансом (#264).
    const none = await service.get({ ...june, eventTypeId: ids.types[0]!, mode: 'PVP' });
    expect(none.members.map((row) => row.balance)).toEqual([65, 43]);
    expect(none.members.every((row) => row.details.length === 0)).toBe(true);
    expect(none.totals).toEqual({ earned: 0, spent: 0, adjustments: 0, net: 0 });
    expect(none.withoutEvent.totals.net).toBe(30);
  });

  it('keeps balances of the selected players in a period without movements', async () => {
    const july = { from: '2026-07-01', to: '2026-07-31' };
    const report = await service.get(july);
    expect(report.balanceAsOf).toBe('2026-07-31T21:00:00.000Z');
    expect(report.totals).toEqual({ earned: 0, spent: 0, adjustments: 0, net: 0 });
    // Движений нет, но состав на границу баланса остаётся в таблице
    // с полным балансом по журналу (#264).
    expect(report.members).toEqual([
      expect.objectContaining({
        id: ids.members[0],
        nickname: `dkpstats-alpha-${suffix}`,
        totals: { earned: 0, spent: 0, adjustments: 0, net: 0 },
        balance: 65,
        details: [],
      }),
      expect.objectContaining({
        id: ids.members[1],
        totals: { earned: 0, spent: 0, adjustments: 0, net: 0 },
        balance: 43,
        details: [],
      }),
    ]);
  });

  it('filters by historical pack and kp of the event date', async () => {
    const byPack = await service.get({ ...june, packId: ids.pack });
    expect(byPack.members.map((row) => row.id)).toEqual(ids.members);
    expect(aggregateDkpTotals(byPack.members.flatMap((row) => row.details))).toEqual(byPack.totals);
    const byKp = await service.get({ ...june, kpId: ids.kp });
    expect(byKp.totals).toEqual(totals);
    // Поздняя корректировка мая атрибутируется старой команде и после фильтров;
    // alpha без движений рейда остаётся строкой с нулевыми показателями (#264).
    const raidKp = await service.get({ ...june, kpId: ids.kp, eventTypeId: ids.types[0]! });
    expect(raidKp.members.map((row) => row.id)).toEqual(ids.members);
    const betaRaid = raidKp.members.find((row) => row.id === ids.members[1])!;
    expect(betaRaid.details[0]).toMatchObject({ packId: ids.pack, kpId: ids.kp });
    await expect(service.get({ ...june, kpId: 'missing' })).rejects.toThrow('Неизвестный фильтр');
  });
});
