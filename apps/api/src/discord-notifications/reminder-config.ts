import { SETTING_DEFAULTS, SETTINGS_REGISTRY } from '@dkp/shared';
import type { Prisma } from '@prisma/client';

export async function readReminderConfig(
  db: Pick<Prisma.TransactionClient, 'setting'>,
  guildId: string,
): Promise<{ channelId: string; minutes: number } | null> {
  const [channelsRow, minutesRow] = await Promise.all([
    db.setting.findUnique({ where: { key: 'discord.channels' } }),
    db.setting.findUnique({ where: { key: 'discord.reminderMinutes' } }),
  ]);
  const value = channelsRow?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.guildId !== guildId)
    return null;
  const channels = value.channels;
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) return null;
  const channelId = channels.reminders;
  if (typeof channelId !== 'string' || !/^\d+$/.test(channelId)) return null;
  const minutes = SETTINGS_REGISTRY['discord.reminderMinutes'].schema.safeParse(
    minutesRow?.value ?? SETTING_DEFAULTS['discord.reminderMinutes'],
  );
  return minutes.success ? { channelId, minutes: minutes.data } : null;
}
