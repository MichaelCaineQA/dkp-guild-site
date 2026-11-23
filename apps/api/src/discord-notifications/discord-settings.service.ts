import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordChannelValidator } from './discord-channel-validator';
import { enqueueDiscordNotification } from './discord-outbox';

const channel = z
  .string()
  .regex(/^\d{1,25}$/)
  .nullable();
const channelsSchema = z.object({
  announcements: channel,
  reminders: channel,
  absences: channel,
  lots: channel,
});
const storedSchema = z.object({ guildId: z.string().regex(/^\d+$/), channels: channelsSchema });
const updateSchema = z.object({
  channels: channelsSchema,
  absenceAccessConfirmed: z.boolean(),
  reason: z.string().trim().min(1).max(500),
});
type Channels = z.infer<typeof channelsSchema>;
const empty: Channels = { announcements: null, reminders: null, absences: null, lots: null };
const settingKey = 'discord.channels';

@Injectable()
export class DiscordSettingsService {
  constructor(
    private readonly db: PrismaService,
    private readonly validator: DiscordChannelValidator,
  ) {}

  async get() {
    const stored = await this.db.setting.findUnique({ where: { key: settingKey } });
    const parsed = storedSchema.safeParse(stored?.value);
    return {
      channels:
        parsed.success && parsed.data.guildId === process.env.DISCORD_GUILD_ID
          ? parsed.data.channels
          : empty,
      configured: Boolean(
        process.env.DISCORD_BOT_TOKEN && /^\d+$/.test(process.env.DISCORD_GUILD_ID ?? ''),
      ),
    };
  }

  async update(body: unknown, actor: { memberId: string | null; isAdmin: boolean }) {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Проверьте ID каналов и причину изменения');
    const { channels, absenceAccessConfirmed, reason } = parsed.data;
    if (channels.absences && !absenceAccessConfirmed) {
      throw new BadRequestException('Подтвердите проверку доступа к каналу отсутствий');
    }
    if (
      channels.absences &&
      [channels.announcements, channels.reminders, channels.lots].includes(channels.absences)
    ) {
      throw new BadRequestException('Для отсутствий нужен отдельный закрытый канал');
    }
    const ids = [...new Set(Object.values(channels).filter((id): id is string => id !== null))];
    for (const id of ids) await this.validator.validate(id);
    await this.db.$transaction(async (tx) => {
      const old = await tx.setting.findUnique({ where: { key: settingKey } });
      const previous = storedSchema.safeParse(old?.value);
      const guildId = process.env.DISCORD_GUILD_ID;
      if (!guildId || !/^\d+$/.test(guildId)) {
        if (ids.length) throw new BadRequestException('Discord-сервер не настроен');
        if (old) {
          await tx.setting.delete({ where: { key: settingKey } });
          await tx.auditLog.create({
            data: {
              actorMemberId: actor.memberId,
              actorIsAdmin: actor.isAdmin,
              action: 'SETTINGS_UPDATE',
              entityType: 'Setting',
              entityId: settingKey,
              comment: `Discord: каналы отключены; ${reason}`,
            },
          });
        }
        return;
      }
      const oldChannels =
        previous.success && previous.data.guildId === guildId ? previous.data.channels : empty;
      if (
        (!old || (previous.success && previous.data.guildId === guildId)) &&
        JSON.stringify(oldChannels) === JSON.stringify(channels)
      )
        return;
      const value = { guildId, channels };
      await tx.setting.upsert({
        where: { key: settingKey },
        create: { key: settingKey, value },
        update: { value },
      });
      await tx.auditLog.create({
        data: {
          actorMemberId: actor.memberId,
          actorIsAdmin: actor.isAdmin,
          action: 'SETTINGS_UPDATE',
          entityType: 'Setting',
          entityId: settingKey,
          comment: `Discord: ${JSON.stringify(oldChannels)} → ${JSON.stringify(channels)}; ${reason}`,
        },
      });
    });
    return this.get();
  }

  async test(kind: string) {
    if (!Object.keys(empty).includes(kind))
      throw new BadRequestException('Неизвестный тип уведомления');
    const { channels } = await this.get();
    const channelId = channels[kind as keyof Channels];
    if (!channelId) throw new BadRequestException('Канал не настроен');
    await this.validator.validate(channelId);
    const id = `test:${randomUUID()}`;
    await this.db.$transaction((tx) =>
      enqueueDiscordNotification(tx, {
        id,
        channelId,
        content: 'Проверка уведомлений сайта гильдии.',
      }),
    );
    return { id };
  }

  async testStatus(id: string) {
    if (!/^test:[0-9a-f-]{36}$/.test(id)) throw new BadRequestException('Неверный ID проверки');
    const row = await this.db.discordNotification.findUnique({
      where: { id },
      select: { status: true, lastError: true },
    });
    if (!row) throw new BadRequestException('Проверка не найдена');
    return row;
  }
}
