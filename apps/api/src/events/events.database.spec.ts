import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { EventsService, type EventsDb } from './events.service';
const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Создание ивентов: настоящие транзакции PostgreSQL', () => {
  let db: PrismaClient;
  let service: EventsService;
  let memberId: string;
  let typeId: string;
  const input = () => ({
    name: 'Ежедневные контракты',
    eventTypeId: typeId,
    mode: 'PVE',
    startsAt: '2026-11-10T17:00:00Z',
    endsAt: '2026-11-10T19:00:00Z',
    dkpReward: 10,
    raidLeadId: memberId,
    repeat: 'DAILY',
    until: '2026-11-13T23:59:59Z',
  });
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    service = new EventsService(db as unknown as EventsDb);
    memberId = (
      await db.member.create({ data: { nickname: 'series-' + randomUUID().slice(0, 10) } })
    ).id;
    typeId = (await db.eventType.create({ data: { name: 'series-' + randomUUID() } })).id;
  });
  beforeEach(async () => {
    await db.auditLog.deleteMany({ where: { actorMemberId: memberId } });
    await db.event.deleteMany({ where: { eventTypeId: typeId } });
  });
  afterAll(async () => {
    if (!db) return;
    if (memberId) await db.auditLog.deleteMany({ where: { actorMemberId: memberId } });
    if (typeId) {
      await db.event.deleteMany({ where: { eventTypeId: typeId } });
      await db.eventType.delete({ where: { id: typeId } });
    }
    if (memberId) await db.member.delete({ where: { id: memberId } });
    await db.$disconnect();
  });
  it('все даты и одна запись аудита создаются вместе', async () => {
    const result = await service.createSeries(input(), {
      memberId,
      isAdmin: false,
      rank: 'OFFICER',
    });
    expect(result.created).toBe(4);
    const rows = await db.event.findMany({
      where: { seriesId: result.seriesId },
      orderBy: { startsAt: 'asc' },
    });
    expect(rows.map((e) => e.startsAt.toISOString())).toEqual([
      '2026-11-10T17:00:00.000Z',
      '2026-11-11T17:00:00.000Z',
      '2026-11-12T17:00:00.000Z',
      '2026-11-13T17:00:00.000Z',
    ]);
    expect(rows.every((e) => e.dkpReward === 10 && e.name === 'Ежедневные контракты')).toBe(true);
    expect(
      await db.auditLog.count({
        where: { entityId: result.seriesId, action: 'EVENT_SERIES_CREATE' },
      }),
    ).toBe(1);
  });
  it('сбой FK автора аудита откатывает всю серию', async () => {
    await expect(
      service.createSeries(input(), { memberId: 'missing-author', isAdmin: true }),
    ).rejects.toThrow();
    expect(await db.event.count({ where: { eventTypeId: typeId } })).toBe(0);
  });
  it('сбой аудита откатывает и одиночное создание', async () => {
    await expect(
      service.create(input(), { memberId: 'missing-author', isAdmin: true }),
    ).rejects.toThrow();
    expect(await db.event.count({ where: { eventTypeId: typeId } })).toBe(0);
  });
});
