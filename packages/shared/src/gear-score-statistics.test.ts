import { describe, expect, it } from 'vitest';
import {
  gearScoreFreshnessAt,
  gearScoreFreshnessTotals,
  gearScoreSnapshotAsOf,
  gearScoreSnapshotRows,
  type GearScoreMemberRow,
  type GearScoreSnapshotMember,
  type GearScoreSnapshotRecord,
  type StatisticsHistoricalPack,
} from './gear-score-statistics';

const DAY = 86_400_000;

const record = (createdAt: Date, screenshots = 1): GearScoreSnapshotRecord => ({
  createdAt,
  screenshotIds: Array.from({ length: screenshots }, (_, i) => `s-${i}-${createdAt.getTime()}`),
});

describe('gearScoreSnapshotAsOf', () => {
  it('прошлый период — на конец периода', () => {
    const end = new Date('2026-06-30T21:00:00Z');
    const now = new Date('2026-11-19T10:00:00Z');
    expect(gearScoreSnapshotAsOf({ end }, now)).toBe(end);
  });

  it('текущий период — на момент формирования отчёта', () => {
    const end = new Date('2026-12-31T21:00:00Z');
    const now = new Date('2026-11-19T10:00:00Z');
    expect(gearScoreSnapshotAsOf({ end }, now)).toBe(now);
  });
});

describe('gearScoreFreshnessAt', () => {
  const asOf = new Date('2026-06-30T21:00:00Z');

  it('возраст ровно в порог — актуальный, на миллисекунду старше — устаревший', () => {
    const staleDays = 14;
    const exact = gearScoreFreshnessAt(
      [record(new Date(asOf.getTime() - staleDays * DAY))],
      staleDays,
      asOf,
    );
    expect(exact.freshness).toBe('FRESH');
    expect(exact.lastScreenshotAt).toEqual(new Date(asOf.getTime() - staleDays * DAY));
    const older = gearScoreFreshnessAt(
      [record(new Date(asOf.getTime() - staleDays * DAY - 1))],
      staleDays,
      asOf,
    );
    expect(older.freshness).toBe('STALE');
    expect(older.lastScreenshotAt).toEqual(new Date(asOf.getTime() - staleDays * DAY - 1));
  });

  it('без записи со скрином — отсутствующий, запись без скрина не считается', () => {
    expect(gearScoreFreshnessAt([], 14, asOf)).toEqual({
      freshness: 'MISSING',
      lastScreenshotAt: null,
    });
    expect(gearScoreFreshnessAt([record(asOf, 0)], 14, asOf)).toEqual({
      freshness: 'MISSING',
      lastScreenshotAt: null,
    });
  });

  it('берётся последняя запись со скрином, записи без скрина её не заменяют', () => {
    const withShot = new Date(asOf.getTime() - 20 * DAY);
    const withoutShot = new Date(asOf.getTime() - DAY);
    const result = gearScoreFreshnessAt([record(withShot), record(withoutShot, 0)], 14, asOf);
    expect(result).toEqual({ freshness: 'STALE', lastScreenshotAt: withShot });
  });

  it('загрузка после среза прошлый отчёт не меняет', () => {
    const before = new Date(asOf.getTime() - 2 * DAY);
    const after = new Date(asOf.getTime() + DAY);
    const result = gearScoreFreshnessAt([record(before), record(after)], 14, asOf);
    expect(result).toEqual({ freshness: 'FRESH', lastScreenshotAt: before });
  });
});

describe('gearScoreSnapshotRows', () => {
  const packA = 'pack-a';
  const packB = 'pack-b';
  const kp1 = 'kp-1';
  const kp2 = 'kp-2';
  const packs: StatisticsHistoricalPack[] = [
    {
      id: packA,
      createdAt: new Date('2025-01-01T00:00:00Z'),
      kpId: kp1,
      membershipHistory: [
        {
          packId: packA,
          previousKpId: kp1,
          kpId: kp1,
          changedAt: new Date('2025-06-01T00:00:00Z'),
        },
      ],
    },
    {
      id: packB,
      createdAt: new Date('2025-01-01T00:00:00Z'),
      kpId: kp2,
      membershipHistory: [
        {
          packId: packB,
          previousKpId: kp2,
          kpId: kp2,
          changedAt: new Date('2025-06-01T00:00:00Z'),
        },
      ],
    },
  ];
  const kps = [
    { id: kp1, createdAt: new Date('2025-01-01T00:00:00Z') },
    { id: kp2, createdAt: new Date('2025-01-01T00:00:00Z') },
  ];
  const member = (overrides: Partial<GearScoreSnapshotMember>): GearScoreSnapshotMember => ({
    id: 'm1',
    nickname: 'Игрок',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    blockedAt: null,
    packId: packA,
    packHistory: [
      {
        memberId: 'm1',
        previousPackId: packA,
        packId: packA,
        changedAt: new Date('2025-06-01T00:00:00Z'),
      },
    ],
    ...overrides,
  });

  it('исторический перевод: на срезе участник в прежнем паке', () => {
    const asOf = new Date('2026-06-30T21:00:00Z');
    const moved = member({
      packId: packB,
      packHistory: [
        {
          memberId: 'm1',
          previousPackId: packA,
          packId: packA,
          changedAt: new Date('2025-06-01T00:00:00Z'),
        },
        {
          memberId: 'm1',
          previousPackId: packA,
          packId: packB,
          changedAt: new Date('2026-08-01T00:00:00Z'),
        },
      ],
    });
    const rows = gearScoreSnapshotRows(
      [moved],
      packs,
      new Map(),
      14,
      asOf,
      new Date('2026-11-19T10:00:00Z'),
      kps,
    );
    expect(rows[0]).toMatchObject({ packId: packA, kpId: kp1, teamStatus: 'KNOWN' });
  });

  it('без истории переносов прошлый состав неизвестен, текущий не подставляется', () => {
    const asOf = new Date('2026-06-30T21:00:00Z');
    const noHistory = member({
      packId: packB,
      packHistory: [],
    });
    const rows = gearScoreSnapshotRows(
      [noHistory],
      packs,
      new Map(),
      14,
      asOf,
      new Date('2026-11-19T10:00:00Z'),
      kps,
    );
    expect(rows[0]).toMatchObject({
      packId: null,
      kpId: null,
      teamStatus: 'NO_HISTORICAL_DATA',
      membershipStatus: 'NO_HISTORICAL_DATA',
      freshness: 'MISSING',
    });
  });

  it('текущий срез: состав известен, заблокированные и будущие участники скрыты', () => {
    const now = new Date('2026-11-19T10:00:00Z');
    const rows = gearScoreSnapshotRows(
      [
        member({}),
        member({ id: 'm2', nickname: 'Ушедший', blockedAt: new Date('2026-10-01T00:00:00Z') }),
        member({ id: 'm3', nickname: 'Новый', createdAt: new Date('2026-11-20T00:00:00Z') }),
      ],
      packs,
      new Map(),
      14,
      now,
      now,
      kps,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      memberId: 'm1',
      packId: packA,
      kpId: kp1,
      teamStatus: 'KNOWN',
      membershipStatus: 'KNOWN',
    });
  });

  it('прошлый срез: заблокированный сейчас участник остаётся с пометкой о составе', () => {
    const asOf = new Date('2026-06-30T21:00:00Z');
    const blockedNow = member({ blockedAt: new Date('2026-10-01T00:00:00Z') });
    const rows = gearScoreSnapshotRows(
      [blockedNow],
      packs,
      new Map(),
      14,
      asOf,
      new Date('2026-11-19T10:00:00Z'),
      kps,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      packId: packA,
      kpId: kp1,
      teamStatus: 'KNOWN',
      membershipStatus: 'NO_HISTORICAL_DATA',
    });
  });

  it('строки сортируются по нику и категория берётся из записей участника', () => {
    const asOf = new Date('2026-06-30T21:00:00Z');
    const records = new Map<string, GearScoreSnapshotRecord[]>([
      ['m1', [record(new Date(asOf.getTime() - 30 * DAY))]],
    ]);
    const rows = gearScoreSnapshotRows(
      [member({}), member({ id: 'm2', nickname: 'ААА' })],
      packs,
      records,
      14,
      asOf,
      new Date('2026-11-19T10:00:00Z'),
      kps,
    );
    expect(rows.map((row) => row.nickname)).toEqual(['ААА', 'Игрок']);
    expect(rows.find((row) => row.memberId === 'm1')).toMatchObject({ freshness: 'STALE' });
    expect(rows.find((row) => row.memberId === 'm2')).toMatchObject({
      freshness: 'MISSING',
      lastScreenshotAt: null,
    });
  });
});

describe('gearScoreFreshnessTotals', () => {
  const row = (freshness: GearScoreMemberRow['freshness']): GearScoreMemberRow => ({
    memberId: freshness,
    nickname: freshness,
    packId: null,
    kpId: null,
    teamStatus: 'NO_HISTORICAL_DATA',
    membershipStatus: 'NO_HISTORICAL_DATA',
    freshness,
    lastScreenshotAt: null,
  });

  it('считает категории и целую долю устаревших от всей выборки', () => {
    expect(gearScoreFreshnessTotals([row('FRESH'), row('STALE'), row('MISSING')])).toEqual({
      members: 3,
      fresh: 1,
      stale: 1,
      missing: 1,
      staleSharePct: 33,
    });
    expect(gearScoreFreshnessTotals([row('STALE'), row('STALE'), row('FRESH')])).toEqual({
      members: 3,
      fresh: 1,
      stale: 2,
      missing: 0,
      staleSharePct: 67,
    });
  });

  it('пустая выборка — доля null', () => {
    expect(gearScoreFreshnessTotals([])).toEqual({
      members: 0,
      fresh: 0,
      stale: 0,
      missing: 0,
      staleSharePct: null,
    });
  });
});
