import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CheckInService, type CheckInDb, type CheckInSettings } from './checkin.service';
import { attachCheckInLaunch } from './checkin.module';
import { ConductService, type ConductDb } from '../conduct/conduct.service';
import { EventsService, type EventsActor, type EventsDb } from '../events/events.service';
const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Чек-ин: настоящие транзакции PostgreSQL и append-only ДКП', () => {
  let db: PrismaClient;
  let events: EventsService;
  let checkin: CheckInService;
  let conduct: ConductService;
  let eventId: string;
  let memberId: string;
  let rlId: string;
  /** Часы сервисов: тесты сдвигают их, чтобы нажать кнопки в нужный момент. */
  let now: Date;
  /** За 2 минуты до планового начала 17:00 — внутри прежнего окна по расписанию. */
  const BEFORE_PLANNED_START = new Date('2027-03-03T16:58:00Z');
  const shares: CheckInSettings = { startSharePct: 50, endSharePct: 50 };
  const key = '1'.repeat(64);
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
  });
  beforeEach(async () => {
    const suffix = randomUUID().slice(0, 10);
    now = BEFORE_PLANNED_START;
    memberId = (await db.member.create({ data: { nickname: 'atomic-player-' + suffix } })).id;
    rlId = (await db.member.create({ data: { nickname: 'atomic-rl-' + suffix } })).id;
    const type = await db.eventType.create({ data: { name: 'atomic-' + suffix } });
    eventId = (
      await db.event.create({
        data: {
          name: 'Транзакции',
          eventTypeId: type.id,
          raidLeadId: rlId,
          mode: 'PVE',
          startsAt: new Date('2027-03-03T17:00:00Z'),
          endsAt: new Date('2027-03-03T19:00:00Z'),
          dkpReward: 10,
        },
      })
    ).id;
    events = new EventsService(db as unknown as EventsDb, () => now);
    attachCheckInLaunch(events, key);
    checkin = new CheckInService(db as unknown as CheckInDb, shares, () => now, key);
    conduct = new ConductService(db as unknown as ConductDb, shares);
  });
  // Тестовая БД в CI эфемерна. Созданные записи ledger не удаляем/не меняем;
  // связанные фикстуры тоже остаются, чтобы сохранялись FK и история начислений.
  afterAll(async () => {
    await db?.$disconnect();
  });
  const rl = (): EventsActor => ({ memberId: rlId, isAdmin: false, rank: 'MEMBER' });
  /** Кнопка «Начать ивент». */
  const start = (service: EventsService = events) =>
    service.changeStatus(eventId, { status: 'RUNNING' }, rl());
  /** Кнопка «Завершить ивент». */
  const finish = (service: EventsService = events) =>
    service.changeStatus(eventId, { status: 'FINISHED' }, rl());
  const code = async () => (await checkin.raidLeadView(eventId, rl(), 'MEMBER')).code;
  const eventStatus = () =>
    db.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true } });
  const ledger = () => db.dkpEntry.findMany({ where: { eventId, memberId } });
  const bonuses = () =>
    db.dkpEntry.findMany({
      where: { eventId, type: 'RAID_LEAD_BONUS' },
      select: { memberId: true, amount: true },
    });
  const auditCount = (action: string) =>
    db.auditLog.count({ where: { entityId: eventId, action } });
  /** Прокси над БД: внутри транзакции заданный метод делегата падает. */
  function failDelegate(delegate: 'dkpEntry' | 'auditLog' | 'checkInCode', method = 'create') {
    return new Proxy(db, {
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
                    get(t, k) {
                      if (k === delegate)
                        return new Proxy(t[k], {
                          get: (model, name) =>
                            name === method
                              ? async () => {
                                  throw new Error('injected failure');
                                }
                              : Reflect.get(model, name),
                        });
                      return Reflect.get(t, k);
                    },
                  }),
                ),
              options,
            );
        return Reflect.get(target, prop);
      },
    });
  }
  it('без нажатия кода нет даже в прежнем окне по расписанию', async () => {
    const view = await checkin.raidLeadView(eventId, rl(), 'MEMBER');
    expect(view).toMatchObject({ phase: 'START', windowState: 'NOT_OPEN_YET', code: '' });
    expect((await checkin.playerView(eventId, memberId)).choices).toHaveLength(0);
    expect(await db.checkInCode.count({ where: { eventId } })).toBe(0);
    await expect(checkin.submit(eventId, memberId, { code: '123' })).rejects.toThrow(
      ConflictException,
    );
  });
  it('«Начать ивент» до планового начала открывает окно стартового кода от нажатия', async () => {
    await start();

    expect(await eventStatus()).toEqual({ status: 'RUNNING' });
    const stored = await db.checkInCode.findUniqueOrThrow({
      where: { eventId_phase: { eventId, phase: 'START' } },
    });
    expect(stored.windowOpensAt).toEqual(now);
    expect(+stored.windowClosesAt - +stored.windowOpensAt).toBe(180_000);
    const view = await checkin.raidLeadView(eventId, rl(), 'MEMBER');
    expect(view).toMatchObject({ phase: 'START', windowState: 'ACTIVE' });
    expect(view.code).toMatch(/^\d{3}$/);
    expect((await checkin.playerView(eventId, memberId)).choices).toContain(view.code);
    expect(await checkin.submit(eventId, memberId, { code: view.code })).toEqual({
      result: 'PASSED',
    });
    expect((await ledger()).map((e) => e.amount)).toEqual([5]);
    const launch = await db.auditLog.findFirstOrThrow({
      where: { entityId: eventId, action: 'CHECKIN_CODE_GENERATE' },
    });
    expect(launch.actorMemberId).toBe(rlId);
    expect(launch.comment).not.toContain(view.code);
  });
  it('одновременные нажатия двух управляющих дают один код и один запуск в аудите', async () => {
    const results = await Promise.allSettled([start(), start()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 'rejected' && r.reason instanceof ConflictException),
    ).toHaveLength(1);
    expect(await db.checkInCode.count({ where: { eventId } })).toBe(1);
    expect(await auditCount('CHECKIN_CODE_GENERATE')).toBe(1);
    expect(await auditCount('EVENT_STATUS_CHANGE')).toBe(1);
    expect(await code()).toMatch(/^\d{3}$/);
  });
  it('«Завершить ивент» позже планового окончания открывает финальное окно; код принимается в завершённом ивенте', async () => {
    await start();
    await checkin.submit(eventId, memberId, { code: await code() });
    // Плановое окончание 19:00 прошло, рейд идёт — финальный код откроется нажатием.
    now = new Date('2027-03-03T19:40:00Z');
    expect((await checkin.playerView(eventId, memberId)).phase).toBe('START');

    await finish();

    expect(await eventStatus()).toEqual({ status: 'FINISHED' });
    const view = await checkin.raidLeadView(eventId, rl(), 'MEMBER');
    expect(view).toMatchObject({ phase: 'END', windowState: 'ACTIVE' });
    expect(view.windowOpensAt).toEqual(now);
    expect(await checkin.submit(eventId, memberId, { code: view.code })).toEqual({
      result: 'PASSED',
    });
    expect((await ledger()).map((e) => e.amount)).toEqual([5, 5]);
  });
  it('«Завершить ивент» раньше планового окончания открывает то же финальное окно', async () => {
    await start();
    now = new Date('2027-03-03T16:59:00Z'); // через минуту после начала

    await finish();

    const view = await checkin.raidLeadView(eventId, rl(), 'MEMBER');
    expect(view).toMatchObject({ phase: 'END', windowState: 'ACTIVE' });
    expect((await checkin.playerView(eventId, memberId)).choices).toContain(view.code);
  });
  it('при завершении начисляет бонус только текущему РЛ, даже если прежний РЛ тоже отметился', async () => {
    await db.event.update({ where: { id: eventId }, data: { dkpReward: 50 } });
    await start();
    const startCode = await code();
    await checkin.submit(eventId, rlId, { code: startCode });
    await checkin.submit(eventId, memberId, { code: startCode });
    const officer: EventsActor = { memberId: rlId, isAdmin: false, rank: 'OFFICER' };
    await events.update(eventId, { raidLeadId: memberId }, officer, 'OFFICER');
    const newLead: EventsActor = { memberId, isAdmin: false, rank: 'MEMBER' };

    await expect(finish()).rejects.toThrow(ForbiddenException);
    await events.changeStatus(eventId, { status: 'FINISHED' }, newLead);
    await expect(events.update(eventId, { raidLeadId: rlId }, officer, 'OFFICER')).rejects.toThrow(
      ConflictException,
    );

    expect(await bonuses()).toEqual([{ memberId, amount: 3 }]);
  });
  it('после финального кода доплачивает разницу до 10% полной платы', async () => {
    await db.event.update({ where: { id: eventId }, data: { dkpReward: 50 } });
    await start();
    await checkin.submit(eventId, rlId, { code: await code() });
    await finish();
    const endCode = await code();

    await checkin.submit(eventId, rlId, { code: endCode });
    await expect(checkin.submit(eventId, rlId, { code: endCode })).rejects.toThrow(
      ConflictException,
    );

    expect((await bonuses()).map((entry) => entry.amount).sort()).toEqual([2, 3]);
  });
  it('поздняя ручная отметка начисляет бонус РЛ, который до этого не отметился', async () => {
    await db.event.update({ where: { id: eventId }, data: { dkpReward: 50 } });
    await start();
    await finish();
    expect(await bonuses()).toEqual([]);

    await conduct.manualCheckIn(
      eventId,
      { memberId: rlId, phase: 'END', comment: 'Был на финале' },
      rl(),
      'MEMBER',
    );

    expect(await bonuses()).toEqual([{ memberId: rlId, amount: 3 }]);
  });
  it('финальное окно закрывается через windowSec: поздний код — 409 без траты попытки', async () => {
    await start();
    await finish();
    // Окно финала открыто в 16:58:00.000 на 180 секунд — на следующей миллисекунде оно закрыто.
    now = new Date('2027-03-03T17:01:00.001Z');

    await expect(checkin.submit(eventId, memberId, { code: await code() })).rejects.toThrow(
      ConflictException,
    );
    expect(await db.attendance.count({ where: { eventId, memberId } })).toBe(0);
    expect(await ledger()).toHaveLength(0);
  });
  it('две верные попытки дают одну половину платы, вторая получает 409', async () => {
    await start();
    const value = await code();
    const results = await Promise.allSettled([
      checkin.submit(eventId, memberId, { code: value }),
      checkin.submit(eventId, memberId, { code: value }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 'rejected' && r.reason instanceof ConflictException),
    ).toHaveLength(1);
    expect((await ledger()).map((e) => e.amount)).toEqual([5]);
    expect(await auditCount('CHECKIN_SUBMIT')).toBe(1);
  });

  it('две ручные отметки одной фазы не удваивают выдачу', async () => {
    const update = () =>
      conduct.manualCheckIn(
        eventId,
        { memberId, phase: 'START', comment: 'Помощь игроку' },
        rl(),
        'MEMBER',
      );
    const results = await Promise.allSettled([update(), update()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 'rejected' && r.reason instanceof ConflictException),
    ).toHaveLength(1);
    expect((await ledger()).map((e) => e.amount)).toEqual([5]);
  });
  it('самоотметка одновременно с ручной отметкой РЛ не удваивает начисление', async () => {
    await start();
    const value = await code();
    const results = await Promise.allSettled([
      checkin.submit(eventId, memberId, { code: value }),
      conduct.manualCheckIn(
        eventId,
        { memberId, phase: 'START', comment: 'Помощь игроку' },
        rl(),
        'MEMBER',
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await ledger()).map((e) => e.amount)).toEqual([5]);
    const attendance = await db.attendance.findUniqueOrThrow({
      where: { eventId_memberId: { eventId, memberId } },
    });
    expect(['PASSED', 'MANUAL']).toContain(attendance.checkinStart);
  });
  it('ошибка начисления откатывает самоотметку и аудит, попытку можно повторить', async () => {
    await start();
    const value = await code();
    const broken = new CheckInService(
      failDelegate('dkpEntry') as unknown as CheckInDb,
      shares,
      () => now,
      key,
    );
    await expect(broken.submit(eventId, memberId, { code: value })).rejects.toThrow(
      'injected failure',
    );
    expect(await db.attendance.count({ where: { eventId, memberId } })).toBe(0);
    expect(await auditCount('CHECKIN_SUBMIT')).toBe(0);
    await checkin.submit(eventId, memberId, { code: value });
    expect(await ledger()).toHaveLength(1);
  });
  it('сбой записи кода откатывает и статус: ивент остаётся запланированным, повторное нажатие открывает окно', async () => {
    const broken = new EventsService(
      failDelegate('checkInCode', 'upsert') as unknown as EventsDb,
      () => now,
    );
    attachCheckInLaunch(broken, key);
    await expect(start(broken)).rejects.toThrow('injected failure');
    expect(await eventStatus()).toEqual({ status: 'PLANNED' });
    expect(await db.checkInCode.count({ where: { eventId } })).toBe(0);
    expect(await auditCount('EVENT_STATUS_CHANGE')).toBe(0);
    expect(await auditCount('CHECKIN_CODE_GENERATE')).toBe(0);

    await start();
    expect(await eventStatus()).toEqual({ status: 'RUNNING' });
    expect(await code()).toMatch(/^\d{3}$/);
  });
  it('сбой аудита откатывает ручные ДКП и отметку посещения', async () => {
    const broken = new ConductService(failDelegate('auditLog') as unknown as ConductDb, shares);
    await expect(
      broken.manualDkp(
        eventId,
        { memberId, type: 'MANUAL_EARN', amount: 7, comment: 'Бонус за помощь' },
        rl(),
        'MEMBER',
      ),
    ).rejects.toThrow('injected failure');
    expect(await ledger()).toHaveLength(0);
    await expect(
      broken.setAttendance(
        eventId,
        { memberId, status: 'PRESENT', comment: 'Был в рейде' },
        rl(),
        'MEMBER',
      ),
    ).rejects.toThrow('injected failure');
    expect(await db.attendance.count({ where: { eventId, memberId } })).toBe(0);
    await expect(
      broken.manualCheckIn(
        eventId,
        { memberId, phase: 'START', comment: 'Помощь игроку' },
        rl(),
        'MEMBER',
      ),
    ).rejects.toThrow('injected failure');
    expect(await ledger()).toHaveLength(0);
    expect(await db.attendance.count({ where: { eventId, memberId } })).toBe(0);
  });

  // Аудит F01 (#163): нечётная плата не должна начислять больше самой платы.
  // Ручные отметки идут через ту же checkInShareAmount, что и самоотметки.
  it.each([
    { reward: 11, startAmount: 5, amounts: [5, 6] },
    { reward: 3, startAmount: 1, amounts: [1, 2] },
    { reward: 1, startAmount: 0, amounts: [1] }, // стартовая доля 0 — записи на 0 не будет
  ])('плата $reward: обе фазы дают ровно плату', async ({ reward, startAmount, amounts }) => {
    const suffix = randomUUID().slice(0, 10);
    const oddEventId = (
      await db.event.create({
        data: {
          name: 'Нечётная плата',
          eventTypeId: (await db.eventType.create({ data: { name: 'odd-' + suffix } })).id,
          raidLeadId: rlId,
          mode: 'PVE',
          startsAt: new Date('2027-03-03T17:00:00Z'),
          endsAt: new Date('2027-03-03T19:00:00Z'),
          dkpReward: reward,
        },
      })
    ).id;
    const entries = () => db.dkpEntry.findMany({ where: { eventId: oddEventId, memberId } });
    await conduct.manualCheckIn(
      oddEventId,
      { memberId, phase: 'START', comment: 'Проверка нечётной платы' },
      rl(),
      'MEMBER',
    );
    const afterStart = await entries();
    expect(afterStart.map((e) => e.amount)).toEqual(startAmount > 0 ? [startAmount] : []);
    await conduct.manualCheckIn(
      oddEventId,
      { memberId, phase: 'END', comment: 'Проверка нечётной платы' },
      rl(),
      'MEMBER',
    );
    const afterEnd = await entries();
    expect([...afterEnd.map((e) => e.amount)].sort((a, b) => a - b)).toEqual(amounts);
    expect(afterEnd.reduce((sum, e) => sum + e.amount, 0)).toBe(reward);
  });
});
