import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ItemTargetRole } from '@dkp/shared';
import type { AuctionEventsPort } from '../realtime/auction-events';
import { AuctionManageService, type ManageDb, type ManageTx } from './auction-manage.service';

const NOW = new Date('2026-11-10T20:00:00Z');
const UUID = '00000000-0000-4000-8000-000000000000';

/** РЛ ивента — по плану 2.6 ведёт «свой» ивент независимо от ранга. */
const RAID_LEAD = { memberId: 'm-rl', isAdmin: false, rank: 'MEMBER' };
const OFFICER = { memberId: 'm-off', isAdmin: false, rank: 'OFFICER' };
const CREATOR_OFFICER = { memberId: 'm-creator', isAdmin: false, rank: 'OFFICER' };
const LEADER = { memberId: 'm-leader', isAdmin: false, rank: 'GUILD_LEADER' };
const RESERVE_ADMIN = { memberId: null, isAdmin: true, rank: null };

interface AuctionSeed {
  id: string;
  status: string;
  startPrice: number;
  step: number;
  timerFromFirstBid: boolean;
  durationSec: number;
  antiSnipeSec: number;
  antiSnipeExtendSec: number;
  noBidTimeoutSec: number | null;
  markupPct: number;
  targetRoles: ItemTargetRole[];
  firstBidAt: Date | null;
  endsAt: Date | null;
  createdAt?: Date;
  eventName?: string;
  itemName?: string;
  eventId?: string;
}

const LOT: AuctionSeed = {
  id: 'a-1',
  status: 'OPEN',
  startPrice: 100,
  step: 5,
  timerFromFirstBid: false,
  durationSec: 86_400,
  antiSnipeSec: 600,
  antiSnipeExtendSec: 600,
  noBidTimeoutSec: null,
  markupPct: 50,
  targetRoles: ['DPS'],
  firstBidAt: NOW,
  endsAt: new Date(NOW.getTime() + 3_600_000),
  createdAt: new Date(NOW.getTime() - 60_000),
  itemName: 'Клинок рассвета',
};

interface BidSeed {
  memberId: string;
  amount: number;
  fullCost: number;
  markupPct?: number;
}

interface AwardSeed {
  winnerId: string;
  finalPrice: number;
  markupPct?: number;
}

function makeDb(options: {
  auctions?: AuctionSeed[];
  bids?: BidSeed[];
  award?: AwardSeed | null;
  members?: Array<{ id: string; nickname: string }>;
  event?: { status: string; raidLeadId: string; creatorId?: string | null };
}) {
  const auctions = (options.auctions ?? [LOT]).map((seed) => ({ ...seed }));
  const award = options.award ?? null;
  const bids = (options.bids ?? []).map((seed, index) => ({
    id: `b-${index + 1}`,
    auctionId: 'a-1',
    markupPct: 0,
    createdAt: new Date(NOW.getTime() + index * 1000),
    ...seed,
  }));
  const members = options.members ?? [
    { id: 'm-1', nickname: 'Воин' },
    { id: 'm-2', nickname: 'Целитель' },
    { id: 'm-rl', nickname: 'Рейд-лид' },
    { id: 'm-off', nickname: 'Офицер' },
    { id: 'm-creator', nickname: 'Создатель' },
    { id: 'm-leader', nickname: 'Глава' },
  ];
  const event = {
    id: 'e-1',
    status: 'RUNNING',
    raidLeadId: 'm-rl',
    creatorId: 'm-creator',
    ...options.event,
  };
  const awards: Array<Record<string, unknown> & { auctionId: string }> = award
    ? [{ auctionId: 'a-1', ...award }]
    : [];
  const entries: Array<Record<string, unknown>> = [];
  const audit: Array<Record<string, unknown>> = [];

  const tx: ManageTx = {
    auction: {
      findUnique: async ({ where }) => {
        const found = auctions.find((row) => row.id === where.id);
        if (!found) return null;
        return {
          createdAt: new Date(NOW.getTime() - 60_000),
          ...found,
          lootDrop: {
            id: 'd-1',
            eventId: found.eventId ?? event.id,
            item: { name: found.itemName ?? 'Предмет' },
          },
          bids: bids
            .filter((bid) => bid.auctionId === found.id)
            .map((bid) => ({ ...bid, member: members.find((m) => m.id === bid.memberId)! })),
          award:
            awards.find((row) => row.auctionId === found.id)?.winnerId != null
              ? {
                  winnerId: award!.winnerId,
                  finalPrice: award!.finalPrice,
                  markupPct: award!.markupPct ?? 0,
                  winner: members.find((m) => m.id === award!.winnerId)!,
                }
              : null,
        } as never;
      },
      update: async ({ where, data }) => {
        const found = auctions.find((row) => row.id === where.id)!;
        Object.assign(found, data);
        return found as never;
      },
    },
    lootAward: {
      create: async ({ data }) => {
        awards.push({ ...data });
      },
      update: async ({ where, data }) => {
        const found = awards.find((row) => row.auctionId === where.auctionId)!;
        Object.assign(found, data);
      },
    },
    dkpEntry: {
      create: async ({ data }) => {
        entries.push(data);
      },
    },
    member: {
      findUnique: async ({ where }) => members.find((m) => m.id === where.id) ?? null,
    },
    event: {
      findUnique: async ({ where }) => (where.id === event.id ? event : null),
    },
    auditLog: {
      create: async ({ data }) => {
        audit.push(data);
      },
    },
  };
  const db: ManageDb = { ...tx, $transaction: async (work) => work(tx) };
  return { db, auctions, awards, bids, entries, audit };
}

const service = (db: ManageDb) => new AuctionManageService(db, () => NOW);

describe('AuctionManageService: продление (issue #96, план 6, п. 8)', () => {
  it('РЛ продлевает лот: окончание сдвигается, аудит с причиной', async () => {
    const { db, auctions, entries, audit } = makeDb({});
    const result = await service(db).extend(
      'a-1',
      { extendSec: 300, comment: ' нужны ещё минуты ' },
      RAID_LEAD,
    );
    expect(result.lot.status).toBe('OPEN');
    expect(result.lot.endsAt).toBe(new Date(LOT.endsAt!.getTime() + 300_000).toISOString());
    expect(auctions[0]!.endsAt).toEqual(new Date(LOT.endsAt!.getTime() + 300_000));
    expect(entries).toHaveLength(0); // продление не меняет журнал
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'AUCTION_EXTEND',
      actorMemberId: 'm-rl',
      entityType: 'Auction',
      entityId: 'a-1',
    });
    expect(String(audit[0]!.comment)).toContain('продлён на 300 сек');
    expect(String(audit[0]!.comment)).toContain('нужны ещё минуты');
  });

  it('Глава и создатель-офицер тоже продлевают; посторонний офицер — 403', async () => {
    await expect(
      service(makeDb({}).db).extend('a-1', { extendSec: 60, comment: 'причина' }, LEADER),
    ).resolves.toBeDefined();
    await expect(
      service(makeDb({}).db).extend('a-1', { extendSec: 60, comment: 'причина' }, CREATOR_OFFICER),
    ).resolves.toBeDefined();
    const stranger = makeDb({});
    await expect(
      service(stranger.db).extend('a-1', { extendSec: 60, comment: 'причина' }, OFFICER),
    ).rejects.toThrow(ForbiddenException);
    expect(stranger.auctions[0]!.endsAt).toEqual(LOT.endsAt);
    expect(stranger.audit).toHaveLength(0);
  });

  it('без причины — 400 до записи; несуществующий лот — 404', async () => {
    await expect(
      service(makeDb({}).db).extend('a-1', { extendSec: 60, comment: '  ' }, RAID_LEAD),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service(makeDb({}).db).extend('nope', { extendSec: 60, comment: 'причина' }, RAID_LEAD),
    ).rejects.toThrow(NotFoundException);
  });

  it('нельзя продлить лот без запущенного таймера и истекающий — 409', async () => {
    const notStarted = makeDb({
      auctions: [{ ...LOT, timerFromFirstBid: true, firstBidAt: null, endsAt: null }],
    });
    await expect(
      service(notStarted.db).extend('a-1', { extendSec: 60, comment: 'причина' }, RAID_LEAD),
    ).rejects.toThrow(/Таймер торгов ещё не запущен/);
    const ending = makeDb({
      auctions: [{ ...LOT, endsAt: new Date(NOW.getTime() - 1) }],
    });
    await expect(
      service(ending.db).extend('a-1', { extendSec: 60, comment: 'причина' }, RAID_LEAD),
    ).rejects.toThrow(/истекло/);
    const closed = makeDb({ auctions: [{ ...LOT, status: 'CLOSED' }] });
    await expect(
      service(closed.db).extend('a-1', { extendSec: 60, comment: 'причина' }, RAID_LEAD),
    ).rejects.toThrow(ConflictException);
  });

  it('лоты ивента любого статуса управляются: завершённый ивент не мешает', async () => {
    for (const status of ['FINISHED', 'CANCELLED', 'PLANNED']) {
      const { db } = makeDb({ event: { status, raidLeadId: 'm-rl' } });
      await expect(
        service(db).extend('a-1', { extendSec: 60, comment: 'причина' }, RAID_LEAD),
      ).resolves.toBeDefined();
    }
  });
});

describe('AuctionManageService: отмена (issue #96, план 6, п. 8)', () => {
  it('РЛ отменяет действующий лот: без записей журнала, аудит с причиной', async () => {
    const { db, auctions, entries, awards, audit } = makeDb({});
    const result = await service(db).cancel('a-1', { comment: 'предмет ошибся дропом' }, RAID_LEAD);
    expect(result.lot.status).toBe('CANCELLED');
    expect(auctions[0]!.status).toBe('CANCELLED');
    expect(entries).toHaveLength(0);
    expect(awards).toHaveLength(0);
    expect(audit[0]).toMatchObject({ action: 'AUCTION_CANCEL', actorMemberId: 'm-rl' });
    expect(String(audit[0]!.comment)).toContain('предмет ошибся дропом');
  });

  it('Рядовой и посторонний офицер лот не отменяют — 403 без изменений', async () => {
    const member = { memberId: 'm-1', isAdmin: false, rank: 'MEMBER' };
    const { db, auctions, audit } = makeDb({});
    await expect(service(db).cancel('a-1', { comment: 'причина' }, member)).rejects.toThrow(
      ForbiddenException,
    );
    expect(auctions[0]!.status).toBe('OPEN');
    expect(audit).toHaveLength(0);
  });

  it('отменить можно только действующий лот — 409', async () => {
    for (const status of ['CLOSED', 'CANCELLED']) {
      const { db } = makeDb({ auctions: [{ ...LOT, status }] });
      await expect(service(db).cancel('a-1', { comment: 'причина' }, RAID_LEAD)).rejects.toThrow(
        ConflictException,
      );
    }
  });

  it('без причины — 400', async () => {
    await expect(service(makeDb({}).db).cancel('a-1', {}, RAID_LEAD)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('AuctionManageService: досрочное завершение (план 6, п. 8)', () => {
  it('Глава завершает досрочно: победитель — ведущая ставка, списание как при закрытии', async () => {
    const { db, auctions, awards, entries, audit } = makeDb({
      bids: [
        { memberId: 'm-1', amount: 100, fullCost: 100 },
        { memberId: 'm-2', amount: 150, fullCost: 225, markupPct: 50 },
      ],
    });
    const result = await service(db).closeEarly('a-1', { comment: 'все ушли спать' }, LEADER);
    expect(result.lot.status).toBe('CLOSED');
    expect(auctions[0]!.status).toBe('CLOSED');
    expect(awards[0]).toMatchObject({ winnerId: 'm-2', finalPrice: 225, markupPct: 50 });
    expect(entries[0]).toMatchObject({
      requestId: 'auction-close:a-1',
      memberId: 'm-2',
      amount: -225,
      type: 'AUCTION_SPEND',
    });
    expect(String(entries[0]!.comment)).toContain('с наценкой 50%');
    expect(audit[0]).toMatchObject({ action: 'AUCTION_CLOSE_EARLY', actorMemberId: 'm-leader' });
    expect(String(audit[0]!.comment)).toContain('победитель Целитель, списано 225');
    expect(String(audit[0]!.comment)).toContain('все ушли спать');
  });

  it('без ставок — завершение без победителя и расхода', async () => {
    const { db, awards, entries, audit } = makeDb({});
    const result = await service(db).closeEarly('a-1', { comment: 'тишина' }, LEADER);
    expect(result.winner).toBeNull();
    expect(awards).toHaveLength(0);
    expect(entries).toHaveLength(0);
    expect(String(audit[0]!.comment)).toContain('без ставок');
  });

  it('РЛ досрочно завершить не может — только Глава/Админ (план 6, п. 8)', async () => {
    const { db, auctions, entries, audit } = makeDb({});
    for (const actor of [RAID_LEAD, OFFICER, CREATOR_OFFICER]) {
      await expect(service(db).closeEarly('a-1', { comment: 'причина' }, actor)).rejects.toThrow(
        ForbiddenException,
      );
    }
    expect(auctions[0]!.status).toBe('OPEN');
    expect(entries).toHaveLength(0);
    expect(audit).toHaveLength(0);
    // резервный админ без Member — может
    await expect(
      service(makeDb({}).db).closeEarly('a-1', { comment: 'причина' }, RESERVE_ADMIN),
    ).resolves.toBeDefined();
  });

  it('только действующий лот — 409', async () => {
    for (const status of ['CLOSED', 'CANCELLED']) {
      const { db } = makeDb({ auctions: [{ ...LOT, status }] });
      await expect(service(db).closeEarly('a-1', { comment: 'причина' }, LEADER)).rejects.toThrow(
        ConflictException,
      );
    }
  });
});

describe('AuctionManageService: ручной победитель (план 6, п. 8 и 10)', () => {
  const input = (over: Record<string, unknown> = {}) => ({
    requestId: UUID,
    winnerId: 'm-1',
    price: 30,
    comment: 'договорились',
    ...over,
  });

  it('Глава назначает победителя действующего лота: торги остановлены, списание без наценки', async () => {
    const { db, auctions, awards, entries, audit } = makeDb({
      bids: [{ memberId: 'm-2', amount: 400, fullCost: 600, markupPct: 50 }],
    });
    const result = await service(db).assignWinner('a-1', input(), LEADER);
    expect(result.lot.status).toBe('CLOSED');
    expect(result.repeated).toBe(false);
    expect(auctions[0]!.status).toBe('CLOSED');
    expect(awards[0]).toMatchObject({ winnerId: 'm-1', finalPrice: 30, markupPct: 0 });
    // назначение остановило торги: ведущая ставка не списана, её заморозка снята
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      requestId: `auction-award:a-1:${UUID}`,
      memberId: 'm-1',
      amount: -30,
    });
    expect(result.refund).toBeNull();
    expect(audit[0]).toMatchObject({ action: 'AUCTION_ASSIGN_WINNER' });
    expect(String(audit[0]!.comment)).toContain('Воин за 30 ДКП');
    expect(String(audit[0]!.comment)).toContain('торги остановлены');
  });

  it('цена 0 — выдача без записи журнала', async () => {
    const { db, awards, entries } = makeDb({});
    const result = await service(db).assignWinner('a-1', input({ price: 0 }), LEADER);
    expect(result.winner).toMatchObject({ finalPrice: 0 });
    expect(awards[0]).toMatchObject({ finalPrice: 0 });
    expect(entries).toHaveLength(0);
  });

  it('смена победителя завершённого лота: возврат прежнему новой записью, выдача новому', async () => {
    const { db, awards, entries, audit } = makeDb({
      auctions: [{ ...LOT, status: 'CLOSED' }],
      award: { winnerId: 'm-2', finalPrice: 225, markupPct: 50 },
    });
    const result = await service(db).assignWinner(
      'a-1',
      input({ winnerId: 'm-1', price: 100 }),
      LEADER,
    );
    expect(awards[0]).toMatchObject({ winnerId: 'm-1', finalPrice: 100, markupPct: 0 });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      requestId: `auction-award-refund:a-1:${UUID}`,
      memberId: 'm-2',
      amount: 225,
      type: 'AUCTION_SPEND',
    });
    expect(entries[1]).toMatchObject({
      requestId: `auction-award:a-1:${UUID}`,
      memberId: 'm-1',
      amount: -100,
    });
    expect(result.refund).toMatchObject({ memberId: 'm-2', amount: 225 });
    expect(String(audit[0]!.comment)).toContain('возвращено 225 ДКП');
  });

  it('повтор того же запроса — без новых записей и аудита', async () => {
    const first = makeDb({
      auctions: [{ ...LOT, status: 'CLOSED' }],
      award: { winnerId: 'm-2', finalPrice: 30 },
    });
    const result = await service(first.db).assignWinner(
      'a-1',
      input({ winnerId: 'm-2', price: 30 }),
      LEADER,
    );
    expect(result.repeated).toBe(true);
    expect(first.entries).toHaveLength(0);
    expect(first.awards[0]).toMatchObject({ winnerId: 'm-2', finalPrice: 30 });
    expect(first.audit).toHaveLength(0);
  });

  it('завершённый без ставок лот получает победителя вручную (план 6, п. 9)', async () => {
    const { db, awards, entries } = makeDb({
      auctions: [{ ...LOT, status: 'CLOSED' }],
      award: null,
    });
    const result = await service(db).assignWinner('a-1', input({ price: 50 }), LEADER);
    expect(result.winner).toMatchObject({ finalPrice: 50 });
    expect(awards[0]).toMatchObject({ winnerId: 'm-1', finalPrice: 50 });
    expect(entries).toHaveLength(1);
  });

  it('отменённый лот не меняется — 409; РЛ и офицер не назначают — 403', async () => {
    const cancelled = makeDb({ auctions: [{ ...LOT, status: 'CANCELLED' }] });
    await expect(service(cancelled.db).assignWinner('a-1', input(), LEADER)).rejects.toThrow(
      /Отменённый лот не меняется/,
    );
    for (const actor of [RAID_LEAD, OFFICER]) {
      const attempt = makeDb({});
      await expect(service(attempt.db).assignWinner('a-1', input(), actor)).rejects.toThrow(
        ForbiddenException,
      );
      expect(attempt.awards).toHaveLength(0);
      expect(attempt.entries).toHaveLength(0);
    }
  });

  it('неизвестный получатель — 404; некорректная цена — 400', async () => {
    await expect(
      service(makeDb({}).db).assignWinner('a-1', input({ winnerId: 'nope' }), LEADER),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service(makeDb({}).db).assignWinner('a-1', input({ price: -5 }), LEADER),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('AuctionManageService: события realtime (issue #97)', () => {
  it('отмена лота отправляет lotClosed(CANCELLED), продление — lotUpdated', async () => {
    const events: AuctionEventsPort = {
      lotCreated: jest.fn(),
      bidPlaced: jest.fn(),
      lotUpdated: jest.fn(),
      lotClosed: jest.fn(),
    };
    const { db } = makeDb({ auctions: [{ ...LOT, endsAt: new Date(NOW.getTime() + 60_000) }] });
    const svc = new AuctionManageService(db, () => NOW, events);

    await svc.cancel('a-1', { comment: 'ошибка предмета' }, LEADER);
    expect(events.lotClosed).toHaveBeenCalledWith('a-1', null, 'CANCELLED');

    const { db: db2 } = makeDb({
      auctions: [
        { ...LOT, firstBidAt: new Date(NOW.getTime() - 30_000), endsAt: new Date(NOW.getTime() + 60_000) },
      ],
    });
    await new AuctionManageService(db2, () => NOW, events).extend('a-1', { extendSec: 60, comment: 'сеть лагает' }, RAID_LEAD);
    expect(events.lotUpdated).toHaveBeenCalledWith('a-1', expect.objectContaining({ id: 'a-1' }), null);
  });
});
