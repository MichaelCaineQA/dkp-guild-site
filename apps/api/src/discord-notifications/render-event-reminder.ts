import type { Prisma } from '@prisma/client';
import { SETTING_DEFAULTS } from '@dkp/shared';
import { readReminderConfig } from './reminder-config';

type ReminderResult =
  | { kind: 'send'; content: string; channelId: string }
  | { kind: 'defer'; until: Date; reason: 'NOT_DUE' | 'NO_CHANNEL' }
  | { kind: 'cancel' };

export async function renderEventReminder(
  tx: Prisma.TransactionClient,
  item: { id: string; guildId: string | null; eventIds: string[] },
  at?: Date,
): Promise<ReminderResult> {
  const eventId = item.eventIds[0];
  if (!eventId || !item.guildId) return { kind: 'cancel' };
  await tx.$executeRaw`INSERT INTO "Setting" (key, value)
    VALUES ('discord.reminderMinutes', to_jsonb(${SETTING_DEFAULTS['discord.reminderMinutes']}::integer))
    ON CONFLICT (key) DO NOTHING`;
  await tx.$queryRaw`SELECT key FROM "Setting" WHERE key IN ('discord.channels', 'discord.reminderMinutes') ORDER BY key FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: {
      name: true,
      startsAt: true,
      status: true,
      scope: true,
      kp: { select: { name: true } },
      pack: { select: { name: true } },
    },
  });
  const now = at ?? new Date();
  if (
    !event ||
    event.status !== 'PLANNED' ||
    event.startsAt <= now ||
    item.id !== `reminder:${eventId}:${event.startsAt.getTime()}`
  )
    return { kind: 'cancel' };
  const config = await readReminderConfig(tx, item.guildId);
  if (!config)
    return { kind: 'defer', until: new Date(now.getTime() + 5000), reason: 'NO_CHANNEL' };
  const due = new Date(event.startsAt.getTime() - config.minutes * 60000);
  if (now < due) return { kind: 'defer', until: due, reason: 'NOT_DUE' };
  const escape = (text: string) =>
    text.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>|~]/g, '\\$&');
  const scope =
    event.scope === 'KP'
      ? `КП ${event.kp?.name ?? ''}`
      : event.scope === 'PACK'
        ? `Пак ${event.pack?.name ?? ''}`
        : 'Вся гильдия';
  const url = new URL('/schedule', process.env.WEB_URL ?? 'http://localhost:3000').toString();
  return {
    kind: 'send',
    channelId: config.channelId,
    content: `Напоминание об ивенте\n<t:${Math.floor(event.startsAt.getTime() / 1000)}:F> — ${escape(event.name)} — ${escape(scope)}\nРасписание: ${url}`,
  };
}
