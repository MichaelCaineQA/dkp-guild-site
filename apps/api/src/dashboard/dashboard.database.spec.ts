import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DashboardService } from './dashboard.service';
import { AuditService, type AuditDb } from '../audit/audit.service';
const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Дашборд: PostgreSQL, границы дня и приватность GS', () => {
  let db: PrismaClient;
  let service: DashboardService;
  let guildId: string;
  let kpId: string;
  let packId: string;
  let memberId: string;
  let userId: string;
  let typeId: string;
  const now = new Date('2026-11-07T20:30:00Z');
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    service = new DashboardService(db, new AuditService(db as unknown as AuditDb));
    const guild = await db.guild.create({
      data: { name: 'dashboard-test-' + randomUUID(), gameTimeAnchor: new Date('2026-01-01') },
    });
    guildId = guild.id;
    const kp = await db.kP.create({ data: { name: 'КП', guildId } });
    kpId = kp.id;
    const pack = await db.pack.create({ data: { name: 'Пак', kpId } });
    packId = pack.id;
    const user = await db.user.create({
      data: { username: 'dashboard-' + randomUUID(), discordId: randomUUID() },
    });
    userId = user.id;
    const member = await db.member.create({
      data: {
        nickname: 'dashboard-' + randomUUID().slice(0, 8),
        userId,
        packId,
        // Ранг проверяется через аргумент actor в service.get, а не через БД:
        // в базе уже есть сидированный Глава, а индекс Member_single_guild_leader
        // не даст создать второго.
        rank: 'OFFICER',
        weapons: ['STAFF', 'WAND'],
        combatRole: 'HEALER',
      },
    });
    memberId = member.id;
    await db.pack.update({ where: { id: packId }, data: { leaderId: memberId } });
    await db.gearScoreRecord.create({
      data: {
        memberId,
        value: 100,
        screenshotIds: [randomUUID()],
        createdAt: new Date('2026-11-01'),
      },
    });
    await db.gearScoreRecord.create({
      data: { memberId, value: 999, screenshotIds: [], createdAt: new Date('2026-11-02') },
    });
    const type = await db.eventType.create({ data: { name: 'dashboard-' + randomUUID() } });
    typeId = type.id;
    for (const hour of [12, 13, 14, 15, 16, 17, 18, 19, 20, 21])
      await db.event.create({
        data: {
          name: 'Сбор ' + hour,
          eventTypeId: typeId,
          mode: 'PVE',
          startsAt: new Date(Date.UTC(2026, 10, 7, hour)),
          endsAt: new Date(Date.UTC(2026, 10, 7, hour + 1)),
          raidLeadId: memberId,
          dkpReward: 10,
        },
      });
  });
  afterAll(async () => {
    if (!db) return;
    // Удаляем только собственные фикстуры из изолированной тестовой БД.
    if (typeId) {
      await db.event.deleteMany({ where: { eventTypeId: typeId } });
      await db.eventType.delete({ where: { id: typeId } });
    }
    if (packId) await db.pack.update({ where: { id: packId }, data: { leaderId: null } });
    if (memberId) {
      await db.gearScoreRecord.deleteMany({ where: { memberId } });
      await db.member.delete({ where: { id: memberId } });
    }
    if (userId) await db.user.delete({ where: { id: userId } });
    if (packId) await db.pack.delete({ where: { id: packId } });
    if (kpId) await db.kP.delete({ where: { id: kpId } });
    if (guildId) await db.guild.delete({ where: { id: guildId } });
    await db.$disconnect();
  });
  it('выбирает последние события московского дня, исключает завтрашнее 21:00 UTC', async () => {
    const result = await service.get({ rank: 'MEMBER', memberId }, now);
    expect(result.events.map((e) => e.name)).toEqual([
      'Сбор 16',
      'Сбор 17',
      'Сбор 18',
      'Сбор 19',
      'Сбор 20',
    ]);
    expect(result.events).toHaveLength(5);
    expect(result.audit).toEqual([]);
    expect(result.team?.members[0]).not.toHaveProperty('gearScore');
  });
  it('Главе возвращает последний подтверждённый GS, остальным не раскрывает даже своё значение', async () => {
    const result = await service.get({ rank: 'GUILD_LEADER', memberId }, now);
    expect(result.team?.members[0]).toMatchObject({ id: memberId, gearScore: 100, leader: true });
    expect(result.team?.members[0]).not.toHaveProperty('screenshotIds');
    const officer = await service.get({ rank: 'OFFICER', memberId }, now);
    expect(officer.team?.members[0]).not.toHaveProperty('gearScore');
    expect(await db.dkpEntry.count({ where: { memberId } })).toBe(0);
  });
});
