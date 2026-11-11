import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import type { PermissionActor } from '@dkp/shared';
import type { AuditService } from '../audit/audit.service';
import type { AuctionsService } from '../auctions/auctions.service';
import { DashboardService, type DashboardDb } from './dashboard.service';

/** Лот с историей ставок — как отдаёт include { lootDrop: { include: { item } }, bids }. */
interface StoredLot {
  id: string;
  endsAt: Date | null;
  createdAt: Date;
  lootDrop: { item: { name: string } };
  bids: Array<{ memberId: string; amount: number; fullCost: number }>;
}

const findLots = jest.fn(async () => [] as StoredLot[]);
const findEntries = jest.fn(async () => [] as Array<{ amount: number }>);
const service = new DashboardService(
  { auction: { findMany: findLots }, dkpEntry: { findMany: findEntries } } as unknown as DashboardDb,
  {} as unknown as AuditService,
  {} as unknown as AuctionsService,
);
const actor: PermissionActor = {
  memberId: 'me',
  rank: 'MEMBER',
  isAdmin: false,
};

beforeEach(() => {
  findLots.mockReset().mockResolvedValue([]);
  findEntries.mockReset().mockResolvedValue([]);
});

describe('Кошелёк дашборда (issue #81, план 2.8 и 6 п. 5)', () => {
  it('без привязанного Member — 403, без запросов к БД', async () => {
    const admin = { ...actor, memberId: null, rank: null, isAdmin: true };
    await expect(service.wallet(admin)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findLots).not.toHaveBeenCalled();
    expect(findEntries).not.toHaveBeenCalled();
  });

  it('баланс — фактическая сумма журнала; без ставок заморозка нулевая', async () => {
    findEntries.mockResolvedValue([{ amount: 50 }, { amount: 10 }, { amount: -5 }]);
    const wallet = await service.wallet(actor);
    expect(wallet).toEqual({ balance: 55, frozen: 0, available: 55, lots: [] });
    // только открытые лоты: отменённые и завершённые в заморозку не попадают
    expect(findLots).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'OPEN' } }),
    );
  });

  it('заморожено — ведущие ставки с наценкой; лоты по ближайшему окончанию', async () => {
    const far = new Date('2026-11-12T18:00:00Z');
    const near = new Date('2026-11-11T20:00:00Z');
    findLots.mockResolvedValue([
      {
        id: 'near',
        endsAt: near,
        createdAt: new Date('2026-11-01T00:00:00Z'),
        lootDrop: { item: { name: 'Посох' } },
        // собственная ставка повышена: ведёт только последняя (80 → 88)
        bids: [
          { memberId: 'me', amount: 50, fullCost: 55 },
          { memberId: 'me', amount: 80, fullCost: 88 },
        ],
      },
      {
        id: 'far',
        endsAt: far,
        createdAt: new Date('2026-11-01T00:00:00Z'),
        lootDrop: { item: { name: 'Клинок' } },
        // наценка +10% уже внутри fullCost ведущей ставки
        bids: [{ memberId: 'me', amount: 100, fullCost: 110 }],
      },
      {
        id: 'outbid',
        endsAt: far,
        createdAt: new Date('2026-11-02T00:00:00Z'),
        lootDrop: { item: { name: 'Щит' } },
        // перебита другим игроком — исключена целиком
        bids: [
          { memberId: 'me', amount: 60, fullCost: 66 },
          { memberId: 'other', amount: 70, fullCost: 70 },
        ],
      },
    ] satisfies StoredLot[]);
    findEntries.mockResolvedValue([{ amount: 200 }]);
    const wallet = await service.wallet(actor);
    expect(wallet).toEqual({
      balance: 200,
      frozen: 198, // 110 + 88, без перебитой 66
      available: 2,
      lots: [
        { lotId: 'near', itemName: 'Посох', fullCost: 88, endsAt: near.toISOString() },
        { lotId: 'far', itemName: 'Клинок', fullCost: 110, endsAt: far.toISOString() },
      ],
    });
  });

  it('живая раздача до первой ставки: endsAt=null — лот всё равно в списке', async () => {
    findLots.mockResolvedValue([
      {
        id: 'live',
        endsAt: null,
        createdAt: new Date('2026-11-01T00:00:00Z'),
        lootDrop: { item: { name: 'Амулет' } },
        bids: [{ memberId: 'me', amount: 30, fullCost: 27 }],
      },
    ] satisfies StoredLot[]);
    const wallet = await service.wallet(actor);
    expect(wallet!.frozen).toBe(27);
    expect(wallet!.lots).toEqual([
      { lotId: 'live', itemName: 'Амулет', fullCost: 27, endsAt: null },
    ]);
  });
});
