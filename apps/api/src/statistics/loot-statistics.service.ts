import { BadRequestException, Injectable } from '@nestjs/common';
import {
  aggregateLootAwards,
  lootAwardMemberRows,
  lootAwardTeamRows,
  lootDroppedItemRows,
  lootDroppedTotals,
  lootTopRows,
  packKpAt,
  resolveStatisticsPeriod,
  statisticsEventMembers,
  statisticsQuerySchema,
  type LootAwardFact,
  type LootDroppedInput,
  type LootStatisticsReport,
} from '@dkp/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Лут-статистика (#216, план 2.8): два разных факта — выпадение (период
 * по дате дропа, нераспределённое остаётся в «Выпало») и получение
 * (только LootAward, период по дате выдачи). Расход — фактическое списание
 * finalPrice с применёнными наценкой и скидкой, без пересчёта по текущим
 * ценам и ролям. Команда — историческая, на дату связанного ивента;
 * дропы и выдачи хранилища (eventId=null, #137) — отдельная категория
 * «Без ивента» без типа, режима и команды, фильтрами не ограничивается.
 */
@Injectable()
export class LootStatisticsService {
  constructor(private readonly db: PrismaService) {}

  async get(rawQuery: unknown): Promise<LootStatisticsReport> {
    const query = statisticsQuerySchema.parse(rawQuery);
    const generatedAt = new Date();
    const period = resolveStatisticsPeriod(query, generatedAt);
    return this.db.$transaction(
      async (tx) => {
        const [kps, packs, members, drops, awards, eventType] = await Promise.all([
          tx.kP.findMany(),
          tx.pack.findMany({ include: { membershipHistory: true } }),
          tx.member.findMany({ include: { packHistory: true } }),
          tx.lootDrop.findMany({
            where: { createdAt: { gte: period.start, lt: period.end, lte: generatedAt } },
            include: { item: true, event: { include: { eventType: true } }, auction: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          }),
          tx.lootAward.findMany({
            where: { createdAt: { gte: period.start, lt: period.end, lte: generatedAt } },
            include: {
              winner: true,
              auction: {
                include: {
                  lootDrop: { include: { item: true, event: { include: { eventType: true } } } },
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
        const dropped: LootDroppedInput[] = [];
        const droppedWithoutEvent: LootDroppedInput[] = [];
        for (const drop of drops) {
          const event = drop.event;
          const base = {
            id: drop.id,
            occurredAt: drop.createdAt.toISOString(),
            lotId: drop.auction?.id ?? null,
            lotStatus: drop.auction?.status ?? null,
            itemId: drop.item.id,
            itemName: drop.item.name,
            rarity: drop.item.rarity,
            slot: drop.item.slot,
            isArchboss: drop.item.isArchboss,
          };
          if (!event) {
            // Дроп хранилища: без ивента, типа, режима и команды.
            droppedWithoutEvent.push({
              ...base,
              eventId: null,
              eventName: null,
              eventStartsAt: null,
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
          let teamStatus: LootDroppedInput['teamStatus'] = 'NO_HISTORICAL_DATA';
          // Команда дропа — область ивента на его дату; дроп не привязан к игроку.
          if (event.scope === 'KP') {
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
            continue;
          dropped.push({
            ...base,
            eventId: event.id,
            eventName: event.name,
            eventStartsAt: event.startsAt.toISOString(),
            eventTypeId: event.eventTypeId,
            eventTypeName: event.eventType.name,
            mode: event.mode,
            packId,
            kpId,
            teamStatus,
          });
        }
        const awardFacts: LootAwardFact[] = [];
        const awardWithoutEvent: LootAwardFact[] = [];
        for (const award of awards) {
          const drop = award.auction.lootDrop;
          const event = drop.event;
          const base = {
            id: award.id,
            memberId: award.winnerId,
            nickname: award.winner.nickname,
            itemId: drop.item.id,
            itemName: drop.item.name,
            rarity: drop.item.rarity,
            slot: drop.item.slot,
            isArchboss: drop.item.isArchboss,
            auctionId: award.auctionId,
            finalPrice: award.finalPrice,
            markupPct: award.markupPct,
            discountPct: award.discountPct,
            occurredAt: award.createdAt.toISOString(),
          };
          if (!event) {
            // Выдача лота хранилища: без ивента и команды.
            awardWithoutEvent.push({
              ...base,
              eventId: null,
              eventName: null,
              eventStartsAt: null,
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
          let teamStatus: LootAwardFact['teamStatus'] = 'NO_HISTORICAL_DATA';
          // Команда получателя на дату ивента: переводы после ивента выдачу
          // новой команде не переносят.
          const attribution = statisticsEventMembers(
            { ...event, scope: 'GUILD' },
            members.filter((m) => m.id === award.winnerId),
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
          awardFacts.push({
            ...base,
            eventId: event.id,
            eventName: event.name,
            eventStartsAt: event.startsAt.toISOString(),
            eventTypeId: event.eventTypeId,
            eventTypeName: event.eventType.name,
            mode: event.mode,
            packId,
            kpId,
            teamStatus,
          });
        }
        const droppedItems = lootDroppedItemRows(dropped);
        const byFreshness = (a: LootAwardFact, b: LootAwardFact) =>
          b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id);
        return {
          generatedAt: generatedAt.toISOString(),
          start: period.start.toISOString(),
          end: period.end.toISOString(),
          dropped: {
            totals: lootDroppedTotals(dropped),
            items: droppedItems,
            withoutEvent: {
              totals: lootDroppedTotals(droppedWithoutEvent),
              items: lootDroppedItemRows(droppedWithoutEvent),
            },
          },
          top: lootTopRows(droppedItems),
          awarded: {
            totals: aggregateLootAwards(awardFacts),
            awards: [...awardFacts].sort(byFreshness),
            members: lootAwardMemberRows(awardFacts),
            packs: lootAwardTeamRows(
              awardFacts,
              'packId',
              new Map(packs.map((row) => [row.id, row.name])),
            ),
            kps: lootAwardTeamRows(
              awardFacts,
              'kpId',
              new Map(kps.map((row) => [row.id, row.name])),
            ),
            withoutEvent: {
              totals: aggregateLootAwards(awardWithoutEvent),
              members: lootAwardMemberRows(awardWithoutEvent),
            },
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
