import { describe, expect, it } from 'vitest';
import {
  activityMemberRows,
  activityModeRows,
  activityParticipationResult,
  activityPeak,
  activityTypeRows,
  activityWeeks,
  aggregateActivity,
  moscowHour,
  moscowWeekdayIndex,
  type ActivityParticipation,
} from './activity-statistics';

const participation = (
  overrides: Partial<ActivityParticipation> = {},
): ActivityParticipation => ({
  eventId: 'e1',
  eventName: 'Ивент',
  startsAt: '2026-03-08T20:30:00.000Z',
  eventTypeId: 't1',
  eventTypeName: 'Гильдбосс',
  mode: 'PVE',
  scope: 'GUILD',
  memberId: 'm1',
  nickname: 'Игрок',
  packId: 'p1',
  kpId: 'k1',
  teamStatus: 'KNOWN',
  membershipStatus: 'KNOWN',
  status: 'LEFT_EARLY',
  checks: 1,
  counted: 1,
  visited: true,
  ...overrides,
});

describe('activity participation result', () => {
  it('counts a single accepted phase as one visited event', () => {
    expect(
      activityParticipationResult({ checkinStart: 'PASSED', checkinEnd: null, excused: false }),
    ).toMatchObject({ checks: 1, counted: 1, visited: true });
  });

  it('does not double the visit for two accepted phases', () => {
    const result = activityParticipationResult({
      checkinStart: 'PASSED',
      checkinEnd: 'PASSED',
      excused: false,
    });
    expect(result).toMatchObject({ checks: 2, counted: 1, visited: true });
    expect(aggregateActivity([participation({ ...result })]).visited).toBe(1);
  });

  it('treats a manual mark like an accepted code', () => {
    expect(
      activityParticipationResult({ checkinStart: 'MANUAL', checkinEnd: null, excused: false }),
    ).toMatchObject({ checks: 1, counted: 1, visited: true, status: 'LEFT_EARLY' });
  });

  it('keeps an excused absence out of the denominator and the visits', () => {
    expect(
      activityParticipationResult({ checkinStart: null, checkinEnd: null, excused: true }),
    ).toMatchObject({ checks: 0, counted: 0, visited: false });
  });
});

describe('Moscow day and week boundaries', () => {
  it('moves 21:00 UTC Sunday to Monday hour zero in Moscow', () => {
    expect(moscowWeekdayIndex('2026-03-08T20:59:59.000Z')).toBe(6);
    expect(moscowHour('2026-03-08T20:59:59.000Z')).toBe(23);
    expect(moscowWeekdayIndex('2026-03-08T21:00:00.000Z')).toBe(0);
    expect(moscowHour('2026-03-08T21:00:00.000Z')).toBe(0);
  });

  it('splits weekly totals at Moscow midnight and converges with the total', () => {
    // Недели пн–вс по Москве: 2–9 и 9–16 марта 2026.
    const weeks = [
      { start: new Date('2026-03-01T21:00:00.000Z'), end: new Date('2026-03-08T21:00:00.000Z') },
      { start: new Date('2026-03-08T21:00:00.000Z'), end: new Date('2026-03-15T21:00:00.000Z') },
    ];
    const rows = [
      participation({ eventId: 'sunday', startsAt: '2026-03-08T20:30:00.000Z' }),
      participation({
        eventId: 'monday',
        startsAt: '2026-03-08T21:30:00.000Z',
        checks: 2,
        status: 'PRESENT',
      }),
    ];
    const weekRows = activityWeeks(weeks, rows);
    expect(weekRows[0]!.totals).toMatchObject({ events: 1, visited: 1, checks: 1 });
    expect(weekRows[1]!.totals).toMatchObject({ events: 1, visited: 1, checks: 2 });
    const total = aggregateActivity(rows);
    for (const key of ['events', 'visited', 'checks', 'counted'] as const) {
      expect(weekRows.reduce((sum, week) => sum + week.totals[key], 0)).toBe(total[key]);
    }
  });
});

describe('activity aggregates', () => {
  it('does not multiply distinct events across participants', () => {
    const totals = aggregateActivity([
      participation({ memberId: 'm1', checks: 2, status: 'PRESENT' }),
      participation({ memberId: 'm2', nickname: 'Второй', checks: 1 }),
    ]);
    expect(totals).toMatchObject({ events: 1, visited: 2, checks: 3, counted: 2 });
    expect(totals.attendance).toBe(75);
  });

  it('distinguishes zero activity from no data', () => {
    const totals = aggregateActivity([]);
    expect(totals).toMatchObject({
      events: 0,
      visited: 0,
      checks: 0,
      counted: 0,
      attendance: null,
      historyStatus: 'KNOWN',
    });
    expect(aggregateActivity([participation({ checks: 0, visited: false })]).attendance).toBe(0);
  });

  it('always returns both modes with explicit zeros', () => {
    const rows = activityModeRows([participation({ mode: 'PVE' })]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ mode: 'PVE', totals: { events: 1, visited: 1 } });
    expect(rows[1]).toMatchObject({
      mode: 'PVP',
      totals: { events: 0, visited: 0, checks: 0, attendance: null },
    });
  });

  it('groups type rows by event type with the same aggregates', () => {
    const rows = activityTypeRows([
      participation({ eventTypeId: 't1', eventTypeName: 'Гильдбосс' }),
      participation({ eventTypeId: 't1', eventTypeName: 'Гильдбосс', memberId: 'm2' }),
      participation({
        eventTypeId: 't2',
        eventTypeName: 'Осада',
        mode: 'PVP',
        checks: 0,
        visited: false,
        status: 'NO_SHOW',
      }),
    ]);
    expect(rows.map((row) => row.name)).toEqual(['Гильдбосс', 'Осада']);
    expect(rows[0]!.totals).toMatchObject({ events: 1, visited: 2, checks: 2 });
    expect(rows[1]!.totals).toMatchObject({ events: 1, visited: 0, attendance: 0 });
  });

  it('buckets the peak into all 7 weekdays and 24 hours of Moscow time', () => {
    const peak = activityPeak([
      participation({ startsAt: '2026-03-08T20:30:00.000Z' }),
      participation({ memberId: 'm2', startsAt: '2026-03-08T20:30:00.000Z' }),
      participation({ eventId: 'no-visit', startsAt: '2026-03-05T16:00:00.000Z', checks: 0, visited: false }),
      participation({ eventId: 'monday', startsAt: '2026-03-08T21:30:00.000Z', checks: 2, status: 'PRESENT' }),
    ]);
    expect(peak.byWeekday).toHaveLength(7);
    expect(peak.byHour).toHaveLength(24);
    expect(peak.byWeekday[6]).toEqual({ weekday: 6, visited: 2 });
    expect(peak.byWeekday[0]).toEqual({ weekday: 0, visited: 1 });
    expect(peak.byHour[23]!.visited).toBe(2);
    expect(peak.byHour[0]!.visited).toBe(1);
    expect(peak.byWeekday.reduce((sum, bucket) => sum + bucket.visited, 0)).toBe(3);
    expect(peak.byHour.reduce((sum, bucket) => sum + bucket.visited, 0)).toBe(3);
  });

  it('keeps historical teams in member details and splits types', () => {
    const [row] = activityMemberRows([
      participation({
        eventId: 'old',
        startsAt: '2026-03-05T16:00:00.000Z',
        packId: 'old-pack',
        kpId: 'old-kp',
        eventTypeId: 't1',
      }),
      participation({ eventId: 'new', packId: 'new-pack', kpId: 'new-kp', eventTypeId: 't2' }),
    ]);
    expect(row!.details.map((detail) => detail.packId)).toEqual(['old-pack', 'new-pack']);
    expect(row!.details.map((detail) => detail.kpId)).toEqual(['old-kp', 'new-kp']);
    expect(row!.byType.map((type) => type.eventTypeId)).toEqual(['t1', 't2']);
    expect(row!.totals).toMatchObject({ events: 2, visited: 2, checks: 2 });
  });

  it('sorts members by visits, then checks, then nickname', () => {
    const rows = activityMemberRows([
      participation({ memberId: 'a', nickname: 'Яна', checks: 0, visited: false }),
      participation({ memberId: 'b', nickname: 'Борис', checks: 2, status: 'PRESENT' }),
      participation({ memberId: 'c', nickname: 'Аня', checks: 2, status: 'PRESENT' }),
    ]);
    expect(rows.map((row) => row.nickname)).toEqual(['Аня', 'Борис', 'Яна']);
  });
});
