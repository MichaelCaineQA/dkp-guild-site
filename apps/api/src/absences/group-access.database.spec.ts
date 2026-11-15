import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AbsencesService, type AbsencesDb } from './absences.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Права лидеров на отсутствие в PostgreSQL', () => {
  let db: PrismaClient;
  let service: AbsencesService;
  let kpId: string;
  let packId: string;
  let authorId: string;
  let leaderId: string;
  let absenceId: string;
  const date = new Date('2030-04-01T12:00:00Z');
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    const guild = await db.guild.findFirstOrThrow();
    const suffix = randomUUID();
    leaderId = (await db.member.create({ data: { nickname: `absence-leader-${suffix}` } })).id;
    kpId = (
      await db.kP.create({ data: { name: `absence-${suffix}`, guildId: guild.id, leaderId } })
    ).id;
    packId = (await db.pack.create({ data: { name: 'test', kpId } })).id;
    authorId = (await db.member.create({ data: { nickname: `absence-author-${suffix}`, packId } }))
      .id;
    absenceId = (
      await db.absence.create({
        data: {
          memberId: authorId,
          dateFrom: new Date('2030-04-01T00:00:00Z'),
          dateTo: new Date('2030-04-02T00:00:00Z'),
          reason: 'Личное',
        },
      })
    ).id;
    service = new AbsencesService(db as unknown as AbsencesDb, { deadlineBeforeStartSec: 180 });
  });
  afterAll(async () => {
    if (!db) return;
    if (absenceId) {
      await db.auditLog.deleteMany({ where: { entityId: absenceId } });
      await db.absenceSeen.deleteMany({ where: { absenceId } });
      await db.absence.delete({ where: { id: absenceId } });
    }
    if (authorId) await db.member.delete({ where: { id: authorId } });
    if (packId) await db.pack.delete({ where: { id: packId } });
    if (kpId) await db.kP.delete({ where: { id: kpId } });
    if (leaderId) await db.member.delete({ where: { id: leaderId } });
    await db.$disconnect();
  });
  it('лидер КП видит причину и отмечает заявку, после смены лидера теряет доступ', async () => {
    const actor = { memberId: leaderId, isAdmin: false, rank: 'MEMBER' };
    const officer = { memberId: leaderId, isAdmin: false, rank: 'OFFICER' };
    const rows = await service.forEvent(date, undefined, actor);
    expect(rows.find((row) => row.id === absenceId)).toMatchObject({
      reason: 'Личное',
      canMarkSeen: true,
    });
    expect((await service.list(undefined, actor)).map((row) => row.id)).toContain(absenceId);
    await service.markSeen(absenceId, actor);
    expect(await db.absenceSeen.count({ where: { absenceId, seenById: leaderId } })).toBe(1);
    await db.kP.update({ where: { id: kpId }, data: { leaderId: null } });
    expect(
      (await service.forEvent(date, undefined, actor)).find((row) => row.id === absenceId),
    ).toMatchObject({ reason: null, canMarkSeen: false });
    await expect(service.markSeen(absenceId, actor)).rejects.toThrow();
    expect(
      (await service.forEvent(date, undefined, officer)).find((row) => row.id === absenceId)
        ?.reason,
    ).toBeNull();
    await db.pack.update({ where: { id: packId }, data: { leaderId } });
    expect(
      (await service.forEvent(date, undefined, actor)).find((row) => row.id === absenceId),
    ).toMatchObject({ reason: 'Личное', canMarkSeen: true });
    await expect(service.markSeen(absenceId, actor)).resolves.toEqual({ ok: true });
  });
});
