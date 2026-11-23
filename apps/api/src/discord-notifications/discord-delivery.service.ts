import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DiscordDeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordDeliveryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly db: PrismaService) {}

  onModuleInit(): void {
    if (!process.env.DISCORD_BOT_TOKEN) return;
    this.timer = setInterval(() => void this.run(), 5000);
    void this.run();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (this.running || !token) return;
    this.running = true;
    try {
      await this.db.$transaction(
        async (tx) => {
          // A single database gate coordinates all workers, including global 429s.
          // The lock also prevents simultaneous sends of the same notification.
          const gate = await tx.$queryRaw<{ resumeAt: Date }[]>`
          SELECT "resumeAt" FROM "DiscordDeliveryGate" WHERE id = 1
          FOR UPDATE SKIP LOCKED`;
          if (!gate.length || gate[0].resumeAt.getTime() > Date.now()) return;
          const item = await tx.discordNotification.findFirst({
            where: { status: 'PENDING', availableAt: { lte: new Date() } },
            orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
          });
          if (!item) return;

          let status = 'PENDING';
          let error = 'NETWORK';
          const attempts = item.attempts + 1;
          let delayMs = Math.min(300000, 1000 * 2 ** Math.min(attempts, 8));
          try {
            const response = await fetch(
              `https://discord.com/api/v10/channels/${item.channelId}/messages`,
              {
                method: 'POST',
                headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  content: item.content,
                  allowed_mentions: { parse: [] },
                  nonce: createHash('sha256').update(item.id).digest('hex').slice(0, 24),
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
                data: { resumeAt: new Date(Date.now() + delayMs) },
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
              status,
              attempts,
              lastError: error || null,
              availableAt: new Date(Date.now() + delayMs),
              sentAt: status === 'SENT' ? new Date() : null,
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
