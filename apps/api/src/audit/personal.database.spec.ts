import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService, type AuditDb } from './audit.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Личный аудит в PostgreSQL', () => {
  let db: PrismaClient;
  const ids: string[] = [];
  let userId: string;
  const prefix = randomUUID();
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    userId = (await db.user.create({ data: { username: `audit-${randomUUID()}` } })).id;
    for (let i = 0; i < 2; i++)
      ids.push((await db.member.create({ data: { nickname: `audit-${randomUUID()}` } })).id);
  });
  afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({ where: { action: prefix } });
    await db.absence.deleteMany({ where: { memberId: { in: ids } } });
    await db.dkpEntry.deleteMany({ where: { memberId: { in: ids } } });
    if (userId) await db.screenshot.deleteMany({ where: { userId } });
    await db.member.deleteMany({ where: { id: { in: ids } } });
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  });
  it('показывает свои старые входы и загрузки скриншотов по ID аккаунта', async () => {
    const screenshot = await db.screenshot.create({ data: { userId, mime: 'image/png' } });
    const action = `login-${prefix}`;
    await db.auditLog.createMany({
      data: [
        { action, entityType: 'User', entityId: userId, comment: 'Вход' },
        { action, entityType: 'Screenshot', entityId: screenshot.id, comment: 'Загрузка' },
      ],
    });
    try {
      const result = await new AuditService(db as unknown as AuditDb).list(
        { action },
        { rank: 'MEMBER', memberId: ids[0], userId },
      );
      expect(result.total).toBe(2);
      expect(result.entries.find((row) => row.entityType === 'User')).toMatchObject({
        entityId: '',
        comment: null,
      });
      expect(result.entries.find((row) => row.entityType === 'Screenshot')?.entityId).toBe(
        screenshot.id,
      );
    } finally {
      await db.auditLog.deleteMany({ where: { action } });
    }
  });
  it('ограничивает строки до фильтрации и скрывает групповые детали', async () => {
    const [self, other] = ids as [string, string];
    const absence = await db.absence.create({
      data: { memberId: self, dateFrom: new Date(), dateTo: new Date(), reason: 'личное' },
    });
    const entry = await db.dkpEntry.create({
      data: { memberId: self, type: 'MANUAL_EARN', amount: 10 },
    });
    await db.auditLog.createMany({
      data: [
        {
          actorMemberId: self,
          action: prefix,
          entityType: 'Event',
          entityId: 'group',
          comment: 'Чужие данные',
        },
        {
          actorMemberId: other,
          action: prefix,
          entityType: 'Member',
          entityId: self,
          comment: 'Ранг',
        },
        {
          actorMemberId: other,
          action: prefix,
          entityType: 'Absence',
          entityId: absence.id,
          comment: 'Увидел',
        },
        {
          actorMemberId: other,
          action: prefix,
          entityType: 'DkpEntry',
          entityId: entry.id,
          comment: 'Бонус',
        },
        {
          actorMemberId: other,
          action: prefix,
          entityType: 'Member',
          entityId: other,
          comment: 'Чужая запись',
        },
      ],
    });
    const service = new AuditService(db as unknown as AuditDb);
    const actor = { memberId: self, rank: 'MEMBER' as const };
    const result = await service.list({ action: prefix, limit: 2 }, actor);
    expect(result.total).toBe(4);
    expect(result.entries).toHaveLength(2);
    const all = await service.list({ action: prefix, limit: 20 }, actor);
    expect(all.entries.some((row) => row.comment === 'Чужая запись')).toBe(false);
    const group = all.entries.find((row) => row.entityType === 'Event');
    expect(group).toMatchObject({ comment: null, entityId: '' });
    await db.member.update({ where: { id: self }, data: { nickname: `renamed-${randomUUID()}` } });
    const renamed = await db.member.findUniqueOrThrow({ where: { id: self } });
    const refreshed = await service.list({ action: prefix, limit: 20 }, actor);
    expect(refreshed.entries.find((row) => row.entityType === 'DkpEntry')?.entityName).toBe(
      renamed.nickname,
    );
    expect((await service.list({ action: prefix, actorMemberId: other }, actor)).total).toBe(3);
  });
});
