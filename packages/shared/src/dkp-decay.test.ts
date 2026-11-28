import { expect, it } from 'vitest';
import { dkpDecayAmount } from './dkp';
import { moscowWeekBounds } from './statistics';
import { aggregateDkpTotals } from './dkp-statistics';

it.each([
  [19n, 10, 1n],
  [9n, 10, 0n],
  [-19n, 10, 0n],
  [0n, 100, 0n],
  [19n, 0, 0n],
  [19n, 100, 19n],
] as const)('сгорание с баланса %s при ставке %s%% даёт %s ДКП', (balance, percent, expected) => {
  expect(dkpDecayAmount(balance, percent)).toBe(expected);
});

it.each([
  ['2026-11-29T20:59:59.999Z', '2026-11-22T21:00:00.000Z', '2026-11-29T21:00:00.000Z'],
  ['2026-11-29T21:00:00.000Z', '2026-11-29T21:00:00.000Z', '2026-12-06T21:00:00.000Z'],
])('момент %s относится к московской неделе с началом %s', (now, start, end) => {
  expect(moscowWeekBounds(new Date(now))).toEqual({ start: new Date(start), end: new Date(end) });
});

it('учитывает сгорание в общем движении ДКП отдельно от ручных корректировок', () => {
  expect(aggregateDkpTotals([{ type: 'WEEKLY_DECAY', amount: -5 }])).toEqual({
    earned: 0,
    spent: 0,
    adjustments: 0,
    decayed: -5,
    net: -5,
  });
});
