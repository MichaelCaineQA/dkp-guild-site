import { ConflictException, NotFoundException } from '@nestjs/common';
import type { MembersDb, Actor } from './members.service';
import { MembersService } from './members.service';

/** In-memory БД для тестов: достаточно интерфейса MembersDb. */
function makeDb(seed: Array<{ id: string; nickname: string; rank: string; combatRole: string | null }>) {
  const members = seed.map((m) => ({ ...m, userId: null as string | null }));
  const audit: Array<Record<string, string | null>> = [];
  const db: MembersDb = {
    member: {
      findMany: async ({ where, orderBy, include }) => {
        expect(orderBy).toEqual({ nickname: 'asc' });
        expect(include).toEqual({ user: { select: { username: true } } });
        return members
          .filter((m) => (where.rank ? m.rank === where.rank : true))
          .filter((m) => (where.combatRole ? m.combatRole === where.combatRole : true))
          .sort((a, b) => a.nickname.localeCompare(b.nickname))
          .map((m) => ({ ...m, user: m.userId ? { username: m.userId } : null }));
      },
      // Как и Prisma, фейки возвращают копии — сервис сравнивает до/после.
      findUnique: async ({ where }) => {
        const found = members.find((m) => m.id === where.id);
        return found ? { ...found } : null;
      },
      findFirst: async ({ where }) => {
        const found = members.find((m) => m.nickname === where.nickname);
        return found ? { ...found } : null;
      },
      count: async ({ where }) => members.filter((m) => m.rank === where.rank).length,
      create: async ({ data }) => {
        const member = { id: `m-${members.length + 1}`, userId: null, ...data };
        members.push(member);
        return member;
      },
      update: async ({ where, data }) => {
        const member = members.find((m) => m.id === where.id)!;
        Object.assign(member, data);
        return { ...member };
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audit.push(data);
      },
    },
  };
  return { db, members, audit };
}

const ACTOR: Actor = { memberId: 'm-actor', isAdmin: false, userId: 'u1' };

describe('MembersService.roster', () => {
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
    expect((await service.roster({ combatRole: 'HEALER' })).map((r) => r.nickname)).toEqual([
      'b',
      'c',
    ]);
    expect((await service.roster({ rank: 'MEMBER', combatRole: 'HEALER' })).map((r) => r.id)).toEqual(
      ['m-3'],
    );
  });
});

describe('MembersService.create', () => {
  it('создаёт члена и пишет MEMBER_CREATE в аудит', async () => {
    const { db, audit } = makeDb([]);
    const service = new MembersService(db);

    const member = await service.create(
      { nickname: 'NewGuy', combatRole: 'TANK', rank: 'OFFICER' },
      ACTOR,
    );
    expect(member).toMatchObject({ nickname: 'NewGuy', combatRole: 'TANK', rank: 'OFFICER' });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorMemberId: 'm-actor',
      action: 'MEMBER_CREATE',
      entityType: 'Member',
      entityId: member.id,
    });
  });

  it('создаёт рядового без роли по умолчанию', async () => {
    const { db } = makeDb([]);
    const service = new MembersService(db);

    const member = await service.create({ nickname: 'Plain' }, ACTOR);
    expect(member).toMatchObject({ rank: 'MEMBER', combatRole: null });
  });

  it('дубликат ника — 409', async () => {
    const { db } = makeDb([{ id: 'm-1', nickname: 'Taken', rank: 'MEMBER', combatRole: null }]);
    const service = new MembersService(db);

    await expect(service.create({ nickname: 'Taken' }, ACTOR)).rejects.toThrow(ConflictException);
  });
});

describe('MembersService.update', () => {
  it('меняет ник и роль, пишет MEMBER_UPDATE с деталями изменений', async () => {
    const { db, audit } = makeDb([
      { id: 'm-1', nickname: 'Old', rank: 'MEMBER', combatRole: 'DPS' },
    ]);
    const service = new MembersService(db);

    const member = await service.update('m-1', { nickname: 'New', combatRole: 'HEALER' }, ACTOR);
    expect(member).toMatchObject({ nickname: 'New', combatRole: 'HEALER', rank: 'MEMBER' });
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
      service.update('m-1', { nickname: 'Bb', combatRole: null }, ACTOR),
    ).rejects.toThrow(ConflictException);
  });

  it('несуществующий — 404', async () => {
    const { db } = makeDb([]);
    const service = new MembersService(db);

    await expect(
      service.update('m-x', { nickname: 'Xx', combatRole: null }, ACTOR),
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

  it('второго Главу понизить можно', async () => {
    const { db } = makeDb([
      { id: 'm-1', nickname: 'boss1', rank: 'GUILD_LEADER', combatRole: null },
      { id: 'm-2', nickname: 'boss2', rank: 'GUILD_LEADER', combatRole: null },
    ]);
    const service = new MembersService(db);

    const member = await service.changeRank(
      'm-2',
      { rank: 'ADMIN', comment: 'оставляем техническим админом' },
      ACTOR,
    );
    expect(member.rank).toBe('ADMIN');
  });

  it('тот же ранг — 409', async () => {
    const { db } = makeDb([{ id: 'm-1', nickname: 'a', rank: 'MEMBER', combatRole: null }]);
    const service = new MembersService(db);

    await expect(
      service.changeRank('m-1', { rank: 'MEMBER', comment: 'без изменений' }, ACTOR),
    ).rejects.toThrow(ConflictException);
  });
});
