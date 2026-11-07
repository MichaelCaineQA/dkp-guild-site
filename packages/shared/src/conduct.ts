import { z } from 'zod';
import { ATTENDANCE_STATUSES, DKP_ENTRY_TYPES, type AttendanceStatus } from './domain';

/**
 * Проведение ивента (issue #10, план 2.2 п.6): ручные отметки РЛ,
 * ручные начисления/корректировки с комментарием, итоговая сводка.
 * Каждое ручное действие идёт в аудит (правило 4 AGENTS.md) —
 * комментарий обязателен.
 */

/** Ручная отметка РЛ: был / опоздал / ушёл раньше / неявка (план 2.2). */
export const setAttendanceSchema = z.object({
  memberId: z.string().min(1),
  status: z.enum(ATTENDANCE_STATUSES).exclude(['EXCUSED_ABSENCE']),
  comment: z.string().min(3).max(500),
});
export type SetAttendanceInput = z.infer<typeof setAttendanceSchema>;

/**
 * Ручная выдача чек-ин статуса (MANUAL): РЛ вручную отмечает старт и/или
 * финал тем, кто не отметился сам (ошибся кодом, не успел). Начисление —
 * та же доля фазы, что и у чек-ина (50/50).
 */
export const manualCheckInSchema = z.object({
  memberId: z.string().min(1),
  phase: z.enum(['START', 'END']),
  comment: z.string().min(3).max(500),
});
export type ManualCheckInInput = z.infer<typeof manualCheckInSchema>;

/** Ручное начисление/корректировка ДКП (план 2.2, журнал append-only). */
export const manualDkpSchema = z
  .object({
    memberId: z.string().min(1),
    type: z.enum(DKP_ENTRY_TYPES).exclude(['CHECKIN_EARN', 'AUCTION_SPEND']),
    amount: z
      .number()
      .int()
      .refine((v) => v !== 0, 'Сумма не может быть нулём'),
    comment: z.string().min(3).max(500),
  })
  .refine((data) => !(data.type === 'ADJUSTMENT' && data.amount > 0) || true, {
    message: 'Корректировка может быть и положительной',
  });
export type ManualDkpInput = z.infer<typeof manualDkpSchema>;

/** Строка сводки по игроку в итогах ивента. */
export interface EventSummaryRow {
  memberId: string;
  memberName: string;
  attendanceStatus: string | null;
  automaticStatus: AttendanceStatus;
  statusIsManual: boolean;
  checkinStart: string;
  checkinEnd: string;
  /** Сумма ДКП, начисленных по ивенту (чек-ины + ручные). */
  dkpEarned: number;
}

/** Чистая сборка итоговой сводки ивента из журнала и посещений. */
export function buildEventSummary(
  members: Array<{ id: string; nickname: string }>,
  attendance: Array<{
    memberId: string;
    status: string | null;
    checkinStart: string;
    checkinEnd: string;
  }>,
  dkpEntries: Array<{ memberId: string; amount: number; type: string; eventId: string | null }>,
  eventId: string,
  excusedMemberIds: string[] = [],
): EventSummaryRow[] {
  const entriesByMember = new Map<string, number>();
  for (const entry of dkpEntries) {
    if (entry.eventId !== eventId) {
      continue;
    }
    entriesByMember.set(entry.memberId, (entriesByMember.get(entry.memberId) ?? 0) + entry.amount);
  }

  const attendanceByMember = new Map(attendance.map((a) => [a.memberId, a]));

  return members.map((member) => {
    const record = attendanceByMember.get(member.id);
    const automaticStatus = resolveAttendanceStatus(
      record?.checkinStart ?? 'PENDING',
      record?.checkinEnd ?? 'PENDING',
      excusedMemberIds.includes(member.id) || record?.status === 'EXCUSED_ABSENCE',
    );
    const statusIsManual = !!record?.status && record.status !== 'EXCUSED_ABSENCE';
    return {
      automaticStatus,
      statusIsManual,
      memberId: member.id,
      memberName: member.nickname,
      attendanceStatus: statusIsManual ? record!.status : automaticStatus,
      checkinStart: record?.checkinStart ?? 'PENDING',
      checkinEnd: record?.checkinEnd ?? 'PENDING',
      dkpEarned: entriesByMember.get(member.id) ?? 0,
    };
  });
}

/** Подтверждённый вручную код имеет ту же силу, что верный самостоятельный. */
export function isAcceptedCheckIn(status: string): boolean {
  return status === 'PASSED' || status === 'MANUAL';
}
export function resolveAttendanceStatus(
  start: string,
  end: string,
  excused: boolean,
): AttendanceStatus {
  if (isAcceptedCheckIn(start) && isAcceptedCheckIn(end)) return 'PRESENT';
  if (isAcceptedCheckIn(start)) return 'LEFT_EARLY';
  if (isAcceptedCheckIn(end)) return 'LATE';
  return excused ? 'EXCUSED_ABSENCE' : 'NO_SHOW';
}
const memberId = z.string().min(1);
const comment = z.string().trim().min(3).max(500);
export const summaryActionSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('CHECKIN'), memberId, phase: z.enum(['START', 'END']), comment })
    .strict(),
  z.object({ kind: z.literal('EXCUSE'), memberId, reason: comment }).strict(),
  z
    .object({
      kind: z.literal('DKP'),
      memberId,
      amount: z
        .number()
        .int()
        .min(-2147483648)
        .max(2147483647)
        .refine((v) => v !== 0),
      comment,
    })
    .strict(),
  z
    .object({
      kind: z.literal('ATTENDANCE'),
      memberId,
      status: z.enum(ATTENDANCE_STATUSES).exclude(['EXCUSED_ABSENCE']),
      comment,
    })
    .strict(),
]);
export type SummaryAction = z.infer<typeof summaryActionSchema>;
export const applyEventSummarySchema = z
  .object({ requestId: z.string().uuid(), actions: z.array(summaryActionSchema).min(1).max(1000) })
  .strict()
  .superRefine((value, ctx) => {
    const used = new Set<string>();
    value.actions.forEach((action, index) => {
      if (action.kind === 'DKP') return;
      const key = `${action.memberId}:${action.kind}:${action.kind === 'CHECKIN' ? action.phase : ''}`;
      if (used.has(key))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['actions', index],
          message: 'Корректировка уже подготовлена',
        });
      used.add(key);
    });
  });
export type ApplyEventSummaryInput = z.infer<typeof applyEventSummarySchema>;
export interface ApplyEventSummaryResult {
  ok: true;
  applied: number;
  repeated: boolean;
}
export function previewSummaryStatus(
  row: EventSummaryRow,
  actions: SummaryAction[],
): string | null {
  const own = actions.filter((a) => a.memberId === row.memberId);
  const override = own.find((a) => a.kind === 'ATTENDANCE');
  if (override?.kind === 'ATTENDANCE') return override.status;
  if (row.statusIsManual) return row.attendanceStatus;
  return resolveAttendanceStatus(
    own.some((a) => a.kind === 'CHECKIN' && a.phase === 'START') ? 'MANUAL' : row.checkinStart,
    own.some((a) => a.kind === 'CHECKIN' && a.phase === 'END') ? 'MANUAL' : row.checkinEnd,
    row.automaticStatus === 'EXCUSED_ABSENCE' || own.some((a) => a.kind === 'EXCUSE'),
  );
}
