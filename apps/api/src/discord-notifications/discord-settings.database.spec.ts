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
  let discordAnswer: (url: string) => Response | undefined;
  let owned = false;
  const testIds: string[] = [];
  const previousToken = process.env.DISCORD_BOT_TOKEN;
  const previousGuild = process.env.DISCORD_GUILD_ID;
  const actor = { memberId: null, isAdmin: true };
  const channels = { announcements: '400', reminders: null, absences: '401', lots: null };
  /** Один канал для всех четырёх типов уведомлений. */
  const shared = { announcements: '400', reminders: '400', absences: '400', lots: '400' };
  const auditWhere = {
    entityId: 'discord.channels',
    comment: { contains: 'discord-settings-test' },
  };
  const auditCount = () => db.auditLog.count({ where: auditWhere });
  const channelReads = (id: string) =>
    fetchSpy.mock.calls.filter(([address]) => String(address).endsWith(`/channels/${id}`));

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
    discordAnswer = () => undefined;
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (address: string | URL | Request) => {
        const path = String(address);
        const override = discordAnswer(path);
        if (override) return override;
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

  beforeEach(() => {
    discordAnswer = () => undefined;
    fetchSpy.mockClear();
  });

  afterAll(async () => {
    fetchSpy?.mockRestore();
    if (testIds.length)
      await db?.discordNotification.deleteMany({ where: { id: { in: testIds } } });
    await db?.auditLog.deleteMany({ where: auditWhere });
    if (owned) await db?.setting.deleteMany({ where: { key: 'discord.channels' } });
    if (previousToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = previousToken;
    if (previousGuild === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = previousGuild;
    await db?.$disconnect();
  });

  it('saves validated channels and records an audit', async () => {
    await service.update({ channels, reason: 'discord-settings-test' }, actor);
    expect((await service.get()).channels).toEqual(channels);
    expect(await auditCount()).toBe(1);
  });

  it('saves a channel shared by all notification types', async () => {
    await service.update({ channels: shared, reason: 'discord-settings-test' }, actor);
    expect((await service.get()).channels).toEqual(shared);
    expect(await auditCount()).toBe(2);
    // Общий ID проверяется в Discord один раз, а не по числу типов.
    expect(channelReads('400')).toHaveLength(1);
  });

  it('ignores the confirmation flag that an older form still sends', async () => {
    const off = { ...channels, absences: null };
    await service.update({ channels: off, reason: 'discord-settings-test' }, actor);
    expect((await service.get()).channels).toEqual(off);
    for (const absenceAccessConfirmed of [false, true]) {
      await service.update(
        { channels, absenceAccessConfirmed, reason: 'discord-settings-test' },
        actor,
      );
      expect((await service.get()).channels).toEqual(channels);
    }
    expect(await auditCount()).toBe(4);
  });

  it('rejects an absence channel from another server and saves nothing', async () => {
    const before = await auditCount();
    discordAnswer = (path) =>
      path.endsWith('/channels/403')
        ? new Response(JSON.stringify({ guild_id: '999', type: 0, permission_overwrites: [] }))
        : undefined;
    await expect(
      service.update(
        { channels: { ...channels, absences: '403' }, reason: 'discord-settings-test' },
        actor,
      ),
    ).rejects.toThrow('настроенного Discord-сервера');
    expect((await service.get()).channels).toEqual(channels);
    expect(await auditCount()).toBe(before);
  });

  it('rejects an absence channel the bot cannot write to and saves nothing', async () => {
    const before = await auditCount();
    const everyone = { id: '100', permissions: '3072' };
    // DENY VIEW_CHANNEL (1024) и SEND_MESSAGES (2048) для @everyone.
    const deny = (1024n | 2048n).toString();
    discordAnswer = (path) => {
      if (path.endsWith('/guilds/100/roles')) return new Response(JSON.stringify([everyone]));
      return path.endsWith('/channels/403')
        ? new Response(
            JSON.stringify({
              guild_id: '100',
              type: 0,
              permission_overwrites: [{ id: '100', type: 0, allow: '0', deny }],
            }),
          )
        : undefined;
    };
    await expect(
      service.update(
        { channels: { ...channels, absences: '403' }, reason: 'discord-settings-test' },
        actor,
      ),
    ).rejects.toThrow('Боту нужны права');
    expect((await service.get()).channels).toEqual(channels);
    expect(await auditCount()).toBe(before);
  });

  it('changes and disables a channel with an audit record', async () => {
    await service.update({ channels, reason: 'discord-settings-test' }, actor);
    const changed = { ...channels, announcements: '402' };
    await service.update({ channels: changed, reason: 'discord-settings-test' }, actor);
    const announcementsOff = { ...changed, announcements: null };
    await service.update({ channels: announcementsOff, reason: 'discord-settings-test' }, actor);
    const absencesOff = { ...announcementsOff, absences: null };
    await service.update({ channels: absencesOff, reason: 'discord-settings-test' }, actor);
    const saved = (await service.get()).channels;
    expect(saved).toEqual(absencesOff);
    expect(
      (
        await db.auditLog.findFirst({
          where: { ...auditWhere, comment: { contains: ` → ${JSON.stringify(absencesOff)}` } },
        })
      )?.comment,
    ).toBe(
      `Discord: ${JSON.stringify(announcementsOff)} → ${JSON.stringify(absencesOff)}; discord-settings-test`,
    );
    await service.update({ channels, reason: 'discord-settings-test' }, actor);
  });

  it('does not write an audit record when the same channels are saved again', async () => {
    const before = await auditCount();
    await service.update({ channels, reason: 'discord-settings-test' }, actor);
    expect((await service.get()).channels).toEqual(channels);
    expect(await auditCount()).toBe(before);
  });

  it('hides channels copied from a different environment', async () => {
    await service.update({ channels, reason: 'discord-settings-test' }, actor);
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
    await service.update({ channels, reason: 'discord-settings-test' }, actor);
    const result = await service.test('announcements');
    testIds.push(result.id);
    expect(
      await db.discordNotification.findUniqueOrThrow({ where: { id: result.id } }),
    ).toMatchObject({
      channelId: '400',
      content: 'Проверка уведомлений сайта гильдии.',
      status: 'PENDING',
    });
  });

  it('queues the absence test message for the shared channel', async () => {
    await service.update({ channels: shared, reason: 'discord-settings-test' }, actor);
    const result = await service.test('absences');
    testIds.push(result.id);
    expect(
      await db.discordNotification.findUniqueOrThrow({ where: { id: result.id } }),
    ).toMatchObject({
      channelId: '400',
      content: 'Проверка уведомлений сайта гильдии.',
      status: 'PENDING',
    });
  });
});
