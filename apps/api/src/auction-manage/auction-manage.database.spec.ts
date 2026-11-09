import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuctionManageService, type ManageDb } from './auction-manage.service';
import { AuctionCloseService, type CloseDb } from '../auction-close/auction-close.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

/**
 * Ручное управление лотом на реальной PostgreSQL (issue #96, приёмка):
 * права по конкретному ивенту; конкуренция ручных действий со ставками
 * и закрытием свипером; идемпотентность финансовых записей при повторе
 * запроса; атомарный откат при сбое аудита.
 */
suite('Ручное управление лотами: настоящие транзакции PostgreSQL', () => {
  let db: PrismaClient;
  let manage: AuctionManageService;
  let closer: AuctionCloseService;
  let leaderId: string;
  let raidLeadId: string;
  let outsiderId: string;
  let dpsId: string;
  let healerId: string;
  let eventId: string;
  let itemId: string;

  /** Глава/Админ и РЛ — реальные члены с рангами; пользователь-админ отдельно. */
  const LEADER = { memberId: '', isAdmin: false, rank: 'GUILD_LEADER' };
  const RAID_LEAD = { memberId: '', isAdmin: false, rank: 'MEMBER' };
  const OUTSIDER = { memberId: '', isAdmin: false, rank: 'OFFICER' };

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
  });

  const makeLot = async (data: { endsAt?: Date | null; status?: 'OPEN' | 'CLOSED' } = {}) => {
    const drop = await db.lootDrop.create({ data: { eventId, itemId } });
    const row = await db.auction.create({
      data: {
        lootDropId: drop.id,
        startPrice: 100,
        step: 5,
        durationSec: 86_400,
        timerFromFirstBid: false,
        antiSnipeSec: 600,
        antiSnipeExtendSec: 600,
        markupPct: 50,
        targetRoles: ['DPS'],
        endsAt: data.endsAt ?? new Date(Date.now() + 3_600_000),
        ...(data.status ? { status: data.status } : {}),
      },
    });
    lotIds.push(row.id);
    return row;
  };

  const balanceOf = async (memberId: string) => {
    const entries = await db.dkpEntry.findMany({ where: { memberId }, select: { amount: true } });
    return entries.reduce((sum, row) => sum + row.amount, 0);
  };

  /**
   * Свои ряды убираем сами: общий dkp_test делится с другими database-спеками,
   * а осиротевший просроченный OPEN-лот ломает их тесты свипера.
   */
  const created = {
    members: [] as string[],
    events: [] as string[],
    types: [] as string[],
    items: [] as string[],
  };
  const lotIds: string[] = [];

  beforeEach(async () => {
    const suffix = randomUUID().slice(0, 10);
    // Ранги — только в акторах: частичный unique-индекс разрешает базе одного
    // Главу, а права сервиса читаются из актора, а не из строки члена.
    const mk = async (nickname: string, combatRole?: 'DPS' | 'HEALER') => {
      const row = await db.member.create({
        data: { nickname: `mg-${nickname}-${suffix}`, ...(combatRole ? { combatRole } : {}) },
      });
      created.members.push(row.id);
      return row.id;
    };
    leaderId = await mk('leader');
    raidLeadId = await mk('rl');
    outsiderId = await mk('outsider');
    dpsId = await mk('dps', 'DPS');
    healerId = await mk('heal', 'HEALER');
    LEADER.memberId = leaderId;
    RAID_LEAD.memberId = raidLeadId;
    OUTSIDER.memberId = outsiderId;

    const type = await db.eventType.create({ data: { name: `mg-${suffix}` } });
    created.types.push(type.id);
    const event = await db.event.create({
      data: {
        name: 'Управление',
        eventTypeId: type.id,
        raidLeadId,
        creatorId: leaderId,
        mode: 'PVE',
        startsAt: new Date('2027-03-03T17:00:00Z'),
        endsAt: new Date('2027-03-03T19:00:00Z'),
        dkpReward: 10,
      },
    });
    eventId = event.id;
    created.events.push(eventId);
    const item = await db.item.create({
      data: { name: `mg-item-${suffix}`, targetRoles: ['DPS'], defaultStartPrice: 100 },
    });
    itemId = item.id;
    created.items.push(itemId);
    manage = new AuctionManageService(db as unknown as ManageDb);
    closer = new AuctionCloseService(db as unknown as CloseDb, undefined, 0);
    for (const memberId of [leaderId, dpsId, healerId]) {
      await db.dkpEntry.create({
        data: { memberId, type: 'MANUAL_EARN', amount: 1000, comment: 'тест' },
      });
    }
  });

  afterAll(async () => {
    if (!db) return;
    // FK-безопасный порядок: сначала ссылки на лоты и членов, затем сами ряды.
    await db.auditLog.deleteMany({
      where: {
        OR: [{ entityId: { in: lotIds } }, { actorMemberId: { in: created.members } }],
      },
    });
    await db.bid.deleteMany({ where: { auctionId: { in: lotIds } } });
    await db.lootAward.deleteMany({ where: { auctionId: { in: lotIds } } });
    await db.dkpEntry.deleteMany({
      where: { OR: [{ auctionId: { in: lotIds } }, { memberId: { in: created.members } }] },
    });
    await db.auction.deleteMany({
      where: { lootDrop: { eventId: { in: created.events } } },
    });
    await db.lootDrop.deleteMany({ where: { eventId: { in: created.events } } });
    await db.event.deleteMany({ where: { id: { in: created.events } } });
    await db.eventType.deleteMany({ where: { id: { in: created.types } } });
    await db.item.deleteMany({ where: { id: { in: created.items } } });
    await db.member.deleteMany({ where: { id: { in: created.members } } });
    await db.$disconnect();
  });

  it('продление: РЛ ивента сдвигает окончание, посторонний офицер — 403', async () => {
    const lot = await makeLot();
    const before = lot.endsAt!;
    await expect(
      manage.extend(lot.id, { extendSec: 120, comment: 'причина' }, OUTSIDER),
    ).rejects.toThrow(/управляющий ивента/);
    expect((await db.auction.findUniqueOrThrow({ where: { id: lot.id } })).endsAt?.getTime()).toBe(
      before.getTime(),
    );
    expect(await db.auditLog.count({ where: { entityId: lot.id } })).toBe(0);

    const result = await manage.extend(
      lot.id,
      { extendSec: 120, comment: 'нужно время' },
      RAID_LEAD,
    );
    expect(result.lot.endsAt).toBe(new Date(before.getTime() + 120_000).toISOString());
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'AUCTION_EXTEND', entityId: lot.id },
    });
    expect(audit.actorMemberId).toBe(raidLeadId);
    expect(audit.comment).toContain('нужно время');
  });

  it('отмена лота с ведущей ставкой снимает заморозку и не трогает журнал', async () => {
    const lot = await makeLot();
    await db.bid.create({
      data: { auctionId: lot.id, memberId: dpsId, amount: 900, fullCost: 900, markupPct: 0 },
    });
    await manage.cancel(lot.id, { comment: 'предмет передаём вне торгов' }, RAID_LEAD);
    expect((await db.auction.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe(
      'CANCELLED',
    );
    expect(await db.dkpEntry.count({ where: { auctionId: lot.id } })).toBe(0);
    expect(await db.lootAward.count({ where: { auctionId: lot.id } })).toBe(0);
    // Заморозка снята: баланс 1000 снова полностью доступен для другой ставки.
    const other = await makeLot();
    await db.bid.create({
      data: { auctionId: other.id, memberId: dpsId, amount: 1000, fullCost: 1000, markupPct: 0 },
    });
    expect(await db.bid.count({ where: { auctionId: other.id, amount: 1000 } })).toBe(1);
  });

  it('досрочное завершение: ровно одна выдача и одно списание при параллельных вызовах', async () => {
    const lot = await makeLot();
    await db.bid.create({
      data: { auctionId: lot.id, memberId: dpsId, amount: 100, fullCost: 100, markupPct: 0 },
    });
    const results = await Promise.allSettled([
      manage.closeEarly(lot.id, { comment: 'первый' }, LEADER),
      manage.closeEarly(lot.id, { comment: 'второй' }, LEADER),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect((await db.auction.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe('CLOSED');
    expect(await db.lootAward.count({ where: { auctionId: lot.id } })).toBe(1);
    expect(await db.dkpEntry.count({ where: { auctionId: lot.id } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { action: 'AUCTION_CLOSE_EARLY', entityId: lot.id } }),
    ).toBe(1);
  });

  it('гонка ставки с ручным назначением: ставка либо успевает, либо отклоняется — выдача одна', async () => {
    const lot = await makeLot();
    await db.bid.create({
      data: { auctionId: lot.id, memberId: dpsId, amount: 100, fullCost: 100, markupPct: 0 },
    });
    const [awardResult, bidResult] = await Promise.allSettled([
      manage.assignWinner(
        lot.id,
        { requestId: randomUUID(), winnerId: healerId, price: 40, comment: 'решение главы' },
        LEADER,
      ),
      db.bid.create({
        data: { auctionId: lot.id, memberId: healerId, amount: 105, fullCost: 158, markupPct: 50 },
      }),
    ]);
    expect(awardResult.status).toBe('fulfilled');
    const row = await db.auction.findUniqueOrThrow({ where: { id: lot.id } });
    expect(row.status).toBe('CLOSED');
    expect(await db.lootAward.count({ where: { auctionId: lot.id } })).toBe(1);
    // Ручное назначение отменяет путь автосписания: тратится только цена главы.
    const entries = await db.dkpEntry.findMany({ where: { auctionId: lot.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ memberId: healerId, amount: -40 });
    // Ставка либо принята до остановки торгов (история остаётся), либо отклонена.
    const accepted = await db.bid.count({ where: { auctionId: lot.id, amount: 105 } });
    if (bidResult.status === 'fulfilled') expect(accepted).toBe(1);
    else expect(accepted).toBe(0);
  });

  it('смена победителя завершённого лота: возврат прежнему и списание с нового сходятся', async () => {
    const lot = await makeLot({ endsAt: new Date(Date.now() - 1000) });
    // Хил («чужой») выигрывает 150 → списано 225 с наценкой.
    await db.bid.create({
      data: { auctionId: lot.id, memberId: dpsId, amount: 100, fullCost: 100, markupPct: 0 },
    });
    await db.bid.create({
      data: { auctionId: lot.id, memberId: healerId, amount: 150, fullCost: 225, markupPct: 50 },
    });
    await closer.closeExpiredLot(lot.id);
    expect(await balanceOf(healerId)).toBe(1000 - 225);

    const result = await manage.assignWinner(
      lot.id,
      { requestId: randomUUID(), winnerId: dpsId, price: 120, comment: 'перераспределение' },
      LEADER,
    );
    expect(result.refund).toMatchObject({ memberId: healerId, amount: 225 });
    expect(await balanceOf(healerId)).toBe(1000); // возврат полностью
    expect(await balanceOf(dpsId)).toBe(1000 - 120);
    const award = await db.lootAward.findUniqueOrThrow({ where: { auctionId: lot.id } });
    expect(award).toMatchObject({ winnerId: dpsId, finalPrice: 120, markupPct: 0 });
    const entries = await db.dkpEntry.findMany({
      where: { auctionId: lot.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((e) => [e.memberId, e.amount])).toEqual([
      [healerId, -225], // автосписание при закрытии
      [healerId, 225], // возврат прежнему
      [dpsId, -120], // цена нового победителя
    ]);
  });

  it('повтор назначения с тем же requestId — без новых записей и аудита', async () => {
    const lot = await makeLot();
    const body = {
      requestId: randomUUID(),
      winnerId: dpsId,
      price: 70,
      comment: 'выдача',
    };
    await manage.assignWinner(lot.id, body, LEADER);
    const again = await manage.assignWinner(lot.id, body, LEADER);
    expect(again.repeated).toBe(true);
    expect(await db.dkpEntry.count({ where: { auctionId: lot.id } })).toBe(1);
    expect(await db.lootAward.count({ where: { auctionId: lot.id } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { action: 'AUCTION_ASSIGN_WINNER', entityId: lot.id } }),
    ).toBe(1);
  });

  it('назначение в минус допустимо: цена списывается без проверки баланса', async () => {
    const lot = await makeLot();
    const result = await manage.assignWinner(
      lot.id,
      { requestId: randomUUID(), winnerId: outsiderId, price: 5000, comment: 'долг допустим' },
      LEADER,
    );
    expect(result.winner).toMatchObject({ finalPrice: 5000 });
    expect(await balanceOf(outsiderId)).toBe(-5000);
  });

  it('сбой аудита откатывает назначение, записи журнала и статус целиком', async () => {
    const lot = await makeLot();
    const brokenDb = new Proxy(db, {
      get(target, prop) {
        if (prop === '$transaction')
          return (work: (tx: unknown) => Promise<unknown>, options: unknown) =>
            target.$transaction(
              (tx) =>
                work(
                  new Proxy(tx, {
                    get(t, k) {
                      if (k === 'auditLog')
                        return {
                          create: async () => {
                            throw new Error('injected failure');
                          },
                        };
                      return Reflect.get(t, k);
                    },
                  }),
                ),
              options as never,
            );
        return Reflect.get(target, prop);
      },
    });
    const broken = new AuctionManageService(brokenDb as unknown as ManageDb);
    await expect(
      broken.assignWinner(
        lot.id,
        { requestId: randomUUID(), winnerId: dpsId, price: 50, comment: 'причина' },
        LEADER,
      ),
    ).rejects.toThrow('injected failure');
    expect((await db.auction.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe('OPEN');
    expect(await db.lootAward.count({ where: { auctionId: lot.id } })).toBe(0);
    expect(await db.dkpEntry.count({ where: { auctionId: lot.id } })).toBe(0);
    expect(await balanceOf(dpsId)).toBe(1000);
  });
});
