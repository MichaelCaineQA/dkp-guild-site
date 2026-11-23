import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { renderEventAnnouncement } from './render-event-announcement';
import { renderEventReminder } from './render-event-reminder';

@Injectable()
export class DiscordDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordDeliveryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly db: PrismaService) {}

  onModuleInit(): void {
    if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) return;
    this.timer = setInterval(() => void this.run(), 5000);
    void this.run();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(at?: Date): Promise<void> {
    const token = process.env.DISCORD_BOT_TOKEN;
    const guildId = process.env.DISCORD_GUILD_ID;
    const now = at ?? new Date();
    if (this.running || !token || !guildId) return;
    this.running = true;
    try {
      await this.db.$transaction(
        async (tx) => {
          // A single database gate coordinates all workers, including global 429s.
          // The lock also prevents simultaneous sends of the same notification.
          const gate = await tx.$queryRaw<{ resumeAt: Date }[]>`
          SELECT "resumeAt" FROM "DiscordDeliveryGate" WHERE id = 1
          FOR UPDATE SKIP LOCKED`;
          if (!gate.length || gate[0].resumeAt.getTime() > now.getTime()) return;
          const item = await tx.discordNotification.findFirst({
            where: { guildId, status: 'PENDING', availableAt: { lte: now } },
            orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
          });
          if (!item) return;

          let content = item.content;
          let channelId = item.channelId;
          let remaining: string[] = [];
          if (item.kind === 'EVENT_ANNOUNCEMENT') {
            const rendered = await renderEventAnnouncement(tx, item);
            remaining = rendered.remaining;
            if (!rendered.content) {
              await tx.discordNotification.update({
                where: { id: item.id },
                data: { eventIds: remaining, status: remaining.length ? 'PENDING' : 'CANCELLED' },
              });
              return;
            }
            content = rendered.content;
          }
          if (item.kind === 'EVENT_REMINDER') {
            const reminder = await renderEventReminder(tx, item, at);
            if (reminder.kind === 'cancel') {
              await tx.discordNotification.update({
                where: { id: item.id },
                data: { status: 'CANCELLED' },
              });
              return;
            }
            if (reminder.kind === 'defer') {
              await tx.discordNotification.update({
                where: { id: item.id },
                data: {
                  availableAt: reminder.until,
                  lastError: reminder.reason,
                },
              });
              return;
            }
            content = reminder.content;
            channelId = reminder.channelId;
          }

          let status = 'PENDING';
          let error = 'NETWORK';
          const attempts = item.attempts + 1;
          let delayMs = Math.min(300000, 1000 * 2 ** Math.min(attempts, 8));
          try {
            const response = await fetch(
              `https://discord.com/api/v10/channels/${channelId}/messages`,
              {
                method: 'POST',
                headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  content,
                  allowed_mentions: { parse: [] },
                  nonce: createHash('sha256')
                    .update(
                      item.kind === 'EVENT_ANNOUNCEMENT'
                        ? `${item.id}:${item.deliveryPart}`
                        : item.id,
                    )
                    .digest('hex')
                    .slice(0, 24),
                  enforce_nonce: true,
                }),
                signal: AbortSignal.timeout(15000),
              },
            );
            if (response.ok) {
              status = 'SENT';
              error = '';
            } else if (response.status === 429) {
              error = 'RATE_LIMIT';
              const header = response.headers.get('retry-after');
              const body = (await response.json().catch(() => ({}))) as { retry_after?: unknown };
              const retry = Number(header ?? body.retry_after);
              delayMs = Math.max(
                delayMs,
                Number.isFinite(retry) && retry > 0 ? retry * 1000 : 60000,
              );
              await tx.discordDeliveryGate.update({
                where: { id: 1 },
                data: { resumeAt: new Date((at ?? new Date()).getTime() + delayMs) },
              });
            } else if (response.status >= 500 || response.status === 408) {
              error = `HTTP_${response.status}`;
            } else {
              status = 'FAILED';
              error = `HTTP_${response.status}`;
            }
          } catch {
            // Discord may have accepted the message; retry uses the same nonce.
          }
          await tx.discordNotification.update({
            where: { id: item.id },
            data: {
              status: status === 'SENT' && remaining.length ? 'PENDING' : status,
              channelId,
              attempts: status === 'SENT' && remaining.length ? 0 : attempts,
              lastError: error || null,
              availableAt: new Date(
                (at ?? new Date()).getTime() +
                  (status === 'SENT' && remaining.length ? 5000 : delayMs),
              ),
              sentAt: status === 'SENT' && !remaining.length ? (at ?? new Date()) : null,
              ...(status === 'SENT' && item.kind === 'EVENT_ANNOUNCEMENT'
                ? { eventIds: remaining, deliveryPart: item.deliveryPart + 1 }
                : {}),
            },
          });
        },
        { timeout: 30000 },
      );
    } catch {
      this.logger.error('Ошибка обработки очереди Discord');
    } finally {
      this.running = false;
    }
  }
}
