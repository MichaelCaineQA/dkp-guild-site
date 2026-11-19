import { z } from 'zod';
import { statisticsHistoryStatusSchema } from './statistics';

const historyStatus = statisticsHistoryStatusSchema;
const mode = z.enum(['PVE', 'PVP']);

/** Строк топа предметов обзора до строки «Остальное» (план 2.8). */
export const LOOT_TOP_ITEMS_LIMIT = 5;

/**
 * Факт выпадения (#216, план 2.8). Выпадение и получение — разные факты:
 * нераспределённое выпадение остаётся в «Выпало» и не означает покупку.
 */
export const lootDropFactSchema = z.object({
  id: z.string(),
  occurredAt: z.iso.datetime(),
  eventId: z.string().nullable(),
  eventName: z.string().nullable(),
  eventStartsAt: z.iso.datetime().nullable(),
  eventTypeId: z.string().nullable(),
  eventTypeName: z.string().nullable(),
  mode: mode.nullable(),
  /** Команда ивента на его дату (событие области КП/пака); null — гильдейский ивент или недостаточная история. */
  packId: z.string().nullable(),
  kpId: z.string().nullable(),
  teamStatus: historyStatus,
  /** Лот по дропу: null — предмет не выставлялся. */
  lotId: z.string().nullable(),
  /** Статус лота объясняет отсутствие выдачи: открыт, отменён, закрыт без победителя. */
  lotStatus: z.enum(['OPEN', 'CLOSED', 'CANCELLED']).nullable(),
});
export type LootDropFact = z.infer<typeof lootDropFactSchema>;

export const lootDroppedTotalsSchema = z.object({
  /** Все выпадения выборки — знаменатель долей. */
  drops: z.number().int(),
  /** Разных предметов. */
  items: z.number().int(),
});
export type LootDroppedTotals = z.infer<typeof lootDroppedTotalsSchema>;

export const lootDroppedItemRowSchema = z.object({
  itemId: z.string(),
  itemName: z.string(),
  rarity: z.string().nullable(),
  slot: z.string().nullable(),
  isArchboss: z.boolean(),
  count: z.number().int(),
  /** Целая доля % от всех выпадений выборки; сумма по таблице ровно 100. */
  sharePct: z.number().int(),
  details: z.array(lootDropFactSchema),
});
export type LootDroppedItemRow = z.infer<typeof lootDroppedItemRowSchema>;

/** Вход строки «Выпало»: факт выпадения с предметом. */
export interface LootDroppedInput extends LootDropFact {
  itemId: string;
  itemName: string;
  rarity: string | null;
  slot: string | null;
  isArchboss: boolean;
}

/** Категория дропов хранилища: без типа, режима и команды, фильтрами не ограничивается. */
export const lootDroppedWithoutEventSchema = z.object({
  totals: lootDroppedTotalsSchema,
  items: z.array(lootDroppedItemRowSchema),
});
export type LootDroppedWithoutEvent = z.infer<typeof lootDroppedWithoutEventSchema>;

export const lootTopItemRowSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ITEM'),
    itemId: z.string(),
    itemName: z.string(),
    rarity: z.string().nullable(),
    slot: z.string().nullable(),
    isArchboss: z.boolean(),
    count: z.number().int(),
    sharePct: z.number().int(),
  }),
  z.object({
    kind: z.literal('REST'),
    count: z.number().int(),
    sharePct: z.number().int(),
  }),
]);
export type LootTopItemRow = z.infer<typeof lootTopItemRowSchema>;

/**
 * Факт выдачи — только LootAward (#216): создание, отмена и закрытие лота
 * без выдачи получением не считаются. finalPrice — фактическое списание
 * журнала с уже применёнными наценкой и скидкой, без пересчёта по текущим
 * ценам и ролям.
 */
export const lootAwardFactSchema = z.object({
  id: z.string(),
  memberId: z.string(),
  nickname: z.string(),
  itemId: z.string(),
  itemName: z.string(),
  rarity: z.string().nullable(),
  slot: z.string().nullable(),
  isArchboss: z.boolean(),
  /** Лот выдачи. */
  auctionId: z.string(),
  finalPrice: z.number().int(),
  markupPct: z.number().int(),
  discountPct: z.number().int(),
  /** Дата фактической выдачи. */
  occurredAt: z.iso.datetime(),
  eventId: z.string().nullable(),
  eventName: z.string().nullable(),
  eventStartsAt: z.iso.datetime().nullable(),
  eventTypeId: z.string().nullable(),
  eventTypeName: z.string().nullable(),
  mode: mode.nullable(),
  /** Команда получателя на дату связанного ивента. */
  packId: z.string().nullable(),
  kpId: z.string().nullable(),
  teamStatus: historyStatus,
});
export type LootAwardFact = z.infer<typeof lootAwardFactSchema>;

export const lootAwardTotalsSchema = z.object({
  /** Число полученных предметов. */
  awards: z.number().int(),
  /** Сумма фактических ДКП (finalPrice выдач). */
  spent: z.number().int(),
});
export type LootAwardTotals = z.infer<typeof lootAwardTotalsSchema>;

export const lootAwardMemberRowSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  totals: lootAwardTotalsSchema,
});
export type LootAwardMemberRow = z.infer<typeof lootAwardMemberRowSchema>;

export const lootAwardTeamRowSchema = z.object({
  /** null — «Без пака» / недостаточная история принадлежности. */
  id: z.string().nullable(),
  name: z.string().nullable(),
  totals: lootAwardTotalsSchema,
});
export type LootAwardTeamRow = z.infer<typeof lootAwardTeamRowSchema>;

/** Категория выдач лотов хранилища: без команды, фильтрами не ограничивается. */
export const lootAwardWithoutEventSchema = z.object({
  totals: lootAwardTotalsSchema,
  members: z.array(lootAwardMemberRowSchema),
});
export type LootAwardWithoutEvent = z.infer<typeof lootAwardWithoutEventSchema>;

export const lootStatisticsReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  /** «Выпало»: период по дате выпадения. */
  dropped: z.object({
    totals: lootDroppedTotalsSchema,
    items: z.array(lootDroppedItemRowSchema),
    /** Дропы хранилища (eventId=null, #137): отдельная категория. */
    withoutEvent: lootDroppedWithoutEventSchema,
  }),
  /** Топ предметов обзора от всей выборки «Выпало»; остаток — «Остальное», сумма долей 100. */
  top: z.array(lootTopItemRowSchema),
  /** «Получено»: период по дате фактической выдачи. */
  awarded: z.object({
    totals: lootAwardTotalsSchema,
    /** Выдачи выборки, свежие сверху. */
    awards: z.array(lootAwardFactSchema),
    members: z.array(lootAwardMemberRowSchema),
    packs: z.array(lootAwardTeamRowSchema),
    kps: z.array(lootAwardTeamRowSchema),
    /** Выдачи лотов хранилища: отдельная категория. */
    withoutEvent: lootAwardWithoutEventSchema,
  }),
});
export type LootStatisticsReport = z.infer<typeof lootStatisticsReportSchema>;

/**
 * Целые доли в процентах с суммой ровно 100 (метод наибольших остатков).
 * Дополнительные баллы получают большие значения, при равенстве остатков —
 * более ранние по порядку. Пустая выборка — пустой результат.
 */
export function lootSharePercents(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  const exact = counts.map((value) => (value * 100) / total);
  const shares = exact.map(Math.floor);
  let remaining = 100 - shares.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const row of order) {
    if (remaining <= 0) break;
    shares[row.index] += 1;
    remaining -= 1;
  }
  return shares;
}

export function lootDroppedTotals(rows: readonly LootDroppedInput[]): LootDroppedTotals {
  return { drops: rows.length, items: new Set(rows.map((row) => row.itemId)).size };
}

const byDropOccurrence = (a: LootDropFact, b: LootDropFact) =>
  a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id);

/**
 * Строки «Выпало»: группировка по предмету с количеством и долей от всех
 * выпадений выборки; детали — факты выпадения по времени.
 */
export function lootDroppedItemRows(rows: readonly LootDroppedInput[]): LootDroppedItemRow[] {
  const groups = new Map<string, LootDroppedInput[]>();
  for (const row of rows) groups.set(row.itemId, [...(groups.get(row.itemId) ?? []), row]);
  const sorted = [...groups.values()]
    .map((group) => ({ head: group[0]!, rows: [...group].sort(byDropOccurrence) }))
    .sort(
      (a, b) =>
        b.rows.length - a.rows.length || a.head.itemName.localeCompare(b.head.itemName, 'ru'),
    );
  const shares = lootSharePercents(sorted.map((entry) => entry.rows.length));
  return sorted.map((entry, index) => {
    const { itemId, itemName, rarity, slot, isArchboss } = entry.head;
    return {
      itemId,
      itemName,
      rarity,
      slot,
      isArchboss,
      count: entry.rows.length,
      sharePct: shares[index]!,
      // Детали — только факт выпадения, предмет уже в самой строке.
      details: entry.rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt,
        eventId: row.eventId,
        eventName: row.eventName,
        eventStartsAt: row.eventStartsAt,
        eventTypeId: row.eventTypeId,
        eventTypeName: row.eventTypeName,
        mode: row.mode,
        packId: row.packId,
        kpId: row.kpId,
        teamStatus: row.teamStatus,
        lotId: row.lotId,
        lotStatus: row.lotStatus,
      })),
    };
  });
}

/**
 * Топ предметов обзора: знаменатель — все выпадения выборки; предметы за
 * пределами лимита объединяются в «Остальное», сумма долей остаётся 100.
 */
export function lootTopRows(
  items: readonly LootDroppedItemRow[],
  limit: number = LOOT_TOP_ITEMS_LIMIT,
): LootTopItemRow[] {
  const head = items.slice(0, limit).map((row) => ({
    kind: 'ITEM' as const,
    itemId: row.itemId,
    itemName: row.itemName,
    rarity: row.rarity,
    slot: row.slot,
    isArchboss: row.isArchboss,
    count: row.count,
    sharePct: row.sharePct,
  }));
  const rest = items.slice(limit);
  if (rest.length === 0) return head;
  return [
    ...head,
    {
      kind: 'REST' as const,
      count: rest.reduce((sum, row) => sum + row.count, 0),
      sharePct: 100 - head.reduce((sum, row) => sum + row.sharePct, 0),
    },
  ];
}

export function aggregateLootAwards(
  rows: ReadonlyArray<Pick<LootAwardFact, 'finalPrice'>>,
): LootAwardTotals {
  return {
    awards: rows.length,
    spent: rows.reduce((sum, row) => sum + row.finalPrice, 0),
  };
}

/** Группировка по игрокам: число предметов и сумма фактических ДКП. */
export function lootAwardMemberRows(rows: readonly LootAwardFact[]): LootAwardMemberRow[] {
  const groups = new Map<string, LootAwardFact[]>();
  for (const row of rows) groups.set(row.memberId, [...(groups.get(row.memberId) ?? []), row]);
  return [...groups]
    .map(([id, group]) => ({
      id,
      nickname: group[0]!.nickname,
      totals: aggregateLootAwards(group),
    }))
    .sort((a, b) => b.totals.spent - a.totals.spent || a.nickname.localeCompare(b.nickname, 'ru'));
}

/**
 * Группировка по исторической команде получателя на дату ивента; null —
 * «Без пака» / недостаточная история принадлежности.
 */
export function lootAwardTeamRows(
  rows: readonly LootAwardFact[],
  key: 'packId' | 'kpId',
  names: ReadonlyMap<string, string>,
): LootAwardTeamRow[] {
  const groups = new Map<string | null, LootAwardFact[]>();
  for (const row of rows) groups.set(row[key], [...(groups.get(row[key]) ?? []), row]);
  return [...groups]
    .map(([id, group]) => ({
      id,
      name: id === null ? null : (names.get(id) ?? null),
      totals: aggregateLootAwards(group),
    }))
    .sort((a, b) => {
      const bySpent = b.totals.spent - a.totals.spent;
      if (bySpent !== 0) return bySpent;
      // «Без пака» / недостаточная история — в конце при равенстве сумм.
      if (a.id === null) return 1;
      if (b.id === null) return -1;
      return (a.name ?? '').localeCompare(b.name ?? '', 'ru');
    });
}
