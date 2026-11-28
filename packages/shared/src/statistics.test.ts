import { describe, expect, it } from 'vitest';
import {
  formatMoscowDayShort,
  moscowInclusiveDates,
  moscowMonthBounds,
  moscowWeekLabel,
  resolveStatisticsPeriod,
  statisticsEventMembers,
  statisticsQueryString,
  statisticsQuerySchema,
} from './statistics';

describe('statistics period', () => {
  it('defaults to the current Moscow month even before UTC midnight', () => {
    const period = resolveStatisticsPeriod({}, new Date('2026-02-28T21:30:00Z'));
    expect([period.start.toISOString(), period.end.toISOString()]).toEqual([
      '2026-02-28T21:00:00.000Z',
      '2026-03-31T21:00:00.000Z',
    ]);
  });

  it('default month bounds follow Moscow, not the browser timezone', () => {
    // 30 ноября 23:00 UTC: в Москве уже 1 декабря, в зонах позади UTC — ещё 30 ноября.
    expect(moscowMonthBounds(new Date('2026-11-30T23:00:00Z'))).toEqual({
      from: '2026-12-01',
      to: '2026-12-31',
    });
    // 1 января 01:00 UTC — московский январь уже наступил, год сменился.
    expect(moscowMonthBounds(new Date('2027-01-01T01:00:00Z'))).toEqual({
      from: '2027-01-01',
      to: '2027-01-31',
    });
    // Високосный февраль заканчивается 29-м числом.
    expect(moscowMonthBounds(new Date('2028-02-10T12:00:00Z'))).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    });
  });

  it('query string keeps the contract order and drops empty filters', () => {
    expect(
      statisticsQueryString({
        from: '2026-12-01',
        to: '2026-12-31',
        kpId: 'kp1',
        packId: undefined,
        eventTypeId: undefined,
        mode: undefined,
      }),
    ).toBe('from=2026-12-01&to=2026-12-31&kpId=kp1');
    expect(statisticsQueryString({ from: undefined, to: undefined })).toBe('');
  });

  it('clips Monday-to-Sunday weeks to inclusive date boundaries', () => {
    const period = resolveStatisticsPeriod(
      { from: '2026-11-18', to: '2026-11-24' },
      new Date('2026-11-18T12:00:00Z'),
    );
    expect(period.weeks.map(({ start, end }) => [start.toISOString(), end.toISOString()])).toEqual([
      ['2026-11-17T21:00:00.000Z', '2026-11-22T21:00:00.000Z'],
      ['2026-11-22T21:00:00.000Z', '2026-11-24T21:00:00.000Z'],
    ]);
  });

  it('rejects invalid dates and reversed periods', () => {
    expect(statisticsQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success).toBe(
      false,
    );
    expect(statisticsQuerySchema.safeParse({ from: '2026-03-02', to: '2026-03-01' }).success).toBe(
      false,
    );
  });
});

describe('historical statistics participants', () => {
  it('attributes an earlier event to the direct KP after a transfer to another KP', () => {
    const rows = statisticsEventMembers(
      { scope: 'KP', kpId: 'old-kp', packId: null, startsAt: new Date('2026-01-01T12:00:00Z') },
      [
        {
          id: 'member',
          createdAt: new Date('2025-01-01Z'),
          packId: null,
          directKpId: 'new-kp',
          blockedAt: null,
          packHistory: [
            {
              memberId: 'member',
              previousPackId: null,
              packId: null,
              previousDirectKpId: 'old-kp',
              directKpId: 'new-kp',
              changedAt: new Date('2026-02-01Z'),
            },
          ],
        },
      ],
      [],
      [],
      new Date('2026-03-01Z'),
    );
    expect(rows).toMatchObject([
      { memberId: 'member', packId: null, kpId: 'old-kp', teamStatus: 'KNOWN' },
    ]);
  });

  it('does not substitute current membership when transfer history is absent', () => {
    const rows = statisticsEventMembers(
      { scope: 'GUILD', kpId: null, packId: null, startsAt: new Date('2026-01-01T12:00:00Z') },
      [
        {
          id: 'member',
          createdAt: new Date('2025-01-01Z'),
          packId: 'current',
          blockedAt: null,
          packHistory: [],
        },
      ],
      [{ id: 'current', createdAt: new Date('2025-01-01Z'), kpId: 'kp', membershipHistory: [] }],
      [],
      new Date('2026-03-01Z'),
    );
    expect(rows[0]).toMatchObject({ packId: null, kpId: null, teamStatus: 'NO_HISTORICAL_DATA' });
  });
  it('keeps an unmarked invitee in their old team after transfers', () => {
    const rows = statisticsEventMembers(
      { scope: 'KP', kpId: 'old-kp', packId: null, startsAt: new Date('2026-01-01T12:00:00Z') },
      [
        {
          id: 'member',
          createdAt: new Date('2025-01-01Z'),
          packId: 'new-pack',
          blockedAt: null,
          packHistory: [
            {
              memberId: 'member',
              previousPackId: 'old-pack',
              packId: 'new-pack',
              changedAt: new Date('2026-02-01Z'),
            },
          ],
        },
      ],
      [
        {
          id: 'old-pack',
          createdAt: new Date('2025-01-01Z'),
          kpId: 'new-kp',
          membershipHistory: [
            {
              packId: 'old-pack',
              previousKpId: 'old-kp',
              kpId: 'new-kp',
              changedAt: new Date('2026-02-02Z'),
            },
          ],
        },
      ],
      [],
      new Date('2026-03-01Z'),
    );
    expect(rows).toEqual([
      {
        memberId: 'member',
        packId: 'old-pack',
        kpId: 'old-kp',
        teamStatus: 'KNOWN',
        membershipStatus: 'NO_HISTORICAL_DATA',
        attendanceStatus: null,
        checkinStart: null,
        checkinEnd: null,
      },
    ]);
  });
});

describe('moscowInclusiveDates', () => {
  it('полуоткрытая неделя становится инклюзивными датами Москвы (#249)', () => {
    expect(moscowInclusiveDates('2026-11-30T21:00:00.000Z', '2026-12-07T21:00:00.000Z')).toEqual({
      from: '2026-12-01',
      to: '2026-12-07',
    });
    // Однодневный интервал: обе границы — один и тот же день.
    expect(moscowInclusiveDates('2026-01-01T21:00:00.000Z', '2026-01-02T21:00:00.000Z')).toEqual({
      from: '2026-01-02',
      to: '2026-01-02',
    });
  });
});

describe('moscowWeekLabel', () => {
  it('подписывает фактические даты недели по Москве', () => {
    // Неделя 1–7 декабря: конец полуоткрытый, последняя дата — 7 декабря.
    expect(moscowWeekLabel('2026-11-30T21:00:00.000Z', '2026-12-07T21:00:00.000Z')).toBe(
      '1 дек – 7 дек',
    );
    // Обрезанная границей периода неделя заканчивается 3 января.
    expect(moscowWeekLabel('2026-12-31T21:00:00.000Z', '2027-01-03T21:00:00.000Z')).toBe(
      '1 янв – 3 янв',
    );
  });

  it('однодневная выборка подписывается одной датой', () => {
    expect(moscowWeekLabel('2026-12-05T21:00:00.000Z', '2026-12-06T21:00:00.000Z')).toBe('6 дек');
  });
});

describe('formatMoscowDayShort', () => {
  it('полночь Москвы относится к тому же календарному дню (#254)', () => {
    // 2 января 00:00 МСК = 21:00 UTC предыдущих суток; фиксированный сдвиг
    // не зависит от зоны браузера.
    expect(formatMoscowDayShort('2026-01-01T21:00:00.000Z')).toBe('2 янв');
  });
});
