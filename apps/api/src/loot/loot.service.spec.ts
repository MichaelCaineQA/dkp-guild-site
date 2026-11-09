import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ItemTargetRole } from '@dkp/shared';
import { LootService, type LootDb } from './loot.service';

const RL = { memberId: 'm-rl', isAdmin: false };
const LEADER = { memberId: 'm-leader', isAdmin: false };
const ADMIN = { memberId: null, isAdmin: true };
const MEMBER = { memberId: 'm-member', isAdmin: false };

const ITEM = {
  id: 'i-1',
  name: 'Клинок рассвета',
  rarity: 'Эпический',
  slot: 'Оружие',
  targetRoles: ['DPS', 'TANK'] as ItemTargetRole[],
  defaultStartPrice: 120,
};

const SETTINGS = new Map<string, number>([
  ['auction.step', 1],
  ['auction.liveDurationSec', 60],
  ['auction.longDurationDays', 2],
  ['auction.antiSnipeLiveSec', 30],
  ['auction.antiSnipeExtendLiveSec', 30],
  ['auction.antiSnipeLongSec', 600],
  ['auction.antiSnipeExtendLongSec', 600],
  ['auction.noBidTimeoutSec', 120],
  ['auction.foreignClassMarkupPct', 50],
]);

interface DropSeed {
  id: string;
  eventId: string;
  itemId: string;
  createdAt: Date;
  withLot?: boolean;
}

function makeDb(options: {
  event?: { id: string; status: string; raidLeadId: string; creatorId?: string | null } | null;
  items?: typeof ITEM[];
  drops?: DropSeed[];
}) {
  const event =
    options.event === undefined
      ? { id: 'e-1', status: 'RUNNING', raidLeadId: 'm-rl', creatorId: null }
      : options.event;
  const items = options.items ?? [ITEM];
  const drops = (options.drops ?? []).map((seed) => ({ ...seed }));
  const auctions: Array<Record<string, unknown>> = [];
  const audit: Array<Record<string, unknown>> = [];

  const expand = (seed: DropSeed) => {
    const item = items.find((candidate) => candidate.id === seed.itemId)!;
    const auction = auctions.find((row) => row.lootDropId === seed.id) ?? null;
    return { ...seed, item: { ...item }, auction } as never;
  };

  const db: LootDb = {
    event: {
      findUnique: async ({ where }) =>
        event && event.id === where.id ? { ...event } : null,
    },
    item: {
      findUnique: async ({ where }) => {
        const found = items.find((candidate) => candidate.id === where.id);
        return found ? { ...found } : null;
      },
    },
    lootDrop: {
      findMany: async ({ where }) =>
        drops.filter((drop) => drop.eventId === where.eventId).map(expand),
      findUnique: async ({ where }) => {
        const found = drops.find((drop) => drop.id === where.id);
        return found ? expand(found) : null;
      },
      create: async ({ data }) => {
        const created = {
          id: `d-${drops.length + 1}`,
          eventId: data.eventId,
          itemId: data.itemId,
          createdAt: new Date('2026-11-09T18:00:00Z'),
        };
        drops.push(created);
        return { id: created.id, createdAt: created.createdAt };
      },
    },
    auction: {
      create: async ({ data }) => {
        const created = {
          id: `a-${auctions.length + 1}`,
          status: 'OPEN',
          firstBidAt: null,
          createdAt: new Date('2026-11-09T18:05:00Z'),
          ...data,
        };
        auctions.push(created);
        return created as never;
      },
    },
    setting: {
      findMany: async ({ where }) =>
        [...SETTINGS.entries()]
          .filter(([key]) => where.key.in.includes(key))
          .map(([key, value]) => ({ key, value })),
    },
    auditLog: {
      create: async ({ data }) => {
        audit.push(data as Record<string, unknown>);
      },
    },
  };
  return { db, drops, auctions, audit };
}

const LIVE_INPUT = {
  startPrice: 120,
  step: 5,
  timerKind: 'FIRST_BID',
  durationValue: 1.5,
  durationUnit: 'MINUTES',
  antiSnipeSec: 30,
  noBidTimeoutSec: 120,
};

describe('LootService (issue #93)', () => {
  it('фиксирует дроп с привязкой к ивенту и пишет аудит', async () => {
    const { db, audit } = makeDb({});
    const service = new LootService(db);

    const drop = await service.createDrop('e-1', { itemId: 'i-1' }, RL, 'MEMBER');
    expect(drop).toMatchObject({
      eventId: 'e-1',
      itemId: 'i-1',
      itemName: 'Клинок рассвета',
      lot: null,
    });
    expect(audit[0]).toMatchObject({
      action: 'LOOT_DROP_CREATE',
      entityType: 'LootDrop',
      entityId: drop.id,
      actorMemberId: 'm-rl',
    });
    expect(String(audit[0]!.comment)).toContain('Клинок рассвета');
  });

  it('рядовой участник без назначения не может фиксировать дроп — 403', async () => {
    const { db, audit } = makeDb({});
    const service = new LootService(db);

    await expect(service.createDrop('e-1', { itemId: 'i-1' }, MEMBER, 'MEMBER')).rejects.toThrow(
      ForbiddenException,
    );
    expect(audit).toHaveLength(0);
  });

  it('резервный админ фиксирует дроп без Member', async () => {
    const { db } = makeDb({});
    const service = new LootService(db);
    await expect(service.createDrop('e-1', { itemId: 'i-1' }, ADMIN, null)).resolves.toMatchObject(
      { itemName: 'Клинок рассвета' },
    );
  });

  it('на завершённом и отменённом ивенте дроп не фиксируется — 409 (2.6)', async () => {
    for (const status of ['FINISHED', 'CANCELLED']) {
      const { db } = makeDb({
        event: { id: 'e-1', status, raidLeadId: 'm-rl', creatorId: null },
      });
      const service = new LootService(db);
      await expect(
        service.createDrop('e-1', { itemId: 'i-1' }, LEADER, 'GUILD_LEADER'),
      ).rejects.toThrow(ConflictException);
    }
  });

  it('список дропов доступен управляющим и на отменённом ивенте (просмотр)', async () => {
    const { db } = makeDb({
      event: { id: 'e-1', status: 'CANCELLED', raidLeadId: 'm-rl', creatorId: null },
      drops: [{ id: 'd-1', eventId: 'e-1', itemId: 'i-1', createdAt: new Date() }],
    });
    const service = new LootService(db);
    const list = await service.listForActor('e-1', RL, 'MEMBER');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ itemName: 'Клинок рассвета', lot: null });
  });

  it('неизвестный предмет — 404, аудита нет', async () => {
    const { db, audit } = makeDb({});
    const service = new LootService(db);
    await expect(service.createDrop('e-1', { itemId: 'nope' }, RL, 'MEMBER')).rejects.toThrow(
      NotFoundException,
    );
    expect(audit).toHaveLength(0);
  });

  it('создаёт живую раздачу: endsAt пуст до первой ставки, тайм-аут и снимки зафиксированы', async () => {
    const { db, auctions, audit } = makeDb({
      drops: [{ id: 'd-1', eventId: 'e-1', itemId: 'i-1', createdAt: new Date() }],
    });
    const service = new LootService(db);

    const lot = await service.createLot('e-1', 'd-1', LIVE_INPUT, RL, 'MEMBER');
    expect(lot).toMatchObject({
      status: 'OPEN',
      startPrice: 120,
      step: 5,
      timerKind: 'FIRST_BID',
      durationSec: 90,
      antiSnipeSec: 30,
      antiSnipeExtendSec: 30,
      noBidTimeoutSec: 120,
      markupPct: 50,
      endsAt: null,
      firstBidAt: null,
    });
    expect(auctions[0]).toMatchObject({ lootDropId: 'd-1', targetRoles: ['DPS', 'TANK'] });
    expect(audit[0]).toMatchObject({ action: 'AUCTION_CREATE', entityType: 'Auction' });
    expect(String(audit[0]!.comment)).toContain('живая раздача 90 сек от первой ставки');
  });

  it('создаёт длинный лот: отсчёт от открытия, endsAt = создание + длительность', async () => {
    const { db, auctions } = makeDb({
      drops: [{ id: 'd-1', eventId: 'e-1', itemId: 'i-1', createdAt: new Date() }],
    });
    const service = new LootService(db);

    const before = Date.now();
    const lot = await service.createLot(
      'e-1',
      'd-1',
      {
        ...LIVE_INPUT,
        timerKind: 'OPENING',
        durationValue: 2,
        durationUnit: 'DAYS',
        antiSnipeSec: 600,
        noBidTimeoutSec: undefined,
      },
      LEADER,
      'GUILD_LEADER',
    );
    expect(lot.timerKind).toBe('OPENING');
    expect(lot.durationSec).toBe(172_800);
    expect(lot.noBidTimeoutSec).toBeNull();
    expect(new Date(lot.endsAt!).getTime()).toBeGreaterThanOrEqual(before + 172_800_000);
    expect((auctions[0] as { endsAt: Date }).endsAt).toBeInstanceOf(Date);
  });

  it('повторный лот по тому же дропу — 409', async () => {
    const { db } = makeDb({
      drops: [{ id: 'd-1', eventId: 'e-1', itemId: 'i-1', createdAt: new Date() }],
    });
    const service = new LootService(db);
    await service.createLot('e-1', 'd-1', LIVE_INPUT, RL, 'MEMBER');
    await expect(service.createLot('e-1', 'd-1', LIVE_INPUT, RL, 'MEMBER')).rejects.toThrow(
      ConflictException,
    );
  });

  it('дроп другого ивента — 404', async () => {
    const { db } = makeDb({
      drops: [{ id: 'd-1', eventId: 'e-2', itemId: 'i-1', createdAt: new Date() }],
    });
    const service = new LootService(db);
    await expect(service.createLot('e-1', 'd-1', LIVE_INPUT, RL, 'MEMBER')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('некорректные параметры лота — 400 с понятным сообщением', async () => {
    const { db, auctions, audit } = makeDb({
      drops: [{ id: 'd-1', eventId: 'e-1', itemId: 'i-1', createdAt: new Date() }],
    });
    const service = new LootService(db);
    await expect(
      service.createLot('e-1', 'd-1', { ...LIVE_INPUT, durationValue: 20 }, RL, 'MEMBER'),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.createLot('e-1', 'd-1', { ...LIVE_INPUT, noBidTimeoutSec: null }, RL, 'MEMBER'),
    ).rejects.toThrow(BadRequestException);
    expect(auctions).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  it('дефолты лота — из настроек и рекомендованной цены предмета', async () => {
    const { db } = makeDb({});
    const service = new LootService(db);
    const defaults = await service.defaultsForActor('e-1', 'i-1', RL, 'MEMBER');
    expect(defaults).toMatchObject({
      startPrice: 120,
      step: 1,
      markupPct: 50,
      live: { durationValue: 1, antiSnipeSec: 30, antiSnipeExtendSec: 30, noBidTimeoutSec: 120 },
      long: { durationValue: 2, antiSnipeSec: 600, antiSnipeExtendSec: 600 },
    });
  });

  it('продление анти-снайпа можно задать на лот, иначе — из настроек', async () => {
    const { db, auctions } = makeDb({
      drops: [{ id: 'd-1', eventId: 'e-1', itemId: 'i-1', createdAt: new Date() }],
    });
    const service = new LootService(db);
    const lot = await service.createLot(
      'e-1',
      'd-1',
      { ...LIVE_INPUT, antiSnipeExtendSec: 45 },
      RL,
      'MEMBER',
    );
    expect(lot.antiSnipeExtendSec).toBe(45);
    expect(auctions[0]).toMatchObject({ antiSnipeSec: 30, antiSnipeExtendSec: 45 });
  });

  it('дефолты работают при пустых настройках (fallback на реестр)', async () => {
    const { db } = makeDb({});
    db.setting.findMany = async () => [];
    const service = new LootService(db);
    const defaults = await service.defaultsForActor('e-1', 'i-1', RL, 'MEMBER');
    expect(defaults.startPrice).toBe(120);
    expect(defaults.live.noBidTimeoutSec).toBe(120);
  });
});
