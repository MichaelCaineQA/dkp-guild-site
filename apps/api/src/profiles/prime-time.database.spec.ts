import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ProfilesService, type ProfilesDb } from './profiles.service';
import { MembersService, type MembersDb } from '../members/members.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Прайм-тайм в PostgreSQL', () => {
  let db: PrismaClient;
  let memberId: string;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    memberId = (await db.member.create({ data: { nickname: `prime-${randomUUID()}` } })).id;
  });
  afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({ where: { entityId: memberId } });
    await db.primeTimeSlot.deleteMany({ where: { memberId } });
    await db.member.deleteMany({ where: { id: memberId } });
    await db.$disconnect();
  });
  it('сохраняет интервалы и аудит и находит игрока серверным фильтром', async () => {
    const profiles = new ProfilesService(db as unknown as ProfilesDb);
    const roster = new MembersService(
      db as unknown as MembersDb,
      () => new Date('2026-11-16T21:30:00Z'),
    );
    const slots = [{ weekday: 1, fromMinute: 0, toMinute: 60 }];
    await profiles.updateOwn(
      memberId,
      { timeZone: 'Europe/Moscow', primeTime: slots, comment: 'Новое расписание' },
      { memberId, rank: 'MEMBER' },
    );
    expect((await profiles.get(memberId)).primeTime).toEqual(slots);
    expect(
      await db.auditLog.count({ where: { entityId: memberId, action: 'MEMBER_UPDATE' } }),
    ).toBe(1);
    expect((await roster.roster({ availableNow: 'true' })).some((row) => row.id === memberId)).toBe(
      true,
    );
  });
});
