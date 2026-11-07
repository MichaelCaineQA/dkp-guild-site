import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CheckInService, type CheckInDb } from './checkin.service';
import { ConductService, type ConductDb } from '../conduct/conduct.service';
import { ConflictException } from '@nestjs/common';
const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Чек-ин: настоящие транзакции PostgreSQL и append-only ДКП', () => {
  let db: PrismaClient;
  let checkin: CheckInService;
  let conduct: ConductService;
  let eventId: string;
  let memberId: string;
  let rlId: string;
  const now = new Date('2027-03-03T16:58:00Z');
  const settings = {
    generateBeforeStartSec: 180,
    windowSec: 180,
    attempts: 1,
    startSharePct: 50,
    endSharePct: 50,
  };
  const key = '1'.repeat(64);
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Только локальная *_test');
    db = new PrismaClient({ datasourceUrl: url });
  });
  beforeEach(async () => {
    const suffix = randomUUID().slice(0, 10);
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
    checkin = new CheckInService(db as unknown as CheckInDb, settings, () => now, key);
    conduct = new ConductService(db as unknown as ConductDb, settings);
  });
  // Тестовая БД в CI эфемерна. Созданные записи ledger не удаляем/не меняем;
  // связанные фикстуры тоже остаются, чтобы сохранялись FK и история начислений.
  afterAll(async () => {
    await db?.$disconnect();
  });
  const code = async () =>
    (await checkin.raidLeadView(eventId, { memberId: rlId, isAdmin: false }, 'MEMBER')).code;
  const ledger = () => db.dkpEntry.findMany({ where: { eventId, memberId } });
  function failDelegate(delegate: 'dkpEntry' | 'auditLog') {
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
                        return {
                          create: async () => {
                            throw new Error('injected failure');
                          },
                        };
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
  it('одновременная генерация возвращает один и тот же код и один аудит без кода', async () => {
    const codes = await Promise.all([code(), code(), code()]);
    expect(new Set(codes).size).toBe(1);
    expect(await db.checkInCode.count({ where: { eventId, phase: 'START' } })).toBe(1);
    const logs = await db.auditLog.findMany({ where: { entityId: eventId } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('CHECKIN_CODE_GENERATE');
    expect(logs[0].comment).toBe('Сгенерирован стартовый код');
  });
  it('две верные попытки дают одну половину платы, вторая получает 409', async () => {
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
    expect(
      await db.auditLog.count({ where: { entityId: eventId, action: 'CHECKIN_SUBMIT' } }),
    ).toBe(1);
  });

  it('две ручные отметки одной фазы не удваивают выдачу', async () => {
    const update = () =>
      conduct.manualCheckIn(
        eventId,
        { memberId, phase: 'START', comment: 'Помощь игроку' },
        { memberId: rlId, isAdmin: false },
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
    const value = await code();
    const results = await Promise.allSettled([
      checkin.submit(eventId, memberId, { code: value }),
      conduct.manualCheckIn(
        eventId,
        { memberId, phase: 'START', comment: 'Помощь игроку' },
        { memberId: rlId, isAdmin: false },
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
    const value = await code();
    const broken = new CheckInService(
      failDelegate('dkpEntry') as unknown as CheckInDb,
      settings,
      () => now,
      key,
    );
    await expect(broken.submit(eventId, memberId, { code: value })).rejects.toThrow(
      'injected failure',
    );
    expect(await db.attendance.count({ where: { eventId, memberId } })).toBe(0);
    expect(
      await db.auditLog.count({ where: { action: 'CHECKIN_SUBMIT', entityId: eventId } }),
    ).toBe(0);
    await checkin.submit(eventId, memberId, { code: value });
    expect(await ledger()).toHaveLength(1);
  });
  it('сбой аудита откатывает ручные ДКП и отметку посещения', async () => {
    const broken = new ConductService(failDelegate('auditLog') as unknown as ConductDb, settings);
    await expect(
      broken.manualDkp(
        eventId,
        { memberId, type: 'MANUAL_EARN', amount: 7, comment: 'Бонус за помощь' },
        { memberId: rlId, isAdmin: false },
        'MEMBER',
      ),
    ).rejects.toThrow('injected failure');
    expect(await ledger()).toHaveLength(0);
    await expect(
      broken.setAttendance(
        eventId,
        { memberId, status: 'PRESENT', comment: 'Был в рейде' },
        { memberId: rlId, isAdmin: false },
        'MEMBER',
      ),
    ).rejects.toThrow('injected failure');
    expect(await db.attendance.count({ where: { eventId, memberId } })).toBe(0);
    await expect(
      broken.manualCheckIn(
        eventId,
        { memberId, phase: 'START', comment: 'Помощь игроку' },
        { memberId: rlId, isAdmin: false },
        'MEMBER',
      ),
    ).rejects.toThrow('injected failure');
    expect(await ledger()).toHaveLength(0);
    expect(await db.attendance.count({ where: { eventId, memberId } })).toBe(0);
  });
  it('досрочный код и его аудит откатываются вместе', async () => {
    const broken = new CheckInService(
      failDelegate('auditLog') as unknown as CheckInDb,
      settings,
      () => now,
      key,
    );
    await expect(
      broken.startEndCodeEarly(eventId, { memberId: rlId, isAdmin: false }, 'MEMBER'),
    ).rejects.toThrow('injected failure');
    expect(await db.checkInCode.count({ where: { eventId, phase: 'END' } })).toBe(0);
    await checkin.startEndCodeEarly(eventId, { memberId: rlId, isAdmin: false }, 'MEMBER');
    expect(
      await db.auditLog.count({ where: { action: 'CHECKIN_END_EARLY', entityId: eventId } }),
    ).toBe(1);
  });
});
