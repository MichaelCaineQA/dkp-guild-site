import type { ItemTargetRole } from '@dkp/shared';
import { AuctionsService, type AuctionsDb } from './auctions.service';

interface LotSeed {
  id: string;
  status?: string;
  endsAt?: Date | null;
  createdAt?: Date;
  itemName?: string;
  rarity?: string | null;
  targetRoles?: ItemTargetRole[];
  bids?: Array<{ memberId: string; nickname: string; amount: number; fullCost?: number }>;
  award?: { winnerId: string; nickname: string; finalPrice: number } | null;
}

function makeDb(lots: LotSeed[]): AuctionsDb & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    auction: {
      findMany: async ({ where, orderBy }) => {
        queries.push(JSON.stringify({ where, orderBy }));
        const matched = lots.filter((lot) => (lot.status ?? 'OPEN') === where.status);
        // применяем orderBy как настоящая БД (иначе тесты врут о порядке)
        if (JSON.stringify(orderBy).includes('"createdAt":"desc"')) {
          matched.sort(
            (a, b) =>
              (b.createdAt ?? new Date('2026-11-10T17:00:00Z')).getTime() -
              (a.createdAt ?? new Date('2026-11-10T17:00:00Z')).getTime(),
          );
        } else {
          matched.sort((a, b) => {
            const ae = a.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
            const be = b.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
            return ae - be;
          });
        }
        return matched
          .map((lot) => ({
            id: lot.id,
            status: lot.status ?? 'OPEN',
            startPrice: 100,
            step: 5,
            timerFromFirstBid: true,
            durationSec: 90,
            antiSnipeSec: 30,
            antiSnipeExtendSec: 30,
            noBidTimeoutSec: 120,
            markupPct: 50,
            firstBidAt: lot.bids?.length ? new Date('2026-11-10T18:00:00Z') : null,
            endsAt: lot.endsAt ?? null,
            createdAt: lot.createdAt ?? new Date('2026-11-10T17:00:00Z'),
            lootDrop: {
              item: {
                name: lot.itemName ?? 'Предмет',
                rarity: lot.rarity ?? null,
                targetRoles: lot.targetRoles ?? (['ALL'] as ItemTargetRole[]),
              },
            },
            bids: (lot.bids ?? []).map((bid, index) => ({
              id: `${lot.id}-b${index + 1}`,
              memberId: bid.memberId,
              amount: bid.amount,
              fullCost: bid.fullCost ?? bid.amount,
              member: { nickname: bid.nickname },
            })),
            award: lot.award
              ? {
                  winnerId: lot.award.winnerId,
                  finalPrice: lot.award.finalPrice,
                  markupPct: 0,
                  winner: { nickname: lot.award.nickname },
                }
              : null,
          }));
      },
    },
  } as AuctionsDb & { queries: string[] };
}

describe('AuctionsService (issue #98)', () => {
  it('открытые лоты: ведущая ставка, моя ставка и лидирую ли я', async () => {
    const db = makeDb([
      {
        id: 'a-1',
        endsAt: new Date('2026-11-10T18:01:30Z'),
        bids: [
          { memberId: 'm-1', nickname: 'Воин', amount: 100 },
          { memberId: 'm-2', nickname: 'Целитель', amount: 150, fullCost: 225 },
        ],
      },
    ]);
    const rows = await new AuctionsService(db).list('OPEN', 'm-1');

    expect(rows).toHaveLength(1);
    expect(rows[0]!.topBid).toMatchObject({ memberName: 'Целитель', amount: 150, fullCost: 225 });
    expect(rows[0]!.myBid).toEqual({ amount: 100, leading: false });
    // та же ставка максимальная у автора — leading: true
    const mineLead = await new AuctionsService(makeDb([
      { id: 'a-1', bids: [{ memberId: 'm-1', nickname: 'Воин', amount: 100 }] },
    ])).list('OPEN', 'm-1');
    expect(mineLead[0]!.myBid).toEqual({ amount: 100, leading: true });
  });

  it('без ставок просматривающего myBid=null; без входа — тоже', async () => {
    const rows = await new AuctionsService(
      makeDb([{ id: 'a-1', bids: [{ memberId: 'm-2', nickname: 'Хил', amount: 10 }] }]),
    ).list('OPEN', null);
    expect(rows[0]!.myBid).toBeNull();
  });

  it('завершённый лот несёт победителя, архив сортируется свежими сверху', async () => {
    const db = makeDb([
      { id: 'old', status: 'CLOSED', createdAt: new Date('2026-11-09T10:00:00Z'), award: { winnerId: 'm-2', nickname: 'Хил', finalPrice: 300 } },
      { id: 'new', status: 'CLOSED', createdAt: new Date('2026-11-10T10:00:00Z') },
    ]);
    const rows = await new AuctionsService(db).list('CLOSED', 'm-2');
    expect(rows.map((row) => row.id)).toEqual(['new', 'old']);
    expect(rows[1]!.winner).toMatchObject({ memberName: 'Хил', finalPrice: 300 });
    expect(db.queries[0]).toContain('"createdAt":"desc"');
  });

  it('виджет «Мой аукцион»: открытый лот с ближайшим окончанием среди моих ставок', async () => {
    const db = makeDb([
      {
        id: 'a-first',
        endsAt: new Date('2026-11-10T18:05:00Z'),
        itemName: 'Клинок',
        bids: [{ memberId: 'm-1', nickname: 'Воин', amount: 100 }],
      },
      {
        id: 'a-mine-later',
        endsAt: new Date('2026-11-10T19:00:00Z'),
        bids: [{ memberId: 'm-1', nickname: 'Воин', amount: 50 }],
      },
      {
        id: 'a-not-mine',
        endsAt: new Date('2026-11-10T18:01:00Z'),
        bids: [{ memberId: 'm-9', nickname: 'Чужой', amount: 500 }],
      },
    ]);
    const widget = await new AuctionsService(db).myNearestBidLot('m-1');
    expect(widget).toMatchObject({
      lotId: 'a-first',
      itemName: 'Клинок',
      status: 'OPEN',
      endsAt: '2026-11-10T18:05:00.000Z',
      topBid: { amount: 100, memberName: 'Воин' },
    });
  });

  it('виджет без ставок или без Member — null', async () => {
    const db = makeDb([{ id: 'a-1', bids: [{ memberId: 'm-9', nickname: 'Чужой', amount: 5 }] }]);
    expect(await new AuctionsService(db).myNearestBidLot('m-1')).toBeNull();
    expect(await new AuctionsService(db).myNearestBidLot(null)).toBeNull();
  });
});
