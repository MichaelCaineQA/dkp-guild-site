import type { Prisma } from '@prisma/client';

/** Insert with the domain operation; no backfill is performed when enabled later. */
export async function enqueueEventAnnouncement(
  tx: Prisma.TransactionClient,
  key: string,
  eventIds: string[],
): Promise<void> {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!process.env.DISCORD_BOT_TOKEN || !guildId || !/^\d+$/.test(guildId) || !eventIds.length)
    return;
  const stored = await tx.setting.findUnique({ where: { key: 'discord.channels' } });
  const value = stored?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const channels = value.channels;
  if (
    value.guildId !== guildId ||
    !channels ||
    typeof channels !== 'object' ||
    Array.isArray(channels)
  )
    return;
  const channelId = channels.announcements;
  if (typeof channelId !== 'string' || !/^\d+$/.test(channelId)) return;
  await tx.discordNotification.upsert({
    where: { id: key },
    create: { id: key, guildId, channelId, content: '', kind: 'EVENT_ANNOUNCEMENT', eventIds },
    update: {},
  });
}
