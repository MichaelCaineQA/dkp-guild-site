import { describe, it, expect } from 'vitest';
import {
  countEventParticipants,
  formatEventTimeRange,
  getLocalWeekBounds,
  groupEventsByLocalDay,
  localDayKey,
  weekDays,
  weekQuerySchema,
} from './week';
describe('Неделя расписания', () => {
  it('воскресенье относится к прошлому понедельнику, включая переход года', () => {
    const { start, end } = getLocalWeekBounds(new Date(2027, 0, 3, 23, 59));
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([
      2026, 11, 28, 0,
    ]);
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours()]).toEqual([
      2027, 0, 4, 0,
    ]);
    expect(localDayKey(start)).toBe('2026-11-28');
  });
  it('понедельник начинается в локальную полночь', () => {
    const monday = new Date(2026, 10, 9, 2);
    expect(getLocalWeekBounds(monday).start.getDate()).toBe(9);
    expect(monday.getHours()).toBe(2);
  });
  it('валидирует диапазон, допускает неделю с переводом часов', () => {
    const from = '2026-01-01T00:00:00Z';
    expect(weekQuerySchema.safeParse({ from, to: '2026-01-08T01:00:00Z' }).success).toBe(true);
    for (const query of [
      {},
      { from, to: from },
      { from, to: '2026-01-10' },
      { from, to: 'invalid' },
    ])
      expect(weekQuerySchema.safeParse(query).success).toBe(false);
  });
});
describe('Недельное расписание дашборда (issue #203)', () => {
  it('weekDays отдаёт семь дат пн–вс через границу месяца и года', () => {
    const days = weekDays(new Date(2026, 11, 28));
    expect(days).toHaveLength(7);
    expect(days.map((d) => [d.getMonth(), d.getDate()])).toEqual([
      [11, 28],
      [11, 29],
      [11, 30],
      [11, 31],
      [0, 1],
      [0, 2],
      [0, 3],
    ]);
    expect(days[0].getDay()).toBe(1);
    expect(days[6].getDay()).toBe(0);
  });
  it('группирует события по локальному дню начала, внутри дня — по времени', () => {
    const at = (y: number, m: number, d: number, h: number, min = 0) =>
      new Date(y, m, d, h, min).toISOString();
    const first = { id: 'late', startsAt: at(2026, 10, 16, 21) };
    const second = { id: 'early', startsAt: at(2026, 10, 16, 9) };
    const otherDay = { id: 'other', startsAt: at(2026, 10, 18, 9) };
    const sameTimeA = { id: 'a', startsAt: at(2026, 10, 16, 9) };
    const sameTimeB = { id: 'b', startsAt: at(2026, 10, 16, 9) };
    const grouped = groupEventsByLocalDay([first, second, otherDay, sameTimeA, sameTimeB]);
    expect([...grouped.keys()]).toEqual([
      localDayKey(new Date(2026, 10, 16)),
      localDayKey(new Date(2026, 10, 18)),
    ]);
    expect(grouped.get(localDayKey(new Date(2026, 10, 16)))!.map((e) => e.id)).toEqual([
      'early',
      'a',
      'b',
      'late',
    ]);
    expect(grouped.get(localDayKey(new Date(2026, 10, 18)))!.map((e) => e.id)).toEqual(['other']);
  });
  it('форматирует интервал; окончание в другой день — с датой', () => {
    const start = new Date(2026, 10, 16, 20, 0);
    expect(formatEventTimeRange(start, new Date(2026, 10, 16, 21, 30))).toBe('20:00–21:30');
    const overnight = formatEventTimeRange(
      new Date(2026, 10, 16, 23, 0),
      new Date(2026, 10, 17, 1, 0),
    );
    expect(overnight.startsWith('23:00–01:00 (')).toBe(true);
    expect(overnight).toContain('17');
    expect(overnight.endsWith(')')).toBe(true);
  });
});
describe('Пойдут / приглашены', () => {
  const startsAt = new Date('2026-11-09T17:00:00Z');
  const event = { startsAt, scope: 'GUILD' as const, packId: null, kpId: null };
  const members = [
    { id: 'a', packId: 'p', kpId: 'k' },
    { id: 'b', packId: 'q', kpId: 'k' },
    { id: 'c', packId: null, kpId: null },
  ];
  const absence = { memberId: 'a', dateFrom: startsAt, dateTo: startsAt };
  it('считает активные отсутствия на границе и не удваивает пересечения', () => {
    expect(
      countEventParticipants(event, members, [
        absence,
        absence,
        { ...absence, memberId: 'outside' },
      ]),
    ).toEqual({ invitedCount: 3, attendingCount: 2 });
  });
  it('считает КП и пак, исключает чужих и отсутствие вне события', () => {
    const past = { ...absence, dateFrom: new Date(0), dateTo: new Date(1) };
    expect(countEventParticipants({ ...event, scope: 'KP', kpId: 'k' }, members, [past])).toEqual({
      invitedCount: 2,
      attendingCount: 2,
    });
    expect(
      countEventParticipants({ ...event, scope: 'PACK', packId: 'p' }, members, [absence]),
    ).toEqual({ invitedCount: 1, attendingCount: 0 });
    expect(countEventParticipants({ ...event, scope: 'PACK' }, members, [])).toEqual({
      invitedCount: 0,
      attendingCount: 0,
    });
  });
  it('отказ относится к ID: не затрагивает одновременное событие и сохраняется при переносе', () => {
    const scoped = { ...absence, eventId: 'e' };
    expect(
      countEventParticipants({ ...event, id: 'other' }, members, [scoped]).attendingCount,
    ).toBe(3);
    expect(
      countEventParticipants(
        { ...event, id: 'e', startsAt: new Date(+startsAt + 86400000) },
        members,
        [scoped],
      ).attendingCount,
    ).toBe(2);
  });
});
