import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuctionEventsPort } from '../realtime/auction-events';
import { MembersService, type MembersDb } from './members.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

/**
 * Блокировка учётки на реальной PostgreSQL (issue #149, приёмка):
 * удаление активных ставок той же транзакцией, скрытие из списков,
 * разблокировка с сохранением данных.
 */
suite('Блокировка участников: настоящие транзакции PostgreSQL', () => {
  let db: PrismaClient;
  let service: MembersService;
  let removedLots: string[];
  let victimId: string;
  let otherId: string;
  let leaderId: string;
  let openLotId: string;
  let closedLotId: string;
  let itemId: string;

  const ADMIN = { memberId: null, isAdmin: true, userId: 'admin' };

  /** Свои ряды убираем сами: dkp_test общая для всех database-спек. */
  const created = { members: [] as string[], lots: [] as string[], drops: [] as string[] };

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    const events: AuctionEventsPort = {
      lotCreated: () => {},
      bidPlaced: () => {},
      bidsRemoved: (auctionId) => {
        removedLots.push(auctionId);
      },
      lotUpdated: () => {},
      lotClosed: () => {},
      userAccessRevoked: () => {},
    };
    service = new MembersService(db as unknown as MembersDb, undefined, events);
  });

  afterAll(async () => {
    if (db) {
      // FK-безопасный порядок: ставки → лоты → дропы → журнал → участники
      await db.bid.deleteMany({ where: { auctionId: { in: created.lots } } });
      await db.auction.deleteMany({ where: { id: { in: created.lots } } });
      await db.lootDrop.deleteMany({ where: { id: { in: created.drops } } });
      if (itemId) await db.item.deleteMany({ where: { id: itemId } });
      await db.dkpEntry.deleteMany({ where: { memberId: { in: created.members } } });
      await db.member.deleteMany({ where: { id: { in: created.members } } });
      await db.$disconnect();
    }
  });

  beforeEach(async () => {
    removedLots = [];
    const suffix = randomUUID().slice(0, 10);
    const mk = async (nickname: string) => {
      const row = await db.member.create({
        data: { nickname: `blk-${nickname}-${suffix}`, rank: 'MEMBER', combatRole: 'DPS' },
      });
      created.members.push(row.id);
      return row.id;
    };
    victimId = await mk('victim');
    otherId = await mk('other');
    // Частичный unique-индекс разрешает базе одного Главу — берём сидового
    const existingLeader = await db.member.findFirst({ where: { rank: 'GUILD_LEADER' } });
    if (existingLeader) {
      leaderId = existingLeader.id;
    } else {
      const row = await db.member.create({
        data: { nickname: `blk-leader-${suffix}`, rank: 'GUILD_LEADER' },
      });
      created.members.push(row.id);
      leaderId = row.id;
    }

    const item = await db.item.create({
      data: { name: `blk-item-${suffix}`, targetRoles: ['ALL'] },
    });
    itemId = item.id;
    const mkLot = async (status: 'OPEN' | 'CLOSED') => {
      const drop = await db.lootDrop.create({ data: { itemId } });
      created.drops.push(drop.id);
      const lot = await db.auction.create({
        data: {
          lootDropId: drop.id,
          durationSec: 86_400,
          timerFromFirstBid: false,
          endsAt: new Date(Date.now() + 3_600_000),
          ...(status === 'CLOSED' ? { status } : {}),
        },
      });
      created.lots.push(lot.id);
      return lot.id;
    };
    openLotId = await mkLot('OPEN');
    closedLotId = await mkLot('CLOSED');

    // Жертва ставит на оба лота, чужак — только на открытый
    await db.bid.create({
      data: { auctionId: openLotId, memberId: victimId, amount: 100, fullCost: 100 },
    });
    await db.bid.create({
      data: { auctionId: closedLotId, memberId: victimId, amount: 50, fullCost: 50 },
    });
    await db.bid.create({
      data: { auctionId: openLotId, memberId: otherId, amount: 120, fullCost: 120 },
    });
    // Журнал жертвы остаётся при блокировке (данные сохраняются)
    await db.dkpEntry.create({
      data: { memberId: victimId, type: 'MANUAL_EARN', amount: 500, comment: 'blk seed' },
    });
  });

  it('блокировка снимает ставки с открытых лотов и закрывает доступ', async () => {
    const row = await service.block(victimId, { comment: 'Покинул гильдию' }, ADMIN);

    expect(row.blockedAt).toBeTruthy();
    // Активная ставка снята, ставки чужака и закрытого лота не тронуты
    const openBids = await db.bid.findMany({ where: { auctionId: openLotId } });
    expect(openBids.map((b) => b.memberId)).toEqual([otherId]);
    const closedBids = await db.bid.findMany({ where: { auctionId: closedLotId } });
    expect(closedBids.map((b) => b.memberId)).toEqual([victimId]);
    // Свежий срез ушёл комнате затронутого лота
    expect(removedLots).toEqual([openLotId]);
    // Журнал ДКП сохранён
    const entries = await db.dkpEntry.findMany({ where: { memberId: victimId } });
    expect(entries).toHaveLength(1);
    // Аудит написан
    const audit = await db.auditLog.findFirst({
      where: { action: 'MEMBER_BLOCK', entityId: victimId },
    });
    expect(audit?.comment).toContain('снято активных ставок: 1');
    expect(audit?.comment).toContain('Покинул гильдию');

    // Состав скрывает, вкладка заблокированных показывает
    const roster = await service.roster({});
    expect(roster.map((m) => m.id)).not.toContain(victimId);
    expect(roster.map((m) => m.id)).toContain(otherId);
    const blocked = await service.blocked();
    expect(blocked.map((m) => m.id)).toContain(victimId);

    // Повторная блокировка — 409
    await expect(service.block(victimId, { comment: 'Ещё раз' }, ADMIN)).rejects.toThrow(
      ConflictException,
    );
  });

  it('Главу блокировать нельзя', async () => {
    await expect(service.block(leaderId, { comment: 'Попробуем главу' }, ADMIN)).rejects.toThrow(
      ConflictException,
    );
    const leader = await db.member.findUnique({ where: { id: leaderId } });
    expect(leader?.blockedAt).toBeNull();
  });

  it('разблокировка возвращает в состав, данные и ранг на месте', async () => {
    await service.block(victimId, { comment: 'Покинул гильдию' }, ADMIN);

    const row = await service.unblock(victimId, { comment: 'Вернулся' }, ADMIN);

    expect(row).toMatchObject({ id: victimId, rank: 'MEMBER' });
    const member = await db.member.findUnique({ where: { id: victimId } });
    expect(member?.blockedAt).toBeNull();
    const roster = await service.roster({});
    expect(roster.map((m) => m.id)).toContain(victimId);
    const entries = await db.dkpEntry.findMany({ where: { memberId: victimId } });
    expect(entries).toHaveLength(1);
    // Незаблокированного разблокировать — 409
    await expect(service.unblock(otherId, { comment: 'Не был' }, ADMIN)).rejects.toThrow(
      ConflictException,
    );
  });
});
