import { describe, it, expect } from 'vitest';
import { countEventParticipants, getLocalWeekBounds, localDayKey, weekQuerySchema } from './week';
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
});
