import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordDeliveryService } from './discord-delivery.service';
import { enqueueDiscordNotification } from './discord-outbox';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('Discord outbox on PostgreSQL', () => {
  let db: PrismaClient;
  let service: DiscordDeliveryService;
  let id: string;
  let token: string | undefined;
  let guild: string | undefined;
  let fetchSpy: jest.SpyInstance;

  beforeAll(() => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Only a local test database is allowed');
    db = new PrismaClient({ datasourceUrl: url });
    service = new DiscordDeliveryService(db as unknown as PrismaService);
    token = process.env.DISCORD_BOT_TOKEN;
    guild = process.env.DISCORD_GUILD_ID;
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.DISCORD_GUILD_ID = '100';
  });

  beforeEach(async () => {
    id = `discord-test-${randomUUID()}`;
    await db.discordDeliveryGate.update({ where: { id: 1 }, data: { resumeAt: new Date(0) } });
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    await db.discordNotification.deleteMany({ where: { id: { startsWith: 'discord-test-' } } });
    await db.discordDeliveryGate.update({ where: { id: 1 }, data: { resumeAt: new Date(0) } });
  });

  afterAll(async () => {
    if (token === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = token;
    if (guild === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = guild;
    await db.$disconnect();
  });

  async function enqueue(): Promise<void> {
    await db.$transaction((tx) =>
      enqueueDiscordNotification(tx, { id, channelId: '123', content: '@everyone hello' }),
    );
  }

  it('rolls back the notification with its domain transaction', async () => {
    await expect(
      db.$transaction(async (tx) => {
        await enqueueDiscordNotification(tx, { id, channelId: '123', content: 'hello' });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await db.discordNotification.findUnique({ where: { id } })).toBeNull();
  });

  it('uses a stable key to avoid duplicate queue entries', async () => {
    await enqueue();
    await enqueue();
    expect(await db.discordNotification.count({ where: { id } })).toBe(1);
  });

  it('leaves pending messages untouched when the bot is disabled', async () => {
    await enqueue();
    delete process.env.DISCORD_BOT_TOKEN;
    try {
      await service.run();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((await db.discordNotification.findUniqueOrThrow({ where: { id } })).status).toBe(
        'PENDING',
      );
    } finally {
      process.env.DISCORD_BOT_TOKEN = 'test-token';
    }
  });

  it('does not send a notification copied from another Discord server', async () => {
    await db.discordNotification.create({
      data: { id, guildId: '999', channelId: '123', content: 'foreign' },
    });
    await service.run();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await db.discordNotification.findUniqueOrThrow({ where: { id } })).status).toBe(
      'PENDING',
    );
  });

  it('delivers once and suppresses user-provided mentions', async () => {
    await enqueue();
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
    await service.run();
    await service.run();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      content: '@everyone hello',
      allowed_mentions: { parse: [] },
      enforce_nonce: true,
    });
    expect((await db.discordNotification.findUniqueOrThrow({ where: { id } })).status).toBe('SENT');
  });

  it('schedules retry for an ambiguous network failure with the same nonce', async () => {
    await enqueue();
    fetchSpy.mockRejectedValueOnce(new Error('network')).mockResolvedValue(new Response('{}'));
    await service.run();
    const pending = await db.discordNotification.findUniqueOrThrow({ where: { id } });
    expect(pending).toMatchObject({ status: 'PENDING', lastError: 'NETWORK', attempts: 1 });
    expect(pending.availableAt.getTime()).toBeGreaterThan(Date.now());
    await db.discordNotification.update({ where: { id }, data: { availableAt: new Date(0) } });
    await service.run();
    const first = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    const second = JSON.parse(fetchSpy.mock.calls[1][1].body as string);
    expect(second.nonce).toBe(first.nonce);
    expect((await db.discordNotification.findUniqueOrThrow({ where: { id } })).status).toBe('SENT');
  });

  it('persists a rate limit across workers', async () => {
    await enqueue();
    fetchSpy.mockResolvedValue(
      new Response('{}', { status: 429, headers: { 'retry-after': '60' } }),
    );
    await service.run();
    const other = new DiscordDeliveryService(db as unknown as PrismaService);
    await other.run();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(
      (await db.discordDeliveryGate.findUniqueOrThrow({ where: { id: 1 } })).resumeAt.getTime(),
    ).toBeGreaterThan(Date.now() + 50000);
    expect((await db.discordNotification.findUniqueOrThrow({ where: { id } })).lastError).toBe(
      'RATE_LIMIT',
    );
  });

  it('marks a permissions error as failed without storing the response body', async () => {
    await enqueue();
    fetchSpy.mockResolvedValue(new Response('secret user text', { status: 403 }));
    await service.run();
    expect(await db.discordNotification.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'FAILED',
      lastError: 'HTTP_403',
    });
  });

  it('allows only one of two workers to send the same notification', async () => {
    await enqueue();
    let finish!: (response: Response) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const response = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    fetchSpy.mockImplementation(() => {
      entered();
      return response;
    });
    const first = service.run();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        started,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Discord request did not start')), 10000);
        }),
      ]);
      const other = new DiscordDeliveryService(db as unknown as PrismaService);
      await other.run();
    } finally {
      if (deadline) clearTimeout(deadline);
      finish(new Response('{}'));
      await first;
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await db.discordNotification.findUniqueOrThrow({ where: { id } })).status).toBe('SENT');
  }, 20000);
});
