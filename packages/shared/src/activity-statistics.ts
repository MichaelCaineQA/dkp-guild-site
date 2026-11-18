import { z } from 'zod';
import { attendancePercentage, attendanceStatisticsResult } from './attendance-statistics';

const MOSCOW_OFFSET = 3 * 60 * 60 * 1000;
const historyStatus = z.enum(['KNOWN', 'NO_HISTORICAL_DATA']);
const mode = z.enum(['PVE', 'PVP']);

/** Участие пары игрок–ивент после правил отметок и уважительных отсутствий. */
export const activityParticipationSchema = z.object({
  eventId: z.string(),
  eventName: z.string(),
  startsAt: z.iso.datetime(),
  eventTypeId: z.string(),
  eventTypeName: z.string(),
  mode,
  scope: z.enum(['GUILD', 'KP', 'PACK']),
  memberId: z.string(),
  nickname: z.string(),
  packId: z.string().nullable(),
  kpId: z.string().nullable(),
  teamStatus: historyStatus,
  membershipStatus: historyStatus,
  status: z.string(),
  checks: z.number().int(),
  /** Учитываемое участие в знаменателе посещаемости: 0 при уважительном отсутствии. */
  counted: z.number().int(),
  /** Хотя бы одна принятая отметка; повторная отметка посещение не удваивает. */
  visited: z.boolean(),
});
export type ActivityParticipation = z.infer<typeof activityParticipationSchema>;

export const activityTotalsSchema = z.object({
  /** Число разных завершённых ивентов; участники его не умножают. */
  events: z.number().int(),
  counted: z.number().int(),
  visited: z.number().int(),
  checks: z.number().int(),
  attendance: z.number().nullable(),
  historyStatus,
});
export type ActivityTotals = z.infer<typeof activityTotalsSchema>;

export const activityTypeRowSchema = z.object({
  eventTypeId: z.string(),
  name: z.string(),
  totals: activityTotalsSchema,
});
export const activityModeRowSchema = z.object({
  mode,
  totals: activityTotalsSchema,
});
export const activityWeekRowSchema = z.object({
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  totals: activityTotalsSchema,
});
export const activityPeakSchema = z.object({
  /** Дни недели по Москве: 0 — понедельник, 6 — воскресенье; всегда все 7. */
  byWeekday: z.array(z.object({ weekday: z.number().int(), visited: z.number().int() })),
  /** Часы начала по Москве 0–23; всегда все 24, нули явные. */
  byHour: z.array(z.object({ hour: z.number().int(), visited: z.number().int() })),
});
export const activityMemberDetailSchema = z.object({
  eventId: z.string(),
  eventName: z.string(),
  startsAt: z.iso.datetime(),
  eventTypeId: z.string(),
  eventTypeName: z.string(),
  mode,
  packId: z.string().nullable(),
  kpId: z.string().nullable(),
  teamStatus: historyStatus,
  status: z.string(),
  checks: z.number().int(),
  visited: z.boolean(),
});
export const activityMemberRowSchema = z.object({
  id: z.string(),
  nickname: z.string(),
  totals: activityTotalsSchema,
  byType: z.array(activityTypeRowSchema),
  /** Историческая команда видна в деталях каждого участия. */
  details: z.array(activityMemberDetailSchema),
});
export const activityEventRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  startsAt: z.iso.datetime(),
  eventTypeId: z.string(),
  eventTypeName: z.string(),
  mode,
  scope: z.enum(['GUILD', 'KP', 'PACK']),
  scopeName: z.string(),
  invited: z.number().int(),
  counted: z.number().int(),
  visited: z.number().int(),
  checks: z.number().int(),
  attendance: z.number().nullable(),
  historyStatus,
});
export type ActivityEventRow = z.infer<typeof activityEventRowSchema>;
export const activityReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  overview: z.object({
    activeMembers: z.number().int(),
    totals: activityTotalsSchema,
  }),
  weeks: z.array(activityWeekRowSchema),
  byType: z.array(activityTypeRowSchema),
  byMode: z.array(activityModeRowSchema),
  peak: activityPeakSchema,
  members: z.array(activityMemberRowSchema),
  events: z.array(activityEventRowSchema),
});
export type ActivityReport = z.infer<typeof activityReportSchema>;

/** Итог участия из отметок: одиночная/ручная отметка уже даёт посещённое событие. */
export function activityParticipationResult(input: {
  checkinStart: string | null;
  checkinEnd: string | null;
  excused: boolean;
  manualStatus?: string | null;
}) {
  const result = attendanceStatisticsResult(input);
  return { ...result, counted: result.events, visited: result.checks > 0 };
}

export function aggregateActivity(rows: ActivityParticipation[]): ActivityTotals {
  const unique = [
    ...new Map(rows.map((row) => [JSON.stringify([row.eventId, row.memberId]), row])).values(),
  ];
  const checks = unique.reduce((sum, row) => sum + row.checks, 0);
  const counted = unique.reduce((sum, row) => sum + row.counted, 0);
  return {
    events: new Set(unique.map((row) => row.eventId)).size,
    counted,
    visited: unique.filter((row) => row.visited).length,
    checks,
    attendance: attendancePercentage(checks, counted),
    historyStatus: unique.some(
      (row) => row.membershipStatus !== 'KNOWN' || row.teamStatus !== 'KNOWN',
    )
      ? 'NO_HISTORICAL_DATA'
      : 'KNOWN',
  };
}

/** Индекс дня недели по Москве: 0 — понедельник, 6 — воскресенье. */
export function moscowWeekdayIndex(startsAt: string): number {
  return (new Date(Date.parse(startsAt) + MOSCOW_OFFSET).getUTCDay() + 6) % 7;
}

/** Час начала ивента по Москве: 0–23. */
export function moscowHour(startsAt: string): number {
  return new Date(Date.parse(startsAt) + MOSCOW_OFFSET).getUTCHours();
}

/** Пик активности: посещённые участия по бакетам недели/суток Москвы. */
export function activityPeak(rows: ActivityParticipation[]): z.infer<typeof activityPeakSchema> {
  const byWeekday = Array.from({ length: 7 }, (_, weekday) => ({ weekday, visited: 0 }));
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, visited: 0 }));
  for (const row of rows) {
    if (!row.visited) continue;
    byWeekday[moscowWeekdayIndex(row.startsAt)]!.visited++;
    byHour[moscowHour(row.startsAt)]!.visited++;
  }
  return { byWeekday, byHour };
}

export function activityTypeRows(rows: ActivityParticipation[]) {
  const groups = new Map<string, ActivityParticipation[]>();
  for (const row of rows) {
    groups.set(row.eventTypeId, [...(groups.get(row.eventTypeId) ?? []), row]);
  }
  return [...groups]
    .map(([eventTypeId, group]) => ({
      eventTypeId,
      name: group[0]!.eventTypeName,
      totals: aggregateActivity(group),
    }))
    .sort((a, b) => b.totals.visited - a.totals.visited || a.name.localeCompare(b.name, 'ru'));
}

/** Оба режима присутствуют всегда: нули отличимы от отсутствия данных. */
export function activityModeRows(rows: ActivityParticipation[]) {
  return (['PVE', 'PVP'] as const).map((value) => ({
    mode: value,
    totals: aggregateActivity(rows.filter((row) => row.mode === value)),
  }));
}

/** Недельные интервалы берутся из общего периода; итоги недель сходятся с общим. */
export function activityWeeks(weeks: { start: Date; end: Date }[], rows: ActivityParticipation[]) {
  return weeks.map((week) => ({
    start: week.start.toISOString(),
    end: week.end.toISOString(),
    totals: aggregateActivity(
      rows.filter(
        (row) => row.startsAt >= week.start.toISOString() && row.startsAt < week.end.toISOString(),
      ),
    ),
  }));
}

export function activityMemberRows(rows: ActivityParticipation[]) {
  const groups = new Map<string, ActivityParticipation[]>();
  for (const row of rows) {
    groups.set(row.memberId, [...(groups.get(row.memberId) ?? []), row]);
  }
  return [...groups]
    .map(([memberId, group]) => ({
      id: memberId,
      nickname: group[0]!.nickname,
      totals: aggregateActivity(group),
      byType: activityTypeRows(group),
      details: group
        .map((row) => ({
          eventId: row.eventId,
          eventName: row.eventName,
          startsAt: row.startsAt,
          eventTypeId: row.eventTypeId,
          eventTypeName: row.eventTypeName,
          mode: row.mode,
          packId: row.packId,
          kpId: row.kpId,
          teamStatus: row.teamStatus,
          status: row.status,
          checks: row.checks,
          visited: row.visited,
        }))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.eventId.localeCompare(b.eventId)),
    }))
    .sort(
      (a, b) =>
        b.totals.visited - a.totals.visited ||
        b.totals.checks - a.totals.checks ||
        a.nickname.localeCompare(b.nickname, 'ru'),
    );
}
