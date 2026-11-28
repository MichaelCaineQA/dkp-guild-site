import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service';
import { DkpDecayScheduler } from './dkp-decay.scheduler';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const first = new Date('2025-01-05T21:00:00.000Z');
const second = new Date('2025-01-12T21:00:00.000Z');
const third = new Date('2025-01-19T21:00:00.000Z');
const beforeFirst = new Date(+first - 1);
const afterFirst = new Date(+first + 1);
const cutoffs = [first, second, third];

suite('Еженедельное сгорание ДКП в PostgreSQL', () => {
  let db: PrismaClient;
  let memberIds: string[] = [];

  const scheduler = () => new DkpDecayScheduler(db as PrismaService);
  const entries = () =>
    db.dkpEntry.findMany({
      where: { memberId: { in: memberIds }, type: 'WEEKLY_DECAY' },
      orderBy: { createdAt: 'asc' },
    });

  async function playerWithBalance(amount: number, createdAt = beforeFirst) {
    const member = await db.member.create({ data: { nickname: `weekly-decay-${randomUUID()}` } });
    memberIds.push(member.id);
    await db.dkpEntry.create({
      data: { memberId: member.id, amount, createdAt, type: 'ADJUSTMENT' },
    });
    return member.id;
  }

  beforeAll(() => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
  });

  afterEach(async () => {
    await db.dkpEntry.deleteMany({ where: { memberId: { in: memberIds } } });
    await db.member.deleteMany({ where: { id: { in: memberIds } } });
    await db.dkpDecayRun.deleteMany({ where: { scheduledAt: { in: cutoffs } } });
    await db.dkpDecayRate.deleteMany({ where: { effectiveAt: { in: cutoffs } } });
    memberIds = [];
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it('в полночь списывает округлённую долю баланса, зафиксированного до понедельника', async () => {
    const memberId = await playerWithBalance(19);
    await playerWithBalance(-19);
    await playerWithBalance(9);
    await playerWithBalance(99, afterFirst);
    await db.dkpEntry.create({
      data: { memberId, amount: 100, createdAt: afterFirst, type: 'MANUAL_EARN' },
    });
    await db.dkpDecayRate.create({ data: { effectiveAt: first, percent: 10 } });
    const worker = scheduler();

    await worker.scan(beforeFirst);
    expect(await entries()).toEqual([]);

    await worker.scan(afterFirst);
    expect(await entries()).toEqual([
      expect.objectContaining({
        memberId,
        amount: -1,
        createdAt: first,
        comment: 'Сгорание 10% · 06.01.2025 (МСК)',
      }),
    ]);
  });

  it('повтор и параллельный расчёт после рестарта оставляют одно списание', async () => {
    await playerWithBalance(19);
    await db.dkpDecayRate.create({ data: { effectiveAt: first, percent: 10 } });

    await Promise.all([scheduler().scan(first), scheduler().scan(first)]);
    await scheduler().scan(afterFirst);

    expect(await entries()).toHaveLength(1);
    expect(await db.dkpDecayRun.count({ where: { scheduledAt: first } })).toBe(1);
  });

  it('догоняет пропуски по ставкам каждой недели и пропускает неделю со ставкой 0%', async () => {
    const memberId = await playerWithBalance(100);
    await db.dkpDecayRate.createMany({
      data: [
        { effectiveAt: first, percent: 10 },
        { effectiveAt: second, percent: 0 },
        { effectiveAt: third, percent: 20 },
      ],
    });

    await scheduler().scan(third);

    expect(await entries()).toEqual([
      expect.objectContaining({ memberId, amount: -10, createdAt: first }),
      expect.objectContaining({ memberId, amount: -18, createdAt: third }),
    ]);
    expect(
      (await db.dkpEntry.aggregate({ where: { memberId }, _sum: { amount: true } }))._sum.amount,
    ).toBe(72);
  });

  it('после сбоя записи повторяет всю неделю без частичного списания', async () => {
    const memberId = await playerWithBalance(19);
    await playerWithBalance(20);
    await db.dkpDecayRate.create({ data: { effectiveAt: first, percent: 100 } });
    const conflict = await db.dkpEntry.create({
      data: {
        memberId,
        amount: 1,
        type: 'ADJUSTMENT',
        createdAt: afterFirst,
        requestId: `dkp-decay:${first.toISOString()}:${memberId}`,
      },
    });
    const worker = scheduler();

    await expect(worker.scan(first)).rejects.toThrow();
    expect(await db.dkpDecayRun.count({ where: { scheduledAt: first } })).toBe(0);
    expect(await entries()).toEqual([]);

    await db.dkpEntry.delete({ where: { id: conflict.id } });
    await worker.scan(afterFirst);
    expect(await entries()).toHaveLength(2);
  });

  it('при 100% полностью списывает баланс больше диапазона одной записи', async () => {
    const memberId = await playerWithBalance(2_147_483_647);
    await db.dkpEntry.create({
      data: { memberId, amount: 10, createdAt: beforeFirst, type: 'ADJUSTMENT' },
    });
    await db.dkpDecayRate.create({ data: { effectiveAt: first, percent: 100 } });

    await scheduler().scan(first);

    expect((await entries()).map((row) => row.amount).sort((a, b) => a - b)).toEqual([
      -2_147_483_648, -9,
    ]);
  });
});
