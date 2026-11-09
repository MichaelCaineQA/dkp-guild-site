import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { BidsService, type BidsDb } from './bids.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

/**
 * Ставки на реальной PostgreSQL (issue #94, приёмка: гонки, права, балансы,
 * анти-снайп). Транзакции serializable с повтором — как в проде.
 */
suite('Ставки: настоящие транзакции PostgreSQL', () => {
  let db: PrismaClient;
  let bids: BidsService;
  let auctionId: string;
  let liveAuctionId: string;
  let dpsId: string;
  let healerId: string;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
  });

  beforeEach(async () => {
    const suffix = randomUUID().slice(0, 10);
    dpsId = (
      await db.member.create({ data: { nickname: 'bid-dd-' + suffix, combatRole: 'DPS' } })
    ).id;
    healerId = (
      await db.member.create({ data: { nickname: 'bid-heal-' + suffix, combatRole: 'HEALER' } })
    ).id;
    const type = await db.eventType.create({ data: { name: 'bid-' + suffix } });
    const event = await db.event.create({
      data: {
        name: 'Ставки',
        eventTypeId: type.id,
        raidLeadId: dpsId,
        mode: 'PVE',
        startsAt: new Date('2027-03-03T17:00:00Z'),
        endsAt: new Date('2027-03-03T19:00:00Z'),
        dkpReward: 10,
      },
    });
    const item = await db.item.create({
      data: { name: 'bid-item-' + suffix, targetRoles: ['DPS'], defaultStartPrice: 100 },
    });
    const makeLot = async (live: boolean, endsAt: Date | null) => {
      const drop = await db.lootDrop.create({ data: { eventId: event.id, itemId: item.id } });
      return db.auction.create({
        data: {
          lootDropId: drop.id,
          startPrice: 100,
          step: 5,
          durationSec: 90,
          timerFromFirstBid: live,
          antiSnipeSec: 30,
          antiSnipeExtendSec: 10,
          markupPct: 50,
          targetRoles: ['DPS'],
          noBidTimeoutSec: live ? 120 : null,
          endsAt,
        },
      });
    };
    auctionId = (await makeLot(false, new Date(Date.now() + 3_600_000))).id;
    liveAuctionId = (await makeLot(true, null)).id;
    bids = new BidsService(db as unknown as BidsDb);
    // Баланс обоих игроков — 1000 ДКП.
    for (const memberId of [dpsId, healerId]) {
      await db.dkpEntry.create({
        data: { memberId, type: 'MANUAL_EARN', amount: 1000, comment: 'тест' },
      });
    }
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  const bidsOf = (lot: string) => db.bid.findMany({ where: { auctionId: lot } });

  it('две конкурирующие ставки одной суммы: принимается одна, вторая — 400 без побочных эффектов', async () => {
    const results = await Promise.allSettled([
      bids.place(auctionId, { amount: 100 }, { memberId: dpsId, isAdmin: false }),
      bids.place(auctionId, { amount: 100 }, { memberId: healerId, isAdmin: false }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 'rejected' && r.reason instanceof BadRequestException),
    ).toHaveLength(1);
    expect(await bidsOf(auctionId)).toHaveLength(1);
    expect(
      await db.auditLog.count({ where: { action: 'AUCTION_BID', entityId: auctionId } }),
    ).toBe(1);
  });

  it('гонка первых ставок живой раздачи запускает таймер один раз', async () => {
    const results = await Promise.allSettled([
      bids.place(liveAuctionId, { amount: 100 }, { memberId: dpsId, isAdmin: false }),
      bids.place(liveAuctionId, { amount: 100 }, { memberId: healerId, isAdmin: false }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lot = await db.auction.findUniqueOrThrow({ where: { id: liveAuctionId } });
    expect(lot.firstBidAt).not.toBeNull();
    expect(lot.endsAt).not.toBeNull();
    expect(await bidsOf(liveAuctionId)).toHaveLength(1);
  });

  it('принятая перебивающая ставка и анти-снайп фиксируются атомарно', async () => {
    const endsAt = new Date(Date.now() + 30_000); // внутри окна 30 сек
    await db.auction.update({ where: { id: auctionId }, data: { endsAt } });
    const first = await bids.place(auctionId, { amount: 100 }, { memberId: dpsId, isAdmin: false });
    expect(new Date(first.endsAt!).getTime()).toBe(endsAt.getTime() + 10_000);
    const second = await bids.place(
      auctionId,
      { amount: 105 },
      { memberId: healerId, isAdmin: false },
    );
    expect(second.bid).toMatchObject({ amount: 105, fullCost: 158, markupPct: 50 });
    expect(await bidsOf(auctionId)).toHaveLength(2);
  });

  it('заморозка на другом лоте режет доступный баланс (проверка на БД)', async () => {
    // m-dd лидирует на длинном лоте со 100; доступно 900.
    await bids.place(auctionId, { amount: 100 }, { memberId: dpsId, isAdmin: false });
    await expect(
      bids.place(liveAuctionId, { amount: 901 }, { memberId: dpsId, isAdmin: false }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      bids.place(liveAuctionId, { amount: 900 }, { memberId: dpsId, isAdmin: false }),
    ).resolves.toMatchObject({ bid: { amount: 900 } });
  });

  it('актор без Member не ставит; просроченный лот не принимает — без записей', async () => {
    await expect(
      bids.place(auctionId, { amount: 100 }, { memberId: null, isAdmin: true }),
    ).rejects.toThrow(ForbiddenException);
    await db.auction.update({
      where: { id: auctionId },
      data: { endsAt: new Date(Date.now() - 1000) },
    });
    await expect(
      bids.place(auctionId, { amount: 100 }, { memberId: dpsId, isAdmin: false }),
    ).rejects.toThrow(ConflictException);
    expect(await bidsOf(auctionId)).toHaveLength(0);
    expect(
      await db.auditLog.count({ where: { action: 'AUCTION_BID', entityId: auctionId } }),
    ).toBe(0);
  });

  it('сбой аудита откатывает ставку и сдвиг таймера', async () => {
    const brokenDb = new Proxy(db, {
      get(target, prop) {
        if (prop === '$transaction')
          return (work: (tx: unknown) => Promise<unknown>, options: unknown) =>
            target.$transaction(
              (tx) =>
                work(
                  new Proxy(tx, {
                    get(t, k) {
                      if (k === 'auditLog')
                        return {
                          create: async () => {
                            throw new Error('injected failure');
                          },
                        };
                      return Reflect.get(t, k);
                    },
                  }),
                ),
              options as never,
            );
        return Reflect.get(target, prop);
      },
    });
    const broken = new BidsService(brokenDb as unknown as BidsDb);
    await expect(
      broken.place(liveAuctionId, { amount: 100 }, { memberId: dpsId, isAdmin: false }),
    ).rejects.toThrow('injected failure');
    expect(await bidsOf(liveAuctionId)).toHaveLength(0);
    const lot = await db.auction.findUniqueOrThrow({ where: { id: liveAuctionId } });
    expect(lot.firstBidAt).toBeNull();
    // После отката ставка принимается штатно.
    await bids.place(liveAuctionId, { amount: 100 }, { memberId: dpsId, isAdmin: false });
    expect(await bidsOf(liveAuctionId)).toHaveLength(1);
  });
});
