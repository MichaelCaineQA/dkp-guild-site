import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { NextFunction, Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LinkRequestService } from './link-request.service';
import { AuditService } from '../audit/audit.service';
import { BidsController } from '../bids/bids.controller';
import { BidsService } from '../bids/bids.service';
import { CheckInController } from '../checkin/checkin.controller';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('@nestjs/passport', () => ({ AuthGuard: () => class {} }));

const placeBid = jest.fn(async () => ({ bid: { amount: 1 } }));
const lookupEvent = jest.fn(async () => null);
const checkInDb = { event: { findUnique: lookupEvent } };

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
  controllers: [AuthController, BidsController, CheckInController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: AuthService, useValue: { isAdminCredentials: () => false } },
    { provide: LinkRequestService, useValue: {} },
    { provide: AuditService, useValue: { record: async () => ({}) } },
    { provide: BidsService, useValue: { place: placeBid } },
    {
      provide: PrismaService,
      useValue: {
        member: {
          findUnique: async ({ where }: { where: { userId: string } }) => ({
            id: `member:${where.userId}`,
            rank: 'MEMBER',
            blockedAt: null,
          }),
        },
        setting: { findMany: async () => [] },
        $transaction: (work: (tx: typeof checkInDb) => Promise<unknown>) => work(checkInDb),
      },
    },
  ],
})
class ThrottleTestModule {}

describe('лимиты входа, ставок и чек-ина через HTTP', () => {
  let app: NestExpressApplication;
  let url: string;
  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(ThrottleTestModule, { logger: false });
    app.set('trust proxy', 1);
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const userId = req.get('x-fixture-user');
      Object.assign(req, { session: { user: userId && { userId, isAdmin: false } } });
      next();
    });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('разрешает пять запросов и ограничивает шестой на 15 минут вместо минуты', async () => {
    const login = (ip = '192.0.2.1') =>
      post('/auth/admin/login', { login: 'invalid', password: 'invalid' }, undefined, ip);
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await login();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: false });
      expect(Number(response.headers.get('X-RateLimit-Limit'))).toBe(5);
      expect(Number(response.headers.get('X-RateLimit-Reset'))).toBeGreaterThan(850);
    }
    const blocked = await login();
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(850);
    expect(retryAfter).toBeLessThanOrEqual(900);
    await blocked.json();
    const differentIp = await login('192.0.2.2');
    expect(differentIp.status).toBe(200);
    expect(differentIp.headers.get('X-RateLimit-Remaining')).toBe('4');
  });

  it('лимит ставки общий на все лоты аккаунта, независим от действий и других игроков за NAT', async () => {
    const bid = (user: string, lot = 'first') => post(`/auctions/${lot}/bids`, { amount: 1 }, user);
    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await bid('bidder')).status).toBe(201);
    }
    expect(placeBid).toHaveBeenCalledTimes(20);
    const denied = await bid('bidder', 'second');
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(placeBid).toHaveBeenCalledTimes(20);
    expect((await bid('other-bidder')).status).toBe(201);

    const checkIn = await post('/events/missing/checkin/me', { code: '123' }, 'bidder');
    expect(checkIn.status).toBe(404);
    expect(checkIn.headers.get('X-RateLimit-Remaining')).toBe('9');
    expect((await post('/auctions/first/bids', { amount: 1 })).status).toBe(401);
  });

  it('повтор при 429 не сдвигает окно чек-ина и после его истечения запрос снова обрабатывается', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const submit = () => post('/events/missing/checkin/me', { code: '123' }, 'check-in-player');
    const lookupsBefore = lookupEvent.mock.calls.length;
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        expect((await submit()).status).toBe(404);
      }
      expect((await submit()).status).toBe(429);
      clock.mockReturnValue(now + 59_000);
      const repeated = await submit();
      expect(repeated.status).toBe(429);
      expect(repeated.headers.get('Retry-After')).toBe('1');
      expect(lookupEvent).toHaveBeenCalledTimes(lookupsBefore + 10);

      const query = await fetch(`${url}/events/missing/checkin/me`, {
        headers: { 'x-fixture-user': 'check-in-player' },
      });
      expect(query.status).toBe(404);
      expect(query.headers.get('X-RateLimit-Remaining')).toBe('29');
      expect((await post('/events/missing/checkin/me', { code: '123' }, 'same-nat')).status).toBe(
        404,
      );

      clock.mockReturnValue(now + 60_000);
      const accepted = await submit();
      expect(accepted.status).toBe(404);
      expect(accepted.headers.get('X-RateLimit-Remaining')).toBe('9');
    } finally {
      clock.mockRestore();
    }
  });

  function post(path: string, body: object, user?: string, ip = '192.0.2.1') {
    return fetch(url + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': ip,
        ...(user ? { 'x-fixture-user': user } : {}),
      },
      body: JSON.stringify(body),
    });
  }
});
