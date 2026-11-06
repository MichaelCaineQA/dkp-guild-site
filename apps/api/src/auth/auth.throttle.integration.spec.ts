import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { NextFunction, Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LinkRequestService } from './link-request.service';
import { AuditService } from '../audit/audit.service';

jest.mock('@nestjs/passport', () => ({ AuthGuard: () => class {} }));

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
  controllers: [AuthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: AuthService, useValue: { isAdminCredentials: () => false } },
    { provide: LinkRequestService, useValue: {} },
    { provide: AuditService, useValue: { record: async () => ({}) } },
  ],
})
class LoginThrottleModule {}

describe('лимит входа администратора через HTTP', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await NestFactory.create(LoginThrottleModule, { logger: false });
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, { session: {} });
      next();
    });
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
  });

  it('разрешает пять запросов и ограничивает шестой на 15 минут вместо минуты', async () => {
    const url = `${await app.getUrl()}/auth/admin/login`;
    const login = () =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'invalid', password: 'invalid' }),
      });
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
  });
});
