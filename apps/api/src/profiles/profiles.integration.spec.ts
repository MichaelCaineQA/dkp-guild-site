import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import type { CombatRole, SessionUser } from '@dkp/shared';
import { ProfilesController } from './profiles.controller';
import { ProfilesService, type ProfilesDb, type ProfileTransaction } from './profiles.service';

let role: CombatRole | null = 'DPS';
let audit: Array<unknown> = [];
let failAudit = false;
let actor: SessionUser | undefined;
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
        user: { username: 'discord-player' },
      }
    : null;
}
const db: ProfilesDb = {
  member: {
    findUnique: async ({ where }) => member(where.id, role),
    update: async () => {
      throw new Error('Изменение вне транзакции');
    },
  },
  auditLog: {
    create: async () => {
      throw new Error('Аудит вне транзакции');
    },
  },
  dkpEntry: { findMany: async () => entries },
  $transaction: async (work) => {
    let draftRole = role;
    const draftAudit: unknown[] = [];
    const tx: ProfileTransaction = {
      member: {
        findUnique: async ({ where }) => member(where.id, draftRole),
        update: async ({ data }) => {
          draftRole = data.combatRole;
          return {};
        },
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
    audit = [];
    failAudit = false;
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

  it('чужую роль менять нельзя, даже через собственный endpoint офицера', async () => {
    expect((await patch('m2', { combatRole: 'HEALER', comment: 'Меняю роль' })).status).toBe(403);
    actor!.rank = 'OFFICER';
    expect((await patch('m2', { combatRole: 'HEALER', comment: 'Меняю роль' })).status).toBe(403);
    expect(role).toBe('DPS');
    expect(audit).toHaveLength(0);
  });

  it('своя роль меняется вместе с одной записью аудита, повтор не дублируется', async () => {
    const body = { combatRole: 'HEALER', comment: 'Перешёл на лечение' };
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

  it('чужие поля и пустой комментарий — 400 без изменений', async () => {
    for (const body of [
      { combatRole: 'TANK', comment: '  ' },
      { combatRole: 'TANK', comment: 'Новая роль', rank: 'ADMIN' },
      { combatRole: null, comment: 'Новая роль' },
    ]) {
      expect((await patch('m1', body)).status).toBe(400);
    }
    expect(role).toBe('DPS');
    expect(audit).toHaveLength(0);
  });

  it('ошибка аудита откатывает изменение роли', async () => {
    failAudit = true;
    expect((await patch('m1', { combatRole: 'TANK', comment: 'Смена роли' })).status).toBe(500);
    expect(role).toBe('DPS');
    expect(audit).toHaveLength(0);
  });

  it('несуществующий профиль — 404; резервный админ может читать', async () => {
    expect((await fetch(`${url}/profiles/missing`)).status).toBe(404);
    actor = { userId: 'admin:admin', username: 'Админ', memberId: null, rank: null, isAdmin: true };
    expect((await fetch(`${url}/profiles/m1`)).status).toBe(200);
    expect((await patch('m1', { combatRole: 'TANK', comment: 'Новая роль' })).status).toBe(403);
  });
});
