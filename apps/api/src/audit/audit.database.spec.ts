import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService, type AuditDb } from './audit.service';
const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Фильтры аудита: PostgreSQL', () => {
  let db: PrismaClient;
  let service: AuditService;
  let memberId: string;
  let guildId: string;
  let packId: string;
  const prefix = 'audit-test-' + randomUUID();
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    service = new AuditService(db as unknown as AuditDb);
    memberId = (await db.member.create({ data: { nickname: prefix.slice(0, 20) } })).id;
    const guild = await db.guild.create({
      data: { name: prefix.slice(0, 20), gameTimeAnchor: new Date('2026-01-01') },
    });
    guildId = guild.id;
    const kp = await db.kP.create({ data: { name: 'КП аудита', guildId } });
    const pack = await db.pack.create({ data: { name: 'Пак аудита', kpId: kp.id } });
    packId = pack.id;
    await db.auditLog.createMany({
      data: [
        {
          actorMemberId: null,
          action: prefix,
          entityType: 'Event',
          entityId: 'old',
          createdAt: new Date('2026-11-01'),
          comment: 'Система',
        },
        {
          actorMemberId: null,
          action: prefix,
          entityType: 'Event',
          entityId: 'new',
          createdAt: new Date('2026-11-07'),
          comment: 'Система',
        },
        {
          actorMemberId: memberId,
          action: prefix,
          entityType: 'Event',
          entityId: 'member',
          createdAt: new Date('2026-11-07'),
          comment: 'Игрок',
        },
        {
          actorMemberId: null,
          action: prefix,
          entityType: 'Pack',
          entityId: 'pack',
          createdAt: new Date('2026-11-07'),
          comment: 'Система',
        },
        {
          // Запись «как до фикса»: имя пака + сырой id КП в комментарии.
          actorMemberId: memberId,
          action: 'PACK_CREATE',
          entityType: 'Pack',
          entityId: packId,
          createdAt: new Date('2026-11-07'),
          comment: `Создан пак «Пак аудита» в КП ${kp.id}`,
        },
      ],
    });
  });
  afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({ where: { action: prefix } });
    await db.auditLog.deleteMany({ where: { action: 'PACK_CREATE', entityId: packId } });
    if (packId) await db.pack.deleteMany({ where: { id: packId } });
    if (guildId) await db.kP.deleteMany({ where: { guildId } });
    if (guildId) await db.guild.delete({ where: { id: guildId } });
    if (memberId) await db.member.delete({ where: { id: memberId } });
    await db.$disconnect();
  });
  it('И для System/entity/date, отбор автора и стабильные страницы', async () => {
    const common = { action: prefix, entityType: 'Event', system: 'true' };
    const filtered = await service.list({ ...common, from: '2026-11-06' });
    expect(filtered.entries.map((e) => e.entityId)).toEqual(['new']);
    expect(filtered.total).toBe(1);
    expect((await service.list({ ...common, limit: 1 })).entries.map((e) => e.entityId)).toEqual([
      'new',
    ]);
    expect(
      (await service.list({ ...common, limit: 1, offset: 1 })).entries.map((e) => e.entityId),
    ).toEqual(['old']);
    expect(
      (await service.list({ action: prefix, actorMemberId: memberId })).entries.map(
        (e) => e.entityId,
      ),
    ).toEqual(['member']);
  });

  it('человекочитаемые названия: entityName пака и имя КП вместо id в комментарии (issue #183)', async () => {
    const { entries } = await service.list({ action: 'PACK_CREATE', actorMemberId: memberId });
    const row = entries.find((e) => e.entityId === packId);
    expect(row?.entityName).toBe('Пак аудита');
    expect(row?.comment).toBe('Создан пак «Пак аудита» в КП «КП аудита»');
    expect(row?.comment).not.toMatch(/c[a-z0-9]{20,}/);
  });
});
