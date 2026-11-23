import type { Prisma } from '@prisma/client';

/** Never persist the reason in the outbox; resolve safe fields at delivery. */
export async function enqueueAbsenceNotification(
  tx: Prisma.TransactionClient,
  absenceId: string,
): Promise<void> {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!process.env.DISCORD_BOT_TOKEN || !guildId || !/^\d+$/.test(guildId)) return;
  const setting = await tx.setting.findUnique({ where: { key: 'discord.channels' } });
  const value = setting?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.guildId !== guildId)
    return;
  const channels = value.channels;
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) return;
  const channelId = channels.absences;
  if (typeof channelId !== 'string' || !/^\d+$/.test(channelId)) return;
  const id = `absence:${absenceId}`;
  await tx.discordNotification.upsert({
    where: { id },
    create: { id, guildId, channelId, content: '', kind: 'ABSENCE_CREATED', subjectId: absenceId },
    update: {},
  });
}
