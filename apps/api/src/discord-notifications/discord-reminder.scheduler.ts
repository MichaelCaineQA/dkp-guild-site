import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { readReminderConfig } from './reminder-config';
import { legacyReminderKey, reminderKey } from './reminder-key';

@Injectable()
export class DiscordReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordReminderScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly db: PrismaService) {}

  onModuleInit(): void {
    if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) return;
    this.timer = setInterval(() => void this.scan(), 5000);
    void this.scan();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async scan(now = new Date()): Promise<void> {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (this.running || !process.env.DISCORD_BOT_TOKEN || !guildId || !/^\d+$/.test(guildId))
      return;
    this.running = true;
    try {
      const config = await readReminderConfig(this.db, guildId);
      if (!config) return;
      const events = await this.db.event.findMany({
        where: {
          status: 'PLANNED',
          startsAt: { gt: now, lte: new Date(now.getTime() + config.minutes * 60000) },
        },
        select: { id: true, startsAt: true },
      });
      if (events.length) {
        const records = events.map((event) => ({
          id: reminderKey(guildId, event.id, event.startsAt),
          legacyId: legacyReminderKey(event.id, event.startsAt),
          guildId,
          channelId: config.channelId,
          content: '',
          kind: 'EVENT_REMINDER',
          eventIds: [event.id],
        }));
        for (let offset = 0; offset < records.length; offset += 500) {
          const batch = records.slice(offset, offset + 500);
          const existing = await this.db.discordNotification.findMany({
            where: { guildId, id: { in: batch.flatMap((record) => [record.id, record.legacyId]) } },
            select: { id: true, status: true, lastError: true, availableAt: true },
          });
          const known = new Set(existing.map((row) => row.id));
          const missing = batch.filter(
            (record) => !known.has(record.id) && !known.has(record.legacyId),
          );
          if (missing.length)
            await this.db.discordNotification.createMany({
              data: missing.map((record) => ({
                id: record.id,
                guildId: record.guildId,
                channelId: record.channelId,
                content: record.content,
                kind: record.kind,
                eventIds: record.eventIds,
              })),
              skipDuplicates: true,
            });
          const wake = existing.filter(
            (row) =>
              row.status === 'PENDING' &&
              (row.lastError === 'NOT_DUE' || row.lastError === 'NO_CHANNEL') &&
              row.availableAt > now,
          );
          if (wake.length)
            await this.db.discordNotification.updateMany({
              where: {
                id: { in: wake.map((row) => row.id) },
                status: 'PENDING',
                lastError: { in: ['NOT_DUE', 'NO_CHANNEL'] },
                availableAt: { gt: now },
              },
              data: { availableAt: now, lastError: null },
            });
        }
      }
    } catch {
      this.logger.error('Ошибка планирования напоминаний Discord');
    } finally {
      this.running = false;
    }
  }
}
