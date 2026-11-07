import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { SessionUser, ParticipationState } from '@dkp/shared';
import { ParticipationController } from './participation.controller';
import { ParticipationService } from './participation.service';
let actor: SessionUser | undefined;
let now: Date;
const start = new Date('2026-11-09T17:00:00Z');
let status = 'PLANNED';
let deadline = 180;
let priorEvent = false;
let outsider = false;
let rows: {
  id: string;
  dateFrom: Date;
  dateTo: Date;
  reason: string;
  memberId: string;
  status: string;
}[] = [];
const audit = jest.fn(async () => ({}));
const db = {
  event: {
    findUnique: async () => ({
      startsAt: start,
      status,
      scope: outsider ? 'PACK' : 'GUILD',
      packId: outsider ? 'other' : null,
      kpId: null,
    }),
    findMany: async () => [
      { startsAt: start },
      ...(priorEvent ? [{ startsAt: new Date('2026-11-08T17:00:00Z') }] : []),
    ],
  },
  member: { findUnique: async () => ({ id: 'self', packId: null, pack: null }) },
  setting: { findUnique: async () => ({ value: deadline }) },
  absence: {
    findMany: async () => rows.filter((a) => a.status === 'ACTIVE'),
    create: async ({ data }: { data: Omit<(typeof rows)[number], 'id' | 'status'> }) => {
      const row = { ...data, id: 'a' + rows.length, status: 'ACTIVE' };
      rows.push(row);
      return row;
    },
    update: async ({ where }: { where: { id: string } }) => {
      rows.find((a) => a.id === where.id)!.status = 'CANCELLED';
    },
  },
  auditLog: { create: audit },
  $transaction: async <T>(work: (tx: unknown) => Promise<T>) => work(db),
};
@Module({
  controllers: [ParticipationController],
  providers: [
    {
      provide: ParticipationService,
      useFactory: () => new ParticipationService(db as unknown as PrismaClient, () => now),
    },
  ],
})
class TestModule {}
describe('Своё участие через HTTP', () => {
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
    actor = { userId: 'u', username: 'Игрок', memberId: 'self', rank: 'MEMBER', isAdmin: false };
    now = new Date(+start - 3600000);
    rows = [];
    status = 'PLANNED';
    deadline = 180;
    outsider = false;
    priorEvent = false;
    jest.clearAllMocks();
  });
  const get = () => fetch(url + '/events/e/participation');
  const post = (body: unknown) =>
    fetch(url + '/events/e/participation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  it('аноним 401, непривязанный 403; резервный админ без Member не меняет участие', async () => {
    actor = undefined;
    expect((await get()).status).toBe(401);
    actor = { userId: 'u', username: 'Новый', memberId: null, rank: null, isAdmin: false };
    expect((await post({ attending: false })).status).toBe(403);
    actor.isAdmin = true;
    expect((await get()).status).toBe(403);
    expect(audit).not.toHaveBeenCalled();
  });
  it('пустая причина разрешена; точечное отсутствие и повтор без дубликата', async () => {
    const initial = await get();
    expect(initial.headers.get('cache-control')).toBe('private, no-store');
    expect(await initial.json()).toMatchObject({ attending: true, canDecline: true });
    expect((await post({ attending: false })).status).toBe(201);
    expect((await post({ attending: false })).status).toBe(201);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dateFrom: start, dateTo: start, reason: '', memberId: 'self' });
    expect(audit).toHaveBeenCalledTimes(1);
    expect((await post({ attending: false, memberId: 'other' })).status).toBe(400);
  });
  it('дедлайн читается на каждый запрос, чужой пак и закрытые события недоступны', async () => {
    now = new Date(+start - 300000);
    deadline = 600;
    expect((await post({ attending: false })).status).toBe(409);
    deadline = 180;
    expect((await get()).status).toBe(200);
    outsider = true;
    expect((await post({ attending: false })).status).toBe(403);
    outsider = false;
    status = 'RUNNING';
    expect((await post({ attending: false })).status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });
  it('возвращение требует подтверждения актуальных периодов и отменяет все пересечения', async () => {
    rows = ['a', 'b'].map((id) => ({
      id,
      memberId: 'self',
      status: 'ACTIVE',
      dateFrom: new Date(+start - 86400000),
      dateTo: new Date(+start + 86400000),
      reason: 'Отпуск',
    }));
    expect((await post({ attending: true, absenceIds: ['a'] })).status).toBe(409);
    expect(rows.every((a) => a.status === 'ACTIVE')).toBe(true);
    expect((await post({ attending: true, absenceIds: ['a', 'b'] })).status).toBe(201);
    expect(rows.every((a) => a.status === 'CANCELLED')).toBe(true);
    expect(audit).toHaveBeenCalledTimes(2);
  });
  it('начавшееся событие в периоде блокирует отмену даже при RUNNING/FINISHED', async () => {
    rows = [
      {
        id: 'a',
        memberId: 'self',
        status: 'ACTIVE',
        dateFrom: new Date(+start - 86400000),
        dateTo: new Date(+start + 86400000),
        reason: 'Отпуск',
      },
    ];
    priorEvent = true;
    const state = (await (await get()).json()) as ParticipationState;
    expect(state.canAttend).toBe(false);
    expect((await post({ attending: true, absenceIds: ['a'] })).status).toBe(409);
    expect(audit).not.toHaveBeenCalled();
  });
});
