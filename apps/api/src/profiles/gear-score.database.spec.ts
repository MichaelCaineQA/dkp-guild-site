import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { GearScoreService } from './gear-score.service';
import { ProfilesService, type ProfilesDb } from './profiles.service';
import type { SessionUser } from '@dkp/shared';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
(url ? describe : describe.skip)('Обновление GS в PostgreSQL', () => {
  let db: PrismaClient;
  let actor: SessionUser;
  let fileId: string;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    const user = await db.user.create({ data: { discordId: randomUUID(), username: 'gs-test' } });
    const member = await db.member.create({
      data: { nickname: `gs-${randomUUID()}`, userId: user.id },
    });
    actor = {
      userId: user.id,
      memberId: member.id,
      rank: 'MEMBER',
      username: user.username,
      isAdmin: false,
      blocked: false,
    };
    fileId = randomUUID();
    await db.screenshot.create({ data: { id: fileId, userId: user.id, mime: 'image/png' } });
    await db.gearScoreRecord.create({
      data: {
        memberId: member.id,
        value: 100,
        screenshotIds: [fileId],
        createdAt: new Date('2020-01-01'),
      },
    });
  });
  afterAll(async () => {
    if (!db) return;
    await db.auditLog.deleteMany({ where: { entityId: actor.memberId! } });
    await db.gearScoreRecord.deleteMany({ where: { memberId: actor.memberId! } });
    await db.screenshot.deleteMany({ where: { userId: actor.userId } });
    await db.member.delete({ where: { id: actor.memberId! } });
    await db.user.delete({ where: { id: actor.userId } });
    await db.$disconnect();
  });
  it('сохраняет историю и аудит, снимает устаревание после обновления', async () => {
    const profiles = new ProfilesService(db as unknown as ProfilesDb);
    expect((await profiles.get(actor.memberId!, actor)).gearScore?.stale).toBe(true);
    await new GearScoreService(db).add(
      actor.memberId!,
      { gearScore: 5000, screenshotIds: [fileId], comment: 'Новая экипировка' },
      actor,
    );
    expect(await db.gearScoreRecord.count({ where: { memberId: actor.memberId! } })).toBe(2);
    expect((await profiles.get(actor.memberId!, actor)).gearScore).toMatchObject({
      value: 5000,
      stale: false,
    });
    expect(
      await db.auditLog.count({
        where: { entityId: actor.memberId!, action: 'GEAR_SCORE_UPDATE' },
      }),
    ).toBe(1);
  });
  it('отклоняет чужой профиль', async () => {
    await expect(new GearScoreService(db).add('other', {}, actor)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('отклоняет чужие или отсутствующие файлы без записи GS', async () => {
    const count = await db.gearScoreRecord.count({ where: { memberId: actor.memberId! } });
    await expect(
      new GearScoreService(db).add(
        actor.memberId!,
        { gearScore: 5001, screenshotIds: [randomUUID()], comment: 'Не мой файл' },
        actor,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(await db.gearScoreRecord.count({ where: { memberId: actor.memberId! } })).toBe(count);
  });
});
