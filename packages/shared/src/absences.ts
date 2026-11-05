import { z } from 'zod';

/**
 * Отсутствия (issue #11, план 2.3, решение гильдии №6): заявка без апрува,
 * дедлайн за 3 минуты до старта ивента, задним числом нельзя, отмена —
 * только до начала. Отметка «Увидел» — фиксация, на статус не влияет.
 */

/** Создание заявки: период (с–по) и причина (видна всем членам гильдии). */
export const createAbsenceSchema = z
  .object({
    dateFrom: z.coerce.date(),
    dateTo: z.coerce.date(),
    reason: z.string().min(3).max(500),
  })
  .refine((data) => data.dateTo >= data.dateFrom, {
    message: 'Конец периода не может быть раньше начала',
    path: ['dateTo'],
  });
export type CreateAbsenceInput = z.infer<typeof createAbsenceSchema>;

/** Дедлайн: за сколько до старта ивента ещё можно подать заявку. */
export interface AbsenceDeadlineConfig {
  deadlineBeforeStartSec: number;
}

/**
 * Проверка дедлайна (план 2.3): заявку нельзя подать, если в её период
 * попадает ивент, до старта которого осталось меньше N секунд, и нельзя
 * задним числом — период целиком в прошлом.
 *
 * Возвращает ошибку с текстом для пользователя или null, если можно.
 */
export function absenceDeadlineError(
  absence: { dateFrom: Date; dateTo: Date },
  events: Array<{ startsAt: Date }>,
  config: AbsenceDeadlineConfig,
  now: Date,
): string | null {
  // Задним числом нельзя: период должен захватывать будущее
  if (absence.dateTo.getTime() < now.getTime()) {
    return 'Нельзя подать заявку задним числом';
  }

  const deadlineMs = config.deadlineBeforeStartSec * 1000;
  for (const event of events) {
    const msToStart = event.startsAt.getTime() - now.getTime();
    const eventInPeriod =
      event.startsAt.getTime() >= absence.dateFrom.getTime() &&
      event.startsAt.getTime() <= absence.dateTo.getTime();
    if (eventInPeriod && msToStart < deadlineMs) {
      return 'До старта ивента меньше 3 минут — заявку подать нельзя';
    }
  }
  return null;
}

/** Можно ли отменить свою заявку: только до начала пересекающих ивентов. */
export function canCancelAbsence(
  absence: { dateFrom: Date; dateTo: Date },
  events: Array<{ startsAt: Date }>,
  now: Date,
): boolean {
  // Период уже прошёл — отменять нечего/нельзя
  if (absence.dateTo.getTime() < now.getTime()) {
    return false;
  }
  // Если какой-то ивент периода уже начался — поздно
  for (const event of events) {
    const eventInPeriod =
      event.startsAt.getTime() >= absence.dateFrom.getTime() &&
      event.startsAt.getTime() <= absence.dateTo.getTime();
    if (eventInPeriod && event.startsAt.getTime() <= now.getTime()) {
      return false;
    }
  }
  return true;
}

/** Попадает ли отсутствие на дату ивента (для карточки и чек-листа РЛ). */
export function absenceCoversEvent(
  absence: { dateFrom: Date; dateTo: Date },
  eventStartsAt: Date,
): boolean {
  return (
    eventStartsAt.getTime() >= absence.dateFrom.getTime() &&
    eventStartsAt.getTime() <= absence.dateTo.getTime()
  );
}
