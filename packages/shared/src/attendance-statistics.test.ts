import { describe, expect, it } from 'vitest';
import {
  aggregateAttendance,
  attendancePercentage,
  attendanceStatisticsResult,
  type AttendanceDetail,
} from './attendance-statistics';

const detail = (overrides: Partial<AttendanceDetail> = {}): AttendanceDetail => ({
  eventId: 'e',
  eventName: 'Ивент',
  startsAt: '2026-01-01T00:00:00.000Z',
  memberId: 'm',
  nickname: 'Игрок',
  packId: 'p',
  kpId: 'k',
  teamStatus: 'KNOWN',
  membershipStatus: 'KNOWN',
  checkinStart: 'PASSED',
  checkinEnd: null,
  status: 'LEFT_EARLY',
  checks: 1,
  events: 1,
  ...overrides,
});

describe('attendance statistics', () => {
  it('calculates twelve checks over eight eligible events as 75 percent', () => {
    expect(attendancePercentage(12, 8)).toBe(75);
  });

  it('excludes two excused events from ten when calculating twelve checks', () => {
    const present = detail({ checks: 2, status: 'PRESENT' });
    const absent = detail({ checks: 0, status: 'NO_SHOW' });
    const excused = detail({ checks: 0, events: 0, status: 'EXCUSED_ABSENCE' });
    expect(
      aggregateAttendance([
        present,
        { ...present, eventId: '2' },
        { ...present, eventId: '3' },
        { ...present, eventId: '4' },
        { ...present, eventId: '5' },
        { ...present, eventId: '6' },
        { ...absent, eventId: '7' },
        { ...absent, eventId: '8' },
        { ...excused, eventId: '9' },
        { ...excused, eventId: '10' },
      ]),
    ).toMatchObject({ checks: 12, events: 8, excused: 2, percentage: 75 });
  });

  it('counts one accepted phase as half an event', () => {
    const result = attendanceStatisticsResult({
      checkinStart: 'PASSED',
      checkinEnd: 'PENDING',
      excused: false,
    });
    expect(attendancePercentage(result.checks, result.events)).toBe(50);
  });

  it('counts manual phases as accepted', () => {
    expect(
      attendanceStatisticsResult({ checkinStart: 'MANUAL', checkinEnd: 'MANUAL', excused: false }),
    ).toMatchObject({ checks: 2, events: 1 });
  });

  it('excludes an excused absence without accepted phases', () => {
    expect(
      attendanceStatisticsResult({ checkinStart: null, checkinEnd: null, excused: true }),
    ).toMatchObject({ checks: 0, events: 0, status: 'EXCUSED_ABSENCE' });
  });

  it('counts actual checks even when an absence was filed', () => {
    expect(
      attendanceStatisticsResult({ checkinStart: 'PASSED', checkinEnd: null, excused: true }),
    ).toMatchObject({ checks: 1, events: 1, status: 'LEFT_EARLY' });
  });

  it('reports no percentage when there are no eligible events', () => {
    expect(attendancePercentage(0, 0)).toBeNull();
  });

  it('adds participant-event counts rather than averaging percentages', () => {
    expect(
      aggregateAttendance([
        detail(),
        detail({ memberId: 'other', checks: 2 }),
        detail({ eventId: 'other-event', memberId: 'other', checks: 0, status: 'NO_SHOW' }),
      ]),
    ).toMatchObject({ checks: 3, events: 3, percentage: 50, noShow: 1, leftEarly: 2 });
  });

  it('marks aggregates whose participant history is unknown', () => {
    expect(
      aggregateAttendance([detail({ membershipStatus: 'NO_HISTORICAL_DATA' })]).historyStatus,
    ).toBe('NO_HISTORICAL_DATA');
  });

  it('counts no checks as zero percent when an event is eligible', () => {
    expect(attendancePercentage(0, 1)).toBe(0);
  });

  it('counts a repeated participant and event only once', () => {
    expect(aggregateAttendance([detail(), detail()])).toMatchObject({ checks: 1, events: 1 });
  });
});
