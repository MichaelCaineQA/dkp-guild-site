import { NotFoundException } from '@nestjs/common';
import type { DkpDb } from './dkp.service';
import { DkpService } from './dkp.service';

interface Entry {
  id: string;
  memberId: string;
  type: string;
  amount: number;
  comment: string | null;
  eventId: string | null;
  createdAt: Date;
}

function makeDb(entries: Entry[] = []) {
  const members = [
    { id: 'm-1', nickname: 'Первый' },
    { id: 'm-2', nickname: 'Второй' },
  ];
  const db: DkpDb = {
    member: {
      findMany: async () => [...members],
      findUnique: async ({ where }) => members.find((m) => m.id === where.id) ?? null,
    },
    dkpEntry: {
      // Один и тот же предикат для findMany и count — как в Prisma
      findMany: async ({ where, orderBy, take, skip }) => {
        expect(orderBy).toEqual({ createdAt: 'desc' });
        const matches = entries.filter(matchesWhere(where));
        return matches
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(skip, take === undefined ? undefined : skip + take);
      },
      count: async ({ where }) => entries.filter(matchesWhere(where)).length,
    },
  };
  return { db, entries, members };
}

function entry(partial: Partial<Entry> & { id: string }): Entry {
  return {
    memberId: 'm-1',
    type: 'CHECKIN_EARN',
    amount: 5,
    comment: null,
    eventId: null,
    createdAt: new Date('2026-03-03T17:00:00Z'),
    ...partial,
  };
}

/** Общий предикат where для фейка (как в Prisma — один и тот же для list/count). */
function matchesWhere(where: {
  memberId?: string;
  eventId?: string;
  type?: string;
  createdAt?: { gte?: Date; lte?: Date };
}) {
  return (e: Entry) =>
    (where.memberId ? e.memberId === where.memberId : true) &&
    (where.eventId ? e.eventId === where.eventId : true) &&
    (where.type ? e.type === where.type : true) &&
    (where.createdAt?.gte ? e.createdAt >= where.createdAt.gte : true) &&
    (where.createdAt?.lte ? e.createdAt <= where.createdAt.lte : true);
}

describe('DkpService.list', () => {
  it('отдаёт операции с именами и total, сортировка новые-сверху', async () => {
    const { db } = makeDb([
      entry({ id: 'd-1', createdAt: new Date('2026-03-03T17:00:00Z') }),
      entry({ id: 'd-2', createdAt: new Date('2026-03-04T17:00:00Z'), memberId: 'm-2' }),
    ]);
    const service = new DkpService(db);

    const result = await service.list({});
    expect(result.total).toBe(2);
    expect(result.entries[0]!.id).toBe('d-2'); // новые сверху
    expect(result.entries[0]!.memberName).toBe('Второй');
    expect(result.entries[1]!.memberName).toBe('Первый');
  });

  it('фильтры: игрок, тип, период, пагинация', async () => {
    const { db } = makeDb([
      entry({ id: 'd-1', type: 'CHECKIN_EARN', amount: 5 }),
      entry({ id: 'd-2', type: 'ADJUSTMENT', amount: -3, createdAt: new Date('2026-02-01T00:00:00Z') }),
      entry({
        id: 'd-3',
        memberId: 'm-2',
        type: 'MANUAL_EARN',
        amount: 2,
        createdAt: new Date('2026-03-05T00:00:00Z'), // новее d-1 — различимые даты для пагинации
      }),
    ]);
    const service = new DkpService(db);

    expect((await service.list({ memberId: 'm-1' })).total).toBe(2);
    expect((await service.list({ type: 'ADJUSTMENT' })).total).toBe(1);
    expect((await service.list({ from: '2026-03-01' })).total).toBe(2); // мартовские
    expect((await service.list({ limit: '1' })).entries).toHaveLength(1);
    expect((await service.list({ limit: '1', offset: '1' })).entries[0]!.id).toBe('d-1');
  });
});

describe('DkpService.balances / memberBalance', () => {
  it('баланс включает весь журнал, даже после 10000 операций', async () => {
    const { db } = makeDb(Array.from({ length: 10_001 }, (_, i) => entry({ id: `d-${i}`, amount: 1 })));
    const service = new DkpService(db);
    expect((await service.memberBalance('m-1')).balance).toBe(10_001);
    expect((await service.balances()).find((row) => row.memberId === 'm-1')?.balance).toBe(10_001);
  });
  it('баланс = сумма журнала, включая корректировки (acceptance #12)', async () => {
    const { db } = makeDb([
      entry({ id: 'd-1', amount: 5 }),
      entry({ id: 'd-2', amount: 5 }),
      entry({ id: 'd-3', type: 'ADJUSTMENT', amount: -3 }),
      entry({ id: 'd-4', memberId: 'm-2', amount: 2 }),
    ]);
    const service = new DkpService(db);

    const balances = await service.balances();
    expect(balances[0]).toMatchObject({ memberName: 'Первый', balance: 7 }); // 5+5-3
    expect(balances[1]).toMatchObject({ memberName: 'Второй', balance: 2 });

    const single = await service.memberBalance('m-1');
    expect(single.balance).toBe(7);
  });

  it('несуществующий игрок — 404', async () => {
    const { db } = makeDb();
    const service = new DkpService(db);
    await expect(service.memberBalance('m-x')).rejects.toThrow(NotFoundException);
  });

  it('без операций баланс 0 (сортировка по алфавиту при равенстве)', async () => {
    const { db } = makeDb();
    const service = new DkpService(db);
    const balances = await service.balances();
    expect(balances.map((b) => b.memberName)).toEqual(['Второй', 'Первый'].sort()); // оба 0
  });
});

describe('Журнал append-only (правило 1 AGENTS.md)', () => {
  it('у DkpService нет update/delete-методов', () => {
    const { db } = makeDb();
    const service = new DkpService(db);
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    const forbidden = methods.filter((m) => /^update|^delete|^remove|^patch/i.test(m));
    expect(forbidden).toEqual([]);
    expect(methods).toContain('list');
    expect(methods).toContain('balances');
  });
});
