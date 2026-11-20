import { BadRequestException, Injectable } from '@nestjs/common';
import {
  resolveStatisticsPeriod,
  statisticsEventMembers,
  statisticsQuerySchema,
  packKpAt,
  type StatisticsFilterOptions,
  type StatisticsReport,
} from '@dkp/shared';
import type { Event } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StatisticsService {
  constructor(private readonly db: PrismaService) {}

  /**
   * Параметры фильтров (#250): паки каждой КП — текущие и исторические
   * (когда-либо входившие), чтобы за период до перевода можно было выбрать
   * прежнюю связку КП и пака; API отчётов принимает оба исторических ID.
   */
  async filterOptions(): Promise<StatisticsFilterOptions> {
    const [kps, packs] = await Promise.all([
      this.db.kP.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.db.pack.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          kpId: true,
          membershipHistory: { select: { kpId: true, previousKpId: true } },
        },
      }),
    ]);
    return {
      kps: kps.map((kp) => ({
        ...kp,
        packs: packs
          .filter(
            (pack) =>
              pack.kpId === kp.id ||
              pack.membershipHistory.some((h) => h.kpId === kp.id || h.previousKpId === kp.id),
          )
          .map(({ id, name }) => ({ id, name })),
      })),
    };
  }

  async get(rawQuery: unknown): Promise<StatisticsReport> {
    const query = statisticsQuerySchema.parse(rawQuery);
    const generatedAt = new Date();
    const period = resolveStatisticsPeriod(query, generatedAt);
    return this.db.$transaction(
      async (tx) => {
        const [kp, pack, eventType, packs, members, events, entries, drops, awards, kps] =
          await Promise.all([
            query.kpId ? tx.kP.findUnique({ where: { id: query.kpId } }) : null,
            query.packId
              ? tx.pack.findUnique({
                  where: { id: query.packId },
                  include: { membershipHistory: true },
                })
              : null,
            query.eventTypeId
              ? tx.eventType.findUnique({ where: { id: query.eventTypeId } })
              : null,
            tx.pack.findMany({ include: { membershipHistory: true } }),
            tx.member.findMany({ include: { packHistory: true } }),
            tx.event.findMany({
              where: {
                startsAt: { gte: period.start, lt: period.end },
                eventTypeId: query.eventTypeId,
                mode: query.mode,
              },
              include: { attendance: true },
              orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
            }),
            tx.dkpEntry.findMany({
              where: { createdAt: { gte: period.start, lt: period.end, lte: generatedAt } },
              include: {
                event: true,
                auction: { include: { lootDrop: { include: { event: true } } } },
              },
            }),
            tx.lootDrop.findMany({
              where: { createdAt: { gte: period.start, lt: period.end, lte: generatedAt } },
              include: { event: true },
            }),
            tx.lootAward.findMany({
              where: { createdAt: { gte: period.start, lt: period.end, lte: generatedAt } },
              include: { auction: { include: { lootDrop: { include: { event: true } } } } },
            }),
            tx.kP.findMany({ select: { id: true, createdAt: true } }),
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
        const rows = events
          .map((event) => {
            const participants = statisticsEventMembers(
              event,
              members,
              packs,
              event.attendance,
              generatedAt,
              kps,
            ).filter(
              (member) =>
                (!query.packId ||
                  member.packId === query.packId ||
                  (member.packId === null && member.teamStatus === 'NO_HISTORICAL_DATA')) &&
                (!query.kpId ||
                  member.kpId === query.kpId ||
                  (member.kpId === null && member.teamStatus === 'NO_HISTORICAL_DATA')),
            );
            return {
              id: event.id,
              startsAt: event.startsAt.toISOString(),
              eventTypeId: event.eventTypeId,
              mode: event.mode,
              status: event.status,
              members: participants,
            };
          })
          .filter((event) => (!query.kpId && !query.packId) || event.members.length > 0);
        type Fact = StatisticsReport['facts'][number];
        const facts: Fact[] = [];
        const factsWithoutEvent: Fact[] = [];
        const addFact = (
          base: Omit<Fact, 'eventId' | 'packId' | 'kpId' | 'teamStatus'>,
          event: Event | null,
        ) => {
          if (!event) {
            factsWithoutEvent.push({
              ...base,
              eventId: null,
              packId: null,
              kpId: null,
              teamStatus: 'NO_HISTORICAL_DATA',
            });
            return;
          }
          if (
            (query.eventTypeId && event.eventTypeId !== query.eventTypeId) ||
            (query.mode && event.mode !== query.mode)
          )
            return;
          let packId: string | null = null;
          let kpId: string | null = null;
          let teamStatus: Fact['teamStatus'] = 'NO_HISTORICAL_DATA';
          if (base.memberId) {
            const attribution = statisticsEventMembers(
              { ...event, scope: 'GUILD' },
              members.filter((m) => m.id === base.memberId),
              packs,
              [],
              generatedAt,
              kps,
            )[0];
            if (attribution) ({ packId, kpId, teamStatus } = attribution);
          } else if (event.scope === 'KP') {
            kpId = kps.some((row) => row.id === event.kpId && row.createdAt <= event.startsAt)
              ? event.kpId
              : null;
          } else if (event.scope === 'PACK') {
            const historicalPack = packs.find(
              (p) => p.id === event.packId && p.createdAt <= event.startsAt,
            );
            if (historicalPack) {
              packId = historicalPack.id;
              kpId =
                historicalPack.membershipHistory.length || event.startsAt >= generatedAt
                  ? packKpAt(historicalPack.kpId, historicalPack.membershipHistory, event.startsAt)
                  : null;
              if (kps.some((row) => row.id === kpId && row.createdAt <= event.startsAt))
                teamStatus = 'KNOWN';
              else kpId = null;
            }
          }
          if (
            (query.packId && packId !== null && packId !== query.packId) ||
            (query.kpId && kpId !== null && kpId !== query.kpId) ||
            (teamStatus === 'KNOWN' &&
              ((query.packId && packId === null) || (query.kpId && kpId === null)))
          )
            return;
          facts.push({ ...base, eventId: event.id, packId, kpId, teamStatus });
        };
        for (const entry of entries)
          addFact(
            {
              id: entry.id,
              occurredAt: entry.createdAt.toISOString(),
              kind: 'DKP',
              memberId: entry.memberId,
              amount: entry.amount,
              dkpType: entry.type,
              itemId: null,
            },
            entry.event ?? entry.auction?.lootDrop.event ?? null,
          );
        for (const drop of drops)
          addFact(
            {
              id: drop.id,
              occurredAt: drop.createdAt.toISOString(),
              kind: 'DROP',
              memberId: null,
              amount: null,
              dkpType: null,
              itemId: drop.itemId,
            },
            drop.event,
          );
        for (const award of awards)
          addFact(
            {
              id: award.id,
              occurredAt: award.createdAt.toISOString(),
              kind: 'AWARD',
              memberId: award.winnerId,
              amount: award.finalPrice,
              dkpType: null,
              itemId: award.auction.lootDrop.itemId,
            },
            award.auction.lootDrop.event,
          );
        return {
          generatedAt: generatedAt.toISOString(),
          start: period.start.toISOString(),
          end: period.end.toISOString(),
          weeks: period.weeks.map(({ start, end }) => ({
            start: start.toISOString(),
            end: end.toISOString(),
          })),
          events: rows,
          facts,
          factsWithoutEvent,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
