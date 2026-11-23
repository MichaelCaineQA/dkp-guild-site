import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { EventsService, type EventsDb } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordDeliveryService } from './discord-delivery.service';
import { enqueueEventAnnouncement } from './event-announcements';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Event announcements on PostgreSQL', () => {
  let db: PrismaClient;
  let events: EventsService;
  let delivery: DiscordDeliveryService;
  let memberId: string;
  let typeId: string;
  let fetchSpy: jest.SpyInstance;
  const keys: string[] = [];
  const oldToken = process.env.DISCORD_BOT_TOKEN;
  const oldGuild = process.env.DISCORD_GUILD_ID;
  const oldWeb = process.env.WEB_URL;
  let ownsSetting = false;
  const channels = { announcements: '400', reminders: null, absences: null, lots: null };
  const input = () => ({
    name: 'Рейд',
    eventTypeId: typeId,
    raidLeadId: memberId,
    mode: 'PVE',
    startsAt: '2030-01-01T17:00:00Z',
    endsAt: '2030-01-01T19:00:00Z',
    dkpReward: 10,
  });

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Only a local test database is allowed');
    db = new PrismaClient({ datasourceUrl: url });
    if (await db.setting.findUnique({ where: { key: 'discord.channels' } }))
      throw new Error('Discord settings test requires an unconfigured test database');
    ownsSetting = true;
    process.env.DISCORD_BOT_TOKEN = 'test';
    process.env.DISCORD_GUILD_ID = '100';
    process.env.WEB_URL = 'https://example.test';
    memberId = (await db.member.create({ data: { nickname: `announce-${randomUUID()}` } })).id;
    typeId = (await db.eventType.create({ data: { name: `announce-${randomUUID()}` } })).id;
    events = new EventsService(db as unknown as EventsDb);
    delivery = new DiscordDeliveryService(db as unknown as PrismaService);
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}'));
  });
  beforeEach(async () => {
    await db.setting.upsert({
      where: { key: 'discord.channels' },
      create: { key: 'discord.channels', value: { guildId: '100', channels } },
      update: { value: { guildId: '100', channels } },
    });
    await db.discordDeliveryGate.update({ where: { id: 1 }, data: { resumeAt: new Date(0) } });
    fetchSpy.mockClear();
  });
  afterAll(async () => {
    fetchSpy?.mockRestore();
    if (keys.length) await db.discordNotification.deleteMany({ where: { id: { in: keys } } });
    if (memberId) await db.auditLog.deleteMany({ where: { actorMemberId: memberId } });
    if (typeId) {
      await db.event.deleteMany({ where: { eventTypeId: typeId } });
      await db.eventType.delete({ where: { id: typeId } });
    }
    if (memberId) await db.member.delete({ where: { id: memberId } });
    if (ownsSetting) await db.setting.deleteMany({ where: { key: 'discord.channels' } });
    if (oldToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = oldToken;
    if (oldGuild === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = oldGuild;
    if (oldWeb === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = oldWeb;
    await db.$disconnect();
  });
  const actor = () => ({ memberId, isAdmin: false, rank: 'OFFICER' as const });

  it('uses the latest event name and time when delivering', async () => {
    const created = await events.create(input(), actor());
    const key = `event:${created.id}`;
    keys.push(key);
    await db.event.update({
      where: { id: created.id },
      data: {
        name: 'Перенесённый рейд',
        startsAt: new Date('2030-01-02T17:00:00Z'),
        endsAt: new Date('2030-01-02T19:00:00Z'),
      },
    });
    await delivery.run();
    const payload = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(payload.content).toContain('Перенесённый рейд');
    expect(payload.content).toContain('<t:1893603600:F>');
    expect(payload.content).toContain('https://example.test/schedule');
    expect((await db.discordNotification.findUniqueOrThrow({ where: { id: key } })).status).toBe(
      'SENT',
    );
    await delivery.run();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not send an event cancelled before delivery', async () => {
    const created = await events.create(input(), actor());
    const key = `event:${created.id}`;
    keys.push(key);
    await db.event.update({ where: { id: created.id }, data: { status: 'CANCELLED' } });
    await delivery.run();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await db.discordNotification.findUniqueOrThrow({ where: { id: key } })).status).toBe(
      'CANCELLED',
    );
  });

  it('does not send an event deleted before delivery', async () => {
    const created = await events.create(input(), actor());
    const key = `event:${created.id}`;
    keys.push(key);
    await events.deleteOne(created.id, actor());
    await delivery.run();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await db.discordNotification.findUniqueOrThrow({ where: { id: key } })).status).toBe(
      'CANCELLED',
    );
  });

  it('does not queue an event when the channel is disabled', async () => {
    await db.setting.update({
      where: { key: 'discord.channels' },
      data: { value: { guildId: '100', channels: { ...channels, announcements: null } } },
    });
    const created = await events.create(input(), actor());
    expect(
      await db.discordNotification.findUnique({ where: { id: `event:${created.id}` } }),
    ).toBeNull();
  });

  it('rolls back the queued announcement with the transaction', async () => {
    const key = `announce-test:${randomUUID()}`;
    await expect(
      db.$transaction(async (tx) => {
        await enqueueEventAnnouncement(tx, key, ['event-id']);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await db.discordNotification.findUnique({ where: { id: key } })).toBeNull();
  });

  it('groups a series and delivers all 30 future dates in multiple messages', async () => {
    const series = await events.createSeries(
      { ...input(), repeat: 'DAILY', until: '2030-01-30T17:00:00Z' },
      actor(),
    );
    const key = `series:${series.seriesId}`;
    keys.push(key);
    expect(series.created).toBe(30);
    await delivery.run();
    await db.discordNotification.update({ where: { id: key }, data: { availableAt: new Date(0) } });
    await delivery.run();
    const messages = fetchSpy.mock.calls.map(
      (call) => JSON.parse(call[1].body as string).content as string,
    );
    expect(messages).toHaveLength(2);
    expect(messages.join('').match(/<t:\d+:F>/g)).toHaveLength(30);
    expect((await db.discordNotification.findUniqueOrThrow({ where: { id: key } })).status).toBe(
      'SENT',
    );
  });

  it('splits long announcements without losing dates or exceeding the Discord limit', async () => {
    const series = await events.createSeries(
      { ...input(), name: 'А'.repeat(120), repeat: 'DAILY', until: '2030-01-15T17:00:00Z' },
      actor(),
    );
    const key = `series:${series.seriesId}`;
    keys.push(key);
    await delivery.run();
    await db.discordNotification.update({ where: { id: key }, data: { availableAt: new Date(0) } });
    await delivery.run();
    const messages = fetchSpy.mock.calls.map(
      (call) => JSON.parse(call[1].body as string).content as string,
    );
    expect(messages).toHaveLength(2);
    expect(messages.every((message) => message.length <= 2000)).toBe(true);
    expect(messages.join('').match(/<t:\d+:F>/g)).toHaveLength(15);
    expect((await db.discordNotification.findUniqueOrThrow({ where: { id: key } })).status).toBe(
      'SENT',
    );
  });
});
