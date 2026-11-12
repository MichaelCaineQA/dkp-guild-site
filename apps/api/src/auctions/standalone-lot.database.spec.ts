import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuctionsService, type AuctionsDb } from './auctions.service';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

/** Создание лота вне ивента «хранилище гильдии» на настоящей PostgreSQL (#137). */
suite('AuctionsService.createLot: PostgreSQL', () => {
  let db: PrismaClient;
  let service: AuctionsService;
  let memberId: string;
  let itemId: string;
  const created = { auctions: [] as string[], drops: [] as string[] };

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    service = new AuctionsService(db as unknown as AuctionsDb);
    const nick = 'sl-' + randomUUID().slice(0, 10);
    memberId = (await db.member.create({ data: { nickname: nick } })).id;
    itemId = (await db.item.create({ data: { name: 'sl-' + randomUUID() } })).id;
  });

  const cleanup = async () => {
    await db.auditLog.deleteMany({ where: { entityId: { in: created.auctions } } });
    await db.bid.deleteMany({ where: { auctionId: { in: created.auctions } } });
    await db.auction.deleteMany({ where: { id: { in: created.auctions } } });
    await db.lootDrop.deleteMany({ where: { id: { in: created.drops } } });
    created.auctions.length = 0;
    created.drops.length = 0;
  };

  beforeEach(cleanup);

  afterAll(async () => {
    if (!db) return;
    await cleanup();
    if (itemId) await db.item.deleteMany({ where: { id: itemId } });
    if (memberId) await db.member.deleteMany({ where: { id: memberId } });
    await db.$disconnect();
  });

  it('длинный лот без ивента: дроп с eventId=null, снапшоты, endsAt от открытия', async () => {
    const before = Date.now();
    const lot = await service.createLot(
      {
        itemId,
        startPrice: 120,
        step: 5,
        timerKind: 'OPENING',
        durationValue: 2,
        durationUnit: 'DAYS',
        antiSnipeSec: 600,
      },
      { memberId, isAdmin: false },
    );
    created.auctions.push(lot.id);
    const stored = await db.auction.findUniqueOrThrow({
      where: { id: lot.id },
      include: { lootDrop: { include: { item: true, event: true } } },
    });
    created.drops.push(stored.lootDropId);
    expect(stored.lootDrop.eventId).toBeNull();
    expect(stored.lootDrop.event).toBeNull();
    expect(stored.noBidTimeoutSec).toBeNull();
    expect(stored.antiSnipeExtendSec).toBeGreaterThanOrEqual(0);
    expect(stored.endsAt!.getTime()).toBeGreaterThanOrEqual(before + 2 * 86_400_000);
    // лот виден в списке без всякого ивента
    const rows = await service.list('OPEN', memberId);
    expect(
      rows.some((row) => row.id === lot.id && row.itemName === stored.lootDrop.item.name),
    ).toBe(true);
    // аудит создания помечает «хранилище гильдии»
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: lot.id, action: 'AUCTION_CREATE' },
    });
    expect(audit.actorMemberId).toBe(memberId);
    expect(audit.comment).toContain('хранилище гильдии');
  });

  it('живая раздача вне ивента: endsAt=null до первой ставки', async () => {
    const lot = await service.createLot(
      {
        itemId,
        startPrice: 10,
        step: 1,
        timerKind: 'FIRST_BID',
        durationValue: 1.5,
        durationUnit: 'MINUTES',
        antiSnipeSec: 30,
        noBidTimeoutSec: 120,
      },
      { memberId, isAdmin: false },
    );
    created.auctions.push(lot.id);
    const stored = await db.auction.findUniqueOrThrow({ where: { id: lot.id } });
    created.drops.push(stored.lootDropId);
    expect(stored.endsAt).toBeNull();
    expect(stored.noBidTimeoutSec).toBe(120);
    expect(stored.durationSec).toBe(90);
  });

  it('дефолты по предмету; неизвестный предмет — 404', async () => {
    const defaults = await service.defaultsForItem(itemId);
    expect(defaults.startPrice).toBe(0);
    expect(defaults.long.durationUnit).toBe('DAYS');
    await expect(service.defaultsForItem('nope')).rejects.toThrow(NotFoundException);
    await expect(
      service.createLot(
        {
          itemId: 'nope',
          startPrice: 1,
          step: 1,
          timerKind: 'OPENING',
          durationValue: 1,
          durationUnit: 'DAYS',
          antiSnipeSec: 0,
        },
        { memberId, isAdmin: false },
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
