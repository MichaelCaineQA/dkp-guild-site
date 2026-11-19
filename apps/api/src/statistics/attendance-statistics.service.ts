import { BadRequestException, Injectable } from '@nestjs/common';
import {
  absenceCoversEvent,
  aggregateAttendance,
  attendanceStatisticsResult,
  resolveStatisticsPeriod,
  statisticsEventMembers,
  statisticsQuerySchema,
  type AttendanceDetail,
  type AttendanceReport,
} from '@dkp/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AttendanceStatisticsService {
  constructor(private readonly db: PrismaService) {}

  async get(rawQuery: unknown): Promise<AttendanceReport> {
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
            include: { attendance: true },
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
        const details: AttendanceDetail[] = [];
        let finishedEvents = 0;
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
          finishedEvents++;
          for (const participant of participants) {
            const excused =
              participant.attendanceStatus === 'EXCUSED_ABSENCE' ||
              absences.some(
                (a) =>
                  a.memberId === participant.memberId &&
                  (a.eventId
                    ? a.eventId === event.id
                    : absenceCoversEvent(a, event.startsAt, event.endsAt)),
              );
            const result = attendanceStatisticsResult({
              checkinStart: participant.checkinStart,
              checkinEnd: participant.checkinEnd,
              excused,
              manualStatus: participant.attendanceStatus,
            });
            details.push({
              eventId: event.id,
              eventName: event.name,
              startsAt: event.startsAt.toISOString(),
              memberId: participant.memberId,
              nickname: memberMap.get(participant.memberId)!.nickname,
              packId: participant.packId,
              kpId: participant.kpId,
              teamStatus: participant.teamStatus,
              membershipStatus: participant.membershipStatus,
              checkinStart: participant.checkinStart,
              checkinEnd: participant.checkinEnd,
              ...result,
            });
          }
        }
        const group = (key: 'memberId' | 'packId' | 'kpId') => {
          const unknown = Symbol('unknown');
          const groups = new Map<string | null | symbol, AttendanceDetail[]>();
          for (const row of details) {
            const id =
              key !== 'memberId' && row.teamStatus === 'NO_HISTORICAL_DATA' ? unknown : row[key];
            groups.set(id, [...(groups.get(id) ?? []), row]);
          }
          return [...groups].map(([groupId, rows]) => {
            const id = typeof groupId === 'symbol' ? null : groupId;
            const member = id === null ? undefined : memberMap.get(id);
            return {
              id,
              name:
                key === 'memberId'
                  ? rows[0].nickname
                  : key === 'packId'
                    ? (packs.find((p) => p.id === id)?.name ?? null)
                    : (kps.find((k) => k.id === id)?.name ?? null),
              avatar: key === 'memberId' && member ? member.avatar : null,
              avatarColor: key === 'memberId' && member ? member.avatarColor : null,
              totals: aggregateAttendance(rows),
            };
          });
        };
        const byMember = group('memberId');
        const top = byMember
          .filter((row) => row.totals.events > 0)
          .sort(
            (a, b) =>
              b.totals.checks / b.totals.events - a.totals.checks / a.totals.events ||
              b.totals.events - a.totals.events ||
              (a.name ?? '').localeCompare(b.name ?? '', 'ru'),
          )
          .slice(0, 5);
        return {
          generatedAt: generatedAt.toISOString(),
          start: period.start.toISOString(),
          end: period.end.toISOString(),
          overview: {
            activeMembers: new Set(
              details.filter((row) => row.checks > 0).map((row) => row.memberId),
            ).size,
            finishedEvents,
            totals: aggregateAttendance(details),
          },
          weeks: period.weeks.map((week) => ({
            start: week.start.toISOString(),
            end: week.end.toISOString(),
            totals: aggregateAttendance(
              details.filter(
                (row) =>
                  row.startsAt >= week.start.toISOString() && row.startsAt < week.end.toISOString(),
              ),
            ),
          })),
          members: byMember,
          packs: group('packId'),
          kps: group('kpId'),
          top,
          details,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
