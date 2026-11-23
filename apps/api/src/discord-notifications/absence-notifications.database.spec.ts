import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AbsencesService, type AbsencesDb } from '../absences/absences.service';
import { ParticipationService } from '../events/participation.service';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordDeliveryService } from './discord-delivery.service';
import { enqueueAbsenceNotification } from './absence-notifications';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Absence notifications on PostgreSQL', () => {
  let db: PrismaClient;
  let memberId: string;
  let typeId: string;
  let eventId: string;
  let absences: AbsencesService;
  let participation: ParticipationService;
  let delivery: DiscordDeliveryService;
  let fetchSpy: jest.SpyInstance;
  let ownsSetting = false;
  const oldToken = process.env.DISCORD_BOT_TOKEN;
  const oldGuild = process.env.DISCORD_GUILD_ID;
  const secret = 'секретная причина @everyone 927';
  const now = new Date('2029-12-31T10:00:00Z');
  const start = new Date('2030-01-01T17:00:00Z');
  const end = new Date('2030-01-01T19:00:00Z');
  const actor = () => ({ memberId, isAdmin: false, rank: 'MEMBER' as const });
  const input = () => ({ dateFrom: start, dateTo: end, allDay: false, reason: secret });

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Only a local test database is allowed');
    db = new PrismaClient({ datasourceUrl: url });
    if (await db.setting.findUnique({ where: { key: 'discord.channels' } }))
      throw new Error('Absence notification test requires an unconfigured test database');
    if (await db.discordNotification.count({ where: { guildId: '100', status: 'PENDING' } }))
      throw new Error('Absence notification test requires an empty test queue');
    ownsSetting = true;
    process.env.DISCORD_BOT_TOKEN = 'test';
    process.env.DISCORD_GUILD_ID = '100';
    memberId = (await db.member.create({ data: { nickname: `absence-${randomUUID()}` } })).id;
    typeId = (await db.eventType.create({ data: { name: `absence-${randomUUID()}` } })).id;
    eventId = (
      await db.event.create({
        data: {
          name: 'Рейд',
          eventTypeId: typeId,
          raidLeadId: memberId,
          mode: 'PVE',
          startsAt: start,
          endsAt: end,
          dkpReward: 10,
        },
      })
    ).id;
    absences = new AbsencesService(
      db as unknown as AbsencesDb,
      { deadlineBeforeStartSec: 180 },
      () => now,
    );
    participation = new ParticipationService(db, () => now);
    delivery = new DiscordDeliveryService(db as unknown as PrismaService);
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}'));
  });
  beforeEach(async () => {
    await db.setting.upsert({
      where: { key: 'discord.channels' },
      create: { key: 'discord.channels', value: { guildId: '100', channels: { absences: '401' } } },
      update: { value: { guildId: '100', channels: { absences: '401' } } },
    });
    await db.discordDeliveryGate.update({ where: { id: 1 }, data: { resumeAt: new Date(0) } });
    fetchSpy.mockClear();
  });
  afterEach(async () => {
    const rows = await db.absence.findMany({ where: { memberId }, select: { id: true } });
    await db.discordNotification.deleteMany({
      where: { subjectId: { in: rows.map((row) => row.id) } },
    });
    await db.auditLog.deleteMany({
      where: {
        OR: [
          { actorMemberId: memberId },
          { entityType: 'Absence', entityId: { in: rows.map((row) => row.id) } },
        ],
      },
    });
    await db.absence.deleteMany({ where: { memberId } });
  });
  afterAll(async () => {
    fetchSpy?.mockRestore();
    if (ownsSetting) await db.setting.deleteMany({ where: { key: 'discord.channels' } });
    if (eventId) await db.event.delete({ where: { id: eventId } });
    if (typeId) await db.eventType.delete({ where: { id: typeId } });
    if (memberId) await db.member.delete({ where: { id: memberId } });
    if (oldToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = oldToken;
    if (oldGuild === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = oldGuild;
    await db.$disconnect();
  });

  it('notifies about an interval without storing or sending the reason', async () => {
    const created = await absences.create(memberId, input(), actor());
    const queued = await db.discordNotification.findUniqueOrThrow({
      where: { id: `absence:${created.id}` },
    });
    expect(JSON.stringify(queued)).not.toContain(secret);
    await delivery.run();
    const request = fetchSpy.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(request.body as string);
    expect(payload.content).toContain('Новая заявка об отсутствии');
    expect(payload.content).toContain('absence-');
    expect(JSON.stringify(payload)).not.toContain(secret);
    expect(payload.content).not.toContain('секретная');
    expect(payload.content).not.toContain('@everyone');
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it('notifies about declining a specific event without its reason', async () => {
    await participation.update(eventId, memberId, { attending: false, reason: secret });
    await delivery.run();
    const payload = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(payload.content).toContain('Ивент: Рейд');
    expect(JSON.stringify(payload)).not.toContain(secret);
  });

  it('does not send a cancelled application', async () => {
    const created = await absences.create(memberId, input(), actor());
    await absences.cancel(created.id, actor());
    await delivery.run();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      (await db.discordNotification.findUniqueOrThrow({ where: { id: `absence:${created.id}` } }))
        .status,
    ).toBe('CANCELLED');
  });

  it('does not enqueue another message for seen or repeated delivery', async () => {
    const created = await absences.create(memberId, input(), actor());
    await absences.markSeen(created.id, { memberId: null, isAdmin: true, rank: null });
    await delivery.run();
    await delivery.run();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await db.discordNotification.count({ where: { subjectId: created.id } })).toBe(1);
  });

  it('does not enqueue without a configured channel', async () => {
    await db.setting.update({
      where: { key: 'discord.channels' },
      data: { value: { guildId: '100', channels: { absences: null } } },
    });
    const created = await absences.create(memberId, input(), actor());
    expect(
      await db.discordNotification.findUnique({ where: { id: `absence:${created.id}` } }),
    ).toBeNull();
  });

  it('rejects an invalid application without creating a notification', async () => {
    await expect(absences.create(memberId, { ...input(), dateTo: now }, actor())).rejects.toThrow();
    expect(await db.absence.count({ where: { memberId } })).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('routes to the current closed channel after a change', async () => {
    await absences.create(memberId, input(), actor());
    await db.setting.update({
      where: { key: 'discord.channels' },
      data: { value: { guildId: '100', channels: { absences: '402' } } },
    });
    await delivery.run();
    expect(fetchSpy.mock.calls[0][0]).toContain('/channels/402/messages');
  });

  it('rolls back the notification with the application transaction', async () => {
    const id = `test-${randomUUID()}`;
    await expect(
      db.$transaction(async (tx) => {
        await enqueueAbsenceNotification(tx, id);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await db.discordNotification.findUnique({ where: { id: `absence:${id}` } })).toBeNull();
  });
});
