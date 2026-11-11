import type { AuctionsService } from '../auctions/auctions.service';
import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import type { DashboardData, SessionUser } from '@dkp/shared';
import { DashboardController } from './dashboard.controller';
import { DashboardService, type DashboardDb } from './dashboard.service';
import { AuditService } from '../audit/audit.service';
let actor: SessionUser | undefined;
const member = jest.fn(async () => ({ packId: 'own-pack' }));
const pack = jest.fn(async () => ({
  id: 'own-pack',
  name: 'Звёзды',
  leaderId: 'self',
  members: [
    {
      id: 'self',
      nickname: 'Лидер',
      rank: 'OFFICER',
      combatRole: 'HEALER',
      weapons: ['STAFF', 'WAND'],
      createdAt: new Date('2026-01-01'),
      packJoinedAt: null,
    },
  ],
}));
const scores = jest.fn(async () => [{ memberId: 'self', value: 4242 }]);
const events = jest.fn(async () => []);
const walletLots = jest.fn(async () => [
  {
    id: 'lot-1',
    endsAt: new Date('2026-11-11T20:00:00Z'),
    createdAt: new Date('2026-11-01T00:00:00Z'),
    lootDrop: { item: { name: 'Клинок' } },
    bids: [{ memberId: 'self', amount: 100, fullCost: 110 }],
  },
]);
const walletEntries = jest.fn(async () => [{ amount: 50 }, { amount: 60 }]);
const list = jest.fn(async (_query: unknown, user: { rank: string | null }) =>
  user.rank === 'MEMBER'
    ? { entries: [], total: 0 }
    : {
        entries: [
          {
            id: 'log',
            actorMemberId: 'head',
            action: 'EVENT_CREATE',
            entityType: 'Event',
            entityId: 'event',
            comment: 'Создан ивент',
            createdAt: new Date(),
            actorName: 'Глава',
          },
        ],
        total: 1,
      },
);
const db = {
  member: { findUnique: member },
  pack: { findUnique: pack },
  event: { findMany: events },
  guild: { findFirst: async () => null },
  gearScoreRecord: { findMany: scores },
  auction: { findMany: walletLots },
  dkpEntry: { findMany: walletEntries },
};
@Module({
  controllers: [DashboardController],
  providers: [
    {
      provide: DashboardService,
      useValue: new DashboardService(
        db as unknown as DashboardDb,
        { list } as unknown as AuditService,
        { myNearestBidLot: async () => null } as unknown as AuctionsService,
      ),
    },
  ],
})
class TestModule {}
describe('Дашборд через HTTP', () => {
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
    actor = { userId: 'u', username: 'Игрок', memberId: 'self', rank: 'MEMBER', isAdmin: false };
  });
  it('аноним получает 401, ожидающий приёма — 403, запросов данных нет', async () => {
    actor = undefined;
    expect((await fetch(url + '/dashboard')).status).toBe(401);
    actor = { userId: 'new', username: 'Новый', memberId: null, rank: null, isAdmin: false };
    expect((await fetch(url + '/dashboard')).status).toBe(403);
    expect(events).not.toHaveBeenCalled();
    expect(member).not.toHaveBeenCalled();
  });
  it('рядовой получает личный аудит без GS; нельзя запросить чужой пак', async () => {
    const response = await fetch(url + '/dashboard?memberId=other&rank=ADMIN');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = (await response.json()) as DashboardData;
    expect(body.team!.id).toBe('own-pack');
    expect(body.team!.members[0].leader).toBe(true);
    expect(body.team!.members[0]).not.toHaveProperty('gearScore');
    expect(body.audit).toEqual([]);
    expect(list).toHaveBeenCalledWith(
      { limit: 10 },
      expect.objectContaining({ memberId: 'self', rank: 'MEMBER' }),
    );
    expect(scores).not.toHaveBeenCalled();
    expect(member).toHaveBeenCalledWith({ where: { id: 'self' }, select: { packId: true } });
  });
  it('Офицер видит аудит, но не GS своего пака', async () => {
    actor!.rank = 'OFFICER';
    const body = (await (await fetch(url + '/dashboard')).json()) as DashboardData;
    expect(body.audit![0].actorName).toBe('Глава');
    expect(list).toHaveBeenCalledWith({ limit: 10 }, expect.objectContaining({ rank: 'OFFICER' }));
    expect(scores).not.toHaveBeenCalled();
    expect(body.team!.members[0]).not.toHaveProperty('gearScore');
  });
  it('Глава видит GS участников своего пака без идентификаторов скриншотов', async () => {
    actor!.rank = 'GUILD_LEADER';
    const body = (await (await fetch(url + '/dashboard')).json()) as DashboardData;
    expect(body.team!.members[0].gearScore).toBe(4242);
    expect(scores).toHaveBeenCalledTimes(1);
    expect(body.team!.members[0]).not.toHaveProperty('screenshotIds');
  });
  it('резервный Админ без Member получает события/аудит и пустую команду', async () => {
    actor = { userId: 'admin:a', username: 'a', memberId: null, rank: null, isAdmin: true };
    const body = (await (await fetch(url + '/dashboard')).json()) as DashboardData;
    expect(body.team).toBeNull();
    expect(body.audit).toHaveLength(1);
    expect(member).not.toHaveBeenCalled();
    expect(events).toHaveBeenCalledTimes(1);
  });
  it('кошелёк: без привязанного Member (включая резервного Админа) — 403', async () => {
    actor = undefined;
    expect((await fetch(url + '/dashboard/wallet')).status).toBe(401);
    actor = { userId: 'new', username: 'Новый', memberId: null, rank: null, isAdmin: false };
    expect((await fetch(url + '/dashboard/wallet')).status).toBe(403);
    actor = { userId: 'admin:a', username: 'a', memberId: null, rank: null, isAdmin: true };
    expect((await fetch(url + '/dashboard/wallet')).status).toBe(403);
    expect(walletLots).not.toHaveBeenCalled();
    expect(walletEntries).not.toHaveBeenCalled();
  });
  it('кошелёк: баланс журнала, заморозка ведущей ставки и доступная сумма', async () => {
    const response = await fetch(url + '/dashboard/wallet');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      balance: 110,
      frozen: 110,
      available: 0,
      lots: [
        {
          lotId: 'lot-1',
          itemName: 'Клинок',
          fullCost: 110,
          endsAt: '2026-11-11T20:00:00.000Z',
        },
      ],
    });
    expect(walletEntries).toHaveBeenCalledWith({
      where: { memberId: 'self' },
      select: { amount: true },
    });
    expect(walletLots).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'OPEN' } }),
    );
  });
});
