import { PrismaClient } from '@prisma/client';
import { SettingsService, type SettingsDb } from './settings.service';
const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Настройки: PostgreSQL и откат аудита', () => {
  let db: PrismaClient;
  let service: SettingsService;
  let original: Array<{ key: string; value: unknown }> = [];
  const keys = ['auction.step', 'checkin.windowSec'];
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    service = new SettingsService(db as unknown as SettingsDb);
    original = await db.setting.findMany({ where: { key: { in: keys } } });
  });
  beforeEach(async () => {
    for (const [key, value] of [
      ['auction.step', 1],
      ['checkin.windowSec', 180],
    ] as const)
      await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  });
  afterAll(async () => {
    if (!db) return;
    await db.setting.deleteMany({ where: { key: { in: keys } } });
    for (const row of original)
      await db.setting.create({ data: { key: row.key, value: row.value as number } });
    await db.$disconnect();
  });
  it('невалидное второе поле не изменяет первое', async () => {
    await expect(
      service.update(
        { 'auction.step': 2, 'checkin.windowSec': 0 },
        { memberId: null, isAdmin: true },
      ),
    ).rejects.toThrow();
    expect((await db.setting.findUniqueOrThrow({ where: { key: 'auction.step' } })).value).toBe(1);
  });
  it('ошибка FK автора аудита откатывает все upsert', async () => {
    await expect(
      service.update(
        { 'auction.step': 2, 'checkin.windowSec': 240 },
        { memberId: 'missing-author', isAdmin: true },
      ),
    ).rejects.toThrow();
    expect((await db.setting.findUniqueOrThrow({ where: { key: 'auction.step' } })).value).toBe(1);
    expect(
      (await db.setting.findUniqueOrThrow({ where: { key: 'checkin.windowSec' } })).value,
    ).toBe(180);
  });
  it('сбой аудита откатывает длительности и якорь игрового цикла', async () => {
    const existing = await db.guild.findFirst();
    const guild =
      existing ??
      (await db.guild.create({
        data: {
          name: 'settings-fixture',
          gameTimeAnchor: new Date('2026-01-01'),
          gameTimeDayMinutes: 90,
          gameTimeNightMinutes: 30,
        },
      }));
    try {
      await expect(
        service.updateGameTime(
          {
            gameTimeAnchor: new Date(+guild.gameTimeAnchor + 1000).toISOString(),
            gameTimeDayMinutes: 100,
            gameTimeNightMinutes: 35,
          },
          { memberId: 'missing-author', isAdmin: true },
        ),
      ).rejects.toThrow();
      const current = await db.guild.findUniqueOrThrow({ where: { id: guild.id } });
      expect(current.gameTimeAnchor).toEqual(guild.gameTimeAnchor);
      expect(current.gameTimeDayMinutes).toBe(guild.gameTimeDayMinutes);
      expect(current.gameTimeNightMinutes).toBe(guild.gameTimeNightMinutes);
    } finally {
      if (!existing) await db.guild.delete({ where: { id: guild.id } });
    }
  });
});
