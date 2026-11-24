import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AdminGrantService, type DkpGrantActor } from './admin-grant.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Ручное начисление ДКП в PostgreSQL', () => {
  let db: PrismaClient;
  let memberId: string;
  let leaderId: string;
  const requestIds = [randomUUID(), randomUUID(), randomUUID()];
  /** Актор-Глава: права читаются из актора, строка сидового Главы даёт его Member. */
  let leader: DkpGrantActor;
  const admin: DkpGrantActor = { memberId: null, rank: null, isAdmin: true };
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    memberId = (await db.member.create({ data: { nickname: `grant-${randomUUID()}` } })).id;
    // Второго Главу создаёт нельзя (частичный unique-индекс) — берём сидового.
    const seeded = await db.member.findFirst({ where: { rank: 'GUILD_LEADER' } });
    if (!seeded) throw new Error('В тестовой базе нет сидового Главы');
    leaderId = seeded.id;
    leader = { memberId: leaderId, rank: 'GUILD_LEADER', isAdmin: false };
  });
  afterAll(async () => {
    if (!db) return;
    const entries = await db.dkpEntry.findMany({
      where: { requestId: { in: requestIds } },
      select: { id: true },
    });
    await db.auditLog.deleteMany({
      where: { entityType: 'DkpEntry', entityId: { in: entries.map((entry) => entry.id) } },
    });
    await db.dkpEntry.deleteMany({ where: { requestId: { in: requestIds } } });
    if (memberId) await db.member.delete({ where: { id: memberId } });
    await db.$disconnect();
  });
  it('отказывает без права: Офицеру, Рядовому и непривязанному аккаунту', async () => {
    const service = new AdminGrantService(db);
    const input = { requestId: requestIds[0], memberId, amount: 10, comment: 'Помощь' };
    const denied: DkpGrantActor[] = [
      { memberId: leaderId, rank: 'OFFICER', isAdmin: false },
      { memberId: leaderId, rank: 'MEMBER', isAdmin: false },
      { memberId: null, rank: null, isAdmin: false },
    ];
    for (const actor of denied) {
      await expect(service.grant(input, actor)).rejects.toThrow(ForbiddenException);
    }
    expect(await db.dkpEntry.count({ where: { requestId: requestIds[0] } })).toBe(0);
  });
  it('Глава начисляет: автор в записи журнала и аудите, повтор не дублирует', async () => {
    const service = new AdminGrantService(db);
    const input = { requestId: requestIds[0], memberId, amount: 10, comment: 'Помощь' };
    await expect(service.grant({ ...input, comment: '  ' }, leader)).rejects.toThrow();
    const results = await Promise.all([service.grant(input, leader), service.grant(input, leader)]);
    expect(results[0].id).toBe(results[1].id);
    expect(await db.dkpEntry.count({ where: { requestId: requestIds[0] } })).toBe(1);
    const entry = await db.dkpEntry.findUniqueOrThrow({ where: { requestId: requestIds[0] } });
    expect(entry).toMatchObject({
      type: 'MANUAL_EARN',
      amount: 10,
      memberId,
      eventId: null,
      createdById: leaderId,
    });
    const audit = await db.auditLog.findMany({
      where: { entityType: 'DkpEntry', entityId: results[0].id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'MANUAL_DKP',
      actorMemberId: leaderId,
      actorIsAdmin: false,
    });
    expect(audit[0]!.comment).toMatch(/^Глава начислил 10 ДКП участнику grant-.+\. Помощь$/);
    await expect(service.grant({ ...input, amount: 11 }, leader)).rejects.toThrow();
    await expect(
      service.grant({ ...input, requestId: requestIds[1], memberId: randomUUID() }, leader),
    ).rejects.toThrow();
  });
  it('Админ начисляет как прежде: без Member, аудит от имени Админа', async () => {
    const service = new AdminGrantService(db);
    const result = await service.grant(
      { requestId: requestIds[2], memberId, amount: 25, comment: 'Перенос баланса' },
      admin,
    );
    const entry = await db.dkpEntry.findUniqueOrThrow({ where: { requestId: requestIds[2] } });
    expect(entry.id).toBe(result.id);
    expect(entry.createdById).toBeNull();
    const audit = await db.auditLog.findMany({
      where: { entityType: 'DkpEntry', entityId: result.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'MANUAL_DKP',
      actorMemberId: null,
      actorIsAdmin: true,
    });
    expect(audit[0]!.comment).toMatch(/^Админ начислил 25 ДКП участнику grant-.+/);
  });
});
