import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { NOOP_AUCTION_EVENTS, type AuctionEventsPort } from '../realtime/auction-events';
import type { MembersDb, Actor } from './members.service';
import { MembersService } from './members.service';

/** In-memory БД для тестов: достаточно интерфейса MembersDb. */
function makeDb(
  seed: Array<{
    id: string;
    nickname: string;
    rank: string;
    combatRole: string | null;
    blockedAt?: Date | null;
    userId?: string | null;
    timeZone?: string;
    primeTime?: import('@dkp/shared').PrimeTimeSlot[];
  }>,
  bidsSeed: Array<{ auctionId: string; memberId: string; open: boolean }> = [],
) {
  const members = seed.map((m) => ({
    weapons: ['STAFF', 'WAND'] as import('@dkp/shared').Weapon[],
    blockedAt: null as Date | null,
    userId: null as string | null,
    ...m,
  }));
  const bids = bidsSeed.map((b) => ({ ...b }));
  const audit: Array<Record<string, string | null>> = [];
  const db: MembersDb = {
    $transaction: async (work) => {
      const oldMembers = structuredClone(members);
      const oldAudit = structuredClone(audit);
      const oldBids = structuredClone(bids);
      try {
        return await work(db);
      } catch (error) {
        members.splice(0, members.length, ...oldMembers);
        audit.splice(0, audit.length, ...oldAudit);
        bids.splice(0, bids.length, ...oldBids);
        throw error;
      }
    },
    member: {
      findMany: async ({ where, orderBy, include }) => {
        expect(include.user).toEqual({ select: { username: true } });
        const byBlocked =
          where.blockedAt === undefined
            ? () => true
            : where.blockedAt === null
              ? (m: (typeof members)[number]) => m.blockedAt == null
              : (m: (typeof members)[number]) => m.blockedAt != null;
        const rows = members
          .filter(byBlocked)
          .filter((m) => (where.rank ? m.rank === where.rank : true))
          .filter((m) => (where.weapons ? m.weapons.includes(where.weapons.has) : true))
          .filter((m) => (where.combatRole ? m.combatRole === where.combatRole : true));
        if ('blockedAt' in orderBy && orderBy.blockedAt === 'desc') {
          rows.sort((a, b) => (b.blockedAt?.getTime() ?? 0) - (a.blockedAt?.getTime() ?? 0));
        } else {
          rows.sort((a, b) => a.nickname.localeCompare(b.nickname));
        }
        return rows.map((m) => ({ ...m, user: m.userId ? { username: m.userId } : null }));
      },
      // Как и Prisma, фейки возвращают копии — сервис сравнивает до/после.
      findUnique: async ({ where }) => {
        const found = members.find((m) => m.id === where.id);
        return found ? { ...found } : null;
      },
      findFirst: async ({ where }) => {
        const found = members.find((m) =>
          where.nickname !== undefined ? m.nickname === where.nickname : m.rank === where.rank,
        );
        return found ? { ...found } : null;
      },
      count: async ({ where }) => members.filter((m) => m.rank === where.rank).length,
      create: async ({ data }) => {
        const member = { id: `m-${members.length + 1}`, userId: null, blockedAt: null, ...data };
        members.push(member);
        return member;
      },
      update: async ({ where, data }) => {
        const member = members.find((m) => m.id === where.id)!;
        Object.assign(member, data);
        return { ...member };
      },
    },
    bid: {
      findMany: async ({ where }) =>
        bids
          .filter((b) => b.memberId === where.memberId && b.open)
          .map((b) => ({ auctionId: b.auctionId })),
      deleteMany: async ({ where }) => {
        const victims = bids.filter(
          (b) => b.memberId === where.memberId && b.open === (where.auction.status === 'OPEN'),
        );
        for (const victim of victims) {
          bids.splice(bids.indexOf(victim), 1);
        }
        return { count: victims.length };
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audit.push({ actorMemberId: data.actorMemberId, action: data.action, entityType: data.entityType, entityId: data.entityId, comment: data.comment ?? null });
      },
    },
  };
  return { db, members, bids, audit };
}

const ACTOR: Actor = { memberId: 'm-actor', isAdmin: false, userId: 'u1' };

describe('MembersService.roster', () => {
  it('фильтрует доступных на стыке дней вместе с рангом', async () => {
    const { db } = makeDb([
      { id: 'a', nickname: 'a', rank: 'MEMBER', combatRole: 'DPS', timeZone: 'Europe/Moscow', primeTime: [{ weekday: 1, fromMinute: 0, toMinute: 60 }] },
      { id: 'b', nickname: 'b', rank: 'MEMBER', combatRole: 'DPS', timeZone: 'Europe/Moscow', primeTime: [{ weekday: 0, fromMinute: 1380, toMinute: 1440 }] },
      { id: 'c', nickname: 'c', rank: 'OFFICER', combatRole: 'DPS', timeZone: 'Europe/Moscow', primeTime: [{ weekday: 1, fromMinute: 0, toMinute: 60 }] },
      { id: 'd', nickname: 'd', rank: 'MEMBER', combatRole: 'DPS' },
    ]);
    const service = new MembersService(db, () => new Date('2026-11-16T21:00:00Z'));
    expect((await service.roster({ availableNow: 'true', rank: 'MEMBER' })).map((row) => row.id)).toEqual(['a']);
  });
  it('возвращает состав, отсортированный по нику, с Discord-именем', async () => {
    const { db, members } = makeDb([
      { id: 'm-1', nickname: 'Zeta', rank: 'MEMBER', combatRole: 'DPS' },
      { id: 'm-2', nickname: 'Alpha', rank: 'OFFICER', combatRole: null },
    ]);
    members[0]!.userId = 'discord-zeta';
    const service = new MembersService(db);

    const rows = await service.roster({});
    expect(rows.map((r) => r.nickname)).toEqual(['Alpha', 'Zeta']);
    expect(rows[1]).toMatchObject({ discord: 'discord-zeta', combatRole: 'DPS' });
    expect(rows[0]).toMatchObject({ discord: null, rank: 'OFFICER' });
  });

  it('фильтрует по рангу и роли в бою', async () => {
    const { db } = makeDb([
      { id: 'm-1', nickname: 'a', rank: 'MEMBER', combatRole: 'DPS' },
      { id: 'm-2', nickname: 'b', rank: 'OFFICER', combatRole: 'HEALER' },
      { id: 'm-3', nickname: 'c', rank: 'MEMBER', combatRole: 'HEALER' },
    ]);
    const service = new MembersService(db);

    expect((await service.roster({ rank: 'MEMBER' })).map((r) => r.nickname)).toEqual(['a', 'c']);
    expect(await service.roster({ weapon: 'STAFF' })).toHaveLength(3);
    expect(await service.roster({ weapon: 'SPEAR' })).toHaveLength(0);
    expect((await service.roster({ combatRole: 'HEALER' })).map((r) => r.nickname)).toEqual([
      'b',
      'c',
    ]);
    expect(
      (await service.roster({ rank: 'MEMBER', combatRole: 'HEALER' })).map((r) => r.id),
    ).toEqual(['m-3']);
  });
});

describe('MembersService.create', () => {
  it('создаёт члена и пишет MEMBER_CREATE в аудит', async () => {
    const { db, audit } = makeDb([]);
    const service = new MembersService(db);

    const member = await service.create(
      { weapons: ['STAFF', 'WAND'], nickname: 'NewGuy', combatRole: 'TANK', rank: 'OFFICER' },
      ACTOR,
    );
    expect(member).toMatchObject({
      weapons: ['STAFF', 'WAND'],
      nickname: 'NewGuy',
      combatRole: 'TANK',
      rank: 'OFFICER',
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorMemberId: 'm-actor',
      action: 'MEMBER_CREATE',
      entityType: 'Member',
      entityId: member.id,
    });
  });

  it('по умолчанию создаёт рядового с явно указанной ролью', async () => {
    const { db } = makeDb([]);
    const service = new MembersService(db);

    const member = await service.create(
      { weapons: ['STAFF', 'WAND'], nickname: 'Plain', combatRole: 'DPS' },
      ACTOR,
    );
    expect(member).toMatchObject({ rank: 'MEMBER', combatRole: 'DPS' });
  });

  it('дубликат ника — 409', async () => {
    const { db } = makeDb([{ id: 'm-1', nickname: 'Taken', rank: 'MEMBER', combatRole: null }]);
    const service = new MembersService(db);

    await expect(
      service.create({ weapons: ['STAFF', 'WAND'], nickname: 'Taken', combatRole: 'DPS' }, ACTOR),
    ).rejects.toThrow(ConflictException);
  });
});

describe('MembersService.update', () => {
  it('меняет ник и роль, пишет MEMBER_UPDATE с деталями изменений', async () => {
    const { db, audit } = makeDb([
      { id: 'm-1', nickname: 'Old', rank: 'MEMBER', combatRole: 'DPS' },
    ]);
    const service = new MembersService(db);

    const member = await service.update(
      'm-1',
      { weapons: ['STAFF', 'WAND'], nickname: 'New', combatRole: 'HEALER' },
      ACTOR,
    );
    expect(member).toMatchObject({
      weapons: ['STAFF', 'WAND'],
      nickname: 'New',
      combatRole: 'HEALER',
      rank: 'MEMBER',
    });
    expect(audit[0]!.comment).toContain('ник «Old» → «New»');
    expect(audit[0]!.comment).toContain('роль в бою «DPS» → «HEALER»');
  });

  it('ник в чужой карточке занят — 409', async () => {
    const { db } = makeDb([
      { id: 'm-1', nickname: 'Aa', rank: 'MEMBER', combatRole: null },
      { id: 'm-2', nickname: 'Bb', rank: 'MEMBER', combatRole: null },
    ]);
    const service = new MembersService(db);

    await expect(
      service.update(
        'm-1',
        { weapons: ['STAFF', 'WAND'], nickname: 'Bb', combatRole: 'DPS' },
        ACTOR,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('несуществующий — 404', async () => {
    const { db } = makeDb([]);
    const service = new MembersService(db);

    await expect(
      service.update(
        'm-x',
        { weapons: ['STAFF', 'WAND'], nickname: 'Xx', combatRole: 'DPS' },
        ACTOR,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('MembersService.changeRank', () => {
  it('меняет ранг, пишет ROLE_CHANGE с комментарием', async () => {
    const { db, audit } = makeDb([
      { id: 'm-1', nickname: 'a', rank: 'MEMBER', combatRole: null },
      { id: 'm-2', nickname: 'boss', rank: 'GUILD_LEADER', combatRole: null },
    ]);
    const service = new MembersService(db);

    const member = await service.changeRank(
      'm-1',
      { rank: 'OFFICER', comment: 'Новый офицер, опека пака Альфа' },
      ACTOR,
    );
    expect(member.rank).toBe('OFFICER');
    expect(audit[0]).toMatchObject({
      action: 'ROLE_CHANGE',
      entityId: 'm-1',
      actorMemberId: 'm-actor',
    });
    expect(audit[0]!.comment).toContain('«MEMBER» → «OFFICER»');
    expect(audit[0]!.comment).toContain('опека пака Альфа');
  });

  it('последнего Главу понизить нельзя — 409', async () => {
    const { db } = makeDb([
      { id: 'm-1', nickname: 'boss', rank: 'GUILD_LEADER', combatRole: null },
    ]);
    const service = new MembersService(db);

    await expect(
      service.changeRank('m-1', { rank: 'OFFICER', comment: 'уход' }, ACTOR),
    ).rejects.toThrow(ConflictException);
  });

  it('Глава в OFFICER — можно, если есть другой Глава (самопонижение сценария нет: один Глава)', async () => {
    const { db } = makeDb([
      { id: 'm-1', nickname: 'boss1', rank: 'GUILD_LEADER', combatRole: null },
      { id: 'm-2', nickname: 'off', rank: 'OFFICER', combatRole: null },
    ]);
    const service = new MembersService(db);

    // Единственного Главу понизить нельзя
    await expect(
      service.changeRank('m-1', { rank: 'OFFICER', comment: 'передача' }, ACTOR),
    ).rejects.toThrow(ConflictException);

    const member = await service.changeRank(
      'm-2',
      { rank: 'MEMBER', comment: 'понижение офицера' },
      ACTOR,
    );
    expect(member.rank).toBe('MEMBER');
  });

  it('тот же ранг — 409', async () => {
    const { db } = makeDb([{ id: 'm-1', nickname: 'a', rank: 'MEMBER', combatRole: null }]);
    const service = new MembersService(db);

    await expect(
      service.changeRank('m-1', { rank: 'MEMBER', comment: 'без изменений' }, ACTOR),
    ).rejects.toThrow(ConflictException);
  });
});

describe('Ранги ADMIN/GUILD_LEADER не назначаются (решение владельца)', () => {
  it('changeRank на ADMIN — 409', async () => {
    const { db } = makeDb([{ id: 'm-1', nickname: 'Игрок', rank: 'MEMBER', combatRole: null }]);
    const service = new MembersService(db);

    await expect(
      service.changeRank('m-1', { rank: 'ADMIN', comment: 'попытка' }, ACTOR),
    ).rejects.toThrow(ConflictException);
  });

  it('changeRank на GUILD_LEADER запрещён не Админу', async () => {
    const { db } = makeDb([{ id: 'm-1', nickname: 'Игрок', rank: 'MEMBER', combatRole: null }]);
    const service = new MembersService(db);

    await expect(
      service.changeRank('m-1', { rank: 'GUILD_LEADER', comment: 'попытка' }, ACTOR),
    ).rejects.toThrow(ForbiddenException);
  });

  it('Админ передаёт Главу атомарно, прежний становится рядовым', async () => {
    const { db, members, audit } = makeDb([
      { id: 'old', nickname: 'Старый', rank: 'GUILD_LEADER', combatRole: null },
      { id: 'new', nickname: 'Новый', rank: 'OFFICER', combatRole: null },
    ]);
    const service = new MembersService(db);
    await service.changeRank(
      'new',
      { rank: 'GUILD_LEADER', comment: 'Передача' },
      { memberId: null, isAdmin: true, userId: 'admin' },
    );
    expect(members.map((m) => m.rank)).toEqual(['MEMBER', 'GUILD_LEADER']);
    expect(audit[0]?.comment).toContain(
      'ранг OFFICER → GUILD_LEADER; прежний Глава: Старый, GUILD_LEADER → MEMBER',
    );
  });

  it('первое назначение и повторное назначение', async () => {
    const { db, members, audit } = makeDb([
      { id: 'new', nickname: 'Новый', rank: 'MEMBER', combatRole: null },
    ]);
    const service = new MembersService(db);
    const admin = { memberId: null, isAdmin: true, userId: 'admin' };
    await service.changeRank('new', { rank: 'GUILD_LEADER', comment: 'Назначение' }, admin);
    await expect(
      service.changeRank('new', { rank: 'GUILD_LEADER', comment: 'Повтор' }, admin),
    ).rejects.toThrow(ConflictException);
    expect(members[0]?.rank).toBe('GUILD_LEADER');
    expect(audit).toHaveLength(1);
  });

  it('create с рангом GUILD_LEADER — 409', async () => {
    const { db } = makeDb([]);
    const service = new MembersService(db);

    await expect(
      service.create(
        { weapons: ['STAFF', 'WAND'], nickname: 'Новый', combatRole: 'DPS', rank: 'GUILD_LEADER' },
        ACTOR,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('MembersService.block/unblock (issue #149)', () => {
  const FIXED = new Date('2026-11-14T12:00:00Z');
  /** Порт событий с записью вызовов bidsRemoved/userAccessRevoked. */
  const makeEvents = () => {
    const removed: string[] = [];
    const revoked: string[] = [];
    const events: AuctionEventsPort = {
      ...NOOP_AUCTION_EVENTS,
      bidsRemoved: (auctionId) => {
        removed.push(auctionId);
      },
      userAccessRevoked: (userId) => {
        revoked.push(userId);
      },
    };
    return { events, removed, revoked };
  };

  it('блокирует, снимает активные ставки, шлёт срез лотов и пишет аудит', async () => {
    const { db, members, bids, audit } = makeDb(
      [{ id: 'm-1', nickname: 'Ушёл', rank: 'MEMBER', combatRole: 'DPS', userId: 'u-1' }],
      [
        { auctionId: 'a-1', memberId: 'm-1', open: true },
        { auctionId: 'a-1', memberId: 'm-2', open: true },
        { auctionId: 'a-2', memberId: 'm-1', open: true },
        { auctionId: 'a-3', memberId: 'm-1', open: false },
      ],
    );
    const { events, removed, revoked } = makeEvents();
    const service = new MembersService(db, () => FIXED, events);

    const row = await service.block('m-1', { comment: 'Покинул гильдию' }, ACTOR);

    expect(row.blockedAt).toBe(FIXED.toISOString());
    expect(members[0]!.blockedAt).toEqual(FIXED);
    // Ставки на открытых лотах сняты, чужая и закрытый лот не тронуты
    expect(bids).toEqual([
      { auctionId: 'a-1', memberId: 'm-2', open: true },
      { auctionId: 'a-3', memberId: 'm-1', open: false },
    ]);
    // Один вызов на каждый затронутый лот (уникальные id)
    expect(removed).toEqual(['a-1', 'a-2']);
    // Сокеты заблокированного пользователя закрываются (аудит F02)
    expect(revoked).toEqual(['u-1']);
    expect(audit[0]).toMatchObject({ action: 'MEMBER_BLOCK', entityId: 'm-1' });
    expect(audit[0]!.comment).toContain('снято активных ставок: 2');
    expect(audit[0]!.comment).toContain('Покинул гильдию');
  });

  it('без ставок — аудит без упоминания ставок, событий лотов нет', async () => {
    const { db, audit } = makeDb([
      { id: 'm-1', nickname: 'Ушёл', rank: 'MEMBER', combatRole: null, userId: 'u-1' },
    ]);
    const { events, removed, revoked } = makeEvents();
    const service = new MembersService(db, () => FIXED, events);

    await service.block('m-1', { comment: 'Ушёл сам' }, ACTOR);

    expect(audit[0]!.comment).not.toContain('ставок');
    expect(removed).toEqual([]);
    expect(revoked).toEqual(['u-1']);
    expect(events).toBeDefined();
  });

  it('повторная блокировка, Глава и короткий комментарий отклоняются', async () => {
    const { db } = makeDb([
      { id: 'm-1', nickname: 'Уже', rank: 'MEMBER', combatRole: null, blockedAt: FIXED },
      { id: 'm-2', nickname: 'Глава', rank: 'GUILD_LEADER', combatRole: null },
    ]);
    const service = new MembersService(db, () => FIXED);

    await expect(service.block('m-1', { comment: 'Ещё раз' }, ACTOR)).rejects.toThrow(
      ConflictException,
    );
    await expect(service.block('m-2', { comment: 'Главу блок' }, ACTOR)).rejects.toThrow(
      ConflictException,
    );
    await expect(
      service.block('m-x', { comment: 'Нет такого' }, ACTOR),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.block('m-1', { comment: 'ок' }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('состав скрывает заблокированных, вкладка заблокированных их показывает', async () => {
    const { db } = makeDb([
      { id: 'm-1', nickname: 'Жив', rank: 'MEMBER', combatRole: null },
      { id: 'm-2', nickname: 'Ушёл', rank: 'MEMBER', combatRole: null, blockedAt: FIXED },
    ]);
    const service = new MembersService(db);

    expect((await service.roster({})).map((r) => r.id)).toEqual(['m-1']);
    const blocked = await service.blocked();
    expect(blocked.map((r) => r.id)).toEqual(['m-2']);
    expect(blocked[0]).toMatchObject({ nickname: 'Ушёл', blockedAt: FIXED.toISOString() });
  });

  it('разблокировка возвращает в состав и пишет аудит; не заблокированного — 409', async () => {
    const { db, members, audit } = makeDb([
      { id: 'm-1', nickname: 'Вернулся', rank: 'MEMBER', combatRole: null, blockedAt: FIXED },
    ]);
    const service = new MembersService(db);

    const row = await service.unblock('m-1', { comment: 'Вернулся в гильдию' }, ACTOR);

    expect(row).toMatchObject({ id: 'm-1', nickname: 'Вернулся' });
    expect(members[0]!.blockedAt).toBeNull();
    expect(audit[0]).toMatchObject({ action: 'MEMBER_UNBLOCK', entityId: 'm-1' });
    expect(audit[0]!.comment).toContain('Вернулся в гильдию');
    await expect(service.unblock('m-1', { comment: 'Ещё раз' }, ACTOR)).rejects.toThrow(
      ConflictException,
    );
  });
});
