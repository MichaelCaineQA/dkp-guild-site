import { describe, expect, it } from 'vitest';
import {
  absenceCoversEvent,
  absenceSeenActorKey,
  absenceDeadlineError,
  canCancelAbsence,
  createAbsenceSchema,
} from './absences';

const CONFIG = { deadlineBeforeStartSec: 180 };

describe('createAbsenceSchema', () => {
  it('принимает период с причиной', () => {
    const parsed = createAbsenceSchema.parse({
      dateFrom: '2026-03-10T00:00:00Z',
      dateTo: '2026-03-12T00:00:00Z',
      reason: 'Отпуск',
    });
    expect(parsed.dateFrom).toBeInstanceOf(Date);
    expect(parsed.reason).toBe('Отпуск');
  });

  it('конец раньше начала — ошибка', () => {
    expect(() =>
      createAbsenceSchema.parse({
        dateFrom: '2026-03-12T00:00:00Z',
        dateTo: '2026-03-10T00:00:00Z',
        reason: 'Перепутал даты',
      }),
    ).toThrow();
  });

  it('короткая причина — ошибка', () => {
    expect(() =>
      createAbsenceSchema.parse({
        dateFrom: '2026-03-10T00:00:00Z',
        dateTo: '2026-03-10T00:00:00Z',
        reason: 'ок',
      }),
    ).toThrow();
  });
});

describe('absenceDeadlineError', () => {
  const NOW = new Date('2026-03-10T12:00:00Z');

  it('за 4 мин до старта — можно', () => {
    const error = absenceDeadlineError(
      { dateFrom: new Date('2026-03-10T00:00:00Z'), dateTo: new Date('2026-03-11T00:00:00Z') },
      [{ startsAt: new Date('2026-03-10T12:04:00Z') }],
      CONFIG,
      NOW,
    );
    expect(error).toBeNull();
  });

  it('за 2 мин заявка создаётся, но событие исключается отдельно', () => {
    const error = absenceDeadlineError(
      { dateFrom: new Date('2026-03-10T00:00:00Z'), dateTo: new Date('2026-03-11T00:00:00Z') },
      [{ startsAt: new Date('2026-03-10T12:02:00Z') }],
      CONFIG,
      NOW,
    );
    expect(error).toBeNull();
  });

  it('идущий ивент не блокирует заявку на остаток дня', () => {
    const error = absenceDeadlineError(
      { dateFrom: new Date('2026-03-10T00:00:00Z'), dateTo: new Date('2026-03-11T00:00:00Z') },
      [{ startsAt: new Date('2026-03-10T11:00:00Z') }],
      CONFIG,
      NOW,
    );
    expect(error).toBeNull();
  });

  it('прошедший период целиком — нельзя (задним числом)', () => {
    const error = absenceDeadlineError(
      { dateFrom: new Date('2026-03-01T00:00:00Z'), dateTo: new Date('2026-03-02T00:00:00Z') },
      [],
      CONFIG,
      NOW,
    );
    expect(error).toBe('Нельзя подать заявку задним числом');
  });

  it('ивент вне периода не мешает', () => {
    const error = absenceDeadlineError(
      { dateFrom: new Date('2026-03-10T00:00:00Z'), dateTo: new Date('2026-03-11T00:00:00Z') },
      [{ startsAt: new Date('2026-03-12T02:00:00Z') }], // завтра, близко к now? нет: за пределами периода
      CONFIG,
      NOW,
    );
    expect(error).toBeNull();
  });

  it('период в будущем без ивентов — можно', () => {
    const error = absenceDeadlineError(
      { dateFrom: new Date('2026-03-20T00:00:00Z'), dateTo: new Date('2026-03-21T00:00:00Z') },
      [],
      CONFIG,
      NOW,
    );
    expect(error).toBeNull();
  });
});

describe('покрытие события интервалом и дедлайном', () => {
  it('не изменяет утреннее событие и покрывает вечернее; граница дедлайна включена', () => {
    const absence = {
      dateFrom: new Date('2026-03-10T00:00:00Z'),
      dateTo: new Date('2026-03-11T00:00:00Z'),
      eligibleFrom: new Date('2026-03-10T15:03:00Z'),
    };
    expect(
      absenceCoversEvent(
        absence,
        new Date('2026-03-10T12:00:00Z'),
        new Date('2026-03-10T13:00:00Z'),
      ),
    ).toBe(false);
    expect(
      absenceCoversEvent(
        absence,
        new Date('2026-03-10T15:02:00Z'),
        new Date('2026-03-10T16:00:00Z'),
      ),
    ).toBe(false);
    expect(
      absenceCoversEvent(
        absence,
        new Date('2026-03-10T15:03:00Z'),
        new Date('2026-03-10T16:00:00Z'),
      ),
    ).toBe(true);
    expect(
      absenceCoversEvent(
        absence,
        new Date('2026-03-10T15:04:00Z'),
        new Date('2026-03-10T16:00:00Z'),
      ),
    ).toBe(true);
  });
  it('учитывает пересечение, но не касание границ и переход через полночь', () => {
    const a = {
      dateFrom: new Date('2026-03-10T23:30:00Z'),
      dateTo: new Date('2026-03-11T00:30:00Z'),
    };
    expect(
      absenceCoversEvent(a, new Date('2026-03-10T23:00:00Z'), new Date('2026-03-10T23:30:00Z')),
    ).toBe(false);
    expect(
      absenceCoversEvent(a, new Date('2026-03-11T00:15:00Z'), new Date('2026-03-11T01:00:00Z')),
    ).toBe(true);
    expect(
      absenceCoversEvent(a, new Date('2026-03-11T00:30:00Z'), new Date('2026-03-11T01:00:00Z')),
    ).toBe(false);
  });
});

describe('canCancelAbsence', () => {
  const NOW = new Date('2026-03-10T12:00:00Z');

  it('до начала пересекающего ивента — можно', () => {
    expect(
      canCancelAbsence(
        { dateFrom: new Date('2026-03-10T00:00:00Z'), dateTo: new Date('2026-03-11T00:00:00Z') },
        [{ startsAt: new Date('2026-03-10T20:00:00Z') }],
        NOW,
      ),
    ).toBe(true);
  });

  it('ивент уже начался — нельзя', () => {
    expect(
      canCancelAbsence(
        { dateFrom: new Date('2026-03-10T00:00:00Z'), dateTo: new Date('2026-03-11T00:00:00Z') },
        [{ startsAt: new Date('2026-03-10T11:00:00Z') }],
        NOW,
      ),
    ).toBe(false);
  });

  it('период прошёл — нельзя', () => {
    expect(
      canCancelAbsence(
        { dateFrom: new Date('2026-03-01T00:00:00Z'), dateTo: new Date('2026-03-02T00:00:00Z') },
        [],
        NOW,
      ),
    ).toBe(false);
  });
});

describe('absenceCoversEvent', () => {
  it('старт ивента внутри периода — true, вне — false', () => {
    const absence = {
      dateFrom: new Date('2026-03-10T00:00:00Z'),
      dateTo: new Date('2026-03-12T00:00:00Z'),
    };
    expect(absenceCoversEvent(absence, new Date('2026-03-11T17:00:00Z'))).toBe(true);
    expect(absenceCoversEvent(absence, new Date('2026-03-13T17:00:00Z'))).toBe(false);
    expect(absenceCoversEvent(absence, new Date('2026-03-10T00:00:00Z'))).toBe(true); // граница
  });
});

describe('Автор отметки Увидел', () => {
  it('обычный участник и игровой админ сохраняют ID, резервный — отдельный ключ без логина', () => {
    expect(absenceSeenActorKey({ memberId: 'm', isAdmin: false })).toBe('m');
    expect(absenceSeenActorKey({ memberId: 'm', isAdmin: true })).toBe('m');
    expect(absenceSeenActorKey({ memberId: null, isAdmin: true })).toBe('system-admin');
    expect(absenceSeenActorKey({ memberId: null, isAdmin: false })).toBeNull();
  });
});
