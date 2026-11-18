import { describe, expect, it } from 'vitest';
import {
  aggregateDkpTotals,
  dkpMemberRows,
  dkpTeamRows,
  dkpWeekRows,
  dkpWithoutEventRows,
  type DkpMovement,
} from './dkp-statistics';

const movement = (overrides: Partial<DkpMovement> = {}): DkpMovement => ({
  id: 'd1',
  memberId: 'm1',
  nickname: 'Игрок',
  type: 'CHECKIN_EARN',
  amount: 10,
  occurredAt: '2026-06-04T18:00:00.000Z',
  comment: null,
  eventId: 'e1',
  eventName: 'Ивент',
  startsAt: '2026-06-04T16:00:00.000Z',
  eventTypeId: 't1',
  eventTypeName: 'Рейд',
  mode: 'PVE',
  auctionId: null,
  auctionItemName: null,
  packId: 'p1',
  kpId: 'k1',
  teamStatus: 'KNOWN',
  ...overrides,
});

describe('dkp totals', () => {
  it('splits earnings, auction spends and signed adjustments', () => {
    expect(
      aggregateDkpTotals([
        { type: 'CHECKIN_EARN', amount: 10 },
        { type: 'MANUAL_EARN', amount: 5 },
        { type: 'AUCTION_SPEND', amount: -30 },
        { type: 'ADJUSTMENT', amount: -7 },
        { type: 'ADJUSTMENT', amount: 4 },
      ]),
    ).toEqual({ earned: 15, spent: -30, adjustments: -3, net: -18 });
  });

  it('keeps a positive adjustment out of the earnings', () => {
    expect(aggregateDkpTotals([{ type: 'ADJUSTMENT', amount: 100 }])).toEqual({
      earned: 0,
      spent: 0,
      adjustments: 100,
      net: 100,
    });
  });

  it('returns explicit zeros for an empty selection', () => {
    expect(aggregateDkpTotals([])).toEqual({ earned: 0, spent: 0, adjustments: 0, net: 0 });
  });
});

describe('dkp weeks', () => {
  it('buckets movements by journal record time and converges with the total', () => {
    // Недели пн–вс по Москве: 1–8 и 8–15 июня 2026.
    const weeks = [
      { start: new Date('2026-05-31T21:00:00.000Z'), end: new Date('2026-06-07T21:00:00.000Z') },
      { start: new Date('2026-06-07T21:00:00.000Z'), end: new Date('2026-06-14T21:00:00.000Z') },
    ];
    const rows = [
      movement({ id: 'd1', amount: 10, occurredAt: '2026-06-04T18:00:00.000Z' }),
      movement({ id: 'd2', type: 'ADJUSTMENT', amount: -3, occurredAt: '2026-06-09T12:00:00.000Z' }),
    ];
    const weekRows = dkpWeekRows(weeks, rows);
    expect(weekRows.map((week) => week.totals.net)).toEqual([10, -3]);
    expect(weekRows.reduce((sum, week) => sum + week.totals.net, 0)).toBe(
      aggregateDkpTotals(rows).net,
    );
  });
});

describe('dkp member rows', () => {
  it('groups by member, sorts by earnings and keeps the full-history balance', () => {
    const rows = [
      movement({ id: 'd2', memberId: 'm2', nickname: 'Бета', amount: 5 }),
      movement({ id: 'd1', memberId: 'm1', nickname: 'Альфа', amount: 10 }),
      movement({
        id: 'd3',
        memberId: 'm1',
        nickname: 'Альфа',
        type: 'AUCTION_SPEND',
        amount: -4,
        occurredAt: '2026-06-05T10:00:00.000Z',
      }),
    ];
    const balances = new Map([
      ['m1', 100],
      ['m2', -2],
    ]);
    expect(dkpMemberRows(rows, balances)).toEqual([
      {
        id: 'm1',
        nickname: 'Альфа',
        totals: { earned: 10, spent: -4, adjustments: 0, net: 6 },
        balance: 100,
        // Раскрытие сортируется по времени записи журнала.
        details: [rows[1], rows[2]],
      },
      {
        id: 'm2',
        nickname: 'Бета',
        totals: { earned: 5, spent: 0, adjustments: 0, net: 5 },
        balance: -2,
        details: [rows[0]],
      },
    ]);
  });

  it('sorts equal earnings by nickname for a stable order', () => {
    const rows = [
      movement({ memberId: 'm2', nickname: 'Бета' }),
      movement({ memberId: 'm1', nickname: 'Альфа' }),
    ];
    expect(dkpMemberRows(rows, new Map()).map((row) => row.nickname)).toEqual(['Альфа', 'Бета']);
  });
});

describe('dkp team rows', () => {
  it('groups by historical pack of the event and separates unknown attribution', () => {
    const rows = [
      movement({ id: 'd1', packId: 'p1', kpId: 'k1', teamStatus: 'KNOWN' }),
      movement({
        id: 'd2',
        memberId: 'm2',
        nickname: 'Бета',
        type: 'ADJUSTMENT',
        amount: -3,
        packId: null,
        kpId: null,
        teamStatus: 'NO_HISTORICAL_DATA',
      }),
    ];
    const names = new Map([['p1', 'Первый пак']]);
    expect(dkpTeamRows(rows, 'packId', names)).toEqual([
      {
        id: 'p1',
        name: 'Первый пак',
        totals: { earned: 10, spent: 0, adjustments: 0, net: 10 },
        details: [rows[0]],
      },
      {
        // Недостаточная история и «Без пака» — отдельная строка null.
        id: null,
        name: null,
        totals: { earned: 0, spent: 0, adjustments: -3, net: -3 },
        details: [rows[1]],
      },
    ]);
    expect(dkpTeamRows(rows, 'kpId', new Map([['k1', 'Первый КП']]))).toEqual([
      {
        id: 'k1',
        name: 'Первый КП',
        totals: { earned: 10, spent: 0, adjustments: 0, net: 10 },
        details: [rows[0]],
      },
      { id: null, name: null, totals: { earned: 0, spent: 0, adjustments: -3, net: -3 }, details: [rows[1]] },
    ]);
  });
});

describe('dkp without event', () => {
  it('keeps own totals and member drill-down separate', () => {
    const rows = [
      movement({
        id: 'd1',
        type: 'MANUAL_EARN',
        amount: 50,
        eventId: null,
        eventName: null,
        startsAt: null,
        eventTypeId: null,
        eventTypeName: null,
        mode: null,
        packId: null,
        kpId: null,
        teamStatus: 'NO_HISTORICAL_DATA',
        comment: 'Админ-начисление',
      }),
      movement({
        id: 'd2',
        memberId: 'm1',
        type: 'AUCTION_SPEND',
        amount: -20,
        occurredAt: '2026-06-10T09:00:00.000Z',
        eventId: null,
        eventName: null,
        startsAt: null,
        eventTypeId: null,
        eventTypeName: null,
        mode: null,
        packId: null,
        kpId: null,
        teamStatus: 'NO_HISTORICAL_DATA',
        auctionId: 'a1',
        auctionItemName: 'Меч',
      }),
    ];
    const result = dkpWithoutEventRows(rows);
    expect(result.totals).toEqual({ earned: 50, spent: -20, adjustments: 0, net: 30 });
    expect(result.members).toHaveLength(1);
    expect(result.members[0]).toEqual({
      id: 'm1',
      nickname: 'Игрок',
      totals: { earned: 50, spent: -20, adjustments: 0, net: 30 },
      details: rows,
    });
  });
});
