import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { LinkRequestService } from './link-request.service';
const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Анкеты: настоящая PostgreSQL, транзакции и конкурентные запросы', () => {
  let db: PrismaClient;
  let service: LinkRequestService;
  const users: string[] = [];
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Разрешена только отдельная локальная база *_test');
    db = new PrismaClient({ datasourceUrl: url });
    service = new LinkRequestService(db);
    await db.$connect();
  });
  afterAll(async () => {
    if (!db) return;
    const members = await db.member.findMany({
      where: { userId: { in: users } },
      select: { id: true },
    });
    const requests = await db.memberLinkRequest.findMany({
      where: { userId: { in: users } },
      select: { id: true },
    });
    await db.$transaction([
      db.auditLog.deleteMany({
        where: {
          OR: [{ entityId: { in: users } }, { entityId: { in: requests.map((r) => r.id) } }],
        },
      }),
      db.gearScoreRecord.deleteMany({ where: { memberId: { in: members.map((m) => m.id) } } }),
      db.member.deleteMany({ where: { id: { in: members.map((m) => m.id) } } }),
      db.memberLinkRequest.deleteMany({ where: { userId: { in: users } } }),
      db.screenshot.deleteMany({ where: { userId: { in: users } } }),
      db.user.deleteMany({ where: { id: { in: users } } }),
    ]);
    await db.$disconnect();
  });
  async function fixture() {
    const user = await db.user.create({
      data: { username: 'onboarding-test-' + randomUUID(), discordId: randomUUID() },
    });
    users.push(user.id);
    const file = await db.screenshot.create({ data: { userId: user.id, mime: 'image/png' } });
    return {
      userId: user.id,
      input: {
        nickname: randomUUID().slice(0, 20),
        combatRole: 'DPS',
        weapons: ['STAFF', 'WAND'],
        gearScore: 2147483648,
        screenshotIds: [file.id],
      },
    };
  }
  it('одновременные первые подачи создают одну актуальную анкету', async () => {
    const { userId, input } = await fixture();
    await Promise.all([
      service.create(userId, input),
      service.create(userId, { ...input, nickname: input.nickname + 'b' }),
    ]);
    expect(await db.memberLinkRequest.count({ where: { userId, status: 'PENDING' } })).toBe(1);
  });
  it('два одновременных приёма создают ровно один профиль, GS и аудит', async () => {
    const { userId, input } = await fixture();
    await service.create(userId, input);
    const request = (await service.mine(userId))!;
    const result = await Promise.allSettled([
      service.approve(request.id),
      service.approve(request.id),
    ]);
    expect(result.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const member = await db.member.findUniqueOrThrow({ where: { userId } });
    expect(member.rank).toBe('MEMBER');
    expect(await db.gearScoreRecord.findMany({ where: { memberId: member.id } })).toMatchObject([
      { value: input.gearScore, screenshotIds: input.screenshotIds },
    ]);
    expect(
      await db.auditLog.count({ where: { entityId: request.id, action: 'LINK_REQUEST_APPROVE' } }),
    ).toBe(1);
  });
  it('ошибка FK в аудите откатывает создание профиля, GS и одобрение', async () => {
    const { userId, input } = await fixture();
    await service.create(userId, input);
    const request = (await service.mine(userId))!;
    await expect(service.approve(request.id, 'несуществующий-автор')).rejects.toThrow();
    expect(await db.member.findUnique({ where: { userId } })).toBeNull();
    expect(
      (await db.memberLinkRequest.findUniqueOrThrow({ where: { id: request.id } })).status,
    ).toBe('PENDING');
    expect(await db.auditLog.count({ where: { entityId: request.id } })).toBe(0);
  });
});
