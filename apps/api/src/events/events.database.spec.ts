import { ConflictException } from '@nestjs/common';
import { WeekService } from './week.service';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { EventsService, type EventsDb } from './events.service';
const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
/** Метка тестовых записей журнала (#302): после удаления ивента по нему их не найти. */
const DKP_MARK = '#302 тестовая запись журнала';
suite('Создание ивентов: настоящие транзакции PostgreSQL', () => {
  let db: PrismaClient;
  let service: EventsService;
  let memberId: string;
  let typeId: string;
  let itemId: string;
  const ACTOR = { memberId: '', isAdmin: false, rank: 'OFFICER' as const };
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
    ACTOR.memberId = memberId;
    typeId = (await db.eventType.create({ data: { name: 'series-' + randomUUID() } })).id;
    itemId = (await db.item.create({ data: { name: 'drop-' + randomUUID() } })).id;
  });
  beforeEach(async () => {
    await db.absence.deleteMany({ where: { memberId } });
    await db.auditLog.deleteMany({ where: { actorMemberId: memberId } });
    await db.auction.deleteMany({ where: { lootDrop: { event: { eventTypeId: typeId } } } });
    await db.lootDrop.deleteMany({ where: { event: { eventTypeId: typeId } } });
    await db.checkInCode.deleteMany({ where: { event: { eventTypeId: typeId } } });
    await db.attendance.deleteMany({ where: { event: { eventTypeId: typeId } } });
    await db.dkpEntry.deleteMany({ where: { memberId, comment: { startsWith: DKP_MARK } } });
    await db.event.deleteMany({ where: { eventTypeId: typeId } });
  });
  afterAll(async () => {
    if (!db) return;
    if (memberId) await db.auditLog.deleteMany({ where: { actorMemberId: memberId } });
    if (typeId) {
      await db.auction.deleteMany({ where: { lootDrop: { event: { eventTypeId: typeId } } } });
      await db.lootDrop.deleteMany({ where: { event: { eventTypeId: typeId } } });
      await db.checkInCode.deleteMany({ where: { event: { eventTypeId: typeId } } });
      await db.attendance.deleteMany({ where: { event: { eventTypeId: typeId } } });
      await db.event.deleteMany({ where: { eventTypeId: typeId } });
      await db.eventType.delete({ where: { id: typeId } });
    }
    if (memberId)
      await db.dkpEntry.deleteMany({ where: { memberId, comment: { startsWith: DKP_MARK } } });
    if (itemId) await db.item.deleteMany({ where: { id: itemId } });
    if (memberId) await db.absence.deleteMany({ where: { memberId } });
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
  it('удаление ивента с дропом без лота — дроп уходит каскадом (#109)', async () => {
    const created = await service.create(input(), ACTOR);
    await db.lootDrop.create({ data: { eventId: created.id, itemId } });

    await service.deleteOne(created.id, ACTOR);

    expect(await db.event.findUnique({ where: { id: created.id } })).toBeNull();
    expect(await db.lootDrop.count({ where: { eventId: created.id } })).toBe(0);
    const auditRow = await db.auditLog.findFirst({
      where: { entityId: created.id, action: 'EVENT_DELETE' },
    });
    expect(auditRow?.comment).toContain('дропов: 1');
  });

  it('удаление ивента с лотом — 409, ивент и дроп остаются (#109)', async () => {
    const created = await service.create(input(), ACTOR);
    const drop = await db.lootDrop.create({ data: { eventId: created.id, itemId } });
    await db.auction.create({
      data: { lootDropId: drop.id, durationSec: 600, endsAt: new Date(Date.now() + 600_000) },
    });

    await expect(service.deleteOne(created.id, ACTOR)).rejects.toThrow(/лотами аукциона/);

    expect(await db.event.findUnique({ where: { id: created.id } })).not.toBeNull();
    expect(await db.lootDrop.count({ where: { eventId: created.id } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityId: created.id, action: 'EVENT_DELETE' } }),
    ).toBe(0);

    await db.auction.deleteMany({ where: { lootDropId: drop.id } });
    await db.lootDrop.deleteMany({ where: { eventId: created.id } });
  });

  it('серия с дропами без лотов удаляется вместе с дропами (#109)', async () => {
    const { seriesId } = await service.createSeries(input(), ACTOR);
    const first = await db.event.findFirstOrThrow({ where: { seriesId } });
    await db.lootDrop.create({ data: { eventId: first.id, itemId } });

    await service.deleteSeries(seriesId, ACTOR);

    expect(await db.event.count({ where: { seriesId } })).toBe(0);
    expect(await db.lootDrop.count({ where: { event: { seriesId } } })).toBe(0);
  });

  describe('удаление ивента с историей чек-ина (#302)', () => {
    /** Сгенерированный стартовый код: строка CheckInCode со ссылкой на ивент. */
    const addStartCode = (eventId: string) =>
      db.checkInCode.create({
        data: {
          eventId,
          phase: 'START',
          codeHash: 'hash',
          salt: 'salt',
          codeEnc: 'enc',
          windowOpensAt: new Date(input().startsAt),
          windowClosesAt: new Date(+new Date(input().startsAt) + 180_000),
        },
      });
    const addDkpEntry = (eventId: string) =>
      db.dkpEntry.create({
        data: { memberId, type: 'MANUAL_EARN', amount: 5, eventId, comment: DKP_MARK },
      });
    /** Отказ должен быть предметным 409, а не ошибкой внешнего ключа (500). */
    const expectConflict = async (work: Promise<unknown>, message: RegExp) => {
      const error: unknown = await work.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getStatus()).toBe(409);
      expect((error as ConflictException).message).toMatch(message);
    };

    it('без кодов, отметок и записей журнала ивент удаляется как раньше', async () => {
      const created = await service.create(input(), ACTOR);

      await expect(service.deleteOne(created.id, ACTOR)).resolves.toEqual({ ok: true });

      expect(await db.event.findUnique({ where: { id: created.id } })).toBeNull();
      expect(
        await db.auditLog.count({ where: { entityId: created.id, action: 'EVENT_DELETE' } }),
      ).toBe(1);
    });

    it('код чек-ина сгенерирован — 409, ивент и код остаются', async () => {
      const created = await service.create(input(), ACTOR);
      await addStartCode(created.id);

      await expectConflict(service.deleteOne(created.id, ACTOR), /Чек-ин уже начался/);

      expect(await db.event.findUnique({ where: { id: created.id } })).not.toBeNull();
      expect(await db.checkInCode.count({ where: { eventId: created.id } })).toBe(1);
      expect(
        await db.auditLog.count({ where: { entityId: created.id, action: 'EVENT_DELETE' } }),
      ).toBe(0);
    });

    it('ручная отметка посещения — 409, ивент и отметка остаются', async () => {
      const created = await service.create(input(), ACTOR);
      await db.attendance.create({
        data: { eventId: created.id, memberId, status: 'PRESENT' },
      });

      await expectConflict(service.deleteOne(created.id, ACTOR), /отметк/);

      expect(await db.event.findUnique({ where: { id: created.id } })).not.toBeNull();
      expect(await db.attendance.count({ where: { eventId: created.id } })).toBe(1);
    });

    it('запись журнала ДКП — 409, запись сохраняет ссылку на ивент', async () => {
      const created = await service.create(input(), ACTOR);
      const entry = await addDkpEntry(created.id);

      await expectConflict(service.deleteOne(created.id, ACTOR), /журнал/);

      expect(await db.event.findUnique({ where: { id: created.id } })).not.toBeNull();
      expect((await db.dkpEntry.findUniqueOrThrow({ where: { id: entry.id } })).eventId).toBe(
        created.id,
      );
    });

    it('серия с кодом у одного из ивентов — 409, серия остаётся целиком', async () => {
      const { seriesId } = await service.createSeries(input(), ACTOR);
      const first = await db.event.findFirstOrThrow({ where: { seriesId } });
      await addStartCode(first.id);

      await expectConflict(service.deleteSeries(seriesId, ACTOR), /Чек-ин уже начался/);

      expect(await db.event.count({ where: { seriesId } })).toBe(4);
      expect(await db.checkInCode.count({ where: { event: { seriesId } } })).toBe(1);
      expect(
        await db.auditLog.count({ where: { entityId: seriesId, action: 'EVENT_SERIES_DELETE' } }),
      ).toBe(0);
    });

    it('серия с записью журнала ДКП — 409, все ивенты остаются', async () => {
      const { seriesId } = await service.createSeries(input(), ACTOR);
      const first = await db.event.findFirstOrThrow({ where: { seriesId } });
      await addDkpEntry(first.id);

      await expectConflict(service.deleteSeries(seriesId, ACTOR), /журнал/);

      expect(await db.event.count({ where: { seriesId } })).toBe(4);
      expect(await db.dkpEntry.count({ where: { event: { seriesId } } })).toBe(1);
    });
  });
  it('неделя: активные пересекающиеся отсутствия, отменённые и граница периода в PostgreSQL', async () => {
    await service.create(input(), { memberId, isAdmin: false, rank: 'OFFICER' });
    const from = new Date('2026-11-09T00:00:00Z');
    const to = new Date('2026-11-16T00:00:00Z');
    for (const status of ['ACTIVE', 'ACTIVE', 'CANCELLED'] as const)
      await db.absence.create({
        data: {
          memberId,
          dateFrom: new Date(input().startsAt),
          dateTo: new Date(input().endsAt),
          reason: 'Тест',
          status,
        },
      });
    await db.event.create({
      data: {
        name: 'Граница',
        mode: 'PVE',
        eventTypeId: typeId,
        raidLeadId: memberId,
        startsAt: to,
        endsAt: new Date(+to + 3600000),
        dkpReward: 10,
      },
    });
    await db.event.create({
      data: {
        name: 'Отмена',
        mode: 'PVE',
        eventTypeId: typeId,
        raidLeadId: memberId,
        startsAt: from,
        endsAt: new Date(+from + 3600000),
        dkpReward: 10,
        status: 'CANCELLED',
      },
    });
    const rows = await new WeekService(db).list({ from, to, eventTypeId: typeId });
    expect(rows).toHaveLength(1);
    expect(rows[0].invitedCount).toBeGreaterThanOrEqual(1);
    expect(rows[0].attendingCount).toBe(rows[0].invitedCount - 1);
    await db.absence.updateMany({ where: { memberId }, data: { status: 'CANCELLED' } });
    const restored = await new WeekService(db).list({ from, to, eventTypeId: typeId });
    expect(restored[0].attendingCount).toBe(restored[0].invitedCount);
  });
});
