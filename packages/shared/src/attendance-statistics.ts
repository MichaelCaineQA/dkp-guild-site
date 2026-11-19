import { isAcceptedCheckIn, resolveAttendanceStatus } from './conduct';
import { z } from 'zod';

export const attendanceTotalsSchema = z.object({
  checks: z.number().int(),
  events: z.number().int(),
  percentage: z.number().nullable(),
  excused: z.number().int(),
  noShow: z.number().int(),
  late: z.number().int(),
  leftEarly: z.number().int(),
  historyStatus: z.enum(['KNOWN', 'NO_HISTORICAL_DATA']),
});
export const attendanceDetailSchema = z.object({
  eventId: z.string(),
  eventName: z.string(),
  startsAt: z.iso.datetime(),
  memberId: z.string(),
  nickname: z.string(),
  packId: z.string().nullable(),
  kpId: z.string().nullable(),
  teamStatus: z.enum(['KNOWN', 'NO_HISTORICAL_DATA']),
  membershipStatus: z.enum(['KNOWN', 'NO_HISTORICAL_DATA']),
  checkinStart: z.string().nullable(),
  checkinEnd: z.string().nullable(),
  status: z.string(),
  checks: z.number().int(),
  events: z.number().int(),
});
export const attendanceGroupSchema = z.object({
  id: z.string().nullable(),
  name: z.string().nullable(),
  /** Аватар игрока — только в группах/топе игроков (#219); у команд null. */
  avatar: z.string().nullable(),
  avatarColor: z.string().nullable(),
  totals: attendanceTotalsSchema,
});
export const attendanceReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  overview: z.object({
    activeMembers: z.number().int(),
    finishedEvents: z.number().int(),
    totals: attendanceTotalsSchema,
  }),
  weeks: z.array(
    z.object({ start: z.iso.datetime(), end: z.iso.datetime(), totals: attendanceTotalsSchema }),
  ),
  members: z.array(attendanceGroupSchema),
  packs: z.array(attendanceGroupSchema),
  kps: z.array(attendanceGroupSchema),
  top: z.array(attendanceGroupSchema),
  details: z.array(attendanceDetailSchema),
});
export type AttendanceDetail = z.infer<typeof attendanceDetailSchema>;
export type AttendanceTotals = z.infer<typeof attendanceTotalsSchema>;
export type AttendanceReport = z.infer<typeof attendanceReportSchema>;

export function aggregateAttendance(rows: AttendanceDetail[]): AttendanceTotals {
  const unique = [
    ...new Map(rows.map((row) => [JSON.stringify([row.eventId, row.memberId]), row])).values(),
  ];
  const checks = unique.reduce((sum, row) => sum + row.checks, 0);
  const events = unique.reduce((sum, row) => sum + row.events, 0);
  return {
    checks,
    events,
    percentage: attendancePercentage(checks, events),
    excused: unique.filter((row) => row.status === 'EXCUSED_ABSENCE').length,
    noShow: unique.filter((row) => row.status === 'NO_SHOW').length,
    late: unique.filter((row) => row.status === 'LATE').length,
    leftEarly: unique.filter((row) => row.status === 'LEFT_EARLY').length,
    historyStatus: unique.some(
      (row) => row.membershipStatus !== 'KNOWN' || row.teamStatus !== 'KNOWN',
    )
      ? 'NO_HISTORICAL_DATA'
      : 'KNOWN',
  };
}

/**
 * Порядок рейтинга посещаемости (план 2.8): процент по убыванию до округления,
 * затем число учитываемых ивентов, затем ник. Игроки без ивентов в рейтинг
 * не попадают (фильтруется вызывающей стороной).
 */
export function compareAttendanceGroups(
  a: { name: string | null; totals: AttendanceTotals },
  b: { name: string | null; totals: AttendanceTotals },
): number {
  return (
    b.totals.checks / (b.totals.events || 1) - a.totals.checks / (a.totals.events || 1) ||
    b.totals.events - a.totals.events ||
    (a.name ?? '').localeCompare(b.name ?? '', 'ru')
  );
}

/** One final participant/event result. A phase can contribute at most once. */
export function attendanceStatisticsResult(input: {
  checkinStart: string | null;
  checkinEnd: string | null;
  excused: boolean;
  manualStatus?: string | null;
}) {
  const start = input.checkinStart ?? 'PENDING';
  const end = input.checkinEnd ?? 'PENDING';
  const automatic = resolveAttendanceStatus(start, end, input.excused);
  const status =
    input.manualStatus && input.manualStatus !== 'EXCUSED_ABSENCE' ? input.manualStatus : automatic;
  const excluded = status === 'EXCUSED_ABSENCE';
  return {
    status,
    checks: excluded ? 0 : Number(isAcceptedCheckIn(start)) + Number(isAcceptedCheckIn(end)),
    events: excluded ? 0 : 1,
  };
}

export function attendancePercentage(checks: number, events: number): number | null {
  return events === 0 ? null : (checks / (2 * events)) * 100;
}
