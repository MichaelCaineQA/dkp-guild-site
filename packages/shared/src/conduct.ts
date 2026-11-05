import { z } from 'zod';
import { ATTENDANCE_STATUSES, DKP_ENTRY_TYPES } from './domain';

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
    amount: z.number().int().refine((v) => v !== 0, 'Сумма не может быть нулём'),
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
): EventSummaryRow[] {
  const entriesByMember = new Map<string, number>();
  for (const entry of dkpEntries) {
    if (entry.eventId !== eventId) {
      continue;
    }
    entriesByMember.set(
      entry.memberId,
      (entriesByMember.get(entry.memberId) ?? 0) + entry.amount,
    );
  }

  const attendanceByMember = new Map(attendance.map((a) => [a.memberId, a]));

  return members.map((member) => {
    const record = attendanceByMember.get(member.id);
    return {
      memberId: member.id,
      memberName: member.nickname,
      attendanceStatus: record?.status ?? null,
      checkinStart: record?.checkinStart ?? 'PENDING',
      checkinEnd: record?.checkinEnd ?? 'PENDING',
      dkpEarned: entriesByMember.get(member.id) ?? 0,
    };
  });
}
