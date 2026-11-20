import { z } from 'zod';
import { DKP_ENTRY_TYPES } from './domain';
import { statisticsHistoryStatusSchema } from './statistics';

const historyStatus = statisticsHistoryStatusSchema;
const mode = z.enum(['PVE', 'PVP']);

/**
 * Движение ДКП периода — запись журнала с атрибуцией и связями (#215, план 2.8).
 * Суммы читаются из фактов журнала и не пересчитываются по настройкам аукциона.
 * Команда определяется на дату связанного ивента: поздняя корректировка
 * входит в период своей записи, но атрибутируется составу ивента.
 */
export const dkpMovementSchema = z.object({
  id: z.string(),
  memberId: z.string(),
  nickname: z.string(),
  type: z.enum(DKP_ENTRY_TYPES),
  /** Знак факта журнала: начисления > 0, траты и корректировки < 0. */
  amount: z.number().int(),
  occurredAt: z.iso.datetime(),
  comment: z.string().nullable(),
  eventId: z.string().nullable(),
  eventName: z.string().nullable(),
  startsAt: z.iso.datetime().nullable(),
  eventTypeId: z.string().nullable(),
  eventTypeName: z.string().nullable(),
  mode: mode.nullable(),
  auctionId: z.string().nullable(),
  auctionItemName: z.string().nullable(),
  packId: z.string().nullable(),
  kpId: z.string().nullable(),
  teamStatus: historyStatus,
});
export type DkpMovement = z.infer<typeof dkpMovementSchema>;

/**
 * Показатели раздельно (план 2.8): положительная корректировка не становится
 * заработком. Знаки фактов журнала сохраняются: spent отрицателен,
 * adjustments — чистая сумма со знаком.
 */
export const dkpTotalsSchema = z.object({
  /** CHECKIN_EARN + MANUAL_EARN. */
  earned: z.number().int(),
  /** AUCTION_SPEND — фактические списания журнала. */
  spent: z.number().int(),
  /** ADJUSTMENT — чистая корректировка со знаком. */
  adjustments: z.number().int(),
  /** Сумма всех движений выборки. */
  net: z.number().int(),
});
export type DkpTotals = z.infer<typeof dkpTotalsSchema>;

export const dkpWeekRowSchema = z.object({
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  totals: dkpTotalsSchema,
});
export const dkpMemberRowSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  totals: dkpTotalsSchema,
  /** Полный баланс по всей истории до границы периода; тип/PvE–PvP его не ограничивают. */
  balance: z.number().int(),
  details: z.array(dkpMovementSchema),
});
export const dkpTeamRowSchema = z.object({
  /** null — «Без пака» / недостаточная история принадлежности. */
  id: z.string().nullable(),
  name: z.string().nullable(),
  totals: dkpTotalsSchema,
  details: z.array(dkpMovementSchema),
});
export const dkpWithoutEventMemberRowSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  totals: dkpTotalsSchema,
  details: z.array(dkpMovementSchema),
});

/**
 * Операции без ивента (лоты хранилища, админ-начисления) — отдельная категория:
 * без типа, режима и исторической команды, не ограничиваются фильтрами
 * и не подмешиваются в итоги отфильтрованных движений.
 */
export const dkpWithoutEventSchema = z.object({
  totals: dkpTotalsSchema,
  members: z.array(dkpWithoutEventMemberRowSchema),
});
export type DkpWithoutEvent = z.infer<typeof dkpWithoutEventSchema>;

export const dkpStatisticsReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  /** Момент полного баланса: граница периода, текущий период — момент отчёта. */
  balanceAsOf: z.iso.datetime(),
  /** Фильтры запроса, не влияющие на полный баланс; UI и CSV обязаны подписать исключение. */
  balanceIgnoresFilters: z.array(z.enum(['eventTypeId', 'mode'])),
  totals: dkpTotalsSchema,
  weeks: z.array(dkpWeekRowSchema),
  members: z.array(dkpMemberRowSchema),
  packs: z.array(dkpTeamRowSchema),
  kps: z.array(dkpTeamRowSchema),
  withoutEvent: dkpWithoutEventSchema,
});
export type DkpStatisticsReport = z.infer<typeof dkpStatisticsReportSchema>;

export function aggregateDkpTotals(
  entries: ReadonlyArray<Pick<DkpMovement, 'type' | 'amount'>>,
): DkpTotals {
  let earned = 0;
  let spent = 0;
  let adjustments = 0;
  for (const entry of entries) {
    if (entry.type === 'CHECKIN_EARN' || entry.type === 'MANUAL_EARN') earned += entry.amount;
    else if (entry.type === 'AUCTION_SPEND') spent += entry.amount;
    else adjustments += entry.amount;
  }
  return { earned, spent, adjustments, net: earned + spent + adjustments };
}

const byOccurrence = (a: DkpMovement, b: DkpMovement) =>
  a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id);

/** Недельные интервалы берутся из общего периода; итоги недель сходятся с общим. */
export function dkpWeekRows(
  weeks: { start: Date; end: Date }[],
  entries: DkpMovement[],
): z.infer<typeof dkpWeekRowSchema>[] {
  return weeks.map((week) => ({
    start: week.start.toISOString(),
    end: week.end.toISOString(),
    totals: aggregateDkpTotals(
      entries.filter(
        (row) =>
          row.occurredAt >= week.start.toISOString() && row.occurredAt < week.end.toISOString(),
      ),
    ),
  }));
}

/**
 * Строки игроков: движения периода с раскрытием до записей журнала и полный
 * баланс на границу периода по всей истории выбранных игроков. roster —
 * выбранные игроки без движений по фильтрам (#264): строка с нулевыми
 * показателями и тем же полным балансом, чтобы смена типа/режима и пустой
 * период не убирали игрока из таблицы.
 */
export function dkpMemberRows(
  entries: DkpMovement[],
  balances: ReadonlyMap<string, number>,
  roster: ReadonlyArray<Pick<z.infer<typeof dkpMemberRowSchema>, 'id' | 'nickname'>> = [],
): z.infer<typeof dkpMemberRowSchema>[] {
  const groups = new Map<string, DkpMovement[]>();
  for (const row of entries) groups.set(row.memberId, [...(groups.get(row.memberId) ?? []), row]);
  for (const member of roster) groups.set(member.id, groups.get(member.id) ?? []);
  return [...groups]
    .map(([memberId, group]) => ({
      id: memberId,
      nickname: group[0]?.nickname ?? roster.find((row) => row.id === memberId)!.nickname,
      totals: aggregateDkpTotals(group),
      balance: balances.get(memberId) ?? 0,
      details: [...group].sort(byOccurrence),
    }))
    .sort(
      (a, b) =>
        b.totals.earned - a.totals.earned ||
        b.totals.net - a.totals.net ||
        a.nickname.localeCompare(b.nickname, 'ru'),
    );
}

/**
 * Строки команд: атрибуция на дату ивента. Движения без известной истории
 * принадлежности попадают в строку null («Без пака»/«Нет исторических данных»),
 * как кандидаты фильтра КП/пака.
 */
export function dkpTeamRows(
  entries: DkpMovement[],
  key: 'packId' | 'kpId',
  names: ReadonlyMap<string, string>,
): z.infer<typeof dkpTeamRowSchema>[] {
  const groups = new Map<string | null, DkpMovement[]>();
  for (const row of entries) groups.set(row[key], [...(groups.get(row[key]) ?? []), row]);
  return [...groups]
    .map(([id, group]) => ({
      id,
      name: id === null ? null : (names.get(id) ?? null),
      totals: aggregateDkpTotals(group),
      details: [...group].sort(byOccurrence),
    }))
    .sort(
      (a, b) =>
        b.totals.earned - a.totals.earned ||
        b.totals.net - a.totals.net ||
        (a.name ?? '').localeCompare(b.name ?? '', 'ru'),
    );
}

/** Категория «Без ивента»: свои итоги и раскрытие по игрокам. */
export function dkpWithoutEventRows(entries: DkpMovement[]): z.infer<typeof dkpWithoutEventSchema> {
  return {
    totals: aggregateDkpTotals(entries),
    members: dkpMemberRows(entries, new Map()).map((row) => ({
      id: row.id,
      nickname: row.nickname,
      totals: row.totals,
      details: row.details,
    })),
  };
}
