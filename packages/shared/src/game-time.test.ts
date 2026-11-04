import { describe, expect, it } from 'vitest';
import { getGamePhase } from './game-time';

const config = {
  anchor: new Date('2026-11-04T18:00:00Z'),
  dayMinutes: 90,
  nightMinutes: 30,
};

describe('getGamePhase (цикл T&L: 90 мин день / 30 мин ночь)', () => {
  it('начало якоря — день, смена через 90 минут', () => {
    const info = getGamePhase(new Date('2026-11-04T18:00:00Z'), config);
    expect(info.phase).toBe('DAY');
    expect(info.switchesAt).toEqual(new Date('2026-11-04T19:30:00Z'));
  });

  it('граница 19:30 — уже ночь, смена на границе цикла', () => {
    const info = getGamePhase(new Date('2026-11-04T19:30:00Z'), config);
    expect(info.phase).toBe('NIGHT');
    expect(info.switchesAt).toEqual(new Date('2026-11-04T20:00:00Z'));
  });

  it('цикл повторяется каждые 2 часа', () => {
    const info = getGamePhase(new Date('2026-11-05T18:30:00Z'), config);
    expect(info.phase).toBe('DAY');
    expect(info.switchesAt).toEqual(new Date('2026-11-05T19:30:00Z'));
  });

  it('момент раньше якоря — ошибка конфигурации', () => {
    expect(() => getGamePhase(new Date('2026-11-04T17:59:00Z'), config)).toThrow();
  });
});
