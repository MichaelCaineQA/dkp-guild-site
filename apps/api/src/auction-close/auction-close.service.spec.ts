import { AuctionCloseService, type CloseDb } from './auction-close.service';

/**
 * Юнит-тесты закрытия лотов (issue #95) на поддельной БД:
 * выдача и списание атомарны, пустой лот — без победителя и расхода,
 * повторное закрытие не создаёт дубликатов.
 */

interface FakeBid {
  id: string;
  memberId: string;
  amount: number;
  fullCost: number;
  markupPct: number;
  member: { nickname: string };
}

interface FakeAuction {
  id: string;
  status: string;
  timerFromFirstBid: boolean;
  noBidTimeoutSec: number | null;
  firstBidAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  lootDrop: { item: { name: string } };
  bids: FakeBid[];
}

function makeDb(auctions: FakeAuction[]) {
  const store = new Map(auctions.map((a) => [a.id, a]));
  const created = { awards: [] as unknown[], entries: [] as unknown[], audits: [] as unknown[] };
  const db = {
    auction: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) => store.get(id) ?? null,
      findMany: async ({ where: { status } }: { where: { status: string } }) =>
        [...store.values()].filter((a) => a.status === status),
      update: async ({ where: { id }, data }: { where: { id: string }; data: { status: 'CLOSED' } }) => {
        Object.assign(store.get(id)!, data);
      },
    },
    lootAward: {
      create: async ({ data }: { data: unknown }) => {
        created.awards.push(data);
      },
    },
    dkpEntry: {
      create: async ({ data }: { data: unknown }) => {
        created.entries.push(data);
      },
    },
    auditLog: {
      create: async ({ data }: { data: unknown }) => {
        created.audits.push(data);
      },
    },
    $transaction: <R>(work: (tx: unknown) => Promise<R>): Promise<R> => work(db),
  } as unknown as CloseDb;
  return { db, created, store };
}

const NOW = new Date('2026-11-09T21:00:00Z');
const service = (db: CloseDb) => new AuctionCloseService(db, () => NOW, 0);

function longLot(overrides: Partial<FakeAuction> = {}): FakeAuction {
  return {
    id: 'lot-1',
    status: 'OPEN',
    timerFromFirstBid: false,
    noBidTimeoutSec: null,
    firstBidAt: null,
    endsAt: new Date(NOW.getTime() - 1000), // истёк
    createdAt: new Date(NOW.getTime() - 86_400_000),
    lootDrop: { item: { name: 'Меч' } },
    bids: [],
    ...overrides,
  };
}

describe('AuctionCloseService (issue #95)', () => {
  it('истёкший лот со ставками: выдача победителю, списание fullCost и системный аудит', async () => {
    const { db, created } = makeDb([
      longLot({
        bids: [
          { id: 'b1', memberId: 'm1', amount: 100, fullCost: 100, markupPct: 0, member: { nickname: 'ДД' } },
          { id: 'b2', memberId: 'm2', amount: 150, fullCost: 225, markupPct: 50, member: { nickname: 'Хил' } },
        ],
      }),
    ]);
    const result = await service(db).closeExpiredLot('lot-1');
    expect(result).toEqual({
      closed: true,
      skipped: false,
      winner: { memberId: 'm2', memberName: 'Хил', finalPrice: 225, markupPct: 50 },
    });
    expect(created.awards).toEqual([
      { auctionId: 'lot-1', winnerId: 'm2', finalPrice: 225, markupPct: 50 },
    ]);
    expect(created.entries).toEqual([
      {
        requestId: 'auction-close:lot-1',
        memberId: 'm2',
        type: 'AUCTION_SPEND',
        amount: -225,
        auctionId: 'lot-1',
        comment: 'Трата на аукционе: «Меч» за 225 (с наценкой 50%)',
      },
    ]);
    expect(created.audits).toHaveLength(1);
    expect(created.audits[0]).toMatchObject({
      actorMemberId: null,
      action: 'AUCTION_CLOSE',
      entityType: 'Auction',
      entityId: 'lot-1',
    });
  });

  it('лот без ставок: закрыт без победителя и расхода', async () => {
    const { db, created } = makeDb([longLot()]);
    const result = await service(db).closeExpiredLot('lot-1');
    expect(result).toEqual({ closed: true, skipped: false, winner: null });
    expect(created.awards).toHaveLength(0);
    expect(created.entries).toHaveLength(0);
    expect((created.audits[0] as { comment: string }).comment).toContain('без ставок');
  });

  it('неистёкший и уже закрытый лот не трогаем', async () => {
    const { db, created, store } = makeDb([
      longLot({ id: 'future', endsAt: new Date(NOW.getTime() + 60_000) }),
      longLot({ id: 'closed', status: 'CLOSED' }),
    ]);
    const svc = service(db);
    expect(await svc.closeExpiredLot('future')).toMatchObject({ closed: false, skipped: true });
    expect(await svc.closeExpiredLot('closed')).toMatchObject({ closed: false, skipped: true });
    expect(created.awards).toHaveLength(0);
    expect(created.entries).toHaveLength(0);
    expect(store.get('future')!.status).toBe('OPEN');
  });

  it('повторное закрытие идемпотентно: дубликатов выдачи, списания и аудита нет', async () => {
    const { db, created } = makeDb([
      longLot({
        bids: [
          { id: 'b1', memberId: 'm1', amount: 100, fullCost: 100, markupPct: 0, member: { nickname: 'ДД' } },
        ],
      }),
    ]);
    const svc = service(db);
    await svc.closeExpiredLot('lot-1');
    const again = await svc.closeExpiredLot('lot-1');
    expect(again).toMatchObject({ closed: false, skipped: true });
    expect(created.awards).toHaveLength(1);
    expect(created.entries).toHaveLength(1);
    expect(created.audits).toHaveLength(1);
  });

  it('свипер закрывает только истёкшие лоты, включая живую раздачу без ставок', async () => {
    const { db, created } = makeDb([
      longLot({ id: 'expired-long' }),
      longLot({ id: 'future-long', endsAt: new Date(NOW.getTime() + 60_000) }),
      longLot({
        id: 'live-no-bids',
        timerFromFirstBid: true,
        noBidTimeoutSec: 120,
        endsAt: null,
        createdAt: new Date(NOW.getTime() - 121_000),
      }),
      longLot({
        id: 'live-waiting',
        timerFromFirstBid: true,
        noBidTimeoutSec: 120,
        endsAt: null,
        createdAt: new Date(NOW.getTime() - 60_000),
      }),
    ]);
    const closedCount = await service(db).closeDue();
    expect(closedCount).toBe(2);
    const statuses = new Map(
      (await db.auction.findMany({ where: { status: 'OPEN' } })).map((l) => [l.id, true]),
    );
    expect(statuses.has('future-long')).toBe(true);
    expect(statuses.has('live-waiting')).toBe(true);
    expect(created.audits).toHaveLength(2);
  });

  it('сбой одного лота не мешает закрыть остальные', async () => {
    const { db, created } = makeDb([longLot({ id: 'bad' }), longLot({ id: 'good' })]);
    const inner = db.auction.findUnique;
    db.auction.findUnique = async (args) => {
      if (args.where.id === 'bad') throw new Error('db down');
      return inner(args);
    };
    const closedCount = await service(db).closeDue();
    expect(closedCount).toBe(1);
    expect(created.audits).toHaveLength(1);
  });
});
