import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordDeliveryService } from './discord-delivery.service';
import { DiscordReminderScheduler } from './discord-reminder.scheduler';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const time = (value: string) => new Date(`2030-01-01T${value}:00Z`);

suite('Discord reminders on PostgreSQL', () => {
  let db: PrismaClient;
  let scheduler: DiscordReminderScheduler;
  let delivery: DiscordDeliveryService;
  let eventId: string;
  let memberId: string;
  let typeId: string;
  let fetchSpy: jest.SpyInstance;
  let ownsChannels = false;
  let priorMinutes: Prisma.JsonValue | undefined;
  const oldToken = process.env.DISCORD_BOT_TOKEN;
  const oldGuild = process.env.DISCORD_GUILD_ID;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Only a local test database is allowed');
    db = new PrismaClient({ datasourceUrl: url });
    if (await db.setting.findUnique({ where: { key: 'discord.channels' } }))
      throw new Error('Discord reminder test requires an unconfigured test database');
    if (await db.event.count({ where: { startsAt: { gte: time('09:00'), lte: time('12:00') } } }))
      throw new Error('Discord reminder test requires an unused test time window');
    if (await db.discordNotification.count({ where: { guildId: '100', status: 'PENDING' } }))
      throw new Error('Discord reminder test requires an empty test queue');
    ownsChannels = true;
    priorMinutes = (await db.setting.findUnique({ where: { key: 'discord.reminderMinutes' } }))
      ?.value;
    process.env.DISCORD_BOT_TOKEN = 'test';
    process.env.DISCORD_GUILD_ID = '100';
    memberId = (await db.member.create({ data: { nickname: `reminder-${randomUUID()}` } })).id;
    typeId = (await db.eventType.create({ data: { name: `reminder-${randomUUID()}` } })).id;
    scheduler = new DiscordReminderScheduler(db as unknown as PrismaService);
    delivery = new DiscordDeliveryService(db as unknown as PrismaService);
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}'));
  });
  beforeEach(async () => {
    await db.setting.upsert({
      where: { key: 'discord.channels' },
      create: {
        key: 'discord.channels',
        value: { guildId: '100', channels: { reminders: '400' } },
      },
      update: { value: { guildId: '100', channels: { reminders: '400' } } },
    });
    await db.setting.upsert({
      where: { key: 'discord.reminderMinutes' },
      create: { key: 'discord.reminderMinutes', value: 15 },
      update: { value: 15 },
    });
    await db.discordDeliveryGate.update({ where: { id: 1 }, data: { resumeAt: new Date(0) } });
    eventId = (
      await db.event.create({
        data: {
          name: 'Рейд',
          eventTypeId: typeId,
          raidLeadId: memberId,
          mode: 'PVE',
          startsAt: time('10:15'),
          endsAt: time('11:15'),
          dkpReward: 10,
        },
      })
    ).id;
    fetchSpy.mockClear();
  });
  afterEach(async () => {
    await db.discordNotification.deleteMany({
      where: { eventIds: { has: eventId }, kind: 'EVENT_REMINDER' },
    });
    await db.event.deleteMany({ where: { id: eventId } });
  });
  afterAll(async () => {
    fetchSpy?.mockRestore();
    if (ownsChannels) await db.setting.deleteMany({ where: { key: 'discord.channels' } });
    if (ownsChannels) {
      if (priorMinutes === undefined)
        await db.setting.deleteMany({ where: { key: 'discord.reminderMinutes' } });
      else
        await db.setting.update({
          where: { key: 'discord.reminderMinutes' },
          data: { value: priorMinutes as Prisma.InputJsonValue },
        });
    }
    if (typeId) await db.eventType.delete({ where: { id: typeId } });
    if (memberId) await db.member.delete({ where: { id: memberId } });
    if (oldToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = oldToken;
    if (oldGuild === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = oldGuild;
    await db.$disconnect();
  });

  it('sends once at the start of the reminder window', async () => {
    await scheduler.scan(time('09:59'));
    expect(await db.discordNotification.count({ where: { eventIds: { has: eventId } } })).toBe(0);
    await scheduler.scan(time('10:00'));
    await delivery.run(time('10:00'));
    await scheduler.scan(time('10:01'));
    await delivery.run(time('10:01'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body as string).content).toContain('Рейд');
  });

  it('creates one local reminder when two schedulers scan together', async () => {
    const other = new DiscordReminderScheduler(db as unknown as PrismaService);
    await Promise.all([scheduler.scan(time('10:00')), other.scan(time('10:00'))]);
    expect(
      await db.discordNotification.count({ where: { guildId: '100', eventIds: { has: eventId } } }),
    ).toBe(1);
  });

  it.each(['SENT', 'PENDING'] as const)(
    'does not let a copied foreign %s reminder block this environment',
    async (status) => {
      await db.discordNotification.create({
        data: {
          id: `reminder:${eventId}:${time('10:15').getTime()}`,
          guildId: '999',
          channelId: '900',
          content: '',
          kind: 'EVENT_REMINDER',
          eventIds: [eventId],
          status,
        },
      });
      await scheduler.scan(time('10:00'));
      const local = await db.discordNotification.findMany({
        where: { guildId: '100', eventIds: { has: eventId } },
      });
      expect(local).toHaveLength(1);
      await delivery.run(time('10:00'));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toContain('/channels/400/messages');
    },
  );

  it.each(['SENT', 'PENDING'] as const)(
    'keeps the local legacy %s reminder without making another',
    async (status) => {
      await db.discordNotification.create({
        data: {
          id: `reminder:${eventId}:${time('10:15').getTime()}`,
          guildId: '100',
          channelId: '400',
          content: '',
          kind: 'EVENT_REMINDER',
          eventIds: [eventId],
          status,
        },
      });
      await scheduler.scan(time('10:00'));
      expect(
        await db.discordNotification.count({
          where: { guildId: '100', eventIds: { has: eventId } },
        }),
      ).toBe(1);
      await delivery.run(time('10:00'));
      expect(fetchSpy).toHaveBeenCalledTimes(status === 'PENDING' ? 1 : 0);
    },
  );

  it('cancels the old reminder after a move and schedules the new start', async () => {
    await scheduler.scan(time('10:00'));
    await db.event.update({
      where: { id: eventId },
      data: { startsAt: time('11:00'), endsAt: time('12:00') },
    });
    await delivery.run(time('10:00'));
    expect(fetchSpy).not.toHaveBeenCalled();
    await scheduler.scan(time('10:45'));
    await delivery.run(time('10:45'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rechecks changed interval and wakes the deferred reminder when the window widens', async () => {
    await scheduler.scan(time('10:00'));
    await db.setting.update({ where: { key: 'discord.reminderMinutes' }, data: { value: 5 } });
    await delivery.run(time('10:00'));
    expect(fetchSpy).not.toHaveBeenCalled();
    await db.setting.update({ where: { key: 'discord.reminderMinutes' }, data: { value: 20 } });
    await scheduler.scan(time('10:01'));
    await delivery.run(time('10:01'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not shorten a network retry delay when scanning again', async () => {
    await scheduler.scan(time('10:00'));
    const row = await db.discordNotification.findFirstOrThrow({
      where: { eventIds: { has: eventId } },
    });
    await db.discordNotification.update({
      where: { id: row.id },
      data: { lastError: 'NETWORK', availableAt: time('10:10') },
    });
    await scheduler.scan(time('10:01'));
    expect(
      (await db.discordNotification.findUniqueOrThrow({ where: { id: row.id } })).availableAt,
    ).toEqual(time('10:10'));
  });

  it('does not send a reminder for a cancelled event', async () => {
    await scheduler.scan(time('10:00'));
    await db.event.update({ where: { id: eventId }, data: { status: 'CANCELLED' } });
    await delivery.run(time('10:00'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(['RUNNING', 'FINISHED'] as const)(
    'does not send after the event becomes %s',
    async (status) => {
      await scheduler.scan(time('10:00'));
      await db.event.update({ where: { id: eventId }, data: { status } });
      await delivery.run(time('10:00'));
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('sends a reminder for an event belonging to a series', async () => {
    await db.event.update({ where: { id: eventId }, data: { seriesId: 'reminder-test-series' } });
    await scheduler.scan(time('10:00'));
    await delivery.run(time('10:00'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the current reminder channel after a configuration change', async () => {
    await scheduler.scan(time('10:00'));
    await db.setting.update({
      where: { key: 'discord.channels' },
      data: { value: { guildId: '100', channels: { reminders: '401' } } },
    });
    await delivery.run(time('10:00'));
    expect(fetchSpy.mock.calls[0][0]).toContain('/channels/401/messages');
  });

  it('recovers a due reminder after a scheduler restart', async () => {
    await scheduler.scan(time('09:00'));
    const restarted = new DiscordReminderScheduler(db as unknown as PrismaService);
    await restarted.scan(time('10:05'));
    await delivery.run(time('10:05'));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('skips reminders whose event has already started', async () => {
    await scheduler.scan(time('10:05'));
    await delivery.run(time('10:15'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not send a reminder for a deleted event', async () => {
    await scheduler.scan(time('10:00'));
    await db.event.delete({ where: { id: eventId } });
    await delivery.run(time('10:00'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
