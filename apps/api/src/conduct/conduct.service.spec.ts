import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { ConductDb, ConductSettings } from './conduct.service';
import { ConductService } from './conduct.service';

const EVENT = {
  id: 'e-1',
  status: 'RUNNING',
  startsAt: new Date('2026-03-03T17:00:00Z'),
  endsAt: new Date('2026-03-03T19:00:00Z'),
  dkpReward: 10,
  raidLeadId: 'm-rl',
};

const SETTINGS: ConductSettings = { startSharePct: 50, endSharePct: 50 };

const LEADER = { memberId: 'm-off', isAdmin: false };
const RL = { memberId: 'm-rl', isAdmin: false };
const MEMBER = { memberId: 'm-3', isAdmin: false };

function makeDb() {
  const members = [
    { id: 'm-1', nickname: 'Первый' },
    { id: 'm-2', nickname: 'Второй' },
    { id: 'm-rl', nickname: 'РЛ' },
  ];
  const attendance = new Map<
    string,
    { memberId: string; status: string | null; checkinStart: string; checkinEnd: string }
  >();
  const dkp: Array<{
    memberId: string;
    type: string;
    amount: number;
    eventId: string;
    createdById: string;
    comment: string;
  }> = [];
  const audit: Array<Record<string, string | null>> = [];
  const db: ConductDb = {
    event: {
      findUnique: async ({ where }) => (where.id === 'e-1' ? { ...EVENT } : null),
    },
    member: {
      findMany: async () => [...members],
    },
    attendance: {
      findMany: async ({ where }) =>
        Array.from(attendance.values()).filter((a) => a.memberId && where.eventId === 'e-1'),
      findUnique: async ({ where }) => attendance.get(where.eventId_memberId.memberId) ?? null,
      upsert: async ({ where, create, update }) => {
        const key = where.eventId_memberId.memberId;
        const current =
          attendance.get(key) ?? { memberId: key, status: null, checkinStart: 'PENDING', checkinEnd: 'PENDING' };
        attendance.set(key, { ...current, ...create, ...update } as typeof current);
      },
    },
    dkpEntry: {
      findMany: async ({ where }) => dkp.filter((d) => d.eventId === where.eventId),
      create: async ({ data }) => {
        dkp.push(data);
        return { id: `d-${dkp.length}` };
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audit.push(data);
      },
    },
  };
  return { db, attendance, dkp, audit };
}

describe('ConductService.setAttendance', () => {
  it('РЛ ставит «опоздал» с комментарием — аудит MANUAL_ATTENDANCE', async () => {
    const { db, audit } = makeDb();
    const service = new ConductService(db, SETTINGS);

    await service.setAttendance(
      'e-1',
      { memberId: 'm-1', status: 'LATE', comment: 'Задержался на работе' },
      RL,
      'MEMBER',
    );
    expect(audit[0]).toMatchObject({ action: 'MANUAL_ATTENDANCE' });
    expect(audit[0]!.comment).toContain('LATE');
    expect(audit[0]!.comment).toContain('Задержался');
  });

  it('Глава может; рядовой-не-РЛ — 403', async () => {
    const { db } = makeDb();
    const service = new ConductService(db, SETTINGS);

    await service.setAttendance(
      'e-1',
      { memberId: 'm-1', status: 'NO_SHOW', comment: 'Не пришёл' },
      LEADER,
      'GUILD_LEADER',
    );
    await expect(
      service.setAttendance(
        'e-1',
        { memberId: 'm-1', status: 'PRESENT', comment: 'Не его дело' },
        MEMBER,
        'MEMBER',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('EXCUSED_ABSENCE вручную — zod-ошибка (только авто, issue #11)', async () => {
    const { db } = makeDb();
    const service = new ConductService(db, SETTINGS);

    await expect(
      service.setAttendance('e-1', { memberId: 'm-1', status: 'EXCUSED_ABSENCE', comment: 'Вручную' }, LEADER, 'GUILD_LEADER'),
    ).rejects.toThrow();
  });
});

describe('ConductService.manualCheckIn', () => {
  it('РЛ вручную отмечает старт: MANUAL + 50% платы в журнал + аудит', async () => {
    const { db, dkp, audit } = makeDb();
    const service = new ConductService(db, SETTINGS);

    await service.manualCheckIn(
      'e-1',
      { memberId: 'm-1', phase: 'START', comment: 'Ошибся кодом' },
      RL,
      'MEMBER',
    );
    expect(dkp).toHaveLength(1);
    expect(dkp[0]).toMatchObject({
      memberId: 'm-1',
      type: 'CHECKIN_EARN',
      amount: 5, // 50% от 10
      eventId: 'e-1',
    });
    expect(audit[0]).toMatchObject({ action: 'MANUAL_CHECKIN' });
  });

  it('повторная ручная отметка той же фазы — 409 (без двойного начисления)', async () => {
    const { db, dkp } = makeDb();
    const service = new ConductService(db, SETTINGS);

    await service.manualCheckIn('e-1', { memberId: 'm-1', phase: 'END', comment: 'Ушёл на работу' }, LEADER, 'GUILD_LEADER');
    await expect(
      service.manualCheckIn('e-1', { memberId: 'm-1', phase: 'END', comment: 'Ещё раз' }, LEADER, 'GUILD_LEADER'),
    ).rejects.toThrow(ConflictException);
    expect(dkp).toHaveLength(1);
  });

  it('после PASSED-самоотметки ручная — 409', async () => {
    const { db, attendance } = makeDb();
    attendance.set('m-1', { memberId: 'm-1', status: null, checkinStart: 'PASSED', checkinEnd: 'PENDING' });
    const service = new ConductService(db, SETTINGS);

    await expect(
      service.manualCheckIn('e-1', { memberId: 'm-1', phase: 'START', comment: 'Двойная отметка' }, LEADER, 'GUILD_LEADER'),
    ).rejects.toThrow(ConflictException);
  });
});

describe('ConductService.manualDkp', () => {
  it('ручное начисление и корректировка пишутся в журнал с автором и комментарием', async () => {
    const { db, dkp, audit } = makeDb();
    const service = new ConductService(db, SETTINGS);

    await service.manualDkp(
      'e-1',
      { memberId: 'm-2', type: 'MANUAL_EARN', amount: 3, comment: 'Помог с боссом' },
      LEADER,
      'GUILD_LEADER',
    );
    await service.manualDkp(
      'e-1',
      { memberId: 'm-2', type: 'ADJUSTMENT', amount: -2, comment: 'Ошибка прошлого начисления' },
      LEADER,
      'GUILD_LEADER',
    );
    expect(dkp.map((d) => d.amount)).toEqual([3, -2]);
    expect(dkp.every((d) => d.createdById === 'm-off')).toBe(true);
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ action: 'MANUAL_DKP' });
  });

  it('рядовой не может — 403', async () => {
    const { db } = makeDb();
    const service = new ConductService(db, SETTINGS);

    await expect(
      service.manualDkp('e-1', { memberId: 'm-1', type: 'MANUAL_EARN', amount: 5, comment: 'Сам себе' }, MEMBER, 'MEMBER'),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('ConductService.checklist', () => {
  it('сводит всех членов, отметки и ДКП ивента', async () => {
    const { db, attendance, dkp } = makeDb();
    attendance.set('m-1', { memberId: 'm-1', status: 'PRESENT', checkinStart: 'PASSED', checkinEnd: 'PASSED' });
    dkp.push({ memberId: 'm-1', type: 'CHECKIN_EARN', amount: 10, eventId: 'e-1', createdById: 'm-1', comment: '' });
    const service = new ConductService(db, SETTINGS);

    const rows = await service.checklist('e-1');
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.memberName === 'Первый')).toMatchObject({
      attendanceStatus: 'PRESENT',
      checkinStart: 'PASSED',
      dkpEarned: 10,
    });
    expect(rows.find((r) => r.memberName === 'Второй')!.dkpEarned).toBe(0);
  });
});
