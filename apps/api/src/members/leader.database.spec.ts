import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { MembersService, type MembersDb } from './members.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Назначение Главы в PostgreSQL', () => {
  let db: PrismaClient;
  const ids: string[] = [];
  let demotedLeaderIds: string[] = [];
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    // В сидированной тестовой БД уже есть Глава: временно понижаем его,
    // чтобы индекс Member_single_guild_leader не мешал проверке,
    // и возвращаем ранг в afterAll.
    demotedLeaderIds = (
      await db.member.findMany({ where: { rank: 'GUILD_LEADER' }, select: { id: true } })
    ).map((member) => member.id);
    if (demotedLeaderIds.length)
      await db.member.updateMany({
        where: { id: { in: demotedLeaderIds } },
        data: { rank: 'OFFICER' },
      });
    for (let i = 0; i < 2; i++) {
      ids.push((await db.member.create({ data: { nickname: `leader-${randomUUID()}` } })).id);
    }
  });
  afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({ where: { entityType: 'Member', entityId: { in: ids } } });
    await db.member.deleteMany({ where: { id: { in: ids } } });
    if (demotedLeaderIds.length)
      await db.member.updateMany({
        where: { id: { in: demotedLeaderIds } },
        data: { rank: 'GUILD_LEADER' },
      });
    await db.$disconnect();
  });
  it('конкурирующие назначения сохраняют единственного Главу и атомарный аудит', async () => {
    const service = new MembersService(db as unknown as MembersDb);
    const actor = { memberId: null, isAdmin: true, userId: 'admin' };
    const outcomes = await Promise.allSettled(
      ids.map((id) => service.changeRank(id, { rank: 'GUILD_LEADER', comment: 'Проверка' }, actor)),
    );
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
    expect(await db.member.count({ where: { id: { in: ids }, rank: 'GUILD_LEADER' } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityType: 'Member', entityId: { in: ids } } }),
    ).toBeGreaterThanOrEqual(outcomes.filter((outcome) => outcome.status === 'fulfilled').length);
  });
});
