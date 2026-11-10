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
});
