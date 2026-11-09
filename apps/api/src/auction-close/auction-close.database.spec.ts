import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuctionCloseService, type CloseDb } from './auction-close.service';
import { BidsService, type BidsDb } from '../bids/bids.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

/**
 * Закрытие лотов на реальной PostgreSQL (issue #95, приёмка): согласованность
 * выдачи, расхода и статуса в транзакции; повторное и одновременное закрытие
 * без дубликатов; рестарт обработчика и просроченные лоты; гонка ставки
 * с закрытием; наценка «чужому» классу.
 */
suite('Закрытие лотов: настоящие транзакции PostgreSQL', () => {
  let db: PrismaClient;
  let closer: AuctionCloseService;
  let bids: BidsService;
  let dpsId: string;
  let healerId: string;
  let eventId: string;
  let itemId: string;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
  });

  const makeLot = async (data: {
    live?: boolean;
    endsAt?: Date | null;
    createdAgoMs?: number;
    noBidTimeoutSec?: number | null;
    markupPct?: number;
    targetRoles?: ('ALL' | 'DPS' | 'HEALER' | 'TANK')[];
  }) => {
    const drop = await db.lootDrop.create({ data: { eventId, itemId } });
    const auction = await db.auction.create({
      data: {
        lootDropId: drop.id,
        startPrice: 100,
        step: 5,
        durationSec: 90,
        timerFromFirstBid: data.live ?? false,
        antiSnipeSec: 30,
        antiSnipeExtendSec: 10,
        markupPct: data.markupPct ?? 50,
        targetRoles: data.targetRoles ?? ['DPS'],
        noBidTimeoutSec: data.live ? (data.noBidTimeoutSec ?? 120) : null,
        endsAt: data.endsAt ?? null,
      },
    });
    if (data.createdAgoMs) {
      await db.$executeRaw`UPDATE "Auction" SET "createdAt" = ${new Date(
        Date.now() - data.createdAgoMs,
      )} WHERE id = ${auction.id}`;
    }
    return auction.id;
  };

  beforeEach(async () => {
    const suffix = randomUUID().slice(0, 10);
    dpsId = (
      await db.member.create({ data: { nickname: 'close-dd-' + suffix, combatRole: 'DPS' } })
    ).id;
    healerId = (
      await db.member.create({ data: { nickname: 'close-heal-' + suffix, combatRole: 'HEALER' } })
    ).id;
    const type = await db.eventType.create({ data: { name: 'close-' + suffix } });
    const event = await db.event.create({
      data: {
        name: 'Закрытие',
        eventTypeId: type.id,
        raidLeadId: dpsId,
        mode: 'PVE',
        startsAt: new Date('2027-03-03T17:00:00Z'),
        endsAt: new Date('2027-03-03T19:00:00Z'),
        dkpReward: 10,
      },
    });
    eventId = event.id;
    const item = await db.item.create({
      data: { name: 'close-item-' + suffix, targetRoles: ['DPS'], defaultStartPrice: 100 },
    });
    itemId = item.id;
    closer = new AuctionCloseService(db as unknown as CloseDb, undefined, 0);
    bids = new BidsService(db as unknown as BidsDb);
    for (const memberId of [dpsId, healerId]) {
      await db.dkpEntry.create({
        data: { memberId, type: 'MANUAL_EARN', amount: 1000, comment: 'тест' },
      });
    }
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it('выдача, расход с наценкой и статус фиксируются атомарно; повтор — без дубликатов', async () => {
    const lotId = await makeLot({ endsAt: new Date(Date.now() + 60_000) });
    // ДД лидирует 100; Хил («чужой» класс) перебивает 150 → fullCost 225.
    await bids.place(lotId, { amount: 100 }, { memberId: dpsId, isAdmin: false });
    await bids.place(lotId, { amount: 150 }, { memberId: healerId, isAdmin: false });
    await db.auction.update({
      where: { id: lotId },
      data: { endsAt: new Date(Date.now() - 1000) },
    });

    const result = await closer.closeExpiredLot(lotId);
    expect(result).toMatchObject({
      closed: true,
      winner: { memberId: healerId, finalPrice: 225, markupPct: 50 },
    });

    const [award, entries, lot, audit] = await Promise.all([
      db.lootAward.findUnique({ where: { auctionId: lotId } }),
      db.dkpEntry.findMany({ where: { auctionId: lotId } }),
      db.auction.findUniqueOrThrow({ where: { id: lotId } }),
      db.auditLog.findMany({ where: { action: 'AUCTION_CLOSE', entityId: lotId } }),
    ]);
    expect(award).toMatchObject({ winnerId: healerId, finalPrice: 225, markupPct: 50 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'AUCTION_SPEND', amount: -225, memberId: healerId });
    expect(lot.status).toBe('CLOSED');
    expect(audit).toHaveLength(1);
    expect(audit[0].actorMemberId).toBeNull(); // системное действие

    // Повторная обработка: статус уже не OPEN — новых записей нет.
    const again = await closer.closeExpiredLot(lotId);
    expect(again).toMatchObject({ closed: false, skipped: true });
    expect(await db.lootAward.count({ where: { auctionId: lotId } })).toBe(1);
    expect(await db.dkpEntry.count({ where: { auctionId: lotId } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { action: 'AUCTION_CLOSE', entityId: lotId } }),
    ).toBe(1);
  });

  it('лот без ставок: статус CLOSED без победителя, расхода и записей журнала', async () => {
    const lotId = await makeLot({ live: true, createdAgoMs: 130_000, noBidTimeoutSec: 120 });
    const result = await closer.closeExpiredLot(lotId);
    expect(result).toMatchObject({ closed: true, winner: null });
    expect(await db.lootAward.count({ where: { auctionId: lotId } })).toBe(0);
    expect(await db.dkpEntry.count({ where: { auctionId: lotId } })).toBe(0);
    expect((await db.auction.findUniqueOrThrow({ where: { id: lotId } })).status).toBe('CLOSED');
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'AUCTION_CLOSE', entityId: lotId },
    });
    expect(audit.comment).toContain('без ставок');
  });

  it('два одновременных закрытия: ровно одна выдача и одно списание', async () => {
    const lotId = await makeLot({ endsAt: new Date(Date.now() - 1000) });
    await db.bid.create({
      data: { auctionId: lotId, memberId: dpsId, amount: 100, fullCost: 100, markupPct: 0 },
    });
    const results = await Promise.allSettled([
      closer.closeExpiredLot(lotId),
      closer.closeExpiredLot(lotId),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(await db.lootAward.count({ where: { auctionId: lotId } })).toBe(1);
    expect(await db.dkpEntry.count({ where: { auctionId: lotId } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { action: 'AUCTION_CLOSE', entityId: lotId } }),
    ).toBe(1);
  });

  it('гонка ставки с закрытием: либо ставка принята и лот жив, либо закрыт без неё', async () => {
    const lotId = await makeLot({
      endsAt: new Date(Date.now() + 15_000), // внутри окна анти-снайпа 30 сек
      markupPct: 0,
      targetRoles: ['ALL'],
    });
    await bids.place(lotId, { amount: 100 }, { memberId: dpsId, isAdmin: false });
    // Просрочиваем лот и одновременно закрываем и принимаем перебивающую ставку.
    await db.auction.update({
      where: { id: lotId },
      data: { endsAt: new Date(Date.now() - 1) },
    });
    const [closeResult, bidResult] = await Promise.allSettled([
      closer.closeExpiredLot(lotId),
      bids.place(lotId, { amount: 105 }, { memberId: healerId, isAdmin: false }),
    ]);

    const lot = await db.auction.findUniqueOrThrow({ where: { id: lotId } });
    const bidCount = await db.bid.count({ where: { auctionId: lotId, amount: 105 } });
    const awards = await db.lootAward.count({ where: { auctionId: lotId } });
    const entries = await db.dkpEntry.count({ where: { auctionId: lotId } });
    if (bidResult.status === 'fulfilled') {
      // Ставка успела: анти-снайп продлил лот, закрытие честно пропустило его.
      expect(bidCount).toBe(1);
      expect(lot.status).toBe('OPEN');
      expect(awards).toBe(0);
      expect(entries).toBe(0);
      expect(closeResult.status === 'fulfilled' && closeResult.value.skipped).toBe(true);
    } else {
      // Закрытие успело: ставка отклонена без побочных эффектов.
      expect(bidCount).toBe(0);
      expect(lot.status).toBe('CLOSED');
      expect(awards).toBe(1);
      expect(entries).toBe(1);
    }
  });

  it('рестарт обработчика: новый экземпляр закрывает просроченные лоты первым проходом', async () => {
    const expiredLong = await makeLot({ endsAt: new Date(Date.now() - 60_000) });
    const expiredLive = await makeLot({ live: true, createdAgoMs: 300_000, noBidTimeoutSec: 120 });
    const alive = await makeLot({ endsAt: new Date(Date.now() + 3_600_000) });
    await db.bid.create({
      data: { auctionId: expiredLong, memberId: dpsId, amount: 100, fullCost: 100, markupPct: 0 },
    });
    // «Новый» экземпляр сервиса — как после перезапуска процесса.
    const restarted = new AuctionCloseService(db as unknown as CloseDb, undefined, 0);
    expect(await restarted.closeDue()).toBe(2);
    const rows = await db.auction.findMany({
      where: { id: { in: [expiredLong, expiredLive, alive] } },
    });
    const byId = new Map(rows.map((r) => [r.id, r.status]));
    expect(byId.get(expiredLong)).toBe('CLOSED');
    expect(byId.get(expiredLive)).toBe('CLOSED');
    expect(byId.get(alive)).toBe('OPEN');
    expect(await db.lootAward.count({ where: { auctionId: expiredLong } })).toBe(1);
    expect(await db.lootAward.count({ where: { auctionId: expiredLive } })).toBe(0);
  });

  it('сбой аудита откатывает выдачу, списание и статус целиком', async () => {
    const lotId = await makeLot({ endsAt: new Date(Date.now() - 1000) });
    await db.bid.create({
      data: { auctionId: lotId, memberId: dpsId, amount: 100, fullCost: 100, markupPct: 0 },
    });
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
    const broken = new AuctionCloseService(brokenDb as unknown as CloseDb, undefined, 0);
    await expect(broken.closeExpiredLot(lotId)).rejects.toThrow('injected failure');
    expect((await db.auction.findUniqueOrThrow({ where: { id: lotId } })).status).toBe('OPEN');
    expect(await db.lootAward.count({ where: { auctionId: lotId } })).toBe(0);
    expect(await db.dkpEntry.count({ where: { auctionId: lotId } })).toBe(0);
    // После отката лот закрывается штатно (аварийное восстановление).
    await closer.closeExpiredLot(lotId);
    expect(await db.lootAward.count({ where: { auctionId: lotId } })).toBe(1);
  });
});
