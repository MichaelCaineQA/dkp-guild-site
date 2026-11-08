import { BadRequestException, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import {
  countEventParticipants,
  absenceCoversEvent,
  isEventInvitee,
  participationActions,
  parseSettingValue,
  SETTING_DEFAULTS,
  weekQuerySchema,
  type WeekEvent,
} from '@dkp/shared';
export type WeekDb = Pick<PrismaClient, 'event' | 'member' | 'absence' | 'setting'>;
@Injectable()
export class WeekService {
  constructor(
    private readonly db: WeekDb,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  async list(query: unknown, memberId: string | null = null): Promise<WeekEvent[]> {
    const parsed = weekQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Некорректный период или фильтр');
    const { from, to, eventTypeId, mode } = parsed.data;
    const events = await this.db.event.findMany({
      where: { startsAt: { gte: from, lt: to }, status: { not: 'CANCELLED' }, eventTypeId, mode },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        eventTypeId: true,
        eventType: { select: { name: true } },
        mode: true,
        status: true,
        startsAt: true,
        endsAt: true,
        dkpReward: true,
        raidLeadId: true,
        creatorId: true,
        raidLead: { select: { nickname: true } },
        place: true,
        notes: true,
        scope: true,
        kpId: true,
        packId: true,
      },
    });
    const [members, absences, setting] = await Promise.all([
      this.db.member.findMany({
        select: { id: true, packId: true, pack: { select: { kpId: true } } },
      }),
      this.db.absence.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { eventId: { in: events.map((e) => e.id) } },
            { eventId: null, dateFrom: { lt: to }, dateTo: { gte: from } },
          ],
        },
        select: { memberId: true, dateFrom: true, dateTo: true, eventId: true, eligibleFrom: true },
      }),
      this.db.setting.findUnique({
        where: { key: 'absence.deadlineBeforeStartSec' },
        select: { value: true },
      }),
    ]);
    const deadline = parseSettingValue(
      'absence.deadlineBeforeStartSec',
      setting?.value ?? SETTING_DEFAULTS['absence.deadlineBeforeStartSec'],
    );
    const now = this.clock();
    const roster = members.map((m) => ({ id: m.id, packId: m.packId, kpId: m.pack?.kpId ?? null }));
    return events.map(({ eventType, raidLead, scope, kpId, packId, ...event }) => ({
      ...event,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      eventTypeName: eventType.name,
      raidLeadName: raidLead.nickname,
      canDecline:
        roster.some((m) => m.id === memberId && isEventInvitee({ scope, kpId, packId }, m)) &&
        participationActions(event, now, deadline).canDecline &&
        !absences.some(
          (a) =>
            a.memberId === memberId &&
            (a.eventId
              ? a.eventId === event.id
              : absenceCoversEvent(a, event.startsAt, event.endsAt)),
        ),
      ...countEventParticipants(
        { id: event.id, scope, kpId, packId, startsAt: event.startsAt, endsAt: event.endsAt },
        roster,
        absences,
      ),
    }));
  }
}
