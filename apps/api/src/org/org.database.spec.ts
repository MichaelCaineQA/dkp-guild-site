import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrgService } from './org.service';
import type { SessionUser } from '../auth/session.types';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { AddressInfo } from 'node:net';
import { OrgController } from './org.controller';

const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const admin = {
  userId: 'admin',
  username: 'admin',
  memberId: null,
  rank: null,
  isAdmin: true,
  blocked: false,
};

suite('Управление оргструктурой в PostgreSQL', () => {
  let db: PrismaClient;
  let service: OrgService;
  let kp1: string;
  let kp2: string;
  let pack1: string;
  let pack2: string;
  let memberId: string;
  let actor: SessionUser;
  let app: INestApplication;
  let baseUrl: string;
  const kps: string[] = [];
  const packs: string[] = [];
  const members: string[] = [];
  const users: string[] = [];

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    service = new OrgService(db as unknown as PrismaService);
    @Module({
      controllers: [OrgController],
      providers: [OrgService, { provide: PrismaService, useValue: db }],
    })
    class TestModule {}
    app = await NestFactory.create(TestModule, { logger: false });
    app.use(
      (
        req: { headers: Record<string, string>; session?: { user?: SessionUser } },
        _res: unknown,
        next: () => void,
      ) => {
        req.session = {
          user: req.headers['x-test-admin']
            ? admin
            : req.headers['x-test-member']
              ? actor
              : undefined,
        };
        next();
      },
    );
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    const guild = await db.guild.findFirstOrThrow();
    const suffix = randomUUID();
    const a = await db.kP.create({ data: { name: `org-a-${suffix}`, guildId: guild.id } });
    const b = await db.kP.create({ data: { name: `org-b-${suffix}`, guildId: guild.id } });
    kp1 = a.id;
    kp2 = b.id;
    kps.push(kp1, kp2);
    const p = await db.pack.create({ data: { name: 'a', kpId: kp1 } });
    const q = await db.pack.create({ data: { name: 'b', kpId: kp2 } });
    pack1 = p.id;
    pack2 = q.id;
    packs.push(pack1, pack2);
    const m = await db.member.create({ data: { nickname: `org-${suffix}`, packId: pack1 } });
    memberId = m.id;
    members.push(memberId);
    actor = { ...admin, memberId, isAdmin: false, rank: 'MEMBER' };
  });

  afterAll(async () => {
    if (!db) return;
    await app?.close();
    await db.auditLog.deleteMany({
      where: {
        OR: [{ entityId: { in: members } }, { entityId: { in: packs } }, { entityId: { in: kps } }],
      },
    });
    await db.memberPackHistory.deleteMany({ where: { memberId: { in: members } } });
    await db.packMembershipHistory.deleteMany({ where: { packId: { in: packs } } });
    await db.kP.updateMany({ where: { id: { in: kps } }, data: { leaderId: null } });
    await db.pack.updateMany({ where: { id: { in: packs } }, data: { leaderId: null } });
    await db.gearScoreRecord.deleteMany({ where: { memberId: { in: members } } });
    await db.member.deleteMany({ where: { id: { in: members } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.pack.deleteMany({ where: { id: { in: packs } } });
    await db.kP.deleteMany({ where: { id: { in: kps } } });
    await db.$disconnect();
  });

  it('HTTP API не допускает неавторизованное создание КП', async () => {
    const response = await fetch(`${baseUrl}/org/kps`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Нет доступа' }),
    });
    expect(response.status).toBe(401);
  });

  it('лидер пака получает GS только своей группы и только в выбранной вкладке', async () => {
    const other = await db.member.create({
      data: { nickname: `other-${randomUUID()}`, packId: pack2 },
    });
    members.push(other.id);
    await db.gearScoreRecord.createMany({
      data: [
        { memberId, value: 1234, screenshotIds: ['screen-one'] },
        { memberId: other.id, value: 5678, screenshotIds: ['screen-two'] },
      ],
    });
    await db.pack.update({ where: { id: pack1 }, data: { leaderId: memberId } });
    const common = await service.roster(actor);
    expect(common.members.find((item) => item.id === memberId)).not.toHaveProperty('gearScore');
    const own = await service.roster(actor, kp1);
    expect(own.members.find((item) => item.id === memberId)).toMatchObject({
      gearScore: 1234,
      screenshotIds: ['screen-one'],
    });
    const foreign = await service.roster(actor, kp2);
    expect(foreign.members.find((item) => item.id === other.id)).not.toHaveProperty('gearScore');
  });

  it('HTTP выдаёт GS только при выборе своей группы', async () => {
    const user = await db.user.create({ data: { username: `org-http-${randomUUID()}` } });
    users.push(user.id);
    await db.member.update({ where: { id: memberId }, data: { userId: user.id } });
    actor.userId = user.id;
    await db.gearScoreRecord.create({
      data: { memberId, value: 4321, screenshotIds: ['gs-http'] },
    });
    await db.pack.update({ where: { id: pack1 }, data: { leaderId: memberId } });
    const headers = { 'x-test-member': '1' };
    const common = (await (await fetch(`${baseUrl}/org/roster`, { headers })).json()) as {
      members: Array<{ id: string; gearScore?: number }>;
    };
    expect(common.members.find((m) => m.id === memberId)).not.toHaveProperty('gearScore');
    const selected = (await (
      await fetch(`${baseUrl}/org/roster?packId=${pack1}`, { headers })
    ).json()) as { members: Array<{ id: string; gearScore?: number }> };
    expect(selected.members.find((m) => m.id === memberId)?.gearScore).toBe(4321);
  });

  it('лидер пака не получает GS соседнего пака в той же КП', async () => {
    const neighborPack = await db.pack.create({ data: { name: 'соседний', kpId: kp1 } });
    packs.push(neighborPack.id);
    const neighbor = await db.member.create({
      data: { nickname: `neighbor-${randomUUID()}`, packId: neighborPack.id },
    });
    members.push(neighbor.id);
    await db.gearScoreRecord.create({
      data: { memberId: neighbor.id, value: 9999, screenshotIds: ['neighbor-gs'] },
    });
    await db.pack.update({ where: { id: pack1 }, data: { leaderId: memberId } });
    const result = await service.roster(actor, kp1);
    expect(result.members.find((item) => item.id === neighbor.id)).not.toHaveProperty('gearScore');
    expect(result.members.find((item) => item.id === neighbor.id)).not.toHaveProperty(
      'screenshotIds',
    );
  });

  it('HTTP API создаёт пустую КП администратору', async () => {
    const response = await fetch(`${baseUrl}/org/kps`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-admin': '1' },
      body: JSON.stringify({ name: 'Пустая КП' }),
    });
    expect(response.status).toBe(201);
    const result = (await response.json()) as { id: string; name: string };
    kps.push(result.id);
    expect(result.name).toBe('Пустая КП');
    expect(
      await db.auditLog.findFirst({ where: { entityId: result.id, action: 'KP_CREATE' } }),
    ).not.toBeNull();
  });

  it('перенос игрока снимает лидерство и пишет историю и аудит', async () => {
    await db.kP.update({ where: { id: kp1 }, data: { leaderId: memberId } });
    await db.pack.update({ where: { id: pack1 }, data: { leaderId: memberId } });
    await service.moveMember(memberId, { packId: pack2 }, admin);
    expect(await db.member.findUnique({ where: { id: memberId } })).toMatchObject({
      packId: pack2,
      packJoinedAt: expect.any(Date),
    });
    expect((await db.kP.findUniqueOrThrow({ where: { id: kp1 } })).leaderId).toBeNull();
    expect((await db.pack.findUniqueOrThrow({ where: { id: pack1 } })).leaderId).toBeNull();
    expect(await db.memberPackHistory.findMany({ where: { memberId } })).toMatchObject([
      { previousPackId: pack1, packId: pack2 },
    ]);
    expect(
      await db.auditLog.findFirst({
        where: { entityId: memberId, action: 'MEMBER_PACK_TRANSFER' },
      }),
    ).toMatchObject({ actorIsAdmin: true, comment: expect.any(String) });
  });

  it('перенос пака сохраняет его лидера и дату вступления, снимая лидера прежней КП', async () => {
    const joined = new Date('2025-01-01T00:00:00Z');
    await db.member.update({ where: { id: memberId }, data: { packJoinedAt: joined } });
    await db.kP.update({ where: { id: kp1 }, data: { leaderId: memberId } });
    await db.pack.update({ where: { id: pack1 }, data: { leaderId: memberId } });
    await service.movePack(pack1, { kpId: kp2 }, admin);
    expect(await db.pack.findUnique({ where: { id: pack1 } })).toMatchObject({
      kpId: kp2,
      leaderId: memberId,
    });
    expect((await db.member.findUniqueOrThrow({ where: { id: memberId } })).packJoinedAt).toEqual(
      joined,
    );
    expect((await db.kP.findUniqueOrThrow({ where: { id: kp1 } })).leaderId).toBeNull();
    expect(await db.packMembershipHistory.findMany({ where: { packId: pack1 } })).toMatchObject([
      { previousKpId: kp1, kpId: kp2 },
    ]);
  });

  it('лидер КП не может переводить игрока или создавать пак в чужой КП', async () => {
    await db.kP.update({ where: { id: kp1 }, data: { leaderId: memberId } });
    await expect(service.moveMember(memberId, { packId: pack2 }, actor)).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.createPack({ name: 'Чужой', kpId: kp2 }, actor)).rejects.toMatchObject({
      status: 403,
    });
    expect((await db.member.findUniqueOrThrow({ where: { id: memberId } })).packId).toBe(pack1);
  });

  it('создаёт КП с перенесённым паком и сохраняет историю', async () => {
    const result = await service.createKp({ name: 'Новая КП', packIds: [pack1] }, admin);
    kps.push(result.id);
    expect((await db.pack.findUniqueOrThrow({ where: { id: pack1 } })).kpId).toBe(result.id);
    expect(await db.packMembershipHistory.findMany({ where: { packId: pack1 } })).toMatchObject([
      { previousKpId: kp1, kpId: result.id },
    ]);
    expect(
      await db.auditLog.findFirst({ where: { entityId: result.id, action: 'KP_CREATE' } }),
    ).not.toBeNull();
  });

  it('лидер КП создаёт пак с игроком своей КП и назначает ему лидера', async () => {
    await db.kP.update({ where: { id: kp1 }, data: { leaderId: memberId } });
    const result = await service.createPack(
      { name: 'Новый пак', kpId: kp1, memberIds: [memberId] },
      actor,
    );
    packs.push(result.id);
    expect((await db.member.findUniqueOrThrow({ where: { id: memberId } })).packId).toBe(result.id);
    // Лидер КП при собственном переносе теряет назначение; админ назначает лидера пака.
    await service.setPackLeader(result.id, { memberId }, admin);
    expect((await db.pack.findUniqueOrThrow({ where: { id: result.id } })).leaderId).toBe(memberId);
  });

  it('конкурентные переносы сохраняют последовательную историю', async () => {
    const third = await db.pack.create({ data: { name: 'c', kpId: kp2 } });
    packs.push(third.id);
    await Promise.all([
      service.moveMember(memberId, { packId: pack2 }, admin),
      service.moveMember(memberId, { packId: third.id }, admin),
    ]);
    const history = await db.memberPackHistory.findMany({
      where: { memberId },
      orderBy: { changedAt: 'asc' },
    });
    expect(history).toHaveLength(2);
    expect(history[0].previousPackId).toBe(pack1);
    expect(history[1].previousPackId).toBe(history[0].packId);
    expect((await db.member.findUniqueOrThrow({ where: { id: memberId } })).packId).toBe(
      history[1].packId,
    );
  });
});
