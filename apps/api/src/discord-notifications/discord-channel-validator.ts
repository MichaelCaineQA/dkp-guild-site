import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import {
  canBotSendToChannel,
  type DiscordOverwrite,
  type DiscordRole,
} from './channel-permissions';

/** Guild ID is an environment boundary, not a value accepted from the browser. */
@Injectable()
export class DiscordChannelValidator {
  async validate(channelId: string): Promise<void> {
    const token = process.env.DISCORD_BOT_TOKEN;
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!token || !guildId || !/^\d+$/.test(guildId)) {
      throw new BadRequestException('Бот или Discord-сервер не настроен на сервере');
    }
    if (!/^\d+$/.test(channelId)) throw new BadRequestException('Неверный ID канала Discord');

    const read = async <T>(path: string): Promise<T> => {
      let response: Response;
      try {
        response = await fetch(`https://discord.com/api/v10${path}`, {
          headers: { Authorization: `Bot ${token}` },
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        throw new BadGatewayException('Discord недоступен, повторите позже');
      }
      if (response.status === 403 || response.status === 404) {
        throw new BadRequestException('Канал или сервер не найден либо недоступен боту');
      }
      if (!response.ok) throw new BadGatewayException('Discord недоступен, повторите позже');
      try {
        return (await response.json()) as T;
      } catch {
        throw new BadGatewayException('Discord вернул некорректный ответ');
      }
    };

    const [bot, guild, channel, roles] = await Promise.all([
      read<{ id: string }>('/users/@me'),
      read<{ owner_id: string }>(`/guilds/${guildId}`),
      read<{ guild_id?: string; type: number; permission_overwrites?: DiscordOverwrite[] }>(
        `/channels/${channelId}`,
      ),
      read<DiscordRole[]>(`/guilds/${guildId}/roles`),
    ]);
    if (channel.guild_id !== guildId || ![0, 5].includes(channel.type)) {
      throw new BadRequestException('Нужен текстовый канал настроенного Discord-сервера');
    }
    if (
      !Array.isArray(channel.permission_overwrites) ||
      !Array.isArray(roles) ||
      !/^\d+$/.test(bot.id)
    ) {
      throw new BadGatewayException('Discord вернул некорректные данные канала');
    }
    const member = await read<{ roles: string[]; communication_disabled_until?: string | null }>(
      `/guilds/${guildId}/members/${bot.id}`,
    );
    try {
      if (
        (member.communication_disabled_until &&
          new Date(member.communication_disabled_until).getTime() > Date.now()) ||
        !canBotSendToChannel({
          guildId,
          botId: bot.id,
          roleIds: member.roles,
          roles,
          overwrites: channel.permission_overwrites,
          isOwner: guild.owner_id === bot.id,
        })
      )
        throw new BadRequestException('Боту нужны права просмотра и отправки сообщений в канале');
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadGatewayException('Discord вернул некорректные права канала');
    }
  }
}
