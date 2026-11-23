import { Prisma } from '@prisma/client';

const escapeText = (text: string) =>
  text.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>|~]/g, '\\$&');

/** Lock candidates before rendering so a committed cancellation or move is respected. */
export async function renderEventAnnouncement(
  tx: Prisma.TransactionClient,
  item: { guildId: string | null; channelId: string; eventIds: string[] },
): Promise<{ content: string | null; remaining: string[] }> {
  await tx.$queryRaw`SELECT key FROM "Setting" WHERE key = 'discord.channels' FOR SHARE`;
  const setting = await tx.setting.findUnique({ where: { key: 'discord.channels' } });
  const value = setting?.value;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.guildId !== item.guildId
  ) {
    return { content: null, remaining: [] };
  }
  const channels = value.channels;
  if (
    !channels ||
    typeof channels !== 'object' ||
    Array.isArray(channels) ||
    channels.announcements !== item.channelId
  ) {
    return { content: null, remaining: [] };
  }
  const candidates = item.eventIds.slice(0, 25);
  if (!candidates.length) return { content: null, remaining: [] };
  await tx.$queryRaw`SELECT id FROM "Event" WHERE id IN (${Prisma.join([...candidates].sort())}) ORDER BY id FOR UPDATE`;
  const events = await tx.event.findMany({
    where: { id: { in: candidates } },
    select: {
      id: true,
      name: true,
      startsAt: true,
      status: true,
      scope: true,
      kp: { select: { name: true } },
      pack: { select: { name: true } },
    },
  });
  const byId = new Map(events.map((event) => [event.id, event]));
  const url = new URL('/schedule', process.env.WEB_URL ?? 'http://localhost:3000').toString();
  const header = `Анонсы ивентов\nРасписание: ${url}\n`;
  let content = header;
  let consumed = 0;
  let included = 0;
  for (const id of candidates) {
    const event = byId.get(id);
    if (!event || event.status !== 'PLANNED' || event.startsAt <= new Date()) {
      consumed++;
      continue;
    }
    const scope =
      event.scope === 'KP'
        ? `КП ${event.kp?.name ?? ''}`
        : event.scope === 'PACK'
          ? `Пак ${event.pack?.name ?? ''}`
          : 'Вся гильдия';
    const line = `<t:${Math.floor(event.startsAt.getTime() / 1000)}:F> — ${escapeText(event.name)} — ${escapeText(scope)}\n`;
    if (content.length + line.length > 1900 && included) break;
    content += line;
    included++;
    consumed++;
  }
  return { content: included ? content : null, remaining: item.eventIds.slice(consumed) };
}
