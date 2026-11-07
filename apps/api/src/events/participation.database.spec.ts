import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { WeekService } from './week.service';
import { ParticipationService } from './participation.service';
const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Участие: PostgreSQL, атомарность и конкурентные запросы', () => {
  let db: PrismaClient;
  let service: ParticipationService;
  let memberId: string;
  let typeId: string;
  let eventId: string;
  const start = new Date('2027-02-09T17:00:00Z');
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
    memberId = (
      await db.member.create({ data: { nickname: 'participation-' + randomUUID().slice(0, 8) } })
    ).id;
    typeId = (await db.eventType.create({ data: { name: 'participation-' + randomUUID() } })).id;
    eventId = (
      await db.event.create({
        data: {
          name: 'Сбор',
          eventTypeId: typeId,
          raidLeadId: memberId,
          mode: 'PVE',
          startsAt: start,
          endsAt: new Date(+start + 3600000),
          dkpReward: 10,
        },
      })
    ).id;
    service = new ParticipationService(db, () => new Date(+start - 86400000));
  });
  beforeEach(async () => {
    await db.absence.deleteMany({ where: { memberId } });
    await db.auditLog.deleteMany({ where: { actorMemberId: memberId } });
  });
  afterAll(async () => {
    if (!db) return;
    if (memberId) {
      await db.absence.deleteMany({ where: { memberId } });
      await db.auditLog.deleteMany({ where: { actorMemberId: memberId } });
    }
    if (typeId) {
      await db.event.deleteMany({ where: { eventTypeId: typeId } });
      await db.eventType.delete({ where: { id: typeId } });
    }
    if (memberId) await db.member.delete({ where: { id: memberId } });
    await db.$disconnect();
  });
  it('два одновременных отказа создают одну заявку и один аудит; возврат отменяет её', async () => {
    await Promise.all([
      service.update(eventId, memberId, { attending: false }),
      service.update(eventId, memberId, { attending: false }),
    ]);
    const rows = await db.absence.findMany({ where: { memberId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dateFrom: start, dateTo: start, reason: '' });
    expect(await db.auditLog.count({ where: { actorMemberId: memberId } })).toBe(1);
    await service.update(eventId, memberId, { attending: true, absenceIds: rows.map((a) => a.id) });
    expect((await service.get(eventId, memberId)).attending).toBe(true);
    expect(await db.auditLog.count({ where: { actorMemberId: memberId } })).toBe(2);
  });

  it('отказ относится только к выбранному ID и следует за переносом времени', async () => {
    await service.update(eventId, memberId, { attending: false });
    const other = await db.event.create({
      data: {
        name: 'Другой',
        eventTypeId: typeId,
        raidLeadId: memberId,
        mode: 'PVE',
        startsAt: start,
        endsAt: new Date(+start + 3600000),
        dkpReward: 10,
      },
    });
    expect((await service.get(other.id, memberId)).attending).toBe(true);
    await db.event.update({
      where: { id: eventId },
      data: { startsAt: new Date(+start + 86400000), endsAt: new Date(+start + 90000000) },
    });
    expect((await service.get(eventId, memberId)).attending).toBe(false);
    const week = await new WeekService(db).list(
      { from: start, to: new Date(+start + 7 * 86400000), eventTypeId: typeId },
      memberId,
    );
    expect(week.find((e) => e.id === eventId)!.attendingCount).toBe(
      week.find((e) => e.id === eventId)!.invitedCount - 1,
    );
    expect(week.find((e) => e.id === other.id)!.attendingCount).toBe(
      week.find((e) => e.id === other.id)!.invitedCount,
    );
    await db.event.update({
      where: { id: eventId },
      data: { startsAt: start, endsAt: new Date(+start + 3600000) },
    });
  });
  it('сбой аудита откатывает реальную транзакцию отсутствия', async () => {
    const broken = new Proxy(db, {
      get(target, key) {
        if (key === '$transaction')
          return (work: (tx: unknown) => Promise<unknown>) =>
            target.$transaction((tx) =>
              work(
                new Proxy(tx, {
                  get(t, k) {
                    if (k === 'auditLog')
                      return {
                        create: async () => {
                          throw new Error('audit failure');
                        },
                      };
                    return Reflect.get(t, k);
                  },
                }),
              ),
            );
        return Reflect.get(target, key);
      },
    });
    await expect(
      new ParticipationService(broken, () => new Date(+start - 86400000)).update(
        eventId,
        memberId,
        { attending: false },
      ),
    ).rejects.toThrow('audit failure');
    expect(await db.absence.count({ where: { memberId } })).toBe(0);
    expect(await db.auditLog.count({ where: { actorMemberId: memberId } })).toBe(0);
  });
  it('удаление запланированного ивента убирает его заявку и отметку Увидел, аудит сохраняется', async () => {
    const extra = await db.event.create({
      data: {
        name: 'Удаляемый',
        eventTypeId: typeId,
        raidLeadId: memberId,
        mode: 'PVE',
        startsAt: start,
        endsAt: new Date(+start + 3600000),
        dkpReward: 10,
      },
    });
    await service.update(extra.id, memberId, { attending: false });
    const absence = await db.absence.findFirstOrThrow({ where: { eventId: extra.id, memberId } });
    await db.absenceSeen.create({
      data: { absenceId: absence.id, seenById: memberId, actorKey: memberId },
    });
    await db.event.delete({ where: { id: extra.id } });
    expect(await db.absence.count({ where: { id: absence.id } })).toBe(0);
    expect(await db.absenceSeen.count({ where: { absenceId: absence.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: absence.id } })).toBe(1);
  });
});
