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
export const createEventSeriesSchema = z.object({
  name: z.string().trim().min(1).max(120),
  eventTypeId: z.string().min(1),
  mode: z.enum(EVENT_MODES),
  /** Первый ивент серии: его интервал задаёт время и длительность. */
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  dkpReward: z.number().int().positive(),
  raidLeadId: z.string().min(1),
  place: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  /** Дни недели серии; если пусто — только первый ивент. */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  /** Сколько недель генерировать (1 = без повторов). */
  weeks: z.number().int().min(1).max(26).default(1),
});
export type CreateEventSeriesInput = z.infer<typeof createEventSeriesSchema>;

/** Интервал ивента серии в ms — серии генерируются сдвигом недели. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Генератор серии: сначала первый ивент, затем — по выбранным дням недели
 * (время и длительность как у первого), в пределах `weeks` недель.
 * Чистая функция — покрывается юнит-тестами.
 */
export function generateSeriesEvents(
  input: CreateEventSeriesInput,
): Array<Pick<CreateEventApiInput, 'startsAt' | 'endsAt'>> {
  const durationMs = input.endsAt.getTime() - input.startsAt.getTime();
  if (durationMs <= 0) {
    throw new Error('Ивент должен заканчиваться позже начала');
  }

  const weekdays = new Set(input.weekdays);
  const events: Array<{ startsAt: Date; endsAt: Date }> = [];

  for (let week = 0; week < input.weeks; week++) {
    for (let day = 0; day < 7; day++) {
      const date = new Date(input.startsAt.getTime() + day * 24 * 60 * 60 * 1000);
      if (week === 0 && day === 0) {
        events.push({ startsAt: input.startsAt, endsAt: input.endsAt });
        continue;
      }
      if (!weekdays.has(date.getUTCDay())) {
        continue;
      }
      // Время суток — как у первого ивента, день недели — из календаря.
      const startsAt = new Date(
        input.startsAt.getTime() + week * WEEK_MS + day * 24 * 60 * 60 * 1000,
      );
      events.push({ startsAt, endsAt: new Date(startsAt.getTime() + durationMs) });
    }
  }

  return events.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
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
