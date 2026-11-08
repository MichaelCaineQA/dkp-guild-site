import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AdminGrantService } from './admin-grant.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Ручное начисление ДКП в PostgreSQL', () => {
  let db: PrismaClient;
  let memberId: string;
  const requestId = randomUUID();
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    memberId = (await db.member.create({ data: { nickname: `grant-${randomUUID()}` } })).id;
  });
  afterAll(async () => {
    if (!db) return;
    const entries = await db.dkpEntry.findMany({ where: { requestId }, select: { id: true } });
    await db.auditLog.deleteMany({
      where: { entityType: 'DkpEntry', entityId: { in: entries.map((entry) => entry.id) } },
    });
    await db.dkpEntry.deleteMany({ where: { requestId } });
    if (memberId) await db.member.delete({ where: { id: memberId } });
    await db.$disconnect();
  });
  it('проверяет права, атомарно пишет аудит и не дублирует повторные запросы', async () => {
    const service = new AdminGrantService(db);
    const input = { requestId, memberId, amount: 10, comment: 'Помощь' };
    await expect(service.grant(input, false)).rejects.toThrow();
    await expect(service.grant({ ...input, comment: '  ' }, true)).rejects.toThrow();
    const results = await Promise.all([service.grant(input, true), service.grant(input, true)]);
    expect(results[0].id).toBe(results[1].id);
    expect(await db.dkpEntry.count({ where: { requestId } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityType: 'DkpEntry', entityId: results[0].id } }),
    ).toBe(1);
    await expect(service.grant({ ...input, amount: 11 }, true)).rejects.toThrow();
  });
});
