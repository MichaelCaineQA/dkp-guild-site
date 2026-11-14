import { z } from 'zod';

export const primeTimeSlotSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  fromMinute: z.number().int().min(0).max(1439),
  toMinute: z.number().int().min(1).max(1440),
}).strict().refine((slot) => slot.fromMinute < slot.toMinute);

export type PrimeTimeSlot = z.infer<typeof primeTimeSlotSchema>;

export const timeZoneSchema = z.string().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value === 'UTC' || value.includes('/');
  } catch {
    return false;
  }
}, 'Укажите корректную таймзону IANA');

/** Проверка момента по местному дню и времени игрока; конец интервала не включается. */
export function isAvailableAt(slots: PrimeTimeSlot[], timeZone: string, instant: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(value('weekday') ?? '');
  const minute = Number(value('hour')) * 60 + Number(value('minute'));
  return slots.some((slot) => slot.weekday === weekday && slot.fromMinute <= minute && minute < slot.toMinute);
}
