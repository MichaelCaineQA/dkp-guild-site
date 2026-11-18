import { BadRequestException, Injectable } from '@nestjs/common';
import {
  absenceCoversEvent,
  activityMemberRows,
  activityModeRows,
  activityParticipationResult,
  activityPeak,
  activityTypeRows,
  activityWeeks,
  aggregateActivity,
  resolveStatisticsPeriod,
  statisticsEventMembers,
  statisticsQuerySchema,
  type ActivityEventRow,
  type ActivityParticipation,
  type ActivityReport,
} from '@dkp/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ActivityStatisticsService {
  constructor(private readonly db: PrismaService) {}

  async get(rawQuery: unknown): Promise<ActivityReport> {
    const query = statisticsQuerySchema.parse(rawQuery);
    const generatedAt = new Date();
    const period = resolveStatisticsPeriod(query, generatedAt);
    return this.db.$transaction(
      async (tx) => {
        const [kps, packs, members, events, absences, eventType] = await Promise.all([
          tx.kP.findMany(),
          tx.pack.findMany({ include: { membershipHistory: true } }),
          tx.member.findMany({ include: { packHistory: true } }),
          tx.event.findMany({
            where: {
              status: 'FINISHED',
              startsAt: { gte: period.start, lt: period.end, lte: generatedAt },
              eventTypeId: query.eventTypeId,
              mode: query.mode,
            },
            include: { attendance: true, eventType: true },
            orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          }),
          tx.absence.findMany({
            where: { status: 'ACTIVE' },
            select: {
              memberId: true,
              eventId: true,
              dateFrom: true,
              dateTo: true,
              eligibleFrom: true,
            },
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
        const packMap = new Map(packs.map((row) => [row.id, row]));
        const kpMap = new Map(kps.map((row) => [row.id, row]));
        const participations: ActivityParticipation[] = [];
        const eventRows: ActivityEventRow[] = [];
        for (const event of events) {
          const participants = statisticsEventMembers(
            event,
            members,
            packs,
            event.attendance,
            generatedAt,
            kps,
          ).filter(
            (m) =>
              (!query.packId ||
                m.packId === query.packId ||
                (m.packId === null && m.teamStatus === 'NO_HISTORICAL_DATA')) &&
              (!query.kpId ||
                m.kpId === query.kpId ||
                (m.kpId === null && m.teamStatus === 'NO_HISTORICAL_DATA')),
          );
          if ((query.kpId || query.packId) && participants.length === 0) continue;
          const rows = participants.map((participant) => {
            const excused =
              participant.attendanceStatus === 'EXCUSED_ABSENCE' ||
              absences.some(
                (a) =>
                  a.memberId === participant.memberId &&
                  (a.eventId
                    ? a.eventId === event.id
                    : absenceCoversEvent(a, event.startsAt, event.endsAt)),
              );
            const { status, checks, counted, visited } = activityParticipationResult({
              checkinStart: participant.checkinStart,
              checkinEnd: participant.checkinEnd,
              excused,
              manualStatus: participant.attendanceStatus,
            });
            return {
              eventId: event.id,
              eventName: event.name,
              startsAt: event.startsAt.toISOString(),
              eventTypeId: event.eventTypeId,
              eventTypeName: event.eventType.name,
              mode: event.mode,
              scope: event.scope,
              memberId: participant.memberId,
              nickname: memberMap.get(participant.memberId)!.nickname,
              packId: participant.packId,
              kpId: participant.kpId,
              teamStatus: participant.teamStatus,
              membershipStatus: participant.membershipStatus,
              status,
              checks,
              counted,
              visited,
            } satisfies ActivityParticipation;
          });
          participations.push(...rows);
          const totals = aggregateActivity(rows);
          const scopeName =
            event.scope === 'PACK'
              ? (packMap.get(event.packId ?? '')?.name ?? '')
              : event.scope === 'KP'
                ? (kpMap.get(event.kpId ?? '')?.name ?? '')
                : 'Вся гильдия';
          eventRows.push({
            id: event.id,
            name: event.name,
            startsAt: event.startsAt.toISOString(),
            eventTypeId: event.eventTypeId,
            eventTypeName: event.eventType.name,
            mode: event.mode,
            scope: event.scope,
            scopeName,
            invited: rows.length,
            counted: totals.counted,
            visited: totals.visited,
            checks: totals.checks,
            attendance: totals.attendance,
            historyStatus: totals.historyStatus,
          });
        }
        return {
          generatedAt: generatedAt.toISOString(),
          start: period.start.toISOString(),
          end: period.end.toISOString(),
          overview: {
            activeMembers: new Set(
              participations.filter((row) => row.checks > 0).map((row) => row.memberId),
            ).size,
            totals: aggregateActivity(participations),
          },
          weeks: activityWeeks(period.weeks, participations),
          byType: activityTypeRows(participations),
          byMode: activityModeRows(participations),
          peak: activityPeak(participations),
          members: activityMemberRows(participations),
          events: eventRows,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
