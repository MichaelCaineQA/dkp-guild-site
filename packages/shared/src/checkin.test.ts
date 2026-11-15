import { describe, expect, it } from 'vitest';
import {
  checkInShareAmount,
  checkInWindowState,
  phaseWindowBounds,
  submitCheckInSchema,
} from './checkin';

// Криптографические функции (генерация/хэш/шифрование) живут в
// apps/api/src/checkin/crypto.ts и тестируются там: shared без node:crypto.

describe('checkInWindowState', () => {
  const opens = new Date('2026-03-03T16:57:00Z');
  const closes = new Date('2026-03-03T17:00:00Z');

  it('до окна — NOT_OPEN_YET, в окне — ACTIVE, после — CLOSED', () => {
    expect(checkInWindowState(new Date('2026-03-03T16:50:00Z'), opens, closes)).toBe('NOT_OPEN_YET');
    expect(checkInWindowState(new Date('2026-03-03T16:57:00Z'), opens, closes)).toBe('ACTIVE');
    expect(checkInWindowState(new Date('2026-03-03T16:59:59Z'), opens, closes)).toBe('ACTIVE');
    expect(checkInWindowState(new Date('2026-03-03T17:00:01Z'), opens, closes)).toBe('CLOSED');
  });
});

describe('checkInShareAmount', () => {
  it('50/50 от платы (решение №7)', () => {
    const shares = { startSharePct: 50, endSharePct: 50 };
    expect(checkInShareAmount(10, 'START', shares)).toBe(5);
    expect(checkInShareAmount(10, 'END', shares)).toBe(5);
    expect(checkInShareAmount(15, 'START', shares)).toBe(7); // нечётная: старт вниз
    expect(checkInShareAmount(15, 'END', shares)).toBe(8); // финал — остаток
  });

  it('сумма фаз всегда равна плате (аудит F01: платы 1, 3, 11, 10)', () => {
    const shares = { startSharePct: 50, endSharePct: 50 };
    for (const reward of [1, 3, 10, 11, 15, 101]) {
      const start = checkInShareAmount(reward, 'START', shares);
      const end = checkInShareAmount(reward, 'END', shares);
      expect(start + end).toBe(reward);
    }
    expect(checkInShareAmount(1, 'START', shares)).toBe(0); // полбала не бывает
    expect(checkInShareAmount(1, 'END', shares)).toBe(1);
    expect(checkInShareAmount(11, 'START', shares)).toBe(5);
    expect(checkInShareAmount(11, 'END', shares)).toBe(6);
  });

  it('произвольные доли тоже дают сумму = плате', () => {
    const shares = { startSharePct: 30, endSharePct: 70 };
    for (const reward of [1, 7, 10, 11, 33]) {
      expect(checkInShareAmount(reward, 'START', shares) + checkInShareAmount(reward, 'END', shares)).toBe(reward);
    }
    expect(checkInShareAmount(11, 'START', shares)).toBe(3);
    expect(checkInShareAmount(11, 'END', shares)).toBe(8);
  });

  it('нулевая доля — ошибка', () => {
    expect(() => checkInShareAmount(10, 'START', { startSharePct: 0, endSharePct: 100 })).toThrow();
    expect(() => checkInShareAmount(10, 'END', { startSharePct: 100, endSharePct: 0 })).toThrow();
  });
});

describe('phaseWindowBounds', () => {
  const event = {
    startsAt: new Date('2026-03-03T17:00:00Z'),
    endsAt: new Date('2026-03-03T19:00:00Z'),
  };
  const config = { generateBeforeStartSec: 180, windowSec: 180 };

  it('стартовый код: окно за 3 мин до начала, на 3 мин (план 2.2)', () => {
    const bounds = phaseWindowBounds('START', event, config);
    expect(bounds.windowOpensAt.getTime()).toBe(new Date('2026-03-03T16:57:00Z').getTime());
    expect(bounds.windowClosesAt.getTime()).toBe(new Date('2026-03-03T17:00:00Z').getTime());
  });

  it('финальный код: окно в момент планового окончания', () => {
    const bounds = phaseWindowBounds('END', event, config);
    expect(bounds.windowOpensAt.getTime()).toBe(new Date('2026-03-03T19:00:00Z').getTime());
    expect(bounds.windowClosesAt.getTime()).toBe(new Date('2026-03-03T19:03:00Z').getTime());
  });
});

describe('submitCheckInSchema', () => {
  it('принимает трёхзначный код, отвергает прочее', () => {
    expect(submitCheckInSchema.parse({ code: '482' }).code).toBe('482');
    expect(() => submitCheckInSchema.parse({ code: '48' })).toThrow();
    expect(() => submitCheckInSchema.parse({ code: '4822' })).toThrow();
    expect(() => submitCheckInSchema.parse({ code: 'abc' })).toThrow();
  });
});
