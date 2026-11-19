import { z } from 'zod';
import { memberPackAt, packKpAt } from './membership-history';
import {
  statisticsHistoryStatusSchema,
  type StatisticsHistoricalMember,
  type StatisticsHistoricalPack,
  type StatisticsPeriod,
} from './statistics';

const DAY = 86_400_000;

/**
 * Свежесть GS (#217, план 2.8): категории среза по правилу профиля 2.5 —
 * «актуальный GS = последняя запись со скрином», строго старше порога —
 * устаревший. Отдельной записи со скрином нет — MISSING.
 */
export const gearScoreFreshnessSchema = z.enum(['FRESH', 'STALE', 'MISSING']);
export type GearScoreFreshness = z.infer<typeof gearScoreFreshnessSchema>;

export const gearScoreMemberRowSchema = z.object({
  memberId: z.string(),
  nickname: z.string(),
  /** Историческая команда на срез; null — нет пака или недостаточная история. */
  packId: z.string().nullable(),
  kpId: z.string().nullable(),
  teamStatus: statisticsHistoryStatusSchema,
  /**
   * Принадлежность к гильдии на срез: у текущего среза KNOWN, у прошлого —
   * NO_HISTORICAL_DATA (полной истории блокировок нет). Не влияет на категорию
   * свежести: недостаточная история состава — не «нет скрина».
   */
  membershipStatus: statisticsHistoryStatusSchema,
  freshness: gearScoreFreshnessSchema,
  /** Последняя запись со скрином на срез; null — скрина нет. */
  lastScreenshotAt: z.iso.datetime().nullable(),
});
export type GearScoreMemberRow = z.infer<typeof gearScoreMemberRowSchema>;

export const gearScoreTotalsSchema = z.object({
  /** Размер выборки среза: fresh + stale + missing. */
  members: z.number().int(),
  fresh: z.number().int(),
  stale: z.number().int(),
  missing: z.number().int(),
  /** Целая доля % устаревших от всей выборки (округление к ближайшему); null — пустая выборка. */
  staleSharePct: z.number().int().nullable(),
});
export type GearScoreTotals = z.infer<typeof gearScoreTotalsSchema>;

export const gearScoreStatisticsReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  /** Момент среза состава и записей: конец периода, текущий период — момент отчёта. */
  asOf: z.iso.datetime(),
  /** Применённый порог устаревания: profile.gearScoreStaleDays на момент отчёта. */
  staleDays: z.number().int(),
  /** Фильтры запроса, не влияющие на срез (у среза нет фактов ивентов); UI и CSV обязаны подписать исключение. */
  snapshotIgnoresFilters: z.array(z.enum(['eventTypeId', 'mode'])),
  totals: gearScoreTotalsSchema,
  members: z.array(gearScoreMemberRowSchema),
});
export type GearScoreStatisticsReport = z.infer<typeof gearScoreStatisticsReportSchema>;

/** Участник среза: как StatisticsHistoricalMember, но с ником для строк отчёта. */
export interface GearScoreSnapshotMember extends StatisticsHistoricalMember {
  nickname: string;
}

/** Запись GS среза: достаточно даты и наличия скринов. */
export interface GearScoreSnapshotRecord {
  createdAt: Date;
  screenshotIds: readonly string[];
}

/**
 * Момент среза (#217): прошлые периоды — на конец периода, текущий —
 * на момент формирования отчёта. Записи после среза прошлый отчёт не меняют.
 */
export function gearScoreSnapshotAsOf(
  period: Pick<StatisticsPeriod, 'end'>,
  generatedAt: Date,
): Date {
  return period.end.getTime() <= generatedAt.getTime() ? period.end : generatedAt;
}

/**
 * Категория свежести и дата последнего скрина на срез — то же правило, что
 * isGearScoreStale профиля (2.5): последняя запись со скрином, устаревший —
 * строго старше порога. Записи позже среза и записи без скринов не считаются.
 */
export function gearScoreFreshnessAt(
  records: ReadonlyArray<GearScoreSnapshotRecord>,
  thresholdDays: number,
  asOf: Date,
): { freshness: GearScoreFreshness; lastScreenshotAt: Date | null } {
  const latest = records
    .filter(
      (record) => record.createdAt.getTime() < asOf.getTime() && record.screenshotIds.length > 0,
    )
    .reduce<Date | null>(
      (date, record) => (!date || record.createdAt > date ? record.createdAt : date),
      null,
    );
  if (latest === null) return { freshness: 'MISSING', lastScreenshotAt: null };
  const stale = asOf.getTime() - latest.getTime() > thresholdDays * DAY;
  return { freshness: stale ? 'STALE' : 'FRESH', lastScreenshotAt: latest };
}

/**
 * Строки среза: состав и команды на момент asOf (переводы после среза не
 * переносят участника новой команде), свежесть — записями до среза.
 * Разрешение команд — как в statisticsEventMembers: без истории переносов
 * прошлый состав неизвестен (NO_HISTORICAL_DATA), текущий состав не подставляется.
 */
export function gearScoreSnapshotRows(
  members: readonly GearScoreSnapshotMember[],
  packs: readonly StatisticsHistoricalPack[],
  records: ReadonlyMap<string, readonly GearScoreSnapshotRecord[]>,
  staleDays: number,
  asOf: Date,
  generatedAt: Date,
  kps?: readonly { id: string; createdAt: Date }[],
): GearScoreMemberRow[] {
  const packMap = new Map(packs.map((pack) => [pack.id, pack]));
  // Текущий срез (текущий месяц) — «сейчас»: заблокированные скрыты, состав известен.
  const current = asOf.getTime() >= generatedAt.getTime();
  const rows = members.flatMap((member) => {
    if (member.createdAt.getTime() > asOf.getTime()) return [];
    if (current && member.blockedAt) return [];
    const memberHistoryKnown = current || member.packHistory.length > 0;
    const packId = memberHistoryKnown
      ? memberPackAt(member.packId, member.packHistory, asOf)
      : null;
    const pack = packId ? packMap.get(packId) : undefined;
    const packKnown =
      memberHistoryKnown && (!packId || (!!pack && pack.createdAt.getTime() <= asOf.getTime()));
    const resolvedPackId = packKnown ? packId : null;
    const packHistoryKnown = !pack || current || pack.membershipHistory.length > 0;
    const historicalKpId =
      packKnown && pack && packHistoryKnown
        ? packKpAt(pack.kpId, pack.membershipHistory, asOf)
        : null;
    const kpKnown =
      !historicalKpId ||
      !kps ||
      kps.some((kp) => kp.id === historicalKpId && kp.createdAt.getTime() <= asOf.getTime());
    const teamKnown = packKnown && packHistoryKnown && kpKnown;
    const { freshness, lastScreenshotAt } = gearScoreFreshnessAt(
      records.get(member.id) ?? [],
      staleDays,
      asOf,
    );
    return [
      {
        memberId: member.id,
        nickname: member.nickname,
        packId: resolvedPackId,
        kpId: kpKnown ? historicalKpId : null,
        teamStatus: teamKnown ? ('KNOWN' as const) : ('NO_HISTORICAL_DATA' as const),
        membershipStatus: current ? ('KNOWN' as const) : ('NO_HISTORICAL_DATA' as const),
        freshness,
        lastScreenshotAt: lastScreenshotAt?.toISOString() ?? null,
      },
    ];
  });
  return rows.sort(
    (a, b) => a.nickname.localeCompare(b.nickname, 'ru') || a.memberId.localeCompare(b.memberId),
  );
}

/** Итоги среза: количества категорий и целая доля устаревших от всей выборки. */
export function gearScoreFreshnessTotals(rows: readonly GearScoreMemberRow[]): GearScoreTotals {
  const count = (freshness: GearScoreFreshness) =>
    rows.filter((row) => row.freshness === freshness).length;
  const fresh = count('FRESH');
  const stale = count('STALE');
  const missing = count('MISSING');
  return {
    members: rows.length,
    fresh,
    stale,
    missing,
    staleSharePct: rows.length > 0 ? Math.round((stale * 100) / rows.length) : null,
  };
}
