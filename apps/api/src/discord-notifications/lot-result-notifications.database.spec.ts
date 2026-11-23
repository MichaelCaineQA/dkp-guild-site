import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuctionCloseService, type CloseDb } from '../auction-close/auction-close.service';
import { AuctionManageService, type ManageDb } from '../auction-manage/auction-manage.service';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordDeliveryService } from './discord-delivery.service';
import { enqueueLotResult } from './lot-result-notifications';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Lot result notifications on PostgreSQL', () => {
  let db: PrismaClient;
  let closer: AuctionCloseService;
  let manage: AuctionManageService;
  let delivery: DiscordDeliveryService;
  let winnerId: string;
  let secondId: string;
  let itemId: string;
  let fetchSpy: jest.SpyInstance;
  let ownsSetting = false;
  const lotIds: string[] = [];
  const dropIds: string[] = [];
  const oldToken = process.env.DISCORD_BOT_TOKEN;
  const oldGuild = process.env.DISCORD_GUILD_ID;
  const actor = { memberId: null, isAdmin: true, rank: 'ADMIN' };
  const secret = 'служебная причина @everyone 842';

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Only a local test database is allowed');
    db = new PrismaClient({ datasourceUrl: url });
    if (await db.setting.findUnique({ where: { key: 'discord.channels' } }))
      throw new Error('Lot notification test requires an unconfigured test database');
    if (await db.discordNotification.count({ where: { guildId: '100', status: 'PENDING' } }))
      throw new Error('Lot notification test requires an empty test queue');
    ownsSetting = true;
    process.env.DISCORD_BOT_TOKEN = 'test';
    process.env.DISCORD_GUILD_ID = '100';
    winnerId = (await db.member.create({ data: { nickname: `winner-${randomUUID()}` } })).id;
    secondId = (await db.member.create({ data: { nickname: `second-${randomUUID()}` } })).id;
    itemId = (await db.item.create({ data: { name: `Предмет-${randomUUID()}` } })).id;
    closer = new AuctionCloseService(db as unknown as CloseDb, undefined, 0);
    manage = new AuctionManageService(db as unknown as ManageDb);
    delivery = new DiscordDeliveryService(db as unknown as PrismaService);
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}'));
  });
  beforeEach(async () => {
    await db.setting.upsert({
      where: { key: 'discord.channels' },
      create: { key: 'discord.channels', value: { guildId: '100', channels: { lots: '400' } } },
      update: { value: { guildId: '100', channels: { lots: '400' } } },
    });
    await db.discordDeliveryGate.update({ where: { id: 1 }, data: { resumeAt: new Date(0) } });
    fetchSpy.mockClear();
  });
  afterEach(async () => {
    await db.discordNotification.deleteMany({
      where: { kind: 'LOT_RESULT', subjectId: { in: lotIds } },
    });
    await db.discordLotCursor.deleteMany({
      where: { auctionId: { in: lotIds.flatMap((id) => [`100:${id}`, `999:${id}`]) } },
    });
    await db.auditLog.deleteMany({ where: { entityType: 'Auction', entityId: { in: lotIds } } });
    await db.dkpEntry.deleteMany({ where: { auctionId: { in: lotIds } } });
    await db.bid.deleteMany({ where: { auctionId: { in: lotIds } } });
    await db.lootAward.deleteMany({ where: { auctionId: { in: lotIds } } });
    await db.auction.deleteMany({ where: { id: { in: lotIds } } });
    await db.lootDrop.deleteMany({ where: { id: { in: dropIds } } });
    lotIds.length = 0;
    dropIds.length = 0;
  });
  afterAll(async () => {
    fetchSpy?.mockRestore();
    if (ownsSetting) await db.setting.deleteMany({ where: { key: 'discord.channels' } });
    if (itemId) await db.item.delete({ where: { id: itemId } });
    if (winnerId || secondId)
      await db.member.deleteMany({ where: { id: { in: [winnerId, secondId].filter(Boolean) } } });
    if (oldToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = oldToken;
    if (oldGuild === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = oldGuild;
    await db.$disconnect();
  });
  async function lot(expired = false) {
    const drop = await db.lootDrop.create({ data: { itemId } });
    dropIds.push(drop.id);
    const result = await db.auction.create({
      data: {
        lootDropId: drop.id,
        durationSec: 3600,
        timerFromFirstBid: false,
        endsAt: new Date(Date.now() + (expired ? -1000 : 3600000)),
      },
    });
    lotIds.push(result.id);
    return result;
  }
  async function bid(auctionId: string) {
    await db.bid.create({
      data: { auctionId, memberId: winnerId, amount: 150, fullCost: 225, markupPct: 50 },
    });
  }

  it('publishes the confirmed automatic winner and actual price once', async () => {
    const current = await lot(true);
    await bid(current.id);
    await closer.closeExpiredLot(current.id);
    await closer.closeExpiredLot(current.id);
    await delivery.run();
    await delivery.run();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(payload.content).toContain('Цена: 225 ДКП');
    expect(payload.content).toContain('Победитель: winner-');
    expect(payload.content).toContain('/auction');
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it('publishes an automatic close without a winner', async () => {
    const current = await lot(true);
    await closer.closeExpiredLot(current.id);
    await delivery.run();
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body as string).content).toContain(
      'закрыт без победителя',
    );
  });

  it('publishes an early close with the actual winning price', async () => {
    const current = await lot();
    await bid(current.id);
    await manage.closeEarly(current.id, { comment: secret }, actor);
    await delivery.run();
    const content = JSON.parse(fetchSpy.mock.calls[0][1].body as string).content as string;
    expect(content).toContain('Цена: 225 ДКП');
    expect(content).not.toContain(secret);
  });

  it('publishes cancellation without its private reason', async () => {
    const current = await lot();
    await manage.cancel(current.id, { comment: secret }, actor);
    await delivery.run();
    const content = JSON.parse(fetchSpy.mock.calls[0][1].body as string).content as string;
    expect(content).toContain('Статус: отменён');
    expect(content).not.toContain(secret);
  });

  it('labels a manual award after a no-bid close as a correction', async () => {
    const current = await lot(true);
    await closer.closeExpiredLot(current.id);
    await manage.assignWinner(
      current.id,
      { requestId: randomUUID(), winnerId, price: 0, comment: secret },
      actor,
    );
    const rows = await db.discordNotification.findMany({
      where: { kind: 'LOT_RESULT', subjectId: current.id },
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.predecessorId)?.content).toContain('Исправление итога лота');
  });

  it('does not queue a result when the lot channel is disabled', async () => {
    const current = await lot(true);
    await db.setting.update({
      where: { key: 'discord.channels' },
      data: { value: { guildId: '100', channels: { lots: null } } },
    });
    await closer.closeExpiredLot(current.id);
    expect(
      await db.discordNotification.count({ where: { kind: 'LOT_RESULT', subjectId: current.id } }),
    ).toBe(0);
  });

  it('discards an undelivered outdated result if the next result occurs while notifications are disabled', async () => {
    const current = await lot();
    await manage.assignWinner(
      current.id,
      { requestId: randomUUID(), winnerId, price: 120, comment: secret },
      actor,
    );
    await db.setting.update({
      where: { key: 'discord.channels' },
      data: { value: { guildId: '100', channels: { lots: null } } },
    });
    await manage.assignWinner(
      current.id,
      { requestId: randomUUID(), winnerId: secondId, price: 80, comment: secret },
      actor,
    );
    const rows = await db.discordNotification.findMany({
      where: { kind: 'LOT_RESULT', subjectId: current.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('CANCELLED');
  });

  it('uses the current lot channel at delivery', async () => {
    const current = await lot(true);
    await closer.closeExpiredLot(current.id);
    await db.setting.update({
      where: { key: 'discord.channels' },
      data: { value: { guildId: '100', channels: { lots: '402' } } },
    });
    await delivery.run();
    expect(fetchSpy.mock.calls[0][0]).toContain('/channels/402/messages');
  });

  it('does not depend on a pending result copied from another environment', async () => {
    const current = await lot(true);
    const foreignId = `lot-result:999:${current.id}:close`;
    await db.discordNotification.create({
      data: {
        id: foreignId,
        guildId: '999',
        channelId: '900',
        subjectId: current.id,
        kind: 'LOT_RESULT',
        content: 'foreign',
      },
    });
    await db.discordLotCursor.create({
      data: { auctionId: `999:${current.id}`, lastNotificationId: foreignId },
    });
    await closer.closeExpiredLot(current.id);
    const local = await db.discordNotification.findUniqueOrThrow({
      where: { id: `lot-result:100:${current.id}:close` },
    });
    expect(local.predecessorId).toBeNull();
    await delivery.run();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('sends an original before its correction and ignores a repeated assignment', async () => {
    const current = await lot();
    const first = { requestId: randomUUID(), winnerId, price: 120, comment: secret };
    await manage.assignWinner(current.id, first, actor);
    await manage.assignWinner(
      current.id,
      { requestId: randomUUID(), winnerId: secondId, price: 80, comment: secret },
      actor,
    );
    const rows = await db.discordNotification.findMany({
      where: { kind: 'LOT_RESULT', subjectId: current.id },
    });
    const correction = rows.find((row) => row.predecessorId)!;
    const original = rows.find((row) => !row.predecessorId)!;
    await db.discordNotification.update({
      where: { id: original.id },
      data: { availableAt: new Date(Date.now() + 60000) },
    });
    await delivery.run();
    expect(fetchSpy).not.toHaveBeenCalled();
    await db.discordNotification.update({
      where: { id: original.id },
      data: { availableAt: new Date(0) },
    });
    await delivery.run();
    await db.discordNotification.update({
      where: { id: correction.id },
      data: { availableAt: new Date(0) },
    });
    await delivery.run();
    const firstPayload = JSON.parse(fetchSpy.mock.calls[0][1].body as string).content as string;
    const secondPayload = JSON.parse(fetchSpy.mock.calls[1][1].body as string).content as string;
    expect(firstPayload).toContain('Цена: 120 ДКП');
    expect(secondPayload).toContain('Исправление итога лота');
    expect(secondPayload).toContain('Цена: 80 ДКП');
    expect(secondPayload).not.toContain(secret);
    const repeat = { requestId: randomUUID(), winnerId: secondId, price: 80, comment: secret };
    await manage.assignWinner(current.id, repeat, actor);
    expect(
      await db.discordNotification.count({ where: { kind: 'LOT_RESULT', subjectId: current.id } }),
    ).toBe(2);
  });

  it('does not publish when the lot is only extended', async () => {
    const current = await lot();
    await manage.extend(current.id, { extendSec: 120, comment: secret }, actor);
    expect(await db.discordNotification.count({ where: { subjectId: current.id } })).toBe(0);
  });

  it('rolls back the notification and ordering cursor with its transaction', async () => {
    const current = await lot();
    await expect(
      db.$transaction(async (tx) => {
        await enqueueLotResult(tx, current.id, 'test', { kind: 'no-winner', itemName: 'Предмет' });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await db.discordNotification.count({ where: { subjectId: current.id } })).toBe(0);
    expect(
      await db.discordLotCursor.findUnique({ where: { auctionId: `100:${current.id}` } }),
    ).toBeNull();
  });
});
