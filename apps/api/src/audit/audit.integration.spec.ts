import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import type { SessionUser } from '@dkp/shared';
import { AuditController } from './audit.controller';
import { AuditService, type AuditDb } from './audit.service';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { LinkRequestService } from '../auth/link-request.service';

// OAuth-переходы не входят в эти HTTP-сценарии; ESM passport не грузим в Jest CJS.
jest.mock('@nestjs/passport', () => ({
  AuthGuard: () =>
    class {
      canActivate() {
        return true;
      }
    },
}));

const record = jest.fn(async () => ({}));
const findMany = jest.fn(async () => [
  {
    id: 'log-1',
    actorMemberId: 'm1',
    action: 'ROLE_CHANGE',
    entityType: 'Member',
    entityId: 'm2',
    comment: 'Назначен офицером',
    createdAt: new Date('2026-11-06T12:00:00Z'),
    actor: { nickname: 'Глава' },
  },
]);
const count = jest.fn(async () => 1);
const db: AuditDb = {
  auditLog: { create: record, findMany, count, groupBy: async () => [{ action: 'ROLE_CHANGE' }] },
};
const login = jest.fn(() => true);
const approve = jest.fn(async () => ({ ok: true }));
let actor: SessionUser | undefined;
@Module({
  controllers: [AuditController, AuthController],
  providers: [
    { provide: AuditService, useValue: new AuditService(db) },
    { provide: AuthService, useValue: { isAdminCredentials: login } },
    { provide: LinkRequestService, useValue: { approve } },
  ],
})
class TestModule {}

describe('аудит через HTTP: права, фильтры, ровно одна запись', () => {
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
    jest.clearAllMocks();
    actor = { userId: 'u1', username: 'Офицер', memberId: 'm1', rank: 'OFFICER', isAdmin: false };
    login.mockReturnValue(true);
  });

  it('аноним получает 401, рядовой — 403 без чтения журнала', async () => {
    actor = undefined;
    expect((await fetch(`${url}/audit`)).status).toBe(401);
    actor = { userId: 'u2', username: 'Игрок', memberId: 'm2', rank: 'MEMBER', isAdmin: false };
    expect((await fetch(`${url}/audit`)).status).toBe(403);
    expect((await fetch(`${url}/audit/actions`)).status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('офицер фильтрует по актору, действию, UTC-периоду и странице', async () => {
    const response = await fetch(
      `${url}/audit?actorMemberId=m1&action=ROLE_CHANGE&from=2026-11-01T00:00:00Z&to=2026-11-07T00:00:00Z&offset=50`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ entries: [{ actorName: 'Глава' }] });
    const where = {
      actorMemberId: 'm1',
      action: 'ROLE_CHANGE',
      createdAt: { gte: new Date('2026-11-01T00:00:00Z'), lte: new Date('2026-11-07T00:00:00Z') },
    };
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 50, take: 50 }));
    expect(count).toHaveBeenCalledWith({ where });
  });

  it('совмещает Систему, сущность и период, не превращает system=false в true', async () => {
    const response = await fetch(
      url + '/audit?system=true&entityType=Event&from=2026-11-01&limit=10',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          actorMemberId: null,
          entityType: 'Event',
          createdAt: { gte: new Date('2026-11-01'), lte: undefined },
        },
        take: 10,
      }),
    );
    findMany.mockClear();
    expect((await fetch(url + '/audit?system=false&entityType=Pack')).status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { entityType: 'Pack' } }),
    );
  });
  it('не принимает двух авторов или некорректный системный фильтр', async () => {
    expect((await fetch(url + '/audit?system=true&actorMemberId=m1')).status).toBe(400);
    expect((await fetch(url + '/audit?system=invalid')).status).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
  });
  it('неверный период и неограниченный размер страницы отклоняются', async () => {
    expect((await fetch(`${url}/audit?limit=10000`)).status).toBe(400);
    expect((await fetch(`${url}/audit?from=2026-11-07&to=2026-11-01`)).status).toBe(400);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('резервный админ без Member видит журнал', async () => {
    actor = { userId: 'admin:admin', username: 'Админ', memberId: null, rank: null, isAdmin: true };
    expect((await fetch(`${url}/audit`)).status).toBe(200);
  });

  it('успешный вход пишет одну запись без пароля, неверный — ни одной', async () => {
    const request = () =>
      fetch(`${url}/auth/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'admin', password: 'private-test-value' }),
      });
    expect((await request()).status).toBe(200);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]).toEqual([
      {
        data: expect.objectContaining({
          action: 'LOGIN_ADMIN',
          actorMemberId: null,
          entityId: 'admin:admin',
        }),
      },
    ]);
    expect(JSON.stringify(record.mock.calls)).not.toContain('private-test-value');
    record.mockClear();
    login.mockReturnValue(false);
    expect(await (await request()).json()).toMatchObject({ ok: false });
    expect(record).not.toHaveBeenCalled();
  });

  it('приём делегирует аудит транзакционному сервису и не дублирует интерцептором', async () => {
    actor!.rank = 'GUILD_LEADER';
    expect(
      (await fetch(`${url}/auth/link-requests/link1/approve`, { method: 'POST' })).status,
    ).toBe(201);
    expect(approve).toHaveBeenCalledWith('link1', 'm1');
    expect(record).not.toHaveBeenCalled();
    await fetch(`${url}/audit`);
    expect(record).not.toHaveBeenCalled();
  });
});
