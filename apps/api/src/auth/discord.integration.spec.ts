import 'reflect-metadata';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import session from 'express-session';
import passport from 'passport';
import { AuthModule } from './auth.module';
import { PrismaService } from '../prisma/prisma.service';

@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: { auditLog: { create: async () => ({}) } } }],
  exports: [PrismaService],
})
class TestDbModule {}

@Module({ imports: [TestDbModule, AuthModule] })
class TestModule {}

describe('Запуск AuthModule с отложенной настройкой Discord', () => {
  const keys = [
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'ADMIN_LOGIN',
    'ADMIN_PASSWORD',
  ] as const;
  let saved: (string | undefined)[];
  let app: INestApplication | undefined;

  beforeEach(() => {
    saved = keys.map((key) => process.env[key]);
    for (const key of keys) delete process.env[key];
    process.env.ADMIN_LOGIN = 'test-admin';
    process.env.ADMIN_PASSWORD = 'test-password';
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
    keys.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
  });

  async function start() {
    app = await NestFactory.create(TestModule, { logger: false });
    app.use(session({ secret: 'test-session-secret', resave: false, saveUninitialized: false }));
    app.use(passport.initialize());
    await app.listen(0, '127.0.0.1');
    return app.getUrl();
  }

  it.each(['пустая', 'частичная'])(
    '%s конфигурация: API стартует, оба OAuth-маршрута закрыты, админ входит',
    async (mode) => {
      if (mode === 'частичная') process.env.DISCORD_CLIENT_ID = 'test-client';
      const url = await start();
      expect(await (await fetch(`${url}/auth/providers`)).json()).toEqual({ discord: false });
      for (const path of ['/auth/discord', '/auth/discord/callback?code=invalid']) {
        const response = await fetch(url + path, { redirect: 'manual' });
        expect(response.status).toBe(503);
        expect(response.headers.get('location')).toBeNull();
        expect(await response.json()).toMatchObject({
          message: 'Вход через Discord пока не настроен',
        });
      }
      const response = await fetch(`${url}/auth/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'test-admin', password: 'test-password' }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(response.headers.get('set-cookie')).toBeTruthy();
    },
  );

  it('полная конфигурация включает реальную Passport-стратегию и редирект на Discord', async () => {
    process.env.DISCORD_CLIENT_ID = 'test-client';
    process.env.DISCORD_CLIENT_SECRET = 'test-secret';
    const url = await start();
    expect(await (await fetch(`${url}/auth/providers`)).json()).toEqual({ discord: true });
    const response = await fetch(`${url}/auth/discord`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get('location')!);
    expect(target.hostname).toBe('discord.com');
    expect(target.searchParams.get('client_id')).toBe('test-client');
    expect(target.searchParams.has('client_secret')).toBe(false);
  });
});
