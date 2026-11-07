import { z } from 'zod';
import { eventsQuerySchema } from './schedule';
import { absenceCoversEvent } from './absences';
import type { DashboardEvent } from './dashboard';

/** Неделя в календарной зоне игрока, пн 00:00 — следующий пн 00:00. */
export function getLocalWeekBounds(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
export const weekQuerySchema = eventsQuerySchema
  .extend({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((v) => +v.to > +v.from && +v.to - +v.from <= 8 * 86400000, {
    message: 'Укажите интервал не более восьми суток',
  });
export interface WeekEvent extends DashboardEvent {
  invitedCount: number;
  attendingCount: number;
}
export interface InvitedMember {
  id: string;
  packId: string | null;
  kpId: string | null;
}
export interface ScopedEvent {
  scope: 'GUILD' | 'KP' | 'PACK';
  packId: string | null;
  kpId: string | null;
  startsAt: Date;
}
/** Текущий приглашённый состав; пересекающиеся отсутствия не вычитаются дважды. */
export function countEventParticipants(
  event: ScopedEvent,
  members: InvitedMember[],
  absences: { memberId: string; dateFrom: Date; dateTo: Date }[],
) {
  const invited = members.filter(
    (m) =>
      event.scope === 'GUILD' ||
      (event.scope === 'PACK' && event.packId !== null && event.packId === m.packId) ||
      (event.scope === 'KP' && event.kpId !== null && event.kpId === m.kpId),
  );
  const absent = new Set(
    absences.filter((a) => absenceCoversEvent(a, event.startsAt)).map((a) => a.memberId),
  );
  return {
    invitedCount: invited.length,
    attendingCount: invited.filter((m) => !absent.has(m.id)).length,
  };
}
