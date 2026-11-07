import { describe, expect, it } from 'vitest';
import {
  EVENT_TRANSITIONS,
  createEventApiSchema,
  createEventSeriesSchema,
  eventsQuerySchema,
  generateSeriesEvents,
  splitIntoPhaseSegments,
} from './schedule';

/** Цикл как в T&L (план 2.1): 90 мин день → 30 мин ночь. */
const CONFIG = {
  anchor: new Date('2026-01-01T00:00:00Z'),
  dayMinutes: 90,
  nightMinutes: 30,
};

function seriesInput(partial: Partial<Parameters<typeof generateSeriesEvents>[0]> = {}) {
  return createEventSeriesSchema.parse({
    name: 'Сбор гильдии',
    eventTypeId: 'et-1',
    mode: 'PVE',
    startsAt: '2026-03-03T17:00:00Z', // вторник
    endsAt: '2026-03-03T19:00:00Z',
    dkpReward: 10,
    raidLeadId: 'm-rl',
    weekdays: [2, 4], // вт, чт
    weeks: 4,
    ...partial,
  });
}

describe('generateSeriesEvents', () => {
  it('«вт/чт 20:00 × 4 недели» — 8 ивентов, вт и чт каждой недели', () => {
    const events = generateSeriesEvents(seriesInput());

    expect(events).toHaveLength(8);
    const days = events.map((e) => e.startsAt.toISOString().slice(0, 10));
    expect(days).toEqual([
      '2026-03-03',
      '2026-03-05', // неделя 1: вт, чт
      '2026-03-10',
      '2026-03-12',
      '2026-03-17',
      '2026-03-19',
      '2026-03-24',
      '2026-03-26',
    ]);
    // Время суток и длительность — как у первого
    for (const event of events) {
      expect(event.startsAt.toISOString().slice(11, 19)).toBe('17:00:00');
      expect(event.endsAt.getTime() - event.startsAt.getTime()).toBe(2 * 60 * 60 * 1000);
    }
  });

  it('первый ивент входит всегда, даже если его день недели не в weekdays', () => {
    const events = generateSeriesEvents(seriesInput({ weekdays: [1] })); // только пн
    // Сам вт + пн каждой недели (первый пн — через 6 дней после вт)
    expect(events).toHaveLength(5);
    expect(events[0]!.startsAt.toISOString().slice(0, 10)).toBe('2026-03-03');
    expect(events[1]!.startsAt.toISOString().slice(0, 10)).toBe('2026-03-09');
    expect(events[1]!.startsAt.getUTCDay()).toBe(1);
  });

  it('weeks=1 — только ивенты первой недели', () => {
    const events = generateSeriesEvents(seriesInput({ weeks: 1 }));
    expect(events).toHaveLength(2);
  });

  it('конец раньше начала — ошибка', () => {
    expect(() =>
      generateSeriesEvents(
        seriesInput({ startsAt: '2026-03-03T19:00:00Z', endsAt: '2026-03-03T17:00:00Z' }),
      ),
    ).toThrow('позже начала');
  });
});

describe('createEventApiSchema', () => {
  it('принимает валидный ивент, плата положительная', () => {
    const parsed = createEventApiSchema.parse({
      name: 'Сбор гильдии',
      eventTypeId: 'et-1',
      mode: 'PVP',
      startsAt: '2026-03-03T17:00:00Z',
      endsAt: '2026-03-03T19:00:00Z',
      dkpReward: 10,
      raidLeadId: 'm-rl',
    });
    expect(parsed.mode).toBe('PVP');
    expect(parsed.startsAt).toBeInstanceOf(Date);
  });

  it('нулевая/отрицательная плата отвергается (решение 1)', () => {
    expect(() =>
      createEventApiSchema.parse({
        name: 'Сбор гильдии',
        eventTypeId: 'et-1',
        mode: 'PVE',
        startsAt: '2026-03-03T17:00:00Z',
        endsAt: '2026-03-03T19:00:00Z',
        dkpReward: 0,
        raidLeadId: 'm-rl',
      }),
    ).toThrow();
  });
});

describe('EVENT_TRANSITIONS', () => {
  it('план 2.1: planned→running→finished; отменить можно из planned и running', () => {
    expect(EVENT_TRANSITIONS['PLANNED']).toContain('RUNNING');
    expect(EVENT_TRANSITIONS['RUNNING']).toContain('FINISHED');
    expect(EVENT_TRANSITIONS['PLANNED']).toContain('CANCELLED');
    expect(EVENT_TRANSITIONS['RUNNING']).toContain('CANCELLED');
    expect(EVENT_TRANSITIONS['FINISHED']).toEqual([]);
    expect(EVENT_TRANSITIONS['CANCELLED']).toEqual([]);
  });
});

describe('eventsQuerySchema', () => {
  it('фильтры периода, типа и режима', () => {
    const parsed = eventsQuerySchema.parse({
      from: '2026-03-01',
      to: '2026-04-01',
      name: 'Сбор гильдии',
      eventTypeId: 'et-1',
      mode: 'PVE',
    });
    expect(parsed.from).toBeInstanceOf(Date);
    expect(parsed.mode).toBe('PVE');
  });
});

describe('splitIntoPhaseSegments', () => {
  it('ивент внутри одной фазы — один сегмент', () => {
    // 00:10–00:20 — ночь первого цикла (день 0:00–1:30, ночь 1:30–2:00)
    const segments = splitIntoPhaseSegments(
      new Date('2026-01-01T00:10:00Z'),
      new Date('2026-01-01T00:20:00Z'),
      CONFIG,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ phase: 'DAY' });
  });

  it('ивент, накрывающий смену фаз, — сегментирован', () => {
    // 1:20–1:50: день до 1:30, потом ночь до 2:00 → два сегмента
    const segments = splitIntoPhaseSegments(
      new Date('2026-01-01T01:20:00Z'),
      new Date('2026-01-01T01:50:00Z'),
      CONFIG,
    );
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      phase: 'DAY',
      startsAt: new Date('2026-01-01T01:20:00Z'),
      endsAt: new Date('2026-01-01T01:30:00Z'),
    });
    expect(segments[1]).toMatchObject({
      phase: 'NIGHT',
      startsAt: new Date('2026-01-01T01:30:00Z'),
      endsAt: new Date('2026-01-01T01:50:00Z'),
    });
  });

  it('длинный ивент через несколько циклов — фазы чередуются', () => {
    // 5 часов = 2.5 цикла
    const segments = splitIntoPhaseSegments(
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-01T05:00:00Z'),
      CONFIG,
    );
    expect(segments.length).toBeGreaterThan(4);
    const phases = segments.map((s) => s.phase);
    expect(phases[0]).toBe('DAY');
    expect(phases).not.toEqual([phases[0]!]);
    // Сегменты плотно прилегают друг к другу
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.startsAt.getTime()).toBe(segments[i - 1]!.endsAt.getTime());
    }
    // Последний сегмент обрезан концом ивента
    expect(segments.at(-1)!.endsAt.getTime()).toBe(new Date('2026-01-01T05:00:00Z').getTime());
  });

  it('пустой/перевёрнутый интервал — без сегментов', () => {
    expect(
      splitIntoPhaseSegments(
        new Date('2026-01-01T01:00:00Z'),
        new Date('2026-01-01T01:00:00Z'),
        CONFIG,
      ),
    ).toEqual([]);
    expect(
      splitIntoPhaseSegments(
        new Date('2026-01-01T01:00:00Z'),
        new Date('2026-01-01T00:00:00Z'),
        CONFIG,
      ),
    ).toEqual([]);
  });
});

it('название обязательно, обрезается по краям и не может быть пустым', () => {
  const base = seriesInput();
  expect(createEventApiSchema.parse({ ...base, name: '  Сбор  ' }).name).toBe('Сбор');
  for (const name of ['', ' ', undefined, 'x'.repeat(121)])
    expect(createEventApiSchema.safeParse({ ...base, name }).success).toBe(false);
});
