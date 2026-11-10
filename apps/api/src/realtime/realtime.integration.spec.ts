import 'reflect-metadata';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AuctionBidEvent, AuctionLiveState, SessionUser } from '@dkp/shared';
import { io, type Socket } from 'socket.io-client';
import { createSessionMiddleware, getSessionStore } from '../auth/session';
import { BidsService, type BidsDb, type BidsTx } from '../bids/bids.service';
import { AuctionCloseService, type CloseDb } from '../auction-close/auction-close.service';
import { AuctionGateway } from './auction.gateway';
import { AuctionSnapshotService, type SnapshotDb } from './auction-snapshot';

/**
 * Realtime аукциона по HTTP+WS как в бою (issue #97): настоящий Socket.IO
 * сервер, настоящая cookie-сессия (MemoryStore), два конкурирующих клиента.
 * Ставки/закрытие — через настоящие сервисы с in-memory БД.
 */

interface LotRow {
  award: { winnerId: string; finalPrice: number; markupPct: number; winner: { nickname: string } } | null;
  id: string;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  startPrice: number;
  step: number;
  timerFromFirstBid: boolean;
  durationSec: number;
  antiSnipeSec: number;
  antiSnipeExtendSec: number;
  noBidTimeoutSec: number | null;
  markupPct: number;
  discountPct: number;
  targetRoles: 'DPS'[];
  firstBidAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  itemName: string;
}

interface BidRowData {
  id: string;
  auctionId: string;
  memberId: string;
  amount: number;
  fullCost: number;
  markupPct: number;
  discountPct?: number;
  createdAt: Date;
}

const MEMBERS = [
  {
    id: 'm-1',
    nickname: 'Воин',
    combatRole: 'DPS' as const,
    prevCombatRole: null,
    combatRoleChangedAt: null,
    preferredItemId: null,
    prevPreferredItemId: null,
    preferredItemChangedAt: null,
  },
  {
    id: 'm-2',
    nickname: 'Целитель',
    combatRole: 'HEALER' as const,
    prevCombatRole: null,
    combatRoleChangedAt: null,
    preferredItemId: null,
    prevPreferredItemId: null,
    preferredItemChangedAt: null,
  },
];

function makeStore() {
  const auction: LotRow = {
    id: 'a-1',
    status: 'OPEN',
    startPrice: 100,
    step: 5,
    timerFromFirstBid: true,
    durationSec: 90,
    antiSnipeSec: 30,
    antiSnipeExtendSec: 30,
    noBidTimeoutSec: 120,
    markupPct: 0,
    discountPct: 0,
    targetRoles: ['DPS'],
    firstBidAt: null,
    endsAt: null,
    createdAt: new Date(),
    itemName: 'Клинок рассвета',
    award: null,
  };
  const auctions = [auction];
  const bids: BidRowData[] = [];
  let seq = 0;
  const audit: Array<Record<string, unknown>> = [];

  const withItem = <T,>(row: T & { itemName?: string }) => ({
    ...row,
    lootDrop: { itemId: 'item-1', item: { name: row.itemName ?? 'Предмет' } },
  });

  const tx = {
    auction: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const found = auctions.find((row) => row.id === where.id);
        return found ? withItem(found) : null;
      },
      findMany: async () =>
        auctions
          .filter((row) => row.status === 'OPEN' && row.id !== 'a-1')
          .map((row) => ({ ...row, bids: [] as unknown[] })) as never,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const found = auctions.find((row) => row.id === where.id)!;
        Object.assign(found, data);
        return found;
      },
    },
    bid: {
      findMany: async ({ where }: { where: { auctionId: string } }) =>
        bids
          .filter((bid) => bid.auctionId === where.auctionId)
          .map((bid) => ({ ...bid, member: MEMBERS.find((m) => m.id === bid.memberId)! })),
      create: async ({ data }: { data: Omit<BidRowData, 'id' | 'createdAt'> }) => {
        const created: BidRowData = {
          id: `b-${++seq}`,
          createdAt: new Date(),
          ...data,
        };
        bids.push(created);
        return created;
      },
    },
    member: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        MEMBERS.find((m) => m.id === where.id) ?? null,
    },
    dkpEntry: {
      findMany: async () => [{ amount: 10000 }],
      create: async () => ({}),
    },
    lootAward: {
      create: async () => ({}),
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audit.push(data);
      },
    },
  };

  // одно хранилище под три интерфейса (взгляды одного и того же лота)
  const bidsTx = tx as unknown as BidsTx;
  const bidsDb: BidsDb = { ...bidsTx, $transaction: async (work) => work(bidsTx) };
  const closeFindUnique = async ({ where }: { where: { id: string } }) => {
    const found = auctions.find((row) => row.id === where.id);
    return found
      ? {
          ...withItem(found),
          bids: bids.map((bid) => ({
            ...bid,
            member: MEMBERS.find((m) => m.id === bid.memberId)!,
          })),
        }
      : null;
  };
  const closeTxView = { ...tx, auction: { ...tx.auction, findUnique: closeFindUnique } };
  const closeDb = {
    ...closeTxView,
    $transaction: async <R,>(work: (t: typeof closeTxView) => Promise<R>) => work(closeTxView),
  } as unknown as CloseDb;
  const snapshotDb = {
    auction: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const found = auctions.find((row) => row.id === where.id);
        return found
          ? {
              ...withItem(found),
              award: found.award,
              bids: bids.map((bid) => ({
                ...bid,
                member: MEMBERS.find((m) => m.id === bid.memberId)!,
              })),
            }
          : null;
      },
    },
  } as unknown as SnapshotDb;
  return { auctions, bids, bidsDb, closeDb, snapshotDb };
}

let storeRef: ReturnType<typeof makeStore>;

@Module({
  providers: [
    {
      provide: AuctionSnapshotService,
      useFactory: () => new AuctionSnapshotService(storeRef.snapshotDb),
    },
    AuctionGateway,
  ],
})
class RealtimeTestModule {}

const USER_1: SessionUser = {
  userId: 'u-1',
  username: 'warrior',
  memberId: 'm-1',
  rank: 'MEMBER',
  isAdmin: false,
};
const USER_2: SessionUser = {
  userId: 'u-2',
  username: 'healer',
  memberId: 'm-2',
  rank: 'MEMBER',
  isAdmin: false,
};

function connect(app: INestApplication, sid: string | null): Socket {
  const url = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const extraHeaders: Record<string, string> = {};
  if (sid) extraHeaders.cookie = `dkp.sid=${sid}`;
  return io(url, {
    path: '/socket.io',
    transports: ['websocket'],
    extraHeaders,
    reconnection: false,
    timeout: 4000,
  });
}

function opened(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
}

function once<T>(socket: Socket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Нет события ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function quiet(socket: Socket, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    socket.once(event, () => {
      clearTimeout(timer);
      reject(new Error(`Лишнее событие ${event}`));
    });
  });
}

function putSession(sid: string, user: SessionUser): void {
  getSessionStore().set(
    sid,
    { user, cookie: { originalMaxAge: 86400000, maxAge: 86400000 } as never },
    () => undefined,
  );
}

describe('Realtime аукциона: интеграция Socket.IO (issue #97)', () => {
  let app: INestApplication;
  let gateway: AuctionGateway;
  let store: ReturnType<typeof makeStore>;
  let bids: BidsService;
  let closer: AuctionCloseService;

  beforeAll(async () => {
    storeRef = makeStore();
    app = await NestFactory.create(RealtimeTestModule, { logger: false });
    app.use(createSessionMiddleware());
    await app.listen(0, '127.0.0.1');
    gateway = app.get(AuctionGateway);
    store = storeRef;
    // сервисы шлют события в настоящий gateway — как в собранном приложении
    bids = new BidsService(store.bidsDb, undefined, gateway);
    closer = new AuctionCloseService(store.closeDb, undefined, 0, gateway);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('два клиента видят принятую ставку; отклонённая не приходит; переподключение без дублирования', async () => {
    putSession('sid-a', USER_1);
    putSession('sid-b', USER_2);

    const a = connect(app, 'sid-a');
    const b = connect(app, 'sid-b');
    await Promise.all([opened(a), opened(b)]);

    // подписка обоих: полный срез без ставок
    a.emit('auction:join', { auctionId: 'a-1' });
    b.emit('auction:join', { auctionId: 'a-1' });
    const stateA = await once<AuctionLiveState | null>(a, 'auction:state');
    await once(b, 'auction:state');
    expect(stateA).not.toBeNull();
    expect(stateA!.bids).toHaveLength(0);
    expect(stateA!.lot.status).toBe('OPEN');

    // принятая ставка m-1 — видят оба без обновления страницы
    const bid1Promise = Promise.all([
      once<AuctionBidEvent>(a, 'auction:bid'),
      once<AuctionBidEvent>(b, 'auction:bid'),
    ]);
    await bids.place('a-1', { amount: 100 }, { memberId: 'm-1', isAdmin: false });
    const [bid1A, bid1B] = await bid1Promise;
    expect(bid1A.bid).toMatchObject({ amount: 100, memberName: 'Воин' });
    expect(bid1B.bid.amount).toBe(100);
    expect(bid1A.endsAt).not.toBeNull();

    // отклонённая (ниже текущей+шаг) — события нет у обоих
    await expect(
      bids.place('a-1', { amount: 104 }, { memberId: 'm-2', isAdmin: false }),
    ).rejects.toThrow();
    await Promise.all([quiet(a, 'auction:bid', 300), quiet(b, 'auction:bid', 300)]);

    // перебивание m-2 — анти-снайп-окно ещё далеко, окончание то же
    await bids.place('a-1', { amount: 150 }, { memberId: 'm-2', isAdmin: false });
    await once(a, 'auction:bid');
    await once(b, 'auction:bid');

    // разрыв и повторное соединение: актуальный срез, без потери и удвоения
    b.disconnect();
    const b2 = connect(app, 'sid-b');
    await opened(b2);
    b2.emit('auction:join', { auctionId: 'a-1' });
    const fresh = await once<AuctionLiveState | null>(b2, 'auction:state');
    expect(fresh!.bids.map((bid) => bid.amount)).toEqual([100, 150]);
    expect(fresh!.bids.map((bid) => bid.id)).toHaveLength(2);
    expect(fresh!.lot.endsAt).toBe(bid1A.endsAt);
    b2.disconnect();

    // закрытие по истечении: свежий срез со статусом CLOSED и лёгкое событие
    store.auctions[0]!.endsAt = new Date(Date.now() - 1000); // просрочен
    const closedPromise = once<{ auctionId: string; reason: string; winner: { memberName: string } | null }>(a, 'auction:closed');
    const closedState = once<{ lot: { status: string }; bids: unknown[] }>(a, 'auction:state');
    await closer.closeExpiredLot('a-1');
    const closed = await closedPromise;
    const afterClose = await closedState;
    expect(closed.reason).toBe('EXPIRED');
    expect(closed.winner).toMatchObject({ memberName: 'Целитель', finalPrice: 150 });
    expect(afterClose.lot.status).toBe('CLOSED');
    expect(afterClose.bids).toHaveLength(2);

    a.disconnect();
  });

  it('без сессии соединение отклоняется и закрытых данных не отдаёт', async () => {
    const intruder = connect(app, null);
    const error = await once<{ message?: string }>(intruder, 'auction:error');
    expect(error).toBeTruthy();
    // сервер закрыл соединение — новых событий не будет
    intruder.emit('auction:join', { auctionId: 'a-1' });
    await expect(once(intruder, 'auction:state', 700)).rejects.toThrow();
    intruder.disconnect();
  });
});
