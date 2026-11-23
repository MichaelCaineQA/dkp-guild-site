import type { Prisma } from '@prisma/client';

export async function renderAbsenceNotification(
  tx: Prisma.TransactionClient,
  item: { guildId: string | null; subjectId: string | null },
): Promise<{ content: string; channelId: string } | null> {
  if (!item.guildId || !item.subjectId) return null;
  await tx.$queryRaw`SELECT key FROM "Setting" WHERE key = 'discord.channels' FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Absence" WHERE id = ${item.subjectId} FOR UPDATE`;
  const [setting, absence] = await Promise.all([
    tx.setting.findUnique({ where: { key: 'discord.channels' } }),
    tx.absence.findUnique({
      where: { id: item.subjectId },
      select: {
        status: true,
        dateFrom: true,
        dateTo: true,
        allDay: true,
        member: { select: { nickname: true } },
        event: { select: { name: true } },
      },
    }),
  ]);
  const value = setting?.value;
  if (
    !absence ||
    absence.status !== 'ACTIVE' ||
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.guildId !== item.guildId
  )
    return null;
  const channels = value.channels;
  if (
    !channels ||
    typeof channels !== 'object' ||
    Array.isArray(channels) ||
    typeof channels.absences !== 'string' ||
    !/^\d+$/.test(channels.absences)
  )
    return null;
  const escape = (text: string) =>
    text.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}\[\]<>|~]/g, '\\$&');
  const from = Math.floor(absence.dateFrom.getTime() / 1000);
  const to = Math.floor(absence.dateTo.getTime() / 1000);
  const url = new URL('/absences', process.env.WEB_URL ?? 'http://localhost:3000').toString();
  return {
    channelId: channels.absences,
    content:
      `Новая заявка об отсутствии\nИгрок: ${escape(absence.member.nickname)}\n` +
      `Период: <t:${from}:F> — <t:${to}:F>${absence.allDay ? ' (весь день)' : ''}\n` +
      (absence.event ? `Ивент: ${escape(absence.event.name)}\n` : '') +
      `Подробнее: ${url}`,
  };
}
