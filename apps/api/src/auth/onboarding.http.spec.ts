import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import type { SessionUser } from '@dkp/shared';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LinkRequestService } from './link-request.service';
import { AuditService } from '../audit/audit.service';
jest.mock('@nestjs/passport', () => ({ AuthGuard: () => class {} }));
let actor: SessionUser;
const mine = jest.fn(async () => null);
const getPending = jest.fn(async () => ({ id: 'r' }));
@Module({
  controllers: [AuthController],
  providers: [
    { provide: AuthService, useValue: {} },
    { provide: AuditService, useValue: {} },
    { provide: LinkRequestService, useValue: { mine, getPending } },
  ],
})
class TestModule {}
describe('Первая анкета: HTTP-контракт', () => {
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
    await app?.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    actor = { userId: 'own', username: 'Новый', memberId: null, rank: null, isAdmin: false };
  });
  it('отсутствующая анкета отдаёт JSON, а не пустое тело; userId берётся только из сессии', async () => {
    const response = await fetch(url + '/auth/link-request?userId=other');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ request: null });
    expect(mine).toHaveBeenCalledWith('own');
  });
  it('чужой профиль заявителя закрыт непринятому, рядовому и Офицеру', async () => {
    for (const rank of [null, 'MEMBER', 'OFFICER'] as const) {
      actor.rank = rank;
      expect((await fetch(url + '/auth/link-requests/r')).status).toBe(401);
    }
    expect(getPending).not.toHaveBeenCalled();
  });
  it('Глава и резервный Админ открывают профиль заявителя', async () => {
    actor.rank = 'GUILD_LEADER';
    expect((await fetch(url + '/auth/link-requests/r')).status).toBe(200);
    actor.rank = null;
    actor.isAdmin = true;
    expect((await fetch(url + '/auth/link-requests/r')).status).toBe(200);
  });
  it('отклонения нет даже у Админа', async () => {
    actor.isAdmin = true;
    expect((await fetch(url + '/auth/link-requests/r/reject', { method: 'POST' })).status).toBe(
      404,
    );
  });
});
