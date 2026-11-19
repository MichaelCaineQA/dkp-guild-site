import { z } from 'zod';
import {
  memberPackAt,
  packKpAt,
  type MemberPackHistory,
  type PackMembershipHistory,
} from './membership-history';
import { isEventInvitee, type ScopedEvent } from './week';

const DAY = 86_400_000;
const MOSCOW_OFFSET = 3 * 60 * 60 * 1000;

const calendarDate = z.iso.date();

/** Calendar dates are inclusive; timestamps in the resolved period are half-open. */
export const statisticsQuerySchema = z
  .object({
    from: calendarDate.optional(),
    to: calendarDate.optional(),
    kpId: z.string().min(1).optional(),
    packId: z.string().min(1).optional(),
    eventTypeId: z.string().min(1).optional(),
    mode: z.enum(['PVE', 'PVP']).optional(),
  })
  .refine((v) => (v.from === undefined) === (v.to === undefined), {
    message: 'Укажите обе границы периода',
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'Начало периода должно быть не позднее окончания',
  });

export type StatisticsQuery = z.infer<typeof statisticsQuerySchema>;

export interface StatisticsPeriod {
  start: Date;
  end: Date;
  weeks: { start: Date; end: Date }[];
}

export const statisticsHistoryStatusSchema = z.enum(['KNOWN', 'NO_HISTORICAL_DATA']);
export const statisticsEventMemberSchema = z.object({
  memberId: z.string(),
  packId: z.string().nullable(),
  kpId: z.string().nullable(),
  teamStatus: statisticsHistoryStatusSchema,
  membershipStatus: statisticsHistoryStatusSchema,
  attendanceStatus: z.string().nullable(),
  checkinStart: z.string().nullable(),
  checkinEnd: z.string().nullable(),
});
export type StatisticsEventMember = z.infer<typeof statisticsEventMemberSchema>;
export const statisticsEventSchema = z.object({
  id: z.string(),
  startsAt: z.iso.datetime(),
  eventTypeId: z.string(),
  mode: z.enum(['PVE', 'PVP']),
  status: z.string(),
  members: z.array(statisticsEventMemberSchema),
});
export const statisticsFactSchema = z.object({
  id: z.string(),
  occurredAt: z.iso.datetime(),
  kind: z.enum(['DKP', 'DROP', 'AWARD']),
  eventId: z.string().nullable(),
  memberId: z.string().nullable(),
  amount: z.number().int().nullable(),
  dkpType: z.string().nullable(),
  itemId: z.string().nullable(),
  packId: z.string().nullable(),
  kpId: z.string().nullable(),
  teamStatus: statisticsHistoryStatusSchema,
});
export const statisticsReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  weeks: z.array(z.object({ start: z.iso.datetime(), end: z.iso.datetime() })),
  events: z.array(statisticsEventSchema),
  facts: z.array(statisticsFactSchema),
  factsWithoutEvent: z.array(statisticsFactSchema),
});
export type StatisticsReport = z.infer<typeof statisticsReportSchema>;

/** A fact without an event has no event type, mode or historical event team. */
export const statisticsFactContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('WITHOUT_EVENT') }),
  z.object({ kind: z.literal('EVENT'), eventId: z.string().min(1) }),
]);

export interface StatisticsHistoricalMember {
  id: string;
  createdAt: Date;
  packId: string | null;
  blockedAt: Date | null;
  packHistory: MemberPackHistory[];
}
export interface StatisticsHistoricalPack {
  id: string;
  createdAt: Date;
  kpId: string;
  membershipHistory: PackMembershipHistory[];
}

/**
 * Historical block/unblock changes do not have a complete, exact timeline.
 * Keep potential invitees but mark historical membership as uncertain.
 */
export function statisticsEventMembers(
  event: ScopedEvent,
  members: StatisticsHistoricalMember[],
  packs: StatisticsHistoricalPack[],
  attendance: {
    memberId: string;
    status: string | null;
    checkinStart?: string;
    checkinEnd?: string;
  }[],
  generatedAt: Date,
  kps?: { id: string; createdAt: Date }[],
): StatisticsEventMember[] {
  const packMap = new Map(packs.map((pack) => [pack.id, pack]));
  return members.flatMap((member) => {
    if (member.createdAt > event.startsAt) return [];
    const historical = event.startsAt < generatedAt;
    const memberHistoryKnown = !historical || member.packHistory.length > 0;
    const packId = memberHistoryKnown
      ? memberPackAt(member.packId, member.packHistory, event.startsAt)
      : null;
    const pack = packId ? packMap.get(packId) : undefined;
    const packKnown =
      memberHistoryKnown && (!packId || (!!pack && pack.createdAt <= event.startsAt));
    const resolvedPackId = packKnown ? packId : null;
    const packHistoryKnown = !pack || !historical || pack.membershipHistory.length > 0;
    const historicalKpId =
      packKnown && pack && packHistoryKnown
        ? packKpAt(pack.kpId, pack.membershipHistory, event.startsAt)
        : null;
    const kpKnown =
      !historicalKpId ||
      !kps ||
      kps.some((kp) => kp.id === historicalKpId && kp.createdAt <= event.startsAt);
    const teamKnown = packKnown && packHistoryKnown && kpKnown;
    const kpId = kpKnown ? historicalKpId : null;
    if (teamKnown && !isEventInvitee(event, { id: member.id, packId: resolvedPackId, kpId }))
      return [];
    const current = event.startsAt >= generatedAt;
    if (current && member.blockedAt) return [];
    const record = attendance.find((row) => row.memberId === member.id);
    return [
      {
        memberId: member.id,
        packId: resolvedPackId,
        kpId,
        teamStatus: teamKnown ? ('KNOWN' as const) : ('NO_HISTORICAL_DATA' as const),
        membershipStatus: current ? ('KNOWN' as const) : ('NO_HISTORICAL_DATA' as const),
        attendanceStatus: record?.status ?? null,
        checkinStart: record?.checkinStart ?? null,
        checkinEnd: record?.checkinEnd ?? null,
      },
    ];
  });
}

/**
 * Default statistics period: the current Moscow calendar month as inclusive
 * calendar dates. The browser timezone must not shift the boundaries (#218).
 */
export function moscowMonthBounds(now: Date): { from: string; to: string } {
  const moscow = new Date(now.getTime() + MOSCOW_OFFSET);
  const year = moscow.getUTCFullYear();
  const month = moscow.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, '0');
  return { from: `${year}-${pad(month + 1)}-01`, to: `${year}-${pad(month + 1)}-${pad(lastDay)}` };
}

/**
 * Query string of the shared report context (#212 contracts) without empty
 * values. Contract values are dates, ids and an enum, so no escaping needed.
 */
export function statisticsQueryString(query: StatisticsQuery): string {
  const parts: string[] = [];
  if (query.from) parts.push(`from=${query.from}`);
  if (query.to) parts.push(`to=${query.to}`);
  if (query.kpId) parts.push(`kpId=${query.kpId}`);
  if (query.packId) parts.push(`packId=${query.packId}`);
  if (query.eventTypeId) parts.push(`eventTypeId=${query.eventTypeId}`);
  if (query.mode) parts.push(`mode=${query.mode}`);
  return parts.join('&');
}

/** Resolve once per report, using the same injected instant for its default month. */
export function resolveStatisticsPeriod(query: StatisticsQuery, now: Date): StatisticsPeriod {
  const validated = statisticsQuerySchema.parse(query);
  const moscowNow = new Date(now.getTime() + MOSCOW_OFFSET);
  const defaultStart = Date.UTC(moscowNow.getUTCFullYear(), moscowNow.getUTCMonth(), 1);
  const defaultEnd = Date.UTC(moscowNow.getUTCFullYear(), moscowNow.getUTCMonth() + 1, 1);
  const startMs =
    (validated.from ? Date.parse(`${validated.from}T00:00:00Z`) : defaultStart) - MOSCOW_OFFSET;
  const endMs =
    (validated.to ? Date.parse(`${validated.to}T00:00:00Z`) + DAY : defaultEnd) - MOSCOW_OFFSET;
  const weeks: StatisticsPeriod['weeks'] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const weekday = new Date(cursor + MOSCOW_OFFSET).getUTCDay();
    const nextMonday = cursor + (7 - ((weekday + 6) % 7)) * DAY;
    const weekEnd = Math.min(nextMonday, endMs);
    weeks.push({ start: new Date(cursor), end: new Date(weekEnd) });
    cursor = weekEnd;
  }
  return { start: new Date(startMs), end: new Date(endMs), weeks };
}

/** Moscow timezone is fixed (UTC+3), so labels need no IANA database. */
export function formatMoscowDayShort(value: string): string {
  const date = new Date(value);
  const moscow = new Date(date.getTime() + MOSCOW_OFFSET);
  const day = moscow.getUTCDate();
  const month = moscow.getUTCMonth();
  const months = [
    'янв',
    'фев',
    'мар',
    'апр',
    'мая',
    'июн',
    'июл',
    'авг',
    'сен',
    'окт',
    'ноя',
    'дек',
  ];
  return `${day} ${months[month]}`;
}

/**
 * Фактические даты недели по Москве («1 дек – 7 янв»): границы обрезаны
 * периодом, подпись всегда отражает реальные даты выборки (#219, план 2.8).
 */
export function moscowWeekLabel(start: string, end: string): string {
  const startLabel = formatMoscowDayShort(start);
  // Конечная граница полуоткрытая: последняя фактическая дата — на мс раньше.
  const endLabel = formatMoscowDayShort(new Date(Date.parse(end) - 1).toISOString());
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
}
