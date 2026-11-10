import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import type { CombatRole, SessionUser } from '@dkp/shared';
import { ProfilesController } from './profiles.controller';
import { ProfilesService, type ProfilesDb, type ProfileTransaction } from './profiles.service';

let role: CombatRole | null = 'DPS';
let weapons: import('@dkp/shared').Weapon[] = ['STAFF', 'WAND'];
let avatar: import('@dkp/shared').Avatar | null = null;
let avatarColor: import('@dkp/shared').AvatarColor | null = null;
/** Предпочитаемый предмет (#101) и время его последней смены — для кулдауна. */
let preferredItemId: string | null = null;
let preferredChangedAt: Date | null = null;
/** Время последней смены роли — свой таймер кулдауна (решение 18). */
let roleChangedAt: Date | null = null;
let audit: Array<unknown> = [];
let failAudit = false;
let actor: SessionUser | undefined;
/** Полученный лут профиля (#99): перезаписывается в beforeEach. */
let loot: Array<{
  id: string;
  itemName: string;
  rarity?: string | null;
  finalPrice: number;
  markupPct?: number;
  eventId?: string;
  eventName?: string;
  createdAt: Date;
}> = [];
const entries = Array.from({ length: 10_001 }, (_, i) => ({
  id: `entry-${i}`,
  type: 'CHECKIN_EARN',
  amount: i === 0 ? -5 : 1,
  eventId: null,
  comment: 'Участие в ивенте',
  createdAt: new Date('2026-11-06T10:00:00Z'),
}));
function member(id: string, combatRole: CombatRole | null) {
  return id === 'm1' || id === 'm2'
    ? {
        id,
        nickname: 'Игрок',
        rank: 'MEMBER' as const,
        combatRole,
        combatRoleChangedAt: null,
        preferredItemId: null,
        preferredItemChangedAt: null,
        preferredItem: null,
        weapons,
        avatar,
        avatarColor,
        user: { username: 'discord-player' },
      }
    : null;
}
const db: ProfilesDb = {
  gearScoreRecord: {
    findFirst: async () => ({
      value: 1234,
      screenshotIds: ['11111111-1111-4111-8111-111111111111'],
      createdAt: new Date('2026-11-07T00:00:00Z'),
    }),
  },
  member: {
    findUnique: async ({ where }) => member(where.id, role),
    update: async () => {
      throw new Error('Изменение вне транзакции');
    },
  },
  item: {
    findUnique: async ({ where }) =>
      where.id === 'item-1' ? { id: 'item-1', name: 'Клинок рассвета' } : null,
  },
  setting: {
    findMany: async () => [] as Array<{ key: string; value: unknown }>,
  },
  auditLog: {
    create: async () => {
      throw new Error('Аудит вне транзакции');
    },
  },
  dkpEntry: { findMany: async () => entries },
      lootAward: {
    findMany: async ({ take }) =>
      loot.slice(0, take).map((award, index) => ({
        id: award.id,
        finalPrice: award.finalPrice,
        markupPct: award.markupPct ?? 0,
        discountPct: 0,
        createdAt: award.createdAt,
        auction: {
          id: `lot-${index}`,
          lootDrop: {
            event: {
              id: award.eventId ?? 'e-1',
              name: award.eventName ?? 'Поход',
              startsAt: new Date('2026-11-10T18:00:00Z'),
            },
            item: { name: award.itemName, rarity: award.rarity ?? null },
          },
        },
      })),
    count: async () => loot.length,
  },
  $transaction: async (work) => {
    let draftRole = role;
    let draftRoleChangedAt = roleChangedAt;
    let draftWeapons = [...weapons];
    let draftAvatar = avatar;
    let draftAvatarColor = avatarColor;
    let draftPreferredItemId = preferredItemId;
    let draftPreferredChangedAt = preferredChangedAt;
    const draftAudit: unknown[] = [];
    const tx: ProfileTransaction = {
      member: {
        findUnique: async ({ where }) => {
          const found = member(where.id, draftRole);
          return found
            ? {
                ...found,
                weapons: draftWeapons,
                avatar: draftAvatar,
                avatarColor: draftAvatarColor,
                combatRoleChangedAt: draftRoleChangedAt,
                preferredItemId: draftPreferredItemId,
                preferredItemChangedAt: draftPreferredChangedAt,
                preferredItem: draftPreferredItemId
                  ? { id: draftPreferredItemId, name: 'Клинок рассвета' }
                  : null,
              }
            : null;
        },
        update: async ({ data }) => {
          if (data.combatRole !== undefined) draftRole = data.combatRole;
          if (data.combatRoleChangedAt !== undefined)
            draftRoleChangedAt = data.combatRoleChangedAt;
          if (data.weapons !== undefined) draftWeapons = data.weapons;
          if (data.avatar !== undefined) draftAvatar = data.avatar;
          if (data.avatarColor !== undefined) draftAvatarColor = data.avatarColor;
          if (data.preferredItemId !== undefined) draftPreferredItemId = data.preferredItemId;
          if (data.preferredItemChangedAt !== undefined)
            draftPreferredChangedAt = data.preferredItemChangedAt;
          return {};
        },
      },
      item: {
        findUnique: async ({ where }) =>
          where.id === 'item-1' ? { id: 'item-1', name: 'Клинок рассвета' } : null,
      },
      setting: {
        findMany: async () => [] as Array<{ key: string; value: unknown }>,
      },
      auditLog: {
        create: async ({ data }) => {
          if (failAudit) throw new Error('Аудит недоступен');
          draftAudit.push(data);
          return {};
        },
      },
    };
    const result = await work(tx);
    role = draftRole;
    roleChangedAt = draftRoleChangedAt;
    weapons = draftWeapons;
    avatar = draftAvatar;
    avatarColor = draftAvatarColor;
    preferredItemId = draftPreferredItemId;
    preferredChangedAt = draftPreferredChangedAt;
    audit.push(...draftAudit);
    return result;
  },
};
@Module({
  controllers: [ProfilesController],
  providers: [{ provide: ProfilesService, useValue: new ProfilesService(db) }],
})
class TestModule {}

describe('профили через HTTP', () => {
  let app: INestApplication;
  let url: string;
  beforeAll(async () => {
    app = await NestFactory.create(TestModule, { logger: false });
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, { session: { user: actor } });
      next();
    });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    actor = { userId: 'u1', username: 'Игрок', memberId: 'm1', rank: 'MEMBER', isAdmin: false };
    role = 'DPS';
    weapons = ['STAFF', 'WAND'];
    avatar = null;
    avatarColor = null;
    preferredItemId = null;
    preferredChangedAt = null;
    roleChangedAt = null;
    audit = [];
    failAudit = false;
    loot = [];
  });
  const patch = (id: string, body: unknown) =>
    fetch(`${url}/profiles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('анониму — 401, непривязанному аккаунту — 403', async () => {
    actor = undefined;
    expect((await fetch(`${url}/profiles/m1`)).status).toBe(401);
    actor = { userId: 'u3', username: 'Новый', memberId: null, rank: null, isAdmin: false };
    expect((await fetch(`${url}/profiles/m1`)).status).toBe(403);
  });

  it('баланс учитывает больше 10000 записей, история содержит последние 10', async () => {
    const result = await fetch(`${url}/profiles/m2`);
    expect(result.status).toBe(200);
    const profile = (await result.json()) as {
      balance: number;
      recentEntries: unknown[];
      discord: string;
    };
    expect(profile.balance).toBe(9995);
    expect(profile.recentEntries).toHaveLength(10);
    expect(profile.discord).toBe('discord-player');
  });

  it('полученный лут в профиле: свежие выдачи с фактической стоимостью (#99)', async () => {
    loot = [
      {
        id: 'w-2',
        itemName: 'Щит стража',
        finalPrice: 90,
        eventName: 'Поход',
        createdAt: new Date('2026-11-10T19:00:00Z'),
      },
      {
        id: 'w-1',
        itemName: 'Клинок зари',
        rarity: 'эпический',
        finalPrice: 225,
        markupPct: 50,
        eventName: 'Осада',
        createdAt: new Date('2026-11-09T19:00:00Z'),
      },
    ];
    const profile = (await (await fetch(`${url}/profiles/m1`)).json()) as {
      loot: Array<{ awardId: string; itemName: string; finalPrice: number }>;
      lootTotal: number;
    };
    // свежие сверху, стоимость и наценка как в фактической записи журнала
    expect(profile.loot.map((award) => award.awardId)).toEqual(['w-2', 'w-1']);
    expect(profile.loot[1]).toMatchObject({ itemName: 'Клинок зари', finalPrice: 225 });
    expect(profile.lootTotal).toBe(2);
  });

  it('без выдач лут в профиле пуст — не «отсутствующие награды»', async () => {
    const profile = (await (await fetch(`${url}/profiles/m1`)).json()) as {
      loot: unknown[];
      lootTotal: number;
    };
    expect(profile.loot).toEqual([]);
    expect(profile.lootTotal).toBe(0);
  });

  it('GS отсутствует в чужом профиле у рядового и Офицера, но есть в своём и у Главы/Админа', async () => {
    for (const rank of ['MEMBER', 'OFFICER'] as const) {
      actor!.rank = rank;
      expect(await (await fetch(`${url}/profiles/m2`)).json()).not.toHaveProperty('gearScore');
    }
    expect(await (await fetch(`${url}/profiles/m1`)).json()).toHaveProperty(
      'gearScore.value',
      1234,
    );
    actor!.rank = 'GUILD_LEADER';
    expect(await (await fetch(`${url}/profiles/m2`)).json()).toHaveProperty(
      'gearScore.value',
      1234,
    );
    actor = { userId: 'admin:a', username: 'a', isAdmin: true, memberId: null, rank: null };
    expect(await (await fetch(`${url}/profiles/m2`)).json()).toHaveProperty(
      'gearScore.value',
      1234,
    );
  });

  it('чужую роль менять нельзя, даже через собственный endpoint офицера', async () => {
    expect(
      (
        await patch('m2', {
          weapons: ['STAFF', 'WAND'],
          combatRole: 'HEALER',
          comment: 'Меняю роль',
        })
      ).status,
    ).toBe(403);
    actor!.rank = 'OFFICER';
    expect(
      (
        await patch('m2', {
          weapons: ['STAFF', 'WAND'],
          combatRole: 'HEALER',
          comment: 'Меняю роль',
        })
      ).status,
    ).toBe(403);
    expect(role).toBe('DPS');
    expect(audit).toHaveLength(0);
  });

  it('своя роль меняется вместе с одной записью аудита, повтор не дублируется', async () => {
    const body = {
      weapons: ['STAFF', 'WAND'],
      combatRole: 'HEALER',
      comment: 'Перешёл на лечение',
    };
    expect((await patch('m1', body)).status).toBe(200);
    expect((await patch('m1', body)).status).toBe(200);
    expect(role).toBe('HEALER');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorMemberId: 'm1',
      entityId: 'm1',
      action: 'MEMBER_UPDATE',
      comment: expect.stringContaining(body.comment),
    });
  });

  it('смена только пары оружий сохраняется и журналируется', async () => {
    expect(
      (
        await patch('m1', {
          combatRole: 'DPS',
          weapons: ['SPEAR', 'DAGGERS'],
          comment: 'Новая пара оружий',
        })
      ).status,
    ).toBe(200);
    expect(weapons).toEqual(['SPEAR', 'DAGGERS']);
    expect(role).toBe('DPS');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ comment: expect.stringContaining('Копьё / Кинжалы') });
  });

  it('смена аватара сохраняется с аудитом и отклоняет неизвестные значения', async () => {
    const body = {
      combatRole: 'DPS',
      weapons: ['STAFF', 'WAND'],
      avatar: 'OCEAN',
    };
    expect((await patch('m1', body)).status).toBe(200);
    expect((await patch('m1', body)).status).toBe(200);
    expect(avatar).toBe('OCEAN');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ comment: expect.stringContaining('OCEAN') });
    expect((await patch('m1', { ...body, avatar: 'INVALID' })).status).toBe(400);
    expect((await patch('m1', { ...body, combatRole: 'TANK' })).status).toBe(400);
  });
  it('аватар можно сменить в старом профиле без роли и оружия', async () => {
    role = null;
    weapons = [];
    expect((await patch('m1', { avatar: 'OCEAN' })).status).toBe(200);
    expect(avatar).toBe('OCEAN');
    expect(role).toBeNull();
    expect(weapons).toEqual([]);
    expect(audit).toHaveLength(1);
  });
  it('цвет меняется независимо от картинки, проверяется и журналируется', async () => {
    const body = {
      combatRole: 'DPS',
      weapons: ['STAFF', 'WAND'],
      avatar: 'FOX',
      avatarColor: 'BLUE',
      comment: 'Синий фон',
    };
    expect((await patch('m1', body)).status).toBe(200);
    expect((await patch('m1', body)).status).toBe(200);
    expect(avatar).toBe('FOX');
    expect(avatarColor).toBe('BLUE');
    expect(audit).toHaveLength(1);
    expect((await patch('m1', { ...body, avatarColor: 'RED' })).status).toBe(200);
    expect(avatar).toBe('FOX');
    expect(avatarColor).toBe('RED');
    expect((await patch('m1', { ...body, avatarColor: 'INVALID' })).status).toBe(400);
  });

  it('чужие поля и пустой комментарий — 400 без изменений', async () => {
    for (const body of [
      { weapons: ['STAFF', 'WAND'], combatRole: 'TANK', comment: '  ' },
      { weapons: ['STAFF', 'WAND'], combatRole: 'TANK', comment: 'Новая роль', rank: 'ADMIN' },
      { weapons: ['STAFF', 'WAND'], combatRole: null, comment: 'Новая роль' },
      { weapons: ['STAFF', 'STAFF'], combatRole: 'DPS', comment: 'Дубли' },
      { weapons: ['ORB', 'STAFF'], combatRole: 'DPS', comment: 'Не RU оружие' },
      { combatRole: 'DPS', comment: 'Оружие не выбрано' },
    ]) {
      expect((await patch('m1', body)).status).toBe(400);
    }
    expect(role).toBe('DPS');
    expect(audit).toHaveLength(0);
  });

  it('ошибка аудита откатывает изменение роли', async () => {
    failAudit = true;
    expect(
      (await patch('m1', { weapons: ['STAFF', 'WAND'], combatRole: 'TANK', comment: 'Смена роли' }))
        .status,
    ).toBe(500);
    expect(role).toBe('DPS');
    expect(audit).toHaveLength(0);
  });

  it('несуществующий профиль — 404; резервный админ может читать', async () => {
    expect((await fetch(`${url}/profiles/missing`)).status).toBe(404);
    actor = { userId: 'admin:admin', username: 'Админ', memberId: null, rank: null, isAdmin: true };
    expect((await fetch(`${url}/profiles/m1`)).status).toBe(200);
    expect(
      (await patch('m1', { weapons: ['STAFF', 'WAND'], combatRole: 'TANK', comment: 'Новая роль' }))
        .status,
    ).toBe(403);
  });

  it('предпочитаемый предмет: первый выбор сразу, смена и снятие — по кулдауну (#101)', async () => {
    // Первый выбор — сразу, с комментарием (смена полей профиля).
    expect((await patch('m1', { preferredItemId: 'item-1', comment: 'Мой предмет' })).status).toBe(
      200,
    );
    expect(preferredItemId).toBe('item-1');
    expect(preferredChangedAt).not.toBeNull();
    expect(audit).toHaveLength(1);
    expect(String((audit[0] as { comment: string }).comment)).toContain('Клинок рассвета');

    // Тот же предмет повторно — без изменений, новый аудит не пишется.
    expect((await patch('m1', { preferredItemId: 'item-1', comment: 'То же самое' })).status).toBe(
      200,
    );
    expect(audit).toHaveLength(1);

    // Смена до истечения интервала — 409 (решение 18: раз в 2 недели по умолчанию).
    expect((await patch('m1', { preferredItemId: null, comment: 'Снять выбор' })).status).toBe(
      409,
    );
    expect(preferredItemId).toBe('item-1');

    // После истечения интервала смена разрешена, включая снятие.
    preferredChangedAt = new Date(Date.now() - 15 * 86_400_000);
    expect((await patch('m1', { preferredItemId: null, comment: 'Снимаю выбор' })).status).toBe(
      200,
    );
    expect(preferredItemId).toBeNull();
    expect(audit).toHaveLength(2);
  });

  it('предпочитаемый предмет: несуществующий — 404, без комментария — 400', async () => {
    expect((await patch('m1', { preferredItemId: 'item-missing', comment: 'Нет такого' })).status).toBe(404);
    expect((await patch('m1', { preferredItemId: 'item-1' })).status).toBe(400);
    expect(preferredItemId).toBeNull();
    expect(audit).toHaveLength(0);
  });

  it('боевая роль сменяется не чаще раза в интервал, независимо от предмета (#101)', async () => {
    const body = { combatRole: 'TANK', weapons: ['SWORD_SHIELD', 'WAND'], comment: 'Новая роль' };
    expect((await patch('m1', body)).status).toBe(200);
    expect(role).toBe('TANK');
    // Повторная смена роли до истечения — 409, а предмет выбрать можно сразу.
    expect(
      (
        await patch('m1', {
          combatRole: 'HEALER',
          weapons: ['STAFF', 'WAND'],
          comment: 'Ещё раз',
        })
      ).status,
    ).toBe(409);
    expect((await patch('m1', { preferredItemId: 'item-1', comment: 'Предмет' })).status).toBe(
      200,
    );
    expect(role).toBe('TANK');
    expect(preferredItemId).toBe('item-1');
  });
});
