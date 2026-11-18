import { BadRequestException, Injectable } from '@nestjs/common';
import {
  aggregateDkpTotals,
  dkpMemberRows,
  dkpTeamRows,
  dkpWeekRows,
  dkpWithoutEventRows,
  resolveStatisticsPeriod,
  statisticsEventMembers,
  statisticsQuerySchema,
  type DkpMovement,
  type DkpStatisticsReport,
} from '@dkp/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ДКП-статистика (#215, план 2.8): движения периода по факту записи журнала,
 * полный баланс на конец периода по всей истории и отдельная категория
 * «Без ивента». Атрибуция и отбор — единый контракт #212: команда связанного
 * ивента на дату ивента, операции без ивента не атрибутируются и не
 * ограничиваются фильтрами.
 */
@Injectable()
export class DkpStatisticsService {
  constructor(private readonly db: PrismaService) {}

  async get(rawQuery: unknown): Promise<DkpStatisticsReport> {
    const query = statisticsQuerySchema.parse(rawQuery);
    const generatedAt = new Date();
    const period = resolveStatisticsPeriod(query, generatedAt);
    return this.db.$transaction(
      async (tx) => {
        const [kps, packs, members, entries, eventType] = await Promise.all([
          tx.kP.findMany(),
          tx.pack.findMany({ include: { membershipHistory: true } }),
          tx.member.findMany({ include: { packHistory: true } }),
          tx.dkpEntry.findMany({
            where: { createdAt: { gte: period.start, lt: period.end } },
            include: {
              event: { include: { eventType: true } },
              auction: {
                include: {
                  lootDrop: { include: { event: { include: { eventType: true } }, item: true } },
                },
              },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          }),
          query.eventTypeId ? tx.eventType.findUnique({ where: { id: query.eventTypeId } }) : null,
        ]);
        const kp = query.kpId ? kps.find((row) => row.id === query.kpId) : undefined;
        const pack = query.packId ? packs.find((row) => row.id === query.packId) : undefined;
        if ((query.kpId && !kp) || (query.packId && !pack) || (query.eventTypeId && !eventType))
          throw new BadRequestException('Неизвестный фильтр');
        if (
          query.kpId &&
          pack &&
          pack.kpId !== query.kpId &&
          !pack.membershipHistory.some(
            (h) => h.kpId === query.kpId || h.previousKpId === query.kpId,
          )
        )
          throw new BadRequestException('Пак не принадлежит выбранной КП');
        const memberMap = new Map(members.map((row) => [row.id, row]));
        const movements: DkpMovement[] = [];
        const withoutEventMovements: DkpMovement[] = [];
        for (const entry of entries) {
          const event = entry.event ?? entry.auction?.lootDrop.event ?? null;
          const base = {
            id: entry.id,
            memberId: entry.memberId,
            nickname: memberMap.get(entry.memberId)?.nickname ?? '',
            type: entry.type,
            amount: entry.amount,
            occurredAt: entry.createdAt.toISOString(),
            comment: entry.comment,
            auctionId: entry.auctionId,
            auctionItemName: entry.auction?.lootDrop.item.name ?? null,
          };
          if (!event) {
            // Операция без ивента: без типа, режима и команды, фильтрами не ограничивается.
            withoutEventMovements.push({
              ...base,
              eventId: null,
              eventName: null,
              startsAt: null,
              eventTypeId: null,
              eventTypeName: null,
              mode: null,
              packId: null,
              kpId: null,
              teamStatus: 'NO_HISTORICAL_DATA',
            });
            continue;
          }
          if (
            (query.eventTypeId && event.eventTypeId !== query.eventTypeId) ||
            (query.mode && event.mode !== query.mode)
          )
            continue;
          let packId: string | null = null;
          let kpId: string | null = null;
          let teamStatus: DkpMovement['teamStatus'] = 'NO_HISTORICAL_DATA';
          // Атрибуция на дату ивента: поздняя корректировка — команда ивента.
          const attribution = statisticsEventMembers(
            { ...event, scope: 'GUILD' },
            members.filter((m) => m.id === entry.memberId),
            packs,
            [],
            generatedAt,
            kps,
          )[0];
          if (attribution) ({ packId, kpId, teamStatus } = attribution);
          if (
            (query.packId && packId !== null && packId !== query.packId) ||
            (query.kpId && kpId !== null && kpId !== query.kpId) ||
            (teamStatus === 'KNOWN' &&
              ((query.packId && packId === null) || (query.kpId && kpId === null)))
          )
            continue;
          movements.push({
            ...base,
            eventId: event.id,
            eventName: event.name,
            startsAt: event.startsAt.toISOString(),
            eventTypeId: event.eventTypeId,
            eventTypeName: event.eventType.name,
            mode: event.mode,
            packId,
            kpId,
            teamStatus,
          });
        }
        // Полный баланс выбранных игроков: вся история до границы периода,
        // фильтры типа/PvE–PvP её не ограничивают.
        const selectedIds = [...new Set(movements.map((row) => row.memberId))];
        const balanceAsOf = period.end <= generatedAt ? period.end : generatedAt;
        const balanceEntries = selectedIds.length
          ? await tx.dkpEntry.findMany({
              where: { memberId: { in: selectedIds }, createdAt: { lt: balanceAsOf } },
              select: { memberId: true, amount: true },
            })
          : [];
        const balances = new Map<string, number>();
        for (const row of balanceEntries)
          balances.set(row.memberId, (balances.get(row.memberId) ?? 0) + row.amount);
        return {
          generatedAt: generatedAt.toISOString(),
          start: period.start.toISOString(),
          end: period.end.toISOString(),
          balanceAsOf: balanceAsOf.toISOString(),
          balanceIgnoresFilters: [
            ...(query.eventTypeId ? (['eventTypeId'] as const) : []),
            ...(query.mode ? (['mode'] as const) : []),
          ],
          totals: aggregateDkpTotals(movements),
          weeks: dkpWeekRows(period.weeks, movements),
          members: dkpMemberRows(movements, balances),
          packs: dkpTeamRows(
            movements,
            'packId',
            new Map(packs.map((row) => [row.id, row.name])),
          ),
          kps: dkpTeamRows(movements, 'kpId', new Map(kps.map((row) => [row.id, row.name]))),
          withoutEvent: dkpWithoutEventRows(withoutEventMovements),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
