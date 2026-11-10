import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuctionsService, type AuctionsDb } from './auctions.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

/** Список лотов и виджет «Мой аукцион» на настоящей PostgreSQL (#98). */
suite('AuctionsService: PostgreSQL', () => {
  let db: PrismaClient;
  let service: AuctionsService;
  let memberId: string;
  let otherId: string;
  let typeId: string;
  let itemId: string;
  const created = { auctions: [] as string[], drops: [] as string[], events: [] as string[] };

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    service = new AuctionsService(db as unknown as AuctionsDb);
    const nick = 'auc-' + randomUUID().slice(0, 10);
    memberId = (await db.member.create({ data: { nickname: nick } })).id;
    otherId = (await db.member.create({ data: { nickname: nick + '-2' } })).id;
    typeId = (await db.eventType.create({ data: { name: 'auc-' + randomUUID() } })).id;
    itemId = (await db.item.create({ data: { name: 'auc-' + randomUUID() } })).id;
  });

  const makeLot = async (options: {
    status?: 'OPEN' | 'CLOSED' | 'CANCELLED';
    endsAt?: Date | null;
    bids?: Array<{ memberId: string; amount: number; fullCost?: number }>;
  }) => {
    const event = await db.event.create({
      data: {
        name: 'Аукцион-тест',
        mode: 'PVE',
        eventTypeId: typeId,
        raidLeadId: memberId,
        startsAt: new Date('2026-11-10T18:00:00Z'),
        endsAt: new Date('2026-11-10T20:00:00Z'),
        dkpReward: 10,
      },
    });
    created.events.push(event.id);
    const drop = await db.lootDrop.create({ data: { eventId: event.id, itemId } });
    created.drops.push(drop.id);
    const auction = await db.auction.create({
      data: {
        lootDropId: drop.id,
        startPrice: 100,
        step: 5,
        durationSec: 86400,
        timerFromFirstBid: false,
        antiSnipeSec: 600,
        antiSnipeExtendSec: 600,
        markupPct: 0,
        endsAt: options.endsAt ?? new Date(Date.now() + 86_400_000),
        status: options.status ?? 'OPEN',
      },
    });
    created.auctions.push(auction.id);
    for (const [index, bid] of (options.bids ?? []).entries()) {
      await db.bid.create({
        data: {
          auctionId: auction.id,
          memberId: bid.memberId,
          amount: bid.amount,
          fullCost: bid.fullCost ?? bid.amount,
          markupPct: 0,
          createdAt: new Date(Date.parse('2026-11-10T18:00:30Z') + index * 1000),
        },
      });
    }
    return auction;
  };

  beforeEach(async () => {
    await db.dkpEntry.deleteMany({ where: { auctionId: { in: created.auctions } } });
    await db.lootAward.deleteMany({ where: { auctionId: { in: created.auctions } } });
    await db.bid.deleteMany({ where: { auctionId: { in: created.auctions } } });
    await db.auction.deleteMany({ where: { id: { in: created.auctions } } });
    await db.lootDrop.deleteMany({ where: { id: { in: created.drops } } });
    await db.event.deleteMany({ where: { id: { in: created.events } } });
    created.auctions.length = 0;
    created.drops.length = 0;
    created.events.length = 0;
  });

  afterAll(async () => {
    if (!db) return;
    await db.dkpEntry.deleteMany({ where: { auctionId: { in: created.auctions } } });
    await db.lootAward.deleteMany({ where: { auctionId: { in: created.auctions } } });
    await db.bid.deleteMany({ where: { auctionId: { in: created.auctions } } });
    await db.auction.deleteMany({ where: { id: { in: created.auctions } } });
    await db.lootDrop.deleteMany({ where: { id: { in: created.drops } } });
    await db.event.deleteMany({ where: { id: { in: created.events } } });
    if (typeId) {
      await db.eventType.deleteMany({ where: { id: typeId } });
    }
    if (itemId) await db.item.deleteMany({ where: { id: itemId } });
    if (memberId) await db.member.deleteMany({ where: { id: { in: [memberId, otherId] } } });
    await db.$disconnect();
  });

  it('открытые лоты с ведущей ставкой и ставкой просматривающего', async () => {
    const soon = await makeLot({
      endsAt: new Date(Date.now() + 3_600_000),
      bids: [
        { memberId, amount: 100 },
        { memberId: otherId, amount: 150 },
      ],
    });
    await makeLot({ endsAt: new Date(Date.now() + 7_200_000) });

    const rows = await service.list('OPEN', memberId);
    const mine = rows.find((row) => row.id === soon.id)!;
    expect(rows.map((row) => row.endsAt).slice(0, 2)).toEqual([
      rows[0]!.endsAt,
      expect.any(String),
    ]);
    expect(mine.topBid).toMatchObject({ memberName: expect.any(String), amount: 150 });
    expect(mine.myBid).toEqual({ amount: 100, leading: false });
  });

  it('виджет: ближайший лот среди моих ставок, без ставок — null', async () => {
    const nearest = await makeLot({
      endsAt: new Date(Date.now() + 3_600_000),
      bids: [{ memberId, amount: 100 }],
    });
    await makeLot({
      endsAt: new Date(Date.now() + 1_800_000),
      bids: [{ memberId: otherId, amount: 500 }],
    });

    const widget = await service.myNearestBidLot(memberId);
    expect(widget).toMatchObject({ lotId: nearest.id, topBid: { amount: 100 } });

    expect(await service.myNearestBidLot(otherId)).toMatchObject({ topBid: { amount: 500 } });
  });

  it('завершённый лот с выдачей: winner в строке', async () => {
    const closed = await makeLot({
      status: 'CLOSED',
      bids: [{ memberId: otherId, amount: 200 }],
    });
    await db.lootAward.create({
      data: { auctionId: closed.id, winnerId: otherId, finalPrice: 200, markupPct: 0 },
    });

    const rows = await service.list('CLOSED', null);
    const row = rows.find((item) => item.id === closed.id)!;
    expect(row.winner).toMatchObject({ finalPrice: 200 });
    expect(row.status).toBe('CLOSED');
  });

  // Лут-лог (issue #99): приёмка на настоящей PostgreSQL.
  it('лут-лог: только фактические выдачи; отменённые лоты и лоты без выдачи не представлены', async () => {
    const awarded = await makeLot({ status: 'CLOSED' });
    await db.lootAward.create({
      data: { auctionId: awarded.id, winnerId: memberId, finalPrice: 150, markupPct: 50 },
    });
    const cancelled = await makeLot({ status: 'CANCELLED' }); // отменённый — не лут
    const noAward = await makeLot({ status: 'CLOSED' }); // без выдачи — предмет у гильдии

    const page = await service.lootLog({});
    const mine = page.entries.filter((row) => row.lotId === awarded.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      itemName: expect.any(String),
      winnerId: memberId,
      finalPrice: 150,
      markupPct: 50,
      eventId: expect.any(String),
      eventName: 'Аукцион-тест',
    });
    const excluded = [cancelled.id, noAward.id];
    expect(page.entries.some((row) => excluded.includes(row.lotId))).toBe(false);
  });

  it('лут-лог: каждый фильтр отдельно и в сочетании', async () => {
    const first = await makeLot({ status: 'CLOSED' });
    await db.lootAward.create({
      data: { auctionId: first.id, winnerId: memberId, finalPrice: 100, markupPct: 0 },
    });
    const second = await makeLot({ status: 'CLOSED' });
    await db.lootAward.create({
      data: { auctionId: second.id, winnerId: otherId, finalPrice: 200, markupPct: 0 },
    });
    const lotOfFirst = await db.auction.findUnique({ where: { id: first.id } });
    const dropOfFirst = await db.lootDrop.findUnique({ where: { id: lotOfFirst!.lootDropId } });

    // по игроку: уникальный для прогона участник — точное число
    const byMember = await service.lootLog({ memberId });
    expect(byMember.total).toBe(1);
    expect(byMember.entries[0]!.lotId).toBe(first.id);

    // по событию лота первой выдачи: ивент уникален для прогона
    const byEvent = await service.lootLog({ eventId: dropOfFirst!.eventId });
    expect(byEvent.total).toBe(1);
    expect(byEvent.entries[0]!.lotId).toBe(first.id);

    // по предмету: оба лота на одном предмете прогона — обе выдачи
    expect((await service.lootLog({ itemId })).total).toBe(2);

    // в сочетании: игрок + событие первой выдачи
    const combined = await service.lootLog({ memberId, eventId: dropOfFirst!.eventId });
    expect(combined.total).toBe(1);
    expect(combined.entries[0]!.lotId).toBe(first.id);
  });

  it('лут-лог: стоимость согласуется с журналом, история живёт после пересоздания сервиса', async () => {
    const lot = await makeLot({ status: 'CLOSED' });
    await db.lootAward.create({
      data: { auctionId: lot.id, winnerId: memberId, finalPrice: 180, markupPct: 0 },
    });
    // фактическое списание — как пишут сервисы закрытия/назначения (#95/#96)
    await db.dkpEntry.create({
      data: {
        requestId: `spec-loot-log:${lot.id}`,
        memberId,
        type: 'AUCTION_SPEND',
        amount: -180,
        auctionId: lot.id,
        comment: 'Трата на аукционе',
      },
    });

    // «перезапуск»: новый сервис над той же БД
    const restarted = new AuctionsService(db as unknown as AuctionsDb);
    const page = await restarted.lootLog({ memberId });
    const row = page.entries.find((item) => item.lotId === lot.id)!;
    const spend = await db.dkpEntry.findFirst({
      where: { auctionId: lot.id, memberId, type: 'AUCTION_SPEND' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row.finalPrice).toBe(-spend!.amount);

    // исправление (смена победителя) обновляет выдачу, но не переписывает журнал:
    // возврат прежнему и списание с нового — новые записи
    await db.lootAward.update({
      where: { auctionId: lot.id },
      data: { winnerId: otherId, finalPrice: 90, markupPct: 0 },
    });
    await db.dkpEntry.create({
      data: {
        requestId: `spec-loot-log-refund:${lot.id}`,
        memberId,
        type: 'AUCTION_SPEND',
        amount: 180,
        auctionId: lot.id,
        comment: 'Возврат траты: победитель изменён вручную',
      },
    });
    await db.dkpEntry.create({
      data: {
        requestId: `spec-loot-log-award:${lot.id}`,
        memberId: otherId,
        type: 'AUCTION_SPEND',
        amount: -90,
        auctionId: lot.id,
        comment: 'Трата на аукционе: победитель назначен вручную',
      },
    });
    const after = await restarted.lootLog({ memberId: otherId });
    const changed = after.entries.find((item) => item.lotId === lot.id)!;
    expect(changed.finalPrice).toBe(90);
    const newSpend = await db.dkpEntry.findFirst({
      where: { auctionId: lot.id, memberId: otherId, type: 'AUCTION_SPEND' },
      orderBy: { createdAt: 'desc' },
    });
    expect(changed.finalPrice).toBe(-newSpend!.amount);
    // старые записи журнала не тронуты — исправление не переписывает журнал
    expect(
      await db.dkpEntry.count({ where: { auctionId: lot.id, type: 'AUCTION_SPEND' } }),
    ).toBe(3);
  });
});
