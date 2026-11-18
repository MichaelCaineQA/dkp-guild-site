import { describe, expect, it } from 'vitest';
import {
  resolveStatisticsPeriod,
  statisticsEventMembers,
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
