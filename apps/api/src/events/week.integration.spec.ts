import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import type { SessionUser, WeekEvent } from '@dkp/shared';
import { WeekController } from './week.controller';
import { WeekService, type WeekDb } from './week.service';
let actor: SessionUser | undefined;
const startsAt = new Date('2026-11-09T17:00:00Z');
const findEvents = jest.fn(async () => [
  {
    id: 'e',
    name: 'Сбор',
    eventTypeId: 't',
    eventType: { name: 'Босс' },
    raidLeadId: 'a',
    raidLead: { nickname: 'Лидер' },
    mode: 'PVE',
    status: 'PLANNED',
    startsAt,
    endsAt: new Date(+startsAt + 3600000),
    dkpReward: 10,
    place: null,
    notes: null,
    scope: 'GUILD',
    kpId: null,
    packId: null,
  },
]);
const findMembers = jest.fn(async () => [
  { id: 'a', packId: 'p', pack: { kpId: 'k' } },
  { id: 'b', packId: null, pack: null },
]);
const absence = { memberId: 'b', dateFrom: startsAt, dateTo: startsAt };
const findAbsences = jest.fn(async () => [absence, absence]);
const db = {
  setting: { findUnique: async () => null },
  event: { findMany: findEvents },
  member: { findMany: findMembers },
  absence: { findMany: findAbsences },
};
@Module({
  controllers: [WeekController],
  providers: [
    {
      provide: WeekService,
      useFactory: () =>
        new WeekService(db as unknown as WeekDb, () => new Date(+startsAt - 3600000)),
    },
  ],
})
class TestModule {}
describe('Недельное расписание через HTTP', () => {
  let app: INestApplication;
  let url: string;
  const query = '?from=2026-11-09T00:00:00Z&to=2026-11-16T00:00:00Z';
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
    actor = { userId: 'u', username: 'Игрок', memberId: 'a', rank: 'MEMBER', isAdmin: false };
  });
  it('анониму 401, ожидающему 403, данные не читаются', async () => {
    actor = undefined;
    expect((await fetch(url + '/schedule/week' + query)).status).toBe(401);
    actor = { userId: 'new', username: 'Новый', memberId: null, rank: null, isAdmin: false };
    expect((await fetch(url + '/schedule/week' + query)).status).toBe(403);
    expect(findEvents).not.toHaveBeenCalled();
  });
  it('член получает N/M без GS; фильтры и полуоткрытые границы передаются в БД', async () => {
    const response = await fetch(url + '/schedule/week' + query + '&mode=PVE&eventTypeId=t');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const rows = (await response.json()) as WeekEvent[];
    expect(rows[0]).toMatchObject({
      canDecline: true,
      invitedCount: 2,
      attendingCount: 1,
      eventTypeName: 'Босс',
      raidLeadName: 'Лидер',
    });
    expect(rows[0]).not.toHaveProperty('scope');
    expect(findMembers).toHaveBeenCalledWith({
      select: { id: true, packId: true, pack: { select: { kpId: true } } },
    });
    expect(findEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          startsAt: { gte: new Date('2026-11-09'), lt: new Date('2026-11-16') },
          status: { not: 'CANCELLED' },
          mode: 'PVE',
          eventTypeId: 't',
        },
      }),
    );
    expect(findAbsences).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'ACTIVE',
          OR: [
            { eventId: { in: ['e'] } },
            {
              eventId: null,
              dateFrom: { lt: new Date('2026-11-16') },
              dateTo: { gte: new Date('2026-11-09') },
            },
          ],
        },
      }),
    );
  });
  it.each(['', '?from=bad&to=bad', '?from=2026-01-01&to=2026-12-31', query + '&mode=BAD'])(
    'не читает БД при некорректном запросе %s',
    async (bad) => {
      expect((await fetch(url + '/schedule/week' + bad)).status).toBe(400);
      expect(findEvents).not.toHaveBeenCalled();
    },
  );
});
