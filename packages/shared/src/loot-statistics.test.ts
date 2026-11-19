import { describe, expect, it } from 'vitest';
import {
  LOOT_TOP_ITEMS_LIMIT,
  aggregateLootAwards,
  lootAwardMemberRows,
  lootAwardTeamRows,
  lootDroppedItemRows,
  lootDroppedTotals,
  lootSharePercents,
  lootTopRows,
  type LootAwardFact,
  type LootDroppedInput,
} from './loot-statistics';

const drop = (overrides: Partial<LootDroppedInput> = {}): LootDroppedInput => ({
  id: 'drop1',
  occurredAt: '2026-06-04T17:00:00.000Z',
  eventId: 'e1',
  eventName: 'Осада',
  eventStartsAt: '2026-06-04T16:00:00.000Z',
  eventTypeId: 't1',
  eventTypeName: 'Осада',
  mode: 'PVP',
  packId: 'p1',
  kpId: 'k1',
  teamStatus: 'KNOWN',
  lotId: 'a1',
  lotStatus: 'CLOSED',
  itemId: 'i1',
  itemName: 'Меч',
  rarity: 'Легендарный',
  slot: 'Оружие',
  isArchboss: false,
  ...overrides,
});

const award = (overrides: Partial<LootAwardFact> = {}): LootAwardFact => ({
  id: 'aw1',
  memberId: 'm1',
  nickname: 'Игрок',
  itemId: 'i1',
  itemName: 'Меч',
  rarity: 'Легендарный',
  slot: 'Оружие',
  isArchboss: false,
  auctionId: 'a1',
  finalPrice: 30,
  markupPct: 10,
  discountPct: 0,
  occurredAt: '2026-06-05T10:00:00.000Z',
  eventId: 'e1',
  eventName: 'Осада',
  eventStartsAt: '2026-06-04T16:00:00.000Z',
  eventTypeId: 't1',
  eventTypeName: 'Осада',
  mode: 'PVP',
  packId: 'p1',
  kpId: 'k1',
  teamStatus: 'KNOWN',
  ...overrides,
});

describe('loot share percents', () => {
  it('splits exact shares', () => {
    expect(lootSharePercents([5, 3, 2])).toEqual([50, 30, 20]);
  });

  it('keeps the sum exactly 100 by largest remainder', () => {
    // 2/6 = 33.(3) %: полы дают 99, балл — первой строке по порядку.
    expect(lootSharePercents([2, 2, 2])).toEqual([34, 33, 33]);
    // 3 и десять единиц (всего 13): баллы при равных остатках — более ранним строкам.
    const shares = lootSharePercents([3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBe(100);
    expect(shares.slice(0, 3)).toEqual([23, 8, 8]);
    expect(shares.slice(8)).toEqual([7, 7, 7]);
  });

  it('returns nothing for an empty selection', () => {
    expect(lootSharePercents([])).toEqual([]);
  });
});

describe('loot dropped rows', () => {
  it('groups by item, sorts by count and keeps drop details in time order', () => {
    const rows = [
      drop({ id: 'd2', itemId: 'i2', itemName: 'Лук', lotId: null, lotStatus: null }),
      drop({ id: 'd1', occurredAt: '2026-06-04T16:30:00.000Z' }),
      drop({ id: 'd0' }),
    ];
    const items = lootDroppedItemRows(rows);
    expect(items).toHaveLength(2);
    // Меч×2 впереди Лука×1; доли от всех трёх выпадений суммируются в 100.
    expect(items.map((row) => row.itemName)).toEqual(['Меч', 'Лук']);
    expect(items.map((row) => row.count)).toEqual([2, 1]);
    expect(items.map((row) => row.sharePct)).toEqual([67, 33]);
    // Детали — по времени факта выпадения, без полей предмета.
    expect(items[0]!.details.map((row) => row.id)).toEqual(['d1', 'd0']);
    expect(items[0]!.details[0]).toEqual({
      id: 'd1',
      occurredAt: '2026-06-04T16:30:00.000Z',
      eventId: 'e1',
      eventName: 'Осада',
      eventStartsAt: '2026-06-04T16:00:00.000Z',
      eventTypeId: 't1',
      eventTypeName: 'Осада',
      mode: 'PVP',
      packId: 'p1',
      kpId: 'k1',
      teamStatus: 'KNOWN',
      lotId: 'a1',
      lotStatus: 'CLOSED',
    });
    expect(lootDroppedTotals(rows)).toEqual({ drops: 3, items: 2 });
  });

  it('orders equal counts by item name', () => {
    const items = lootDroppedItemRows([
      drop({ itemId: 'i2', itemName: 'Меч' }),
      drop({ itemId: 'i1', itemName: 'Лук' }),
    ]);
    expect(items.map((row) => row.itemName)).toEqual(['Лук', 'Меч']);
  });
});

describe('loot top rows', () => {
  it('passes all items below the limit without a rest row', () => {
    const items = lootDroppedItemRows([
      drop({ itemId: 'i2', itemName: 'Лук' }),
      drop({ itemId: 'i1', itemName: 'Меч' }),
    ]);
    const top = lootTopRows(items);
    expect(top).toEqual([
      expect.objectContaining({ kind: 'ITEM', itemName: 'Лук', count: 1, sharePct: 50 }),
      expect.objectContaining({ kind: 'ITEM', itemName: 'Меч', count: 1, sharePct: 50 }),
    ]);
  });

  it('folds remaining items into a rest row with shares summing to 100', () => {
    const rows = Array.from({ length: LOOT_TOP_ITEMS_LIMIT + 2 }, (_, index) =>
      drop({
        id: `d${index}`,
        itemId: `i${index}`,
        // Убывающие количества дают устойчивый порядок без связок имён.
        itemName: `Предмет ${index}`,
        occurredAt: `2026-06-0${(index % 9) + 1}T16:30:00.000Z`,
      }),
    );
    // Первые семь строк: 3+3+2+2+2+2+2 выпадения — топ обрезается лимитом.
    rows.push(
      drop({ id: 'x1', itemId: 'i0', itemName: 'Предмет 0' }),
      drop({ id: 'x2', itemId: 'i1', itemName: 'Предмет 1' }),
    );
    const items = lootDroppedItemRows(rows);
    const top = lootTopRows(items);
    expect(top).toHaveLength(LOOT_TOP_ITEMS_LIMIT + 1);
    const rest = top[top.length - 1]!;
    expect(rest.kind).toBe('REST');
    // Знаменатель — все выпадения выборки, включая «Остальное».
    expect(rest.count).toBe(
      items.slice(LOOT_TOP_ITEMS_LIMIT).reduce((sum, row) => sum + row.count, 0),
    );
    expect(top.reduce((sum, row) => sum + row.sharePct, 0)).toBe(100);
    expect(top.slice(0, -1).every((row) => row.kind === 'ITEM')).toBe(true);
  });

  it('returns nothing without drops', () => {
    expect(lootTopRows([])).toEqual([]);
  });
});

describe('loot award aggregation', () => {
  it('counts awards and sums actual final prices', () => {
    expect(aggregateLootAwards([{ finalPrice: 30 }, { finalPrice: 5 }])).toEqual({
      awards: 2,
      spent: 35,
    });
    expect(aggregateLootAwards([])).toEqual({ awards: 0, spent: 0 });
  });

  it('groups members by spent and nickname', () => {
    const rows = [
      award({ memberId: 'm1', nickname: 'Альфа', finalPrice: 30 }),
      award({ id: 'aw2', memberId: 'm2', nickname: 'Бета', finalPrice: 50 }),
      award({ id: 'aw3', memberId: 'm1', nickname: 'Альфа', finalPrice: 20 }),
    ];
    expect(lootAwardMemberRows(rows)).toEqual([
      { id: 'm1', nickname: 'Альфа', totals: { awards: 2, spent: 50 } },
      { id: 'm2', nickname: 'Бета', totals: { awards: 1, spent: 50 } },
    ]);
  });

  it('groups teams with a separate null row for unknown attribution', () => {
    const rows = [
      award({ memberId: 'm1', packId: 'p1', kpId: 'k1' }),
      award({
        id: 'aw2',
        memberId: 'm2',
        nickname: 'Бета',
        packId: null,
        kpId: null,
        teamStatus: 'NO_HISTORICAL_DATA',
      }),
    ];
    const names = new Map([
      ['p1', 'Первый пак'],
      ['k1', 'Первый КП'],
    ]);
    expect(lootAwardTeamRows(rows, 'packId', names)).toEqual([
      { id: 'p1', name: 'Первый пак', totals: { awards: 1, spent: 30 } },
      { id: null, name: null, totals: { awards: 1, spent: 30 } },
    ]);
    expect(lootAwardTeamRows(rows, 'kpId', names)).toEqual([
      { id: 'k1', name: 'Первый КП', totals: { awards: 1, spent: 30 } },
      { id: null, name: null, totals: { awards: 1, spent: 30 } },
    ]);
  });
});
