import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import type { SessionUser } from '@dkp/shared';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';
import { AttendanceStatisticsService } from './attendance-statistics.service';
import { ActivityStatisticsService } from './activity-statistics.service';
import { DkpStatisticsService } from './dkp-statistics.service';
import { LootStatisticsService } from './loot-statistics.service';
import { GearScoreStatisticsService } from './gear-score-statistics.service';
import type { PrismaService } from '../prisma/prisma.service';

let actor: SessionUser | undefined;
/** Пустая БД: привилегированный путь завершается пустым отчётом без доступа к данным. */
const emptySnapshotDb = {
  $transaction: (callback: (tx: unknown) => unknown) => callback(emptySnapshotDb),
  kP: { findMany: async () => [], findUnique: async () => null },
  pack: { findMany: async () => [], findUnique: async () => null },
  member: { findMany: async () => [] },
  gearScoreRecord: { findMany: async () => [] },
  eventType: { findUnique: async () => null },
  setting: { findMany: async () => [] },
};
@Module({
  controllers: [StatisticsController],
  providers: [
    { provide: StatisticsService, useValue: { get: () => ({ events: [] }) } },
    { provide: AttendanceStatisticsService, useValue: { get: () => ({}) } },
    { provide: ActivityStatisticsService, useValue: { get: () => ({}) } },
    { provide: DkpStatisticsService, useValue: { get: () => ({}) } },
    { provide: LootStatisticsService, useValue: { get: () => ({}) } },
    {
      provide: GearScoreStatisticsService,
      useValue: new GearScoreStatisticsService(emptySnapshotDb as unknown as PrismaService),
    },
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
    expect((await fetch(`${url}/statistics/activity`)).status).toBe(401);
    expect((await fetch(`${url}/statistics/dkp`)).status).toBe(401);
    expect((await fetch(`${url}/statistics/loot`)).status).toBe(401);
    expect((await fetch(`${url}/statistics/gear-score`)).status).toBe(401);
  });
  it('отказывает ожидающему участнику', async () => {
    actor = { ...member, memberId: null, rank: null };
    expect((await fetch(`${url}/statistics`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/attendance`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/activity`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/dkp`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/loot`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/gear-score`)).status).toBe(403);
  });
  it('отказывает заблокированному участнику', async () => {
    actor = { ...member, blocked: true };
    expect((await fetch(`${url}/statistics`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/attendance`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/activity`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/dkp`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/loot`)).status).toBe(403);
    expect((await fetch(`${url}/statistics/gear-score`)).status).toBe(403);
  });
  it.each(['MEMBER', 'OFFICER', 'GUILD_LEADER'] as const)('разрешает ранг %s', async (rank) => {
    actor = { ...member, rank };
    expect((await fetch(`${url}/statistics`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/attendance`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/activity`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/dkp`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/loot`)).status).toBe(200);
  });
  it('разрешает резервного администратора', async () => {
    actor = { ...member, memberId: null, rank: null, isAdmin: true };
    expect((await fetch(`${url}/statistics`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/activity`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/dkp`)).status).toBe(200);
    expect((await fetch(`${url}/statistics/loot`)).status).toBe(200);
  });

  /**
   * Матрица блока GS (#217, план 2.5): только Глава и резервный Админ.
   * Лидерство КП/пака и назначение РЛ не входят в проверку видимости GS —
   * для них доступ определяется рангом (MEMBER/OFFICER), поэтому отдельные
   * строки матрицы не нужны: ранговые 403 закрывают и лидеров с РЛ.
   */
  it('блок GS: Глава и резервный Админ проходят, остальные ранги — 403', async () => {
    const leader: SessionUser = { ...member, rank: 'GUILD_LEADER' };
    actor = leader;
    const leaderResponse = await fetch(`${url}/statistics/gear-score`);
    expect(leaderResponse.status).toBe(200);
    await expect(leaderResponse.json()).resolves.toMatchObject({
      totals: { members: 0, fresh: 0, stale: 0, missing: 0, staleSharePct: null },
      members: [],
    });
    actor = { ...member, memberId: null, rank: null, isAdmin: true };
    expect((await fetch(`${url}/statistics/gear-score`)).status).toBe(200);
    actor = { ...member, rank: 'MEMBER' };
    expect((await fetch(`${url}/statistics/gear-score`)).status).toBe(403);
    actor = { ...member, rank: 'OFFICER' };
    expect((await fetch(`${url}/statistics/gear-score`)).status).toBe(403);
  });
});
