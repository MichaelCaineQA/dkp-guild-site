import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordChannelValidator } from './discord-channel-validator';
import { DiscordSettingsService } from './discord-settings.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Discord settings on PostgreSQL', () => {
  let db: PrismaClient;
  let service: DiscordSettingsService;
  let fetchSpy: jest.SpyInstance;
  let owned = false;
  let testId: string | undefined;
  const previousToken = process.env.DISCORD_BOT_TOKEN;
  const previousGuild = process.env.DISCORD_GUILD_ID;
  const actor = { memberId: null, isAdmin: true };
  const channels = { announcements: '400', reminders: null, absences: '401', lots: null };

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Only a local test database is allowed');
    db = new PrismaClient({ datasourceUrl: url });
    if (await db.setting.findUnique({ where: { key: 'discord.channels' } }))
      throw new Error('Discord settings test requires an unconfigured test database');
    owned = true;
    process.env.DISCORD_BOT_TOKEN = 'test';
    process.env.DISCORD_GUILD_ID = '100';
    service = new DiscordSettingsService(
      db as unknown as PrismaService,
      new DiscordChannelValidator(),
    );
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (url: string | URL | Request) => {
        const path = String(url);
        let body: unknown;
        if (path.endsWith('/users/@me')) body = { id: '200' };
        else if (path.endsWith('/guilds/100')) body = { owner_id: '300' };
        else if (path.includes('/channels/'))
          body = { guild_id: '100', type: 0, permission_overwrites: [] };
        else if (path.endsWith('/guilds/100/roles')) body = [{ id: '100', permissions: '3072' }];
        else if (path.endsWith('/guilds/100/members/200')) body = { roles: [] };
        else return new Response('{}', { status: 404 });
        return new Response(JSON.stringify(body));
      });
  });

  afterAll(async () => {
    fetchSpy?.mockRestore();
    if (testId) await db?.discordNotification.deleteMany({ where: { id: testId } });
    await db?.auditLog.deleteMany({
      where: { entityId: 'discord.channels', comment: { contains: 'discord-settings-test' } },
    });
    if (owned) await db?.setting.deleteMany({ where: { key: 'discord.channels' } });
    if (previousToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = previousToken;
    if (previousGuild === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = previousGuild;
    await db?.$disconnect();
  });

  it('saves validated channels and records an audit', async () => {
    await service.update(
      { channels, absenceAccessConfirmed: true, reason: 'discord-settings-test' },
      actor,
    );
    expect((await service.get()).channels).toEqual(channels);
    expect(
      await db.auditLog.count({
        where: { entityId: 'discord.channels', comment: { contains: 'discord-settings-test' } },
      }),
    ).toBe(1);
  });

  it('rejects absence channels without the access checklist', async () => {
    await expect(
      service.update(
        { channels, absenceAccessConfirmed: false, reason: 'discord-settings-test' },
        actor,
      ),
    ).rejects.toThrow('Подтвердите');
  });

  it('changes and disables a channel with an audit record', async () => {
    await service.update(
      { channels, absenceAccessConfirmed: true, reason: 'discord-settings-test' },
      actor,
    );
    const changed = { ...channels, announcements: '402' };
    await service.update(
      { channels: changed, absenceAccessConfirmed: true, reason: 'discord-settings-test' },
      actor,
    );
    const disabled = { ...changed, announcements: null };
    await service.update(
      { channels: disabled, absenceAccessConfirmed: true, reason: 'discord-settings-test' },
      actor,
    );
    expect((await service.get()).channels).toEqual(disabled);
  });

  it('hides channels copied from a different environment', async () => {
    await service.update(
      { channels, absenceAccessConfirmed: true, reason: 'discord-settings-test' },
      actor,
    );
    process.env.DISCORD_GUILD_ID = '999';
    try {
      expect((await service.get()).channels).toEqual({
        announcements: null,
        reminders: null,
        absences: null,
        lots: null,
      });
    } finally {
      process.env.DISCORD_GUILD_ID = '100';
    }
  });

  it('queues a neutral message for the saved channel', async () => {
    await service.update(
      { channels, absenceAccessConfirmed: true, reason: 'discord-settings-test' },
      actor,
    );
    const result = await service.test('announcements');
    testId = result.id;
    expect(
      await db.discordNotification.findUniqueOrThrow({ where: { id: result.id } }),
    ).toMatchObject({
      channelId: '400',
      content: 'Проверка уведомлений сайта гильдии.',
      status: 'PENDING',
    });
  });
});
