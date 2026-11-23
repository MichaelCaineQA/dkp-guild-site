import type { Prisma } from '@prisma/client';

type LotResult =
  | { kind: 'cancelled'; itemName: string }
  | { kind: 'no-winner'; itemName: string }
  | { kind: 'awarded'; itemName: string; winnerName: string; price: number; correction: boolean };

/** Called in the result transaction; only the confirmed public result enters the outbox. */
export async function enqueueLotResult(
  tx: Prisma.TransactionClient,
  auctionId: string,
  resultKey: string,
  result: LotResult,
): Promise<void> {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId || !/^\d+$/.test(guildId)) return;
  const cancelStale = async () => {
    await tx.discordNotification.updateMany({
      where: { guildId, subjectId: auctionId, kind: 'LOT_RESULT', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  };
  if (!process.env.DISCORD_BOT_TOKEN) {
    await cancelStale();
    return;
  }
  const stored = await tx.setting.findUnique({ where: { key: 'discord.channels' } });
  const value = stored?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.guildId !== guildId) {
    await cancelStale();
    return;
  }
  const channels = value.channels;
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) {
    await cancelStale();
    return;
  }
  const channelId = channels.lots;
  if (typeof channelId !== 'string' || !/^\d+$/.test(channelId)) {
    await cancelStale();
    return;
  }
  const id = `lot-result:${guildId}:${auctionId}:${resultKey}`;
  const cursorKey = `${guildId}:${auctionId}`;
  await tx.$executeRaw`INSERT INTO "DiscordLotCursor" ("auctionId") VALUES (${cursorKey}) ON CONFLICT DO NOTHING`;
  const cursor = await tx.$queryRaw<{ lastNotificationId: string | null }[]>`
    SELECT "lastNotificationId" FROM "DiscordLotCursor" WHERE "auctionId" = ${cursorKey} FOR UPDATE`;
  if (await tx.discordNotification.findUnique({ where: { id }, select: { id: true } })) return;
  const escape = (text: string) =>
    text.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>|~]/g, '\\$&');
  const url = new URL('/auction', process.env.WEB_URL ?? 'http://localhost:3000').toString();
  const title =
    result.kind === 'awarded' && result.correction ? 'Исправление итога лота' : 'Итог лота';
  const outcome =
    result.kind === 'cancelled'
      ? 'Статус: отменён'
      : result.kind === 'no-winner'
        ? 'Статус: закрыт без победителя'
        : `Победитель: ${escape(result.winnerName)}\nЦена: ${result.price} ДКП`;
  const content = `${title}\nПредмет: ${escape(result.itemName)}\n${outcome}\nАукцион: ${url}`;
  await tx.discordNotification.create({
    data: {
      id,
      guildId,
      channelId,
      subjectId: auctionId,
      predecessorId: cursor[0]?.lastNotificationId ?? null,
      kind: 'LOT_RESULT',
      content,
    },
  });
  await tx.discordLotCursor.update({
    where: { auctionId: cursorKey },
    data: { lastNotificationId: id },
  });
}
