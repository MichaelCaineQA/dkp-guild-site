import { PrismaClient, type Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AbsencesService, type AbsencesDb } from './absences.service';
const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Увидел: PostgreSQL, единственная отметка и аудит', () => {
  let db: PrismaClient;
  let service: AbsencesService;
  let memberId: string;
  let absenceId: string;
  const date = new Date('2027-04-01');
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    memberId = (await db.member.create({ data: { nickname: 'seen-' + randomUUID().slice(0, 10) } }))
      .id;
    absenceId = (
      await db.absence.create({
        data: { memberId, dateFrom: date, dateTo: date, reason: 'Работа' },
      })
    ).id;
    service = new AbsencesService(db as unknown as AbsencesDb, { deadlineBeforeStartSec: 180 });
  });
  beforeEach(async () => {
    await db.absenceSeen.deleteMany({ where: { absenceId } });
    await db.auditLog.deleteMany({ where: { entityId: absenceId } });
  });
  afterAll(async () => {
    if (!db) return;
    if (absenceId) {
      await db.auditLog.deleteMany({ where: { entityId: absenceId } });
      await db.absence.delete({ where: { id: absenceId } });
    }
    if (memberId) await db.member.delete({ where: { id: memberId } });
    await db.$disconnect();
  });
  it('два запроса Главы создают одну отметку и один аудит, статус не меняется', async () => {
    const actor = { memberId, isAdmin: false, rank: 'GUILD_LEADER' };
    await Promise.all([service.markSeen(absenceId, actor), service.markSeen(absenceId, actor)]);
    expect(await db.absenceSeen.count({ where: { absenceId } })).toBe(1);
    expect(await db.auditLog.count({ where: { entityId: absenceId } })).toBe(1);
    expect((await db.absence.findUniqueOrThrow({ where: { id: absenceId } })).status).toBe(
      'ACTIVE',
    );
    expect((await service.forEvent(date))[0].seenBy).toContain(memberId);
  });
  it('резервный админ без Member: нет несуществующего FK, один ключ в обоих списках', async () => {
    const actor = { memberId: null, isAdmin: true, rank: null };
    await service.markSeen(absenceId, actor);
    await service.markSeen(absenceId, actor);
    const row = await db.absenceSeen.findFirstOrThrow({ where: { absenceId } });
    expect(row.seenById).toBeNull();
    expect(row.actorKey).toBe('system-admin');
    expect((await service.list(memberId))[0].seenBy).toEqual(['system-admin']);
    expect((await service.forEvent(date)).find((a) => a.id === absenceId)!.seenBy).toEqual([
      'system-admin',
    ]);
    expect(await db.auditLog.count({ where: { entityId: absenceId } })).toBe(1);
  });
  it('сбой аудита откатывает реальную отметку', async () => {
    const broken = new Proxy(db, {
      get(target, key) {
        if (key === '$transaction')
          return (
            work: (tx: unknown) => Promise<unknown>,
            options: { isolationLevel: Prisma.TransactionIsolationLevel },
          ) =>
            target.$transaction(
              (tx) =>
                work(
                  new Proxy(tx, {
                    get(t, k) {
                      if (k === 'auditLog')
                        return {
                          create: async () => {
                            throw new Error('audit failure');
                          },
                        };
                      return Reflect.get(t, k);
                    },
                  }),
                ),
              options,
            );
        return Reflect.get(target, key);
      },
    });
    await expect(
      new AbsencesService(broken as unknown as AbsencesDb, {
        deadlineBeforeStartSec: 180,
      }).markSeen(absenceId, { memberId, isAdmin: false, rank: 'GUILD_LEADER' }),
    ).rejects.toThrow('audit failure');
    expect(await db.absenceSeen.count({ where: { absenceId } })).toBe(0);
  });
});
