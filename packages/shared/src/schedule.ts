import { z } from 'zod';
import { EVENT_MODES, EVENT_STATUSES } from './domain';
import { getGamePhase, type GamePhase, type GamePhaseConfig } from './game-time';

/**
 * Расписание ивентов (issue #8, план 2.1): схемы API и чистая логика —
 * генератор серий повторяющихся ивентов и разбивка интервала на фазы
 * игрового времени день/ночь для раскраски календаря.
 */

/** Создание ивента: плата ДКП фиксируется при создании (решение 1). */
export const createEventApiSchema = z.object({
  name: z.string().trim().min(1).max(120),
  eventTypeId: z.string().min(1),
  mode: z.enum(EVENT_MODES),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  dkpReward: z.number().int().positive(),
  raidLeadId: z.string().min(1),
  place: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export type CreateEventApiInput = z.infer<typeof createEventApiSchema>;

/**
 * Редактирование ивента: плата ДКП НЕ входит — после создания неизменяема
 * (решение гильдии №1). РЛ ивента может менять своё ивент, остальное —
 * офицеры+ (проверяется в API через can с target.raidLeadId).
 */
export const updateEventSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  eventTypeId: z.string().min(1).optional(),
  mode: z.enum(EVENT_MODES).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  raidLeadId: z.string().min(1).optional(),
  place: z.string().max(200).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

/** Смена статуса: planned → running → finished / cancelled (план 2.1). */
export const EVENT_TRANSITIONS: Record<string, readonly string[]> = {
  PLANNED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['FINISHED', 'CANCELLED'],
  FINISHED: [],
  CANCELLED: [],
};

export const changeEventStatusSchema = z.object({
  status: z.enum(EVENT_STATUSES),
});
export type ChangeEventStatusInput = z.infer<typeof changeEventStatusSchema>;

/** Фильтры списка/календаря: период, тип, режим. */
export const eventsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  eventTypeId: z.string().optional(),
  mode: z.enum(EVENT_MODES).optional(),
});
export type EventsQuery = z.infer<typeof eventsQuerySchema>;

/**
 * Серия по шаблону (план 2.1): «каждый вт и чт в 20:00 × 4 недели».
 * Дни недели — 0=вс…6=сб (как Date#getDay), время — минуты от полуночи
 * в таймзоне гильдии не нужны: клиент шлёт готовые UTC-интервалы первого
 * ивента, серия сдвигает их на недели.
 */
export const createEventSeriesSchema = createEventApiSchema
  .extend({
    repeat: z.enum(['DAILY', 'WEEKLY']),
    until: z.coerce.date(),
    /** Дни недели UTC. При пустом выборе еженедельно в день первого ивента. */
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  })
  .refine((input) => input.until >= input.startsAt, {
    message: 'Дата окончания серии раньше первого ивента',
    path: ['until'],
  });
export type CreateEventSeriesInput = z.infer<typeof createEventSeriesSchema>;

/** Технический предел объёма одного запроса; не ограничивает даты будущих серий. */
export const MAX_SERIES_OCCURRENCES = 1000;
export function generateSeriesEvents(
  input: CreateEventSeriesInput,
): Array<Pick<CreateEventApiInput, 'startsAt' | 'endsAt'>> {
  const duration = +input.endsAt - +input.startsAt;
  if (duration <= 0) throw new Error('Ивент должен заканчиваться позже начала');
  if (input.until < input.startsAt) throw new Error('Дата окончания серии раньше первого ивента');
  const days = Math.floor((+input.until - +input.startsAt) / 86400000);
  if (days > MAX_SERIES_OCCURRENCES * 7)
    throw new RangeError('Слишком много событий. Разбейте серию на части (до 1000 за запрос).');
  const weekdays = new Set(input.weekdays.length ? input.weekdays : [input.startsAt.getUTCDay()]);
  const events: Array<{ startsAt: Date; endsAt: Date }> = [];
  for (let day = 0; day <= days; day++) {
    const startsAt = new Date(+input.startsAt + day * 86400000);
    if (day > 0 && input.repeat === 'WEEKLY' && !weekdays.has(startsAt.getUTCDay())) continue;
    events.push({ startsAt, endsAt: new Date(+startsAt + duration) });
    if (events.length > MAX_SERIES_OCCURRENCES)
      throw new RangeError('Слишком много событий. Разбейте серию на части (до 1000 за запрос).');
  }
  return events;
}

/** Отрезок интервала в одной фазе игрового времени — для раскраски календаря. */
export interface PhaseSegment {
  phase: GamePhase;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Разбивка интервала ивента на сегменты день/ночь (план 2.1): ивент,
 * накрывающий несколько фаз, сегментирован. Первый и последний сегменты
 * обрезаются границами ивента. Чистая функция для UI и тестов.
 */
export function splitIntoPhaseSegments(
  startsAt: Date,
  endsAt: Date,
  config: GamePhaseConfig,
): PhaseSegment[] {
  if (endsAt.getTime() <= startsAt.getTime()) {
    return [];
  }

  const segments: PhaseSegment[] = [];
  let cursor = new Date(startsAt.getTime());

  while (cursor.getTime() < endsAt.getTime()) {
    const { phase, switchesAt } = getGamePhase(cursor, config);
    const segmentEnd = new Date(Math.min(switchesAt.getTime(), endsAt.getTime()));
    segments.push({ phase, startsAt: cursor, endsAt: segmentEnd });
    cursor = segmentEnd;
  }

  return segments;
}
