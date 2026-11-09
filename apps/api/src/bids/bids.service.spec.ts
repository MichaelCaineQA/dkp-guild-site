import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ItemTargetRole } from '@dkp/shared';
import { BidsService, type BidsDb, type BidsTx } from './bids.service';

const NOW = new Date('2026-11-09T20:00:00Z');
const ACTOR = { memberId: 'm-1', isAdmin: false };

interface AuctionSeed {
  id: string;
  status: string;
  startPrice: number;
  step: number;
  timerFromFirstBid: boolean;
  durationSec: number;
  antiSnipeSec: number;
  antiSnipeExtendSec: number;
  markupPct: number;
  targetRoles: ItemTargetRole[];
  firstBidAt: Date | null;
  endsAt: Date | null;
  itemName?: string;
}

const LIVE_LOT: AuctionSeed = {
  id: 'a-1',
  status: 'OPEN',
  startPrice: 100,
  step: 5,
  timerFromFirstBid: true,
  durationSec: 90,
  antiSnipeSec: 30,
  antiSnipeExtendSec: 10,
  markupPct: 50,
  targetRoles: ['DPS'],
  firstBidAt: null,
  endsAt: null,
  itemName: 'Клинок рассвета',
};

interface BidSeed {
  auctionId: string;
  memberId: string;
  amount: number;
  fullCost: number;
  markupPct?: number;
}

function makeDb(options: {
  auctions?: AuctionSeed[];
  bids?: BidSeed[];
  members?: Array<{ id: string; nickname: string; combatRole: 'DPS' | 'HEALER' | 'TANK' | null }>;
  dkp?: Record<string, number>;
}) {
  const auctions = (options.auctions ?? [LIVE_LOT]).map((seed) => ({ ...seed }));
  const bids: Array<Record<string, unknown>> = [];
  let bidSeq = 0;
  for (const seed of options.bids ?? []) {
    bids.push({
      id: `b-${++bidSeq}`,
      markupPct: 0,
      createdAt: new Date(NOW.getTime() + bidSeq * 1000),
      ...seed,
    });
  }
  const members = options.members ?? [
    { id: 'm-1', nickname: 'Воин', combatRole: 'DPS' as const },
    { id: 'm-2', nickname: 'Целитель', combatRole: 'HEALER' as const },
  ];
  const dkp = options.dkp ?? { 'm-1': 1000 };
  const audit: Array<Record<string, unknown>> = [];

  const tx: BidsTx = {
    auction: {
      findUnique: async ({ where }) => {
        const found = auctions.find((row) => row.id === where.id);
        if (!found) return null;
        return {
          ...found,
          lootDrop: { item: { name: found.itemName ?? 'Предмет' } },
        } as never;
      },
      findMany: async ({ where }) =>
        auctions
          .filter((row) => row.status === where.status && row.id !== where.id.not)
          .map(
            (row) =>
              ({
                ...row,
                bids: bids.filter((bid) => bid.auctionId === row.id),
              }) as never,
          ),
      update: async ({ where, data }) => {
        const found = auctions.find((row) => row.id === where.id)!;
        Object.assign(found, data);
        return found;
      },
    },
    bid: {
      findMany: async ({ where }) =>
        bids
          .filter((bid) => bid.auctionId === where.auctionId)
          .map(
            (bid) =>
              ({
                ...bid,
                member: members.find((member) => member.id === bid.memberId)!,
              }) as never,
          ),
      create: async ({ data }) => {
        const created = {
          id: `b-${++bidSeq}`,
          createdAt: NOW,
          ...data,
        };
        bids.push(created);
        return created as never;
      },
    },
    member: {
      findUnique: async ({ where }) =>
        members.find((member) => member.id === where.id) ?? null,
    },
    dkpEntry: {
      findMany: async ({ where }) => [{ amount: dkp[where.memberId] ?? 0 }],
    },
    auditLog: {
      create: async ({ data }) => {
        audit.push(data);
      },
    },
  };
  const db: BidsDb = {
    ...tx,
    $transaction: async (work) => work(tx),
  };
  return { db, auctions, bids, audit };
}

const service = (db: BidsDb) => new BidsService(db, () => NOW);

describe('BidsService (issue #94)', () => {
  it('первая ставка живой раздачи запускает таймер и пишет аудит', async () => {
    const { db, auctions, bids, audit } = makeDb({});
    const result = await service(db).place('a-1', { amount: 100 }, ACTOR);
    expect(result.bid).toMatchObject({ amount: 100, fullCost: 100, markupPct: 0 });
    expect(result.endsAt).toBe(new Date(NOW.getTime() + 90_000).toISOString());
    expect(auctions[0]).toMatchObject({ firstBidAt: NOW });
    expect(bids).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'AUCTION_BID',
      entityType: 'Auction',
      entityId: 'a-1',
      actorMemberId: 'm-1',
    });
    expect(String(audit[0]!.comment)).toContain('Ставка 100 на лот «Клинок рассвета»');
  });

  it('следующая ставка — не ниже текущей плюс шаг', async () => {
    const { db } = makeDb({ bids: [{ auctionId: 'a-1', memberId: 'm-2', amount: 100, fullCost: 100 }] });
    await expect(service(db).place('a-1', { amount: 104 }, ACTOR)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service(db).place('a-1', { amount: 105 }, ACTOR)).resolves.toMatchObject({
      bid: { amount: 105 },
    });
  });

  it('отклонённая ставка не оставляет ни записи, ни аудита, ни сдвига таймера', async () => {
    const { db, auctions, bids, audit } = makeDb({});
    await expect(service(db).place('a-1', { amount: 99 }, ACTOR)).rejects.toThrow(
      BadRequestException,
    );
    expect(bids).toHaveLength(0);
    expect(audit).toHaveLength(0);
    expect(auctions[0]!.firstBidAt).toBeNull();
  });

  it('закрытый и отменённый лот ставок не принимает — 409', async () => {
    for (const status of ['CLOSED', 'CANCELLED']) {
      const { db, bids, audit } = makeDb({ auctions: [{ ...LIVE_LOT, status }] });
      await expect(service(db).place('a-1', { amount: 100 }, ACTOR)).rejects.toThrow(
        ConflictException,
      );
      expect(bids).toHaveLength(0);
      expect(audit).toHaveLength(0);
    }
  });

  it('длинный лот после истечения таймера ставку не принимает — 409', async () => {
    const { db } = makeDb({
      auctions: [
        {
          ...LIVE_LOT,
          timerFromFirstBid: false,
          endsAt: new Date(NOW.getTime() - 1000),
        },
      ],
    });
    await expect(service(db).place('a-1', { amount: 100 }, ACTOR)).rejects.toThrow(
      ConflictException,
    );
  });

  it('анти-снайп: ставка в окне прибавляет продление к текущему окончанию', async () => {
    const endsAt = new Date(NOW.getTime() + 30_000); // ровно граница окна 30 сек
    const { db, auctions } = makeDb({
      auctions: [{ ...LIVE_LOT, timerFromFirstBid: false, endsAt }],
    });
    const result = await service(db).place('a-1', { amount: 100 }, ACTOR);
    expect(result.endsAt).toBe(new Date(endsAt.getTime() + 10_000).toISOString());
    expect(auctions[0]!.endsAt).toEqual(new Date(endsAt.getTime() + 10_000));
  });

  it('вне окна анти-снайпа окончание не меняется', async () => {
    const endsAt = new Date(NOW.getTime() + 31_000);
    const { db } = makeDb({
      auctions: [{ ...LIVE_LOT, timerFromFirstBid: false, endsAt }],
    });
    const result = await service(db).place('a-1', { amount: 100 }, ACTOR);
    expect(result.endsAt).toBe(endsAt.toISOString());
  });

  it('«чужой» класс: полная стоимость с наценкой округляется вверх и проверяется по балансу', async () => {
    const { db, bids, audit } = makeDb({
      dkp: { 'm-2': 151 },
    });
    // Хиллер ставит на предмет «ДД» с наценкой 50%: 101 × 1,5 = 151,5 → 152 > 151.
    await expect(
      service(db).place('a-1', { amount: 101 }, { memberId: 'm-2', isAdmin: false }),
    ).rejects.toThrow(BadRequestException);
    expect(bids).toHaveLength(0);
    expect(audit).toHaveLength(0);

    const ok = await service(db).place('a-1', { amount: 100 }, { memberId: 'm-2', isAdmin: false });
    expect(ok.bid).toMatchObject({ amount: 100, fullCost: 150, markupPct: 50 });
    expect(String(audit[0]!.comment)).toContain('полная стоимость 150 с наценкой 50%');
  });

  it('замороженные лидирующие ставки по другим лотам уменьшают доступный баланс', async () => {
    const other: AuctionSeed = { ...LIVE_LOT, id: 'a-2', itemName: 'Щит' };
    const { db } = makeDb({
      auctions: [{ ...LIVE_LOT }, other],
      bids: [{ auctionId: 'a-2', memberId: 'm-1', amount: 950, fullCost: 950 }],
      dkp: { 'm-1': 1050 },
    });
    // Доступно 1050 − 950 = 100.
    await expect(service(db).place('a-1', { amount: 101 }, ACTOR)).rejects.toThrow(
      /Недостаточно доступного баланса: нужно 101, доступно 100/,
    );
    await expect(service(db).place('a-1', { amount: 100 }, ACTOR)).resolves.toMatchObject({
      bid: { amount: 100 },
    });
  });

  it('перебитая ставка не замораживает средства', async () => {
    const other: AuctionSeed = { ...LIVE_LOT, id: 'a-2', itemName: 'Щит' };
    const { db } = makeDb({
      auctions: [{ ...LIVE_LOT }, other],
      bids: [
        { auctionId: 'a-2', memberId: 'm-1', amount: 950, fullCost: 950 },
        { auctionId: 'a-2', memberId: 'm-2', amount: 960, fullCost: 960 },
      ],
      dkp: { 'm-1': 1000 },
    });
    await expect(service(db).place('a-1', { amount: 100 }, ACTOR)).resolves.toBeDefined();
  });

  it('резервный админ без члена гильдии ставить не может — 403', async () => {
    const { db, bids, audit } = makeDb({});
    await expect(
      service(db).place('a-1', { amount: 100 }, { memberId: null, isAdmin: true }),
    ).rejects.toThrow(ForbiddenException);
    expect(bids).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  it('некорректная сумма — 400 до обращения к БД', async () => {
    const { db, audit } = makeDb({});
    await expect(service(db).place('a-1', { amount: -1 }, ACTOR)).rejects.toThrow(
      BadRequestException,
    );
    expect(audit).toHaveLength(0);
  });

  it('несуществующий лот — 404', async () => {
    const { db } = makeDb({});
    await expect(service(db).place('nope', { amount: 100 }, ACTOR)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('игрок без боевой роли платит наценку', async () => {
    const { db } = makeDb({
      members: [{ id: 'm-1', nickname: 'Безролевой', combatRole: null }],
      dkp: { 'm-1': 1000 },
    });
    const result = await service(db).place('a-1', { amount: 100 }, ACTOR);
    expect(result.bid).toMatchObject({ fullCost: 150, markupPct: 50 });
  });

  it('история ставок открыта и упорядочена по времени', async () => {
    const { db } = makeDb({
      bids: [
        { auctionId: 'a-1', memberId: 'm-1', amount: 100, fullCost: 100 },
        { auctionId: 'a-1', memberId: 'm-2', amount: 105, fullCost: 158, markupPct: 50 },
      ],
    });
    const list = await service(db).list('a-1');
    expect(list.map((row) => row.amount)).toEqual([100, 105]);
    expect(list[1]).toMatchObject({ memberName: 'Целитель', fullCost: 158, markupPct: 50 });
  });
});
