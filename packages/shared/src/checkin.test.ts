import { describe, expect, it } from 'vitest';
import {
  activeCheckInPhase,
  checkInPhaseView,
  checkInShareAmount,
  checkInWindowState,
  manualWindowBounds,
  submitCheckInSchema,
} from './checkin';

// Криптографические функции (генерация/хэш/шифрование) живут в
// apps/api/src/checkin/crypto.ts и тестируются там: shared без node:crypto.

describe('checkInWindowState', () => {
  const opens = new Date('2026-03-03T16:57:00Z');
  const closes = new Date('2026-03-03T17:00:00Z');

  it('до окна — NOT_OPEN_YET, в окне — ACTIVE, после — CLOSED', () => {
    expect(checkInWindowState(new Date('2026-03-03T16:50:00Z'), opens, closes)).toBe(
      'NOT_OPEN_YET',
    );
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
      expect(
        checkInShareAmount(reward, 'START', shares) + checkInShareAmount(reward, 'END', shares),
      ).toBe(reward);
    }
    expect(checkInShareAmount(11, 'START', shares)).toBe(3);
    expect(checkInShareAmount(11, 'END', shares)).toBe(8);
  });

  it('нулевая доля — ошибка', () => {
    expect(() => checkInShareAmount(10, 'START', { startSharePct: 0, endSharePct: 100 })).toThrow();
    expect(() => checkInShareAmount(10, 'END', { startSharePct: 100, endSharePct: 0 })).toThrow();
  });
});

describe('manualWindowBounds', () => {
  it('окно открывается в момент нажатия и длится настройку (решение №23)', () => {
    const now = new Date('2026-03-03T16:45:00Z');
    const bounds = manualWindowBounds(now, 180);
    expect(bounds.windowOpensAt.getTime()).toBe(now.getTime());
    expect(bounds.windowClosesAt.getTime()).toBe(new Date('2026-03-03T16:48:00Z').getTime());
    // Границы — свои объекты: случайно изменив границу, не сдвинуть «сейчас»
    expect(bounds.windowOpensAt).not.toBe(now);
  });
});

describe('activeCheckInPhase', () => {
  const started = manualWindowBounds(new Date('2026-03-03T16:45:00Z'), 180);
  const finished = manualWindowBounds(new Date('2026-03-03T19:40:00Z'), 180);

  it('код не запускали — открытой фазы нет, что бы ни показывали часы', () => {
    const now = new Date('2026-03-03T16:58:00Z'); // прежнее стартовое окно по расписанию
    expect(activeCheckInPhase(now, {})).toBeNull();
  });

  it('стартовое окно открыто после нажатия — START, до и после — null', () => {
    expect(activeCheckInPhase(new Date('2026-03-03T16:44:59Z'), { START: started })).toBeNull();
    expect(activeCheckInPhase(new Date('2026-03-03T16:45:00Z'), { START: started })).toBe('START');
    expect(activeCheckInPhase(new Date('2026-03-03T16:48:00Z'), { START: started })).toBe('START');
    expect(activeCheckInPhase(new Date('2026-03-03T16:48:01Z'), { START: started })).toBeNull();
  });

  it('финальное окно позже планового окончания открывается нажатием — END', () => {
    expect(
      activeCheckInPhase(new Date('2026-03-03T19:40:00Z'), { START: started, END: finished }),
    ).toBe('END');
    expect(activeCheckInPhase(new Date('2026-03-03T19:43:00Z'), { END: finished })).toBe('END');
  });

  it('финал перекрывает ещё открытое стартовое окно: завершили сразу после начала', () => {
    const quickFinish = manualWindowBounds(new Date('2026-03-03T16:46:00Z'), 180);
    expect(
      activeCheckInPhase(new Date('2026-03-03T16:46:30Z'), { START: started, END: quickFinish }),
    ).toBe('END');
  });
});

describe('checkInPhaseView', () => {
  const started = manualWindowBounds(new Date('2026-03-03T16:45:00Z'), 180);
  const finished = manualWindowBounds(new Date('2026-03-03T19:40:00Z'), 180);

  it('ивент не начинали — стартовая фаза ещё не открыта, без границ', () => {
    for (const status of ['PLANNED', 'RUNNING']) {
      expect(checkInPhaseView(new Date('2026-03-03T16:50:00Z'), status, {})).toEqual({
        phase: 'START',
        windowState: 'NOT_OPEN_YET',
        window: null,
      });
    }
  });

  it('после старта показывается стартовый код: открыт, затем закрыт', () => {
    expect(
      checkInPhaseView(new Date('2026-03-03T16:46:00Z'), 'RUNNING', { START: started }),
    ).toEqual({
      phase: 'START',
      windowState: 'ACTIVE',
      window: started,
    });
    expect(
      checkInPhaseView(new Date('2026-03-03T17:30:00Z'), 'RUNNING', { START: started }),
    ).toMatchObject({
      phase: 'START',
      windowState: 'CLOSED',
    });
  });

  it('после завершения показывается финальный код, пока ивент уже завершён', () => {
    expect(
      checkInPhaseView(new Date('2026-03-03T19:41:00Z'), 'FINISHED', {
        START: started,
        END: finished,
      }),
    ).toEqual({ phase: 'END', windowState: 'ACTIVE', window: finished });
    expect(
      checkInPhaseView(new Date('2026-03-03T20:00:00Z'), 'FINISHED', {
        START: started,
        END: finished,
      }),
    ).toMatchObject({ phase: 'END', windowState: 'CLOSED' });
  });

  it('завершённый ивент без кодов — финальная фаза закрыта, вводить нечего', () => {
    expect(checkInPhaseView(new Date('2026-03-03T20:00:00Z'), 'FINISHED', {})).toEqual({
      phase: 'END',
      windowState: 'CLOSED',
      window: null,
    });
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
