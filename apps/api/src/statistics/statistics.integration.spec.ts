import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import type { SessionUser } from '@dkp/shared';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { AttendanceStatisticsService } from './attendance-statistics.service';

let actor: SessionUser | undefined;
@Module({
  controllers: [StatisticsController],
  providers: [
    { provide: StatisticsService, useValue: { get: () => ({ events: [] }) } },
    { provide: AttendanceStatisticsService, useValue: { get: () => ({}) } },
  ],
})
class TestModule {}

describe('Доступ к статистике через HTTP', () => {
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
  afterAll(async () => app.close());
  const member: SessionUser = {
    userId: 'u',
    username: 'test',
    memberId: 'm',
    rank: 'MEMBER',
    isAdmin: false,
    blocked: false,
  };
  it('отказывает без входа', async () => {
    actor = undefined;
    expect((await fetch(`${url}/statistics`)).status).toBe(401);
    expect((await fetch(`${url}/statistics/attendance`)).status).toBe(401);
  });
  it('отказывает ожидающему участнику', async () => {
    actor = { ...member, memberId: null, rank: null };
    expect((await fetch(`${url}/statistics`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/attendance`)).status).toBe(403);
  });
  it('отказывает заблокированному участнику', async () => {
    actor = { ...member, blocked: true };
    expect((await fetch(`${url}/statistics`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/attendance`)).status).toBe(403);
  });
  it.each(['MEMBER', 'OFFICER', 'GUILD_LEADER'] as const)('разрешает ранг %s', async (rank) => {
    actor = { ...member, rank };
    expect((await fetch(`${url}/statistics`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/attendance`)).status).toBe(200);
  });
  it('разрешает резервного администратора', async () => {
    actor = { ...member, memberId: null, rank: null, isAdmin: true };
    expect((await fetch(`${url}/statistics`)).status).toBe(200);
  });
});
