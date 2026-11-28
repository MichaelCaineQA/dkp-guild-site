import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { dkpDecayAmount, moscowWeekBounds } from '@dkp/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';

const moscowDate = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const MAX_DEBIT_PER_ENTRY = 2_147_483_648n;

@Injectable()
export class DkpDecayScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DkpDecayScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private checkedThrough?: Date;

  constructor(private readonly db: PrismaService) {}

  onApplicationBootstrap(): void {
    const tick = () => {
      void this.scan().catch((error: unknown) => {
        this.logger.error('Не удалось выполнить еженедельное сгорание ДКП', error);
      });
    };
    this.timer = setInterval(tick, 1000);
    tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async scan(now = new Date()): Promise<void> {
    const { start } = moscowWeekBounds(now);
    if (this.running || (this.checkedThrough && this.checkedThrough >= start)) return;
    this.running = true;
    try {
      while (
        await serializable(
          this.db,
          (tx: Prisma.TransactionClient) => this.processNextWeek(tx, start),
          true,
        )
      ) {
        // Каждая пропущенная неделя фиксируется отдельно и влияет на следующую.
      }
      this.checkedThrough = start;
    } finally {
      this.running = false;
    }
  }

  private async processNextWeek(tx: Prisma.TransactionClient, dueThrough: Date): Promise<boolean> {
    // Дождаться сохранения ставки, если оно началось прямо перед границей недели.
    await tx.$queryRaw`SELECT "key" FROM "Setting" WHERE "key" = 'dkp.weeklyDecayPct' FOR SHARE`;
    const last = await tx.dkpDecayRun.findFirst({ orderBy: { scheduledAt: 'desc' } });
    const scheduledAt = last
      ? moscowWeekBounds(last.scheduledAt).end
      : (
          await tx.dkpDecayRate.findFirst({
            where: { percent: { gt: 0 } },
            orderBy: { effectiveAt: 'asc' },
          })
        )?.effectiveAt;
    if (!scheduledAt || scheduledAt > dueThrough) return false;

    const rate = await tx.dkpDecayRate.findFirst({
      where: { effectiveAt: { lte: scheduledAt } },
      orderBy: { effectiveAt: 'desc' },
    });
    await tx.dkpDecayRun.create({ data: { scheduledAt } });
    if (!rate?.percent) return true;

    const balances = await tx.$queryRaw<Array<{ memberId: string; balance: bigint }>>`
      SELECT "memberId", SUM("amount") AS "balance"
      FROM "DkpEntry"
      WHERE "createdAt" < CAST(${scheduledAt.toISOString()} AS timestamp)
      GROUP BY "memberId"
      HAVING SUM("amount") > 0
    `;
    const comment = `Сгорание ${rate.percent}% · ${moscowDate.format(scheduledAt)} (МСК)`;
    const data: Prisma.DkpEntryCreateManyInput[] = [];
    for (const { memberId, balance } of balances) {
      let remaining = dkpDecayAmount(balance, rate.percent);
      const requestId = `dkp-decay:${scheduledAt.toISOString()}:${memberId}`;
      // Баланс суммируется из всех записей и может превышать диапазон одного Int.
      for (let part = 0; remaining > 0n; part++) {
        const debit = remaining > MAX_DEBIT_PER_ENTRY ? MAX_DEBIT_PER_ENTRY : remaining;
        data.push({
          requestId: part ? `${requestId}:${part}` : requestId,
          memberId,
          type: 'WEEKLY_DECAY',
          amount: -Number(debit),
          comment,
          createdAt: scheduledAt,
        });
        remaining -= debit;
      }
    }
    if (data.length) await tx.dkpEntry.createMany({ data });
    return true;
  }
}
