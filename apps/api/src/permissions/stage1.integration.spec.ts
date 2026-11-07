import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import type { SessionUser } from '@dkp/shared';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { LinkRequestService } from '../auth/link-request.service';
import { AuditService } from '../audit/audit.service';
import { MembersController } from '../members/members.controller';
import { MembersService } from '../members/members.service';
import { EventsController } from '../events/events.controller';
import { EventsService, type EventsDb } from '../events/events.service';
import { CheckInController } from '../checkin/checkin.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ConductController } from '../conduct/conduct.controller';
import { ConductService, type ConductDb } from '../conduct/conduct.service';

jest.mock('@nestjs/passport', () => ({ AuthGuard: () => class {} }));

let actor: SessionUser;
let event: Record<string, unknown>;
const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
  Object.assign(event, data);
  return { id: 'e1' };
});
const remove = jest.fn(async () => ({}));
const record = jest.fn(async () => ({}));
const ledger = jest.fn(async () => ({ id: 'dkp1' }));
const createMember = jest.fn(async () => ({ id: 'member1' }));
const approve = jest.fn(async () => ({ ok: true }));
const db = {
  $transaction: async <T>(work: (tx: unknown) => Promise<T>) => work(db),
  event: { findUnique: async () => event, update, delete: remove },
  auditLog: { create: record },
  dkpEntry: { create: ledger },
  setting: { findMany: async () => [] },
};
@Module({
  controllers: [
    AuthController,
    MembersController,
    EventsController,
    CheckInController,
    ConductController,
  ],
  providers: [
    { provide: AuthService, useValue: {} },
    { provide: LinkRequestService, useValue: { approve, listPending: async () => [] } },
    { provide: AuditService, useValue: { record } },
    { provide: MembersService, useValue: { create: createMember, update: createMember } },
    { provide: EventsService, useValue: new EventsService(db as unknown as EventsDb) },
    { provide: PrismaService, useValue: db },
    {
      provide: ConductService,
      useValue: new ConductService(db as unknown as ConductDb, {
        startSharePct: 50,
        endSharePct: 50,
      }),
    },
  ],
})
class PermissionTestModule {}

describe('PLAN 1.1: права через реальные HTTP-маршруты', () => {
  let app: INestApplication;
  let url: string;
  beforeAll(async () => {
    app = await NestFactory.create(PermissionTestModule, { logger: false });
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
    actor = {
      userId: 'u1',
      username: 'Офицер',
      memberId: 'officer',
      rank: 'OFFICER',
      isAdmin: false,
    };
    event = {
      id: 'e1',
      status: 'PLANNED',
      raidLeadId: 'rl',
      startsAt: new Date(Date.now() + 3600000),
      endsAt: new Date(Date.now() + 7200000),
      dkpReward: 10,
    };
  });
  const request = (path: string, method = 'POST', body: unknown = {}) =>
    fetch(url + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
  const dkp = {
    memberId: 'target',
    type: 'ADJUSTMENT',
    amount: -1,
    comment: 'Исправление начисления',
  };

  it('Офицер не создаёт/изменяет состав и не подтверждает заявки прямым запросом', async () => {
    expect((await request('/members')).status).toBe(404);
    expect((await request('/members/m1', 'PATCH')).status).toBe(403);
    expect((await request('/auth/link-requests', 'GET')).status).toBe(401);
    expect((await request('/auth/link-requests/r1/approve')).status).toBe(401);
    expect(createMember).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
  it('резервный Админ без Member может читать и подтверждать заявки', async () => {
    actor = { userId: 'admin:a', username: 'a', rank: null, memberId: null, isAdmin: true };
    expect((await request('/auth/link-requests', 'GET')).status).toBe(200);
    expect((await request('/auth/link-requests/r1/approve')).status).toBe(201);
    expect(approve).toHaveBeenCalledWith('r1', null);
  });
  it('Офицер без назначения РЛ не видит код, не запускает ивент и не меняет ДКП', async () => {
    expect((await request('/events/e1/checkin/code', 'GET')).status).toBe(403);
    expect((await request('/events/e1/status', 'POST', { status: 'RUNNING' })).status).toBe(403);
    expect((await request('/events/e1/conduct/dkp', 'POST', dkp)).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
    expect(ledger).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
  it('Офицер сохраняет отмену и удаление запланированных ивентов', async () => {
    expect((await request('/events/e1', 'PATCH', { place: 'Место сбора' })).status).toBe(200);
    expect((await request('/events/e1/status', 'POST', { status: 'CANCELLED' })).status).toBe(201);
    event.status = 'PLANNED';
    expect((await request('/events/e1', 'DELETE')).status).toBe(200);
    expect(update).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('рядовой РЛ запускает только свой ивент — guard не обрывает проверку назначения', async () => {
    actor.rank = 'MEMBER';
    actor.memberId = 'rl';
    expect((await request('/events/e1/status', 'POST', { status: 'RUNNING' })).status).toBe(201);
    event.raidLeadId = 'other';
    expect((await request('/events/e1/status', 'POST', { status: 'RUNNING' })).status).toBe(403);
    expect(update).toHaveBeenCalledTimes(1);
  });
  it.each(['FINISHED', 'CANCELLED'])('даже Глава не редактирует параметры %s', async (status) => {
    actor.rank = 'GUILD_LEADER';
    event.status = status;
    expect((await request('/events/e1', 'PATCH', { place: 'Новое место' })).status).toBe(409);
    expect(update).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
  it('РЛ корректирует завершённый ивент, отменённый доступен только для чтения', async () => {
    actor.rank = 'MEMBER';
    actor.memberId = 'rl';
    event.status = 'FINISHED';
    expect((await request('/events/e1/conduct/dkp', 'POST', dkp)).status).toBe(201);
    expect(ledger).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    event.status = 'CANCELLED';
    expect((await request('/events/e1/conduct/dkp', 'POST', dkp)).status).toBe(409);
    expect(ledger).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
  });
});
