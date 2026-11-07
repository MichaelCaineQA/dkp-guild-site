import { BadRequestException, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { countEventParticipants, weekQuerySchema, type WeekEvent } from '@dkp/shared';
export type WeekDb = Pick<PrismaClient, 'event' | 'member' | 'absence'>;
@Injectable()
export class WeekService {
  constructor(private readonly db: WeekDb) {}
  async list(query: unknown): Promise<WeekEvent[]> {
    const parsed = weekQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Некорректный период или фильтр');
    const { from, to, eventTypeId, mode } = parsed.data;
    const [events, members, absences] = await Promise.all([
      this.db.event.findMany({
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
          raidLead: { select: { nickname: true } },
          place: true,
          notes: true,
          scope: true,
          kpId: true,
          packId: true,
        },
      }),
      this.db.member.findMany({
        select: { id: true, packId: true, pack: { select: { kpId: true } } },
      }),
      this.db.absence.findMany({
        where: { status: 'ACTIVE', dateFrom: { lt: to }, dateTo: { gte: from } },
        select: { memberId: true, dateFrom: true, dateTo: true },
      }),
    ]);
    const roster = members.map((m) => ({ id: m.id, packId: m.packId, kpId: m.pack?.kpId ?? null }));
    return events.map(({ eventType, raidLead, scope, kpId, packId, ...event }) => ({
      ...event,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      eventTypeName: eventType.name,
      raidLeadName: raidLead.nickname,
      ...countEventParticipants(
        { scope, kpId, packId, startsAt: event.startsAt },
        roster,
        absences,
      ),
    }));
  }
}
