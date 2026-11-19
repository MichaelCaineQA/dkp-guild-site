import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  canViewGuildGearScore,
  gearScoreFreshnessTotals,
  gearScoreSnapshotAsOf,
  gearScoreSnapshotRows,
  resolveStatisticsPeriod,
  statisticsQuerySchema,
  type GearScoreStatisticsReport,
  type PermissionActor,
} from '@dkp/shared';
import { gearScoreStaleDays } from '../settings/gear-score-settings';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Свежесть GS (#217, план 2.8): защищённый отчёт только для Главы/Админа —
 * количества актуальных/устаревших/отсутствующих скринов, доля устаревших
 * и дата среза. Срез — состав и последние записи GS на конец периода;
 * текущий месяц — на момент формирования отчёта, поэтому новые загрузки
 * прошлый отчёт не меняют. Порог — существующее правило профиля
 * (profile.gearScoreStaleDays), лидерство КП/пака и назначение РЛ доступ
 * не расширяют (план 2.5). Фильтры КП/пак действуют по исторической команде
 * на срез; у среза нет фактов ивентов, поэтому eventTypeId/mode валидируются,
 * но выборку не меняют (DTO сообщает это явно).
 */
@Injectable()
export class GearScoreStatisticsService {
  constructor(private readonly db: PrismaService) {}

  async get(rawQuery: unknown, actor: PermissionActor): Promise<GearScoreStatisticsReport> {
    if (!canViewGuildGearScore(actor)) {
      throw new ForbiddenException('Блок свежести GS доступен только Главе и Админу');
    }
    const query = statisticsQuerySchema.parse(rawQuery);
    const generatedAt = new Date();
    const period = resolveStatisticsPeriod(query, generatedAt);
    const asOf = gearScoreSnapshotAsOf(period, generatedAt);
    return this.db.$transaction(
      async (tx) => {
        const [kps, packs, members, records, kp, pack, eventType] = await Promise.all([
          tx.kP.findMany({ select: { id: true, createdAt: true } }),
          tx.pack.findMany({ include: { membershipHistory: true } }),
          tx.member.findMany({ include: { packHistory: true } }),
          tx.gearScoreRecord.findMany({
            where: { createdAt: { lt: asOf } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          }),
          query.kpId ? tx.kP.findUnique({ where: { id: query.kpId } }) : null,
          query.packId
            ? tx.pack.findUnique({
                where: { id: query.packId },
                include: { membershipHistory: true },
              })
            : null,
          query.eventTypeId ? tx.eventType.findUnique({ where: { id: query.eventTypeId } }) : null,
        ]);
        if ((query.kpId && !kp) || (query.packId && !pack) || (query.eventTypeId && !eventType)) {
          throw new BadRequestException('Неизвестный фильтр');
        }
        if (
          query.kpId &&
          pack &&
          pack.kpId !== query.kpId &&
          !pack.membershipHistory.some(
            (h) => h.kpId === query.kpId || h.previousKpId === query.kpId,
          )
        ) {
          throw new BadRequestException('Пак не принадлежит выбранной КП');
        }
        const staleDays = await gearScoreStaleDays(tx);
        const recordsByMember = new Map<string, typeof records>();
        for (const record of records) {
          recordsByMember.set(record.memberId, [
            ...(recordsByMember.get(record.memberId) ?? []),
            record,
          ]);
        }
        const rows = gearScoreSnapshotRows(
          members,
          packs,
          recordsByMember,
          staleDays,
          asOf,
          generatedAt,
          kps,
        ).filter(
          (row) =>
            (!query.packId ||
              row.packId === query.packId ||
              (row.packId === null && row.teamStatus === 'NO_HISTORICAL_DATA')) &&
            (!query.kpId ||
              row.kpId === query.kpId ||
              (row.kpId === null && row.teamStatus === 'NO_HISTORICAL_DATA')),
        );
        return {
          generatedAt: generatedAt.toISOString(),
          start: period.start.toISOString(),
          end: period.end.toISOString(),
          asOf: asOf.toISOString(),
          staleDays,
          snapshotIgnoresFilters: [
            ...(query.eventTypeId ? (['eventTypeId'] as const) : []),
            ...(query.mode ? (['mode'] as const) : []),
          ],
          totals: gearScoreFreshnessTotals(rows),
          members: rows,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
