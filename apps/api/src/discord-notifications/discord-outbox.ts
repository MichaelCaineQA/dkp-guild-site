import type { Prisma } from '@prisma/client';

/** Call inside the same transaction as the domain change. Keys must be stable. */
export async function enqueueDiscordNotification(
  tx: Prisma.TransactionClient,
  notification: { id: string; channelId: string; content: string },
): Promise<void> {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId || !/^\d+$/.test(guildId)) {
    throw new Error('Discord guild is not configured');
  }
  if (!notification.id || !/^\d+$/.test(notification.channelId)) {
    throw new Error('Invalid Discord notification key or channel');
  }
  if (!notification.content || notification.content.length > 2000) {
    throw new Error('Invalid Discord notification content length');
  }
  await tx.discordNotification.upsert({
    where: { id: notification.id },
    create: { ...notification, guildId },
    update: {},
  });
}
