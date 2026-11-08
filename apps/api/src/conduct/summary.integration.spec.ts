import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import type { SessionUser } from '@dkp/shared';
import { ConductController } from './conduct.controller';
import { ConductService, type ConductDb } from './conduct.service';
let actor: SessionUser | undefined;
let eventStatus = 'FINISHED';
const ledger = jest.fn(async () => ({ id: 'd' }));
const record = jest.fn(async () => ({}));
const db = {
  $transaction: async <T>(work: (tx: unknown) => Promise<T>) => work(db),
  event: {
    findUnique: async () => ({
      id: 'e',
      status: eventStatus,
      startsAt: new Date('2026-01-01'),
      endsAt: new Date('2026-01-02'),
      raidLeadId: 'rl',
      creatorId: 'author',
      dkpReward: 10,
    }),
  },
  member: { findMany: async () => [{ id: 'm', nickname: 'Игрок' }] },
  attendance: { findMany: async () => [] },
  absence: { findMany: async () => [] },
  dkpEntry: { findMany: async () => [], create: ledger },
  auditLog: { create: record },
  eventSummaryBatch: { findUnique: async () => null, create: async () => ({}) },
};
@Module({
  controllers: [ConductController],
  providers: [
    {
      provide: ConductService,
      useValue: new ConductService(db as unknown as ConductDb, {
        startSharePct: 50,
        endSharePct: 50,
      }),
    },
  ],
})
class TestModule {}
describe('Пакет итогов через HTTP', () => {
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
    eventStatus = 'FINISHED';
    actor = { userId: 'u', username: 'Игрок', memberId: 'rl', rank: 'MEMBER', isAdmin: false };
  });
  const body = {
    requestId: '00000000-0000-4000-8000-000000000001',
    actions: [{ kind: 'DKP', memberId: 'm', amount: 5, comment: 'Бонус' }],
  };
  const post = (value: unknown = body) =>
    fetch(url + '/events/e/conduct/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  it('аноним 401, непривязанный 403, Офицер без назначения 403', async () => {
    actor = undefined;
    expect((await post()).status).toBe(401);
    actor = { userId: 'u', username: 'Гость', memberId: null, rank: null, isAdmin: false };
    expect((await post()).status).toBe(403);
    actor.memberId = 'other';
    actor.rank = 'OFFICER';
    expect((await post()).status).toBe(403);
    expect(ledger).not.toHaveBeenCalled();
  });
  it('назначенный РЛ применяет пакет после завершения, отменённый даёт 409', async () => {
    expect((await post()).status).toBe(201);
    expect(ledger).toHaveBeenCalledTimes(1);
    eventStatus = 'CANCELLED';
    expect((await post()).status).toBe(409);
    expect(ledger).toHaveBeenCalledTimes(1);
  });
  it('чек-лист и итоги доступны только автору-Офицеру или назначенному РЛ', async () => {
    actor = { userId: 'u', username: 'Автор', memberId: 'author', rank: 'OFFICER', isAdmin: false };
    expect((await fetch(url + '/events/e/conduct/checklist')).status).toBe(200);
    expect((await post()).status).toBe(201);
    actor.rank = 'MEMBER';
    expect((await fetch(url + '/events/e/conduct/checklist')).status).toBe(403);
    expect((await post()).status).toBe(403);
    actor.memberId = 'other';
    actor.rank = 'OFFICER';
    expect((await fetch(url + '/events/e/conduct/checklist')).status).toBe(403);
  });
  it('невалидный пакет не записывается, чужого участника подставить нельзя', async () => {
    expect(
      (await post({ ...body, actions: [{ kind: 'EXCUSE', memberId: 'm', reason: '' }] })).status,
    ).toBe(400);
    expect(
      (await post({ ...body, actions: [{ ...body.actions[0], memberId: 'outside' }] })).status,
    ).toBe(400);
    expect(ledger).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
  it('резервный админ без Member сохраняет автора null', async () => {
    actor = { userId: 'admin:root', username: 'Админ', memberId: null, rank: null, isAdmin: true };
    expect((await post()).status).toBe(201);
    expect(ledger).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdById: null }) }),
    );
  });
});
