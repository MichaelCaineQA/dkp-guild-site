import { BadRequestException } from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PlaceBidResult } from '@dkp/shared';
import { BidsService, type BidsDb, type BidsTx } from './bids.service';

// Отдельный PostgreSQL: synchronous_standby_names=dkp_bid_commit_test,
// synchronous_commit=off. Обычную локальную БД этот тест не перенастраивает.
const url = process.env.BIDS_COMMIT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

async function waitForDatabaseState(probe: () => Promise<boolean>, description: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await probe()) return;
  }
  throw new Error(`PostgreSQL не достиг состояния: ${description}`);
}

function observeTransaction(
  db: PrismaClient,
  observe: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  return new Proxy(db, {
    get(target, key) {
      if (key === '$transaction') {
        return <T>(work: (tx: BidsTx) => Promise<T>, options: { isolationLevel: 'Serializable' }) =>
          target.$transaction(async (tx) => {
            await observe(tx);
            return work(tx as unknown as BidsTx);
          }, options);
      }
      return Reflect.get(target, key);
    },
  }) as unknown as BidsDb;
}

suite('Ставки: задержка видимости COMMIT PostgreSQL', () => {
  let db: PrismaClient;
  const auctionId = randomUUID();
  const dropId = randomUUID();
  const itemId = randomUUID();
  const winnerId = randomUUID();
  const contenderId = randomUUID();

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    const config = await db.$queryRaw<Array<{ standby: string; commit: string }>>`
      SELECT current_setting('synchronous_standby_names') AS standby,
        current_setting('synchronous_commit') AS commit`;
    expect(config[0]).toEqual({ standby: 'dkp_bid_commit_test', commit: 'off' });

    const suffix = randomUUID();
    await db.member.create({ data: { id: winnerId, nickname: `commit-win-${suffix}` } });
    await db.member.create({ data: { id: contenderId, nickname: `commit-bid-${suffix}` } });
    await db.item.create({ data: { id: itemId, name: `commit-${suffix}`, targetRoles: ['DPS'] } });
    await db.lootDrop.create({ data: { id: dropId, itemId } });
    await db.auction.create({
      data: {
        id: auctionId,
        lootDropId: dropId,
        startPrice: 100,
        step: 5,
        durationSec: 3600,
        timerFromFirstBid: false,
        antiSnipeSec: 0,
        antiSnipeExtendSec: 0,
        markupPct: 0,
        targetRoles: ['DPS'],
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });
    await db.dkpEntry.createMany({
      data: [
        { memberId: winnerId, type: 'MANUAL_EARN', amount: 1000 },
        { memberId: contenderId, type: 'MANUAL_EARN', amount: 1000 },
      ],
    });
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await db.auditLog.deleteMany({ where: { entityId: auctionId } });
      await db.bid.deleteMany({ where: { auctionId } });
      await db.dkpEntry.deleteMany({ where: { memberId: { in: [winnerId, contenderId] } } });
      await db.auction.deleteMany({ where: { id: auctionId } });
      await db.lootDrop.deleteMany({ where: { id: dropId } });
      await db.item.deleteMany({ where: { id: itemId } });
      await db.member.deleteMany({ where: { id: { in: [winnerId, contenderId] } } });
    } finally {
      await db.$disconnect();
    }
  });

  it('после задержанного COMMIT конкурента равная ставка получает 400 без побочных эффектов', async () => {
    let winnerPid = 0;
    let contenderPid = 0;
    const winner = new BidsService(
      observeTransaction(db, async (tx) => {
        await tx.$executeRaw`SET LOCAL synchronous_commit = on`;
        winnerPid = (await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`)[0]
          .pid;
      }),
    );
    const contender = new BidsService(
      observeTransaction(db, async (tx) => {
        contenderPid = (
          await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`
        )[0].pid;
      }),
    );
    const accepted = Promise.allSettled([
      winner.place(auctionId, { amount: 100 }, { memberId: winnerId, isAdmin: false }),
    ]);
    let rejected: Promise<PromiseSettledResult<PlaceBidResult>[]> | undefined;
    let contenderSettled = false;
    try {
      // SSI уже считает транзакцию фиксирующейся, но её изменения ещё не видны
      // новым снимкам. Без блокировки три быстрых P2034 превращались в 409.
      await waitForDatabaseState(async () => {
        const state = await db.$queryRaw<Array<{ wait_event: string }>>`
          SELECT wait_event FROM pg_stat_activity WHERE pid = ${winnerPid}`;
        return state[0]?.wait_event === 'SyncRep';
      }, 'победитель ждёт подтверждения COMMIT');
      rejected = Promise.allSettled([
        contender.place(auctionId, { amount: 100 }, { memberId: contenderId, isAdmin: false }),
      ]).then((result) => {
        contenderSettled = true;
        return result;
      });
      await waitForDatabaseState(async () => {
        const state = await db.$queryRaw<Array<{ blocking: number[] }>>`
          SELECT pg_blocking_pids(${contenderPid}::int) AS blocking`;
        return contenderSettled || state[0].blocking.includes(winnerPid);
      }, 'конкурент дождался результата либо ждёт победителя');
    } finally {
      // Отмена только ожидания реплики: локальный COMMIT не откатывается.
      // Освобождаем его и при падении теста, чтобы не оставить висящий backend.
      await db.$queryRaw`SELECT pg_cancel_backend(${winnerPid}::int)`;
      await accepted;
      if (rejected) await rejected;
    }
    const results = [...(await accepted), ...(await rejected!)];
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failures = results.filter((r) => r.status === 'rejected');
    expect(failures).toEqual([{ status: 'rejected', reason: expect.any(BadRequestException) }]);
    expect(failures[0].reason.getStatus()).toBe(400);
    expect(failures[0].reason.message).toBe('Минимальная ставка — 105');
    expect(await db.bid.count({ where: { auctionId } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'AUCTION_BID', entityId: auctionId } })).toBe(
      1,
    );
    expect(
      await db.dkpEntry.findMany({ where: { memberId: contenderId }, select: { amount: true } }),
    ).toEqual([{ amount: 1000 }]);
  }, 15000);
});
