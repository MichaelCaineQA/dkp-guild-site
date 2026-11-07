import { PrismaClient, type Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { ConductService, type ConductDb } from './conduct.service';
const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Итоги ивента: PostgreSQL, атомарный пакет и повтор запроса', () => {
  let db: PrismaClient;
  let service: ConductService;
  let eventId: string;
  let memberId: string;
  let otherId: string;
  let rlId: string;
  const start = new Date('2027-05-01T17:00:00Z');
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
  });
  beforeEach(async () => {
    const suffix = randomUUID().slice(0, 10);
    rlId = (await db.member.create({ data: { nickname: 'summary-rl-' + suffix } })).id;
    memberId = (await db.member.create({ data: { nickname: 'summary-player-' + suffix } })).id;
    otherId = (await db.member.create({ data: { nickname: 'summary-other-' + suffix } })).id;
    const type = await db.eventType.create({ data: { name: 'summary-' + suffix } });
    eventId = (
      await db.event.create({
        data: {
          name: 'Итоги',
          eventTypeId: type.id,
          raidLeadId: rlId,
          mode: 'PVE',
          startsAt: start,
          endsAt: new Date(+start + 3600000),
          status: 'FINISHED',
          dkpReward: 10,
        },
      })
    ).id;
    service = new ConductService(db as unknown as ConductDb, {
      startSharePct: 50,
      endSharePct: 50,
    });
  });
  // Эфемерная *_test: ledger и его FK-фикстуры не удаляем и не переписываем.
  afterAll(async () => {
    await db?.$disconnect();
  });
  const actor = () => ({ memberId: rlId, isAdmin: false });
  const bonus = () => ({ kind: 'DKP', memberId, amount: 7, comment: 'Помощь рейду' });
  const apply = (body: unknown) => service.applySummary(eventId, body, actor(), 'MEMBER');
  it('два одновременных запроса одного пакета дают одну выдачу и одну квитанцию', async () => {
    const requestId = randomUUID();
    const body = { requestId, actions: [bonus()] };
    const results = await Promise.all([apply(body), apply(body)]);
    expect(results.filter((r) => r.repeated)).toHaveLength(1);
    expect(await db.eventSummaryBatch.count({ where: { id: requestId } })).toBe(1);
    expect((await db.dkpEntry.findMany({ where: { eventId } })).map((e) => e.amount)).toEqual([7]);
    expect(
      await db.auditLog.count({ where: { entityId: eventId, action: 'EVENT_SUMMARY_APPLY' } }),
    ).toBe(1);
    await expect(apply({ ...body, actions: [{ ...bonus(), amount: 8 }] })).rejects.toThrow(
      ConflictException,
    );
  });
  it('отмена после применения не мешает получить прежнюю квитанцию, но запрещает новый пакет', async () => {
    const requestId = randomUUID();
    const body = { requestId, actions: [bonus()] };
    await apply(body);
    await db.event.update({ where: { id: eventId }, data: { status: 'CANCELLED' } });
    expect((await apply(body)).repeated).toBe(true);
    await expect(apply({ ...body, requestId: randomUUID() })).rejects.toThrow(ConflictException);
    expect(await db.dkpEntry.count({ where: { eventId } })).toBe(1);
  });
  it('сохраняет оба кода, отсутствие, ручные ДКП и все записи аудита одним пакетом', async () => {
    const previous = await db.dkpEntry.create({
      data: { eventId, memberId, type: 'ADJUSTMENT', amount: -2, comment: 'Предыдущая коррекция' },
    });
    await apply({
      requestId: randomUUID(),
      actions: [
        { kind: 'CHECKIN', memberId, phase: 'START', comment: 'Был в начале' },
        { kind: 'CHECKIN', memberId, phase: 'END', comment: 'Был до конца' },
        { kind: 'EXCUSE', memberId: otherId, reason: 'Работа' },
        bonus(),
      ],
    });
    const rows = await service.checklist(eventId);
    expect(rows.find((r) => r.memberId === memberId)).toMatchObject({
      attendanceStatus: 'PRESENT',
      dkpEarned: 15,
    });
    expect(rows.find((r) => r.memberId === otherId)).toMatchObject({
      attendanceStatus: 'EXCUSED_ABSENCE',
      dkpEarned: 0,
    });
    expect(await db.dkpEntry.findUnique({ where: { id: previous.id } })).toEqual(previous);
    expect(await db.absence.count({ where: { eventId, memberId: otherId } })).toBe(1);
    expect(
      await db.auditLog.count({ where: { entityId: eventId, action: 'EVENT_SUMMARY_APPLY' } }),
    ).toBe(1);
  });
  it('поздний конфликт откатывает весь пакет, исходный ledger остаётся неизменным', async () => {
    const previous = await db.dkpEntry.create({
      data: {
        eventId,
        memberId,
        type: 'CHECKIN_EARN',
        amount: 5,
        comment: 'Самостоятельный старт',
      },
    });
    await db.attendance.create({ data: { eventId, memberId, checkinStart: 'PASSED' } });
    const requestId = randomUUID();
    await expect(
      apply({
        requestId,
        actions: [
          bonus(),
          { kind: 'EXCUSE', memberId: otherId, reason: 'Работа' },
          { kind: 'CHECKIN', memberId, phase: 'START', comment: 'Повторная отметка' },
        ],
      }),
    ).rejects.toThrow(ConflictException);
    expect(await db.dkpEntry.findMany({ where: { eventId } })).toEqual([previous]);
    expect(await db.absence.count({ where: { eventId } })).toBe(0);
    expect(await db.eventSummaryBatch.count({ where: { id: requestId } })).toBe(0);
    expect(await db.auditLog.count({ where: { actorMemberId: rlId } })).toBe(0);
  });
  it('ошибка итогового аудита откатывает также квитанцию и начисление', async () => {
    const broken = new Proxy(db, {
      get(target, prop) {
        if (prop === '$transaction')
          return (
            work: (tx: unknown) => Promise<unknown>,
            options: { isolationLevel: Prisma.TransactionIsolationLevel },
          ) =>
            target.$transaction(
              (tx) =>
                work(
                  new Proxy(tx, {
                    get(t, key) {
                      if (key === 'auditLog')
                        return {
                          create: async (args: { data: { action: string } }) => {
                            if (args.data.action === 'EVENT_SUMMARY_APPLY')
                              throw new Error('summary audit failure');
                            return tx.auditLog.create(
                              args as Parameters<typeof tx.auditLog.create>[0],
                            );
                          },
                        };
                      return Reflect.get(t, key);
                    },
                  }),
                ),
              options,
            );
        return Reflect.get(target, prop);
      },
    });
    const requestId = randomUUID();
    await expect(
      new ConductService(broken as unknown as ConductDb, {
        startSharePct: 50,
        endSharePct: 50,
      }).applySummary(eventId, { requestId, actions: [bonus()] }, actor(), 'MEMBER'),
    ).rejects.toThrow('summary audit failure');
    expect(await db.dkpEntry.count({ where: { eventId } })).toBe(0);
    expect(await db.eventSummaryBatch.count({ where: { id: requestId } })).toBe(0);
    expect(await db.auditLog.count({ where: { actorMemberId: rlId } })).toBe(0);
  });
  it('чек-лист и пакет используют состав пака и не читают GS', async () => {
    const guild = await db.guild.create({
      data: { name: 'summary-' + randomUUID(), gameTimeAnchor: start },
    });
    const kp = await db.kP.create({ data: { name: 'КП', guildId: guild.id } });
    const pack = await db.pack.create({ data: { name: 'Пак', kpId: kp.id } });
    await db.member.update({ where: { id: memberId }, data: { packId: pack.id } });
    await db.event.update({ where: { id: eventId }, data: { scope: 'PACK', packId: pack.id } });
    expect((await service.checklist(eventId)).map((r) => r.memberId)).toEqual([memberId]);
    await expect(
      apply({ requestId: randomUUID(), actions: [{ ...bonus(), memberId: otherId }] }),
    ).rejects.toThrow('Участник не входит');
    await apply({ requestId: randomUUID(), actions: [bonus()] });
    expect(await db.dkpEntry.count({ where: { eventId, memberId } })).toBe(1);
  });
  it('резервный админ корректирует завершённый ивент; отменённый закрыт', async () => {
    await service.applySummary(
      eventId,
      { requestId: randomUUID(), actions: [bonus()] },
      { memberId: null, isAdmin: true },
      null,
    );
    expect((await db.dkpEntry.findFirstOrThrow({ where: { eventId } })).createdById).toBeNull();
    await db.event.update({ where: { id: eventId }, data: { status: 'CANCELLED' } });
    await expect(apply({ requestId: randomUUID(), actions: [bonus()] })).rejects.toThrow(
      ConflictException,
    );
    expect(await db.dkpEntry.count({ where: { eventId } })).toBe(1);
  });
});
