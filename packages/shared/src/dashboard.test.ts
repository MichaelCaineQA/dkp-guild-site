import { describe, expect, it } from 'vitest';
import { getMoscowDayBounds, selectDashboardEvents, sortTeamMembers } from './dashboard';
import { canViewGuildGearScore } from './profile';
const event = (hour: number) => ({
  id: String(hour),
  startsAt: new Date(Date.UTC(2026, 10, 7, hour)),
  endsAt: new Date(Date.UTC(2026, 10, 7, hour + 1)),
});
describe('Главная: день по Москве', () => {
  it('граница 21:00 UTC открывает новый день независимо от TZ процесса', () => {
    expect(getMoscowDayBounds(new Date('2026-11-07T20:59:59.999Z')).start.toISOString()).toBe(
      '2026-11-06T21:00:00.000Z',
    );
    expect(getMoscowDayBounds(new Date('2026-11-07T21:00:00Z'))).toEqual({
      start: new Date('2026-11-07T21:00:00Z'),
      end: new Date('2026-11-08T21:00:00Z'),
    });
  });
  it('переход года и високосный день не меняют длительность суток', () => {
    expect(getMoscowDayBounds(new Date('2024-02-29T22:00:00Z')).end.toISOString()).toBe(
      '2024-03-01T21:00:00.000Z',
    );
    expect(getMoscowDayBounds(new Date('2026-12-31T22:00:00Z')).end.toISOString()).toBe(
      '2027-01-01T21:00:00.000Z',
    );
  });
  it('берёт пять ближайших; старые и завтрашние уходят', () => {
    const events = Array.from({ length: 24 }, (_, h) => event(h));
    expect(
      selectDashboardEvents(events, new Date('2026-11-07T12:30:00Z')).map((e) => e.id),
    ).toEqual(['12', '13', '14', '15', '16']);
    expect(
      selectDashboardEvents(events, new Date('2026-11-07T20:30:00Z')).map((e) => e.id),
    ).toEqual(['16', '17', '18', '19', '20']);
  });
  it('пустой день пуст; уже прошедшие заполняют свободные места', () => {
    expect(selectDashboardEvents([], new Date())).toEqual([]);
    expect(
      selectDashboardEvents(
        [event(10), event(11), event(13)],
        new Date('2026-11-07T12:30:00Z'),
      ).map((e) => e.id),
    ).toEqual(['10', '11', '13']);
  });
});
describe('Команда на главной', () => {
  it('лидер первый, затем дата вступления с fallback на регистрацию; исходник не мутируется', () => {
    const members = [
      { id: 'new', createdAt: '2020-01-01', packJoinedAt: '2026-11-01' },
      { id: 'leader', createdAt: '2026-11-06', packJoinedAt: null },
      { id: 'old', createdAt: '2026-01-01', packJoinedAt: null },
    ];
    expect(sortTeamMembers(members, 'leader').map((m) => m.id)).toEqual(['leader', 'old', 'new']);
    expect(members[0].id).toBe('new');
  });
  it('GS скрыт даже у своего игрока/Офицера/лидера; есть у Главы и резервного Админа', () => {
    expect(canViewGuildGearScore({ rank: 'MEMBER', memberId: 'self' })).toBe(false);
    expect(canViewGuildGearScore({ rank: 'OFFICER', memberId: 'leader' })).toBe(false);
    expect(canViewGuildGearScore({ rank: 'GUILD_LEADER' })).toBe(true);
    expect(canViewGuildGearScore({ rank: null, isAdmin: true })).toBe(true);
  });
});
