import { describe, expect, it } from 'vitest';
import { isAvailableAt } from './prime-time';

describe('прайм-тайм в таймзоне игрока', () => {
  it('учитывает время Риги до перехода на летнее время', () => {
    expect(isAvailableAt([{ weekday: 6, fromMinute: 120, toMinute: 180 }], 'Europe/Riga', new Date('2026-03-29T00:30:00Z'))).toBe(true);
  });
  it('учитывает время Риги после перехода на летнее время', () => {
    expect(isAvailableAt([{ weekday: 6, fromMinute: 240, toMinute: 300 }], 'Europe/Riga', new Date('2026-03-29T01:30:00Z'))).toBe(true);
  });
  it('учитывает повторяющийся час при переходе Риги на зимнее время', () => {
    const slot = [{ weekday: 6, fromMinute: 180, toMinute: 240 }];
    expect(isAvailableAt(slot, 'Europe/Riga', new Date('2026-10-25T00:30:00Z'))).toBe(true);
    expect(isAvailableAt(slot, 'Europe/Riga', new Date('2026-10-25T01:30:00Z'))).toBe(true);
  });
  it('сохраняет последний час дня в московском понедельнике', () => {
    expect(isAvailableAt([{ weekday: 0, fromMinute: 1380, toMinute: 1440 }], 'Europe/Moscow', new Date('2026-11-16T20:30:00Z'))).toBe(true);
  });
  it('не переносит последний час на следующий день', () => {
    expect(isAvailableAt([{ weekday: 0, fromMinute: 1380, toMinute: 1440 }], 'Europe/Moscow', new Date('2026-11-16T21:00:00Z'))).toBe(false);
  });
  it('находит второй интервал одного дня', () => {
    expect(isAvailableAt([{ weekday: 0, fromMinute: 0, toMinute: 60 }, { weekday: 0, fromMinute: 600, toMinute: 720 }], 'Europe/Moscow', new Date('2026-11-16T08:00:00Z'))).toBe(true);
  });
  it('весь день включает начало суток', () => {
    expect(isAvailableAt([{ weekday: 1, fromMinute: 0, toMinute: 1440 }], 'Europe/Moscow', new Date('2026-11-16T21:00:00Z'))).toBe(true);
  });
  it('пустой прайм-тайм не означает доступность', () => {
    expect(isAvailableAt([], 'Europe/Moscow', new Date('2026-11-16T21:00:00Z'))).toBe(false);
  });
});
