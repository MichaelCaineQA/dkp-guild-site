import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import type { SessionUser } from '@dkp/shared';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { GuildSettingsController } from './guild-settings.controller';

let actor: SessionUser | undefined;
const update = jest.fn(async () => ({}));
const audit = jest.fn(async () => ({}));
const tx = {
  guild: { findFirst: async () => ({ id: 'g', name: 'Гильдия', crest: null }), update },
  auditLog: { create: audit },
};
@Module({
  controllers: [GuildSettingsController],
  providers: [
    {
      provide: PrismaService,
      useValue: { $transaction: async (work: (value: typeof tx) => unknown) => work(tx) },
    },
  ],
})
class TestModule {}
describe('Настройки гильдии через HTTP', () => {
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
  });
  it('отказывает Офицеру и сохраняет прозрачное изображение Админа', async () => {
    const data = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const form = () => {
      const result = new FormData();
      result.set('name', 'Новое');
      result.set('file', new Blob([Uint8Array.from(data)], { type: 'image/png' }), 'crest.png');
      return result;
    };
    actor = { userId: 'off', username: 'Офицер', memberId: 'off', rank: 'OFFICER', isAdmin: false };
    expect((await fetch(`${url}/settings/guild`, { method: 'PUT', body: form() })).status).toBe(
      403,
    );
    expect(update).not.toHaveBeenCalled();
    actor = { userId: 'admin:a', username: 'Админ', memberId: null, rank: null, isAdmin: true };
    expect((await fetch(`${url}/settings/guild`, { method: 'PUT', body: form() })).status).toBe(
      200,
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ actorIsAdmin: true }) }),
    );
  });
});
