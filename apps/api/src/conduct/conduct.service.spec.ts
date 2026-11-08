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
    createdById: string | null;
    comment: string;
  }> = [];
  const audit: Array<Record<string, string | null>> = [];
  const receipts = new Map<
    string,
    { eventId: string; actorKey: string; payloadHash: string; actionCount: number }
  >();
  const absences: {
    id: string;
    memberId: string;
    eventId: string | null;
    dateFrom: Date;
    dateTo: Date;
    reason: string;
  }[] = [];
  const db: ConductDb = {
    eventSummaryBatch: {
      findUnique: async ({ where }) => receipts.get(where.id) ?? null,
      create: async ({ data }) => {
        receipts.set(data.id, data);
      },
    },
    absence: {
      findMany: async () => absences,
      create: async ({ data }) => {
        const value = { id: 'absence-' + absences.length, ...data };
        absences.push(value);
        return value;
      },
    },
    setting: { findMany: async () => [] },
    $transaction: async (work) => {
      const oldReceipts = structuredClone([...receipts]);
      const oldAbsences = structuredClone(absences);
      const previousAttendance = structuredClone([...attendance]);
      const previousDkp = structuredClone(dkp);
      const previousAudit = structuredClone(audit);
      try {
        return await work(db);
      } catch (error) {
        receipts.clear();
        oldReceipts.forEach(([key, value]) => receipts.set(key, value));
        absences.splice(0, absences.length, ...oldAbsences);
        attendance.clear();
        for (const [key, value] of previousAttendance) attendance.set(key, value);
        dkp.splice(0, dkp.length, ...previousDkp);
        audit.splice(0, audit.length, ...previousAudit);
        throw error;
      }
    },
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
        const current = attendance.get(key) ?? {
          memberId: key,
          status: null,
          checkinStart: 'PENDING',
          checkinEnd: 'PENDING',
        };
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
        audit.push({ actorMemberId: data.actorMemberId, action: data.action, entityType: data.entityType, entityId: data.entityId, comment: data.comment });
      },
    },
  };
  return { db, attendance, dkp, audit, receipts, absences };
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
      service.setAttendance(
        'e-1',
        { memberId: 'm-1', status: 'EXCUSED_ABSENCE', comment: 'Вручную' },
        LEADER,
        'GUILD_LEADER',
      ),
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

    await service.manualCheckIn(
      'e-1',
      { memberId: 'm-1', phase: 'END', comment: 'Ушёл на работу' },
      LEADER,
      'GUILD_LEADER',
    );
    await expect(
      service.manualCheckIn(
        'e-1',
        { memberId: 'm-1', phase: 'END', comment: 'Ещё раз' },
        LEADER,
        'GUILD_LEADER',
      ),
    ).rejects.toThrow(ConflictException);
    expect(dkp).toHaveLength(1);
  });

  it('после PASSED-самоотметки ручная — 409', async () => {
    const { db, attendance } = makeDb();
    attendance.set('m-1', {
      memberId: 'm-1',
      status: null,
      checkinStart: 'PASSED',
      checkinEnd: 'PENDING',
    });
    const service = new ConductService(db, SETTINGS);

    await expect(
      service.manualCheckIn(
        'e-1',
        { memberId: 'm-1', phase: 'START', comment: 'Двойная отметка' },
        LEADER,
        'GUILD_LEADER',
      ),
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
      service.manualDkp(
        'e-1',
        { memberId: 'm-1', type: 'MANUAL_EARN', amount: 5, comment: 'Сам себе' },
        MEMBER,
        'MEMBER',
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('ConductService.checklist', () => {
  it('сводит всех членов, отметки и ДКП ивента', async () => {
    const { db, attendance, dkp } = makeDb();
    attendance.set('m-1', {
      memberId: 'm-1',
      status: 'PRESENT',
      checkinStart: 'PASSED',
      checkinEnd: 'PASSED',
    });
    dkp.push({
      memberId: 'm-1',
      type: 'CHECKIN_EARN',
      amount: 10,
      eventId: 'e-1',
      createdById: 'm-1',
      comment: '',
    });
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

describe('Доступ к чек-листу', () => {
  it('разрешает автору-Офицеру и РЛ, запрещает чужому Офицеру и пониженному автору', async () => {
    const { db } = makeDb();
    db.event.findUnique = async () => ({ ...EVENT, creatorId: 'm-author' });
    const service = new ConductService(db, SETTINGS);
    await expect(
      service.checklistForActor('e-1', { memberId: 'm-author', isAdmin: false }, 'OFFICER'),
    ).resolves.toHaveLength(3);
    await expect(service.checklistForActor('e-1', RL, 'MEMBER')).resolves.toHaveLength(3);
    await expect(
      service.checklistForActor('e-1', { memberId: 'other', isAdmin: false }, 'OFFICER'),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.checklistForActor('e-1', { memberId: 'm-author', isAdmin: false }, 'MEMBER'),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('Атомарность ручного чек-ина', () => {
  it('сбой аудита откатывает отметку и начисление', async () => {
    const { db, attendance, dkp } = makeDb();
    db.auditLog.create = async () => {
      throw new Error('audit failure');
    };
    await expect(
      new ConductService(db, SETTINGS).manualCheckIn(
        'e-1',
        { memberId: 'm-1', phase: 'START', comment: 'Помощь' },
        RL,
        'MEMBER',
      ),
    ).rejects.toThrow('audit failure');
    expect(attendance.size).toBe(0);
    expect(dkp).toHaveLength(0);
  });
  it('настройки запрашиваются для каждого ручного начисления', async () => {
    const { db, dkp } = makeDb();
    let share = 20;
    const settings = jest.fn(async () => ({ startSharePct: share, endSharePct: 100 - share }));
    const service = new ConductService(db, settings);
    await service.manualCheckIn(
      'e-1',
      { memberId: 'm-1', phase: 'START', comment: 'Старт' },
      RL,
      'MEMBER',
    );
    share = 30;
    await service.manualCheckIn(
      'e-1',
      { memberId: 'm-2', phase: 'START', comment: 'Старт' },
      RL,
      'MEMBER',
    );
    expect(dkp.map((e) => e.amount)).toEqual([2, 3]);
    expect(settings).toHaveBeenCalledTimes(2);
  });
});

describe('Пакет итогов', () => {
  const requestId = '00000000-0000-4000-8000-000000000001';
  it('применяет коды, уважительную и ДКП вместе, точный повтор ничего не добавляет', async () => {
    const { db, dkp, absences, audit } = makeDb();
    const service = new ConductService(db, SETTINGS);
    const body = {
      requestId,
      actions: [
        { kind: 'CHECKIN', memberId: 'm-1', phase: 'START', comment: 'Был на старте' },
        { kind: 'CHECKIN', memberId: 'm-1', phase: 'END', comment: 'Был до конца' },
        { kind: 'EXCUSE', memberId: 'm-2', reason: 'Работа' },
        { kind: 'DKP', memberId: 'm-1', amount: -2, comment: 'Коррекция ошибки' },
      ],
    };
    expect(await service.applySummary('e-1', body, RL, 'MEMBER')).toEqual({
      ok: true,
      applied: 4,
      repeated: false,
    });
    expect(dkp.map((row) => row.amount)).toEqual([5, 5, -2]);
    expect(absences).toHaveLength(1);
    const rows = await service.checklist('e-1');
    expect(rows.find((row) => row.memberId === 'm-1')).toMatchObject({
      attendanceStatus: 'PRESENT',
      dkpEarned: 8,
    });
    expect(rows.find((row) => row.memberId === 'm-2')).toMatchObject({
      attendanceStatus: 'EXCUSED_ABSENCE',
      dkpEarned: 0,
    });
    const auditCount = audit.length;
    expect((await service.applySummary('e-1', body, RL, 'MEMBER')).repeated).toBe(true);
    expect(dkp).toHaveLength(3);
    expect(audit).toHaveLength(auditCount);
    await expect(
      service.applySummary('e-1', { ...body, actions: body.actions.slice(0, 1) }, RL, 'MEMBER'),
    ).rejects.toThrow(ConflictException);
    await expect(service.applySummary('e-1', body, LEADER, 'GUILD_LEADER')).rejects.toThrow(
      ConflictException,
    );
  });
  it('конфликт в последнем действии откатывает предыдущие записи и квитанцию', async () => {
    const { db, attendance, dkp, receipts, audit } = makeDb();
    attendance.set('m-1', {
      memberId: 'm-1',
      status: null,
      checkinStart: 'PASSED',
      checkinEnd: 'PENDING',
    });
    await expect(
      new ConductService(db, SETTINGS).applySummary(
        'e-1',
        {
          requestId,
          actions: [
            { kind: 'DKP', memberId: 'm-2', amount: 10, comment: 'Помог рейду' },
            { kind: 'CHECKIN', memberId: 'm-1', phase: 'START', comment: 'Повтор старта' },
          ],
        },
        RL,
        'MEMBER',
      ),
    ).rejects.toThrow(ConflictException);
    expect(dkp).toHaveLength(0);
    expect(receipts.size).toBe(0);
    expect(audit).toHaveLength(0);
    expect(attendance.get('m-1')!.checkinStart).toBe('PASSED');
  });
  it('Рядовой и Офицер без назначения не применяют пакет', async () => {
    const { db, dkp } = makeDb();
    const body = {
      requestId,
      actions: [{ kind: 'DKP', memberId: 'm-1', amount: 5, comment: 'Бонус' }],
    };
    for (const rank of ['MEMBER', 'OFFICER'])
      await expect(
        new ConductService(db, SETTINGS).applySummary('e-1', body, MEMBER, rank),
      ).rejects.toThrow(ForbiddenException);
    expect(dkp).toHaveLength(0);
  });
  it('завершённый ивент допускает корректировки, отменённый — нет; состав обязателен', async () => {
    const { db, absences } = makeDb();
    db.event.findUnique = async () => ({ ...EVENT, status: 'FINISHED' });
    const body = { requestId, actions: [{ kind: 'EXCUSE', memberId: 'm-2', reason: 'Работа' }] };
    await new ConductService(db, SETTINGS).applySummary('e-1', body, RL, 'MEMBER');
    expect(absences).toHaveLength(1);
    db.event.findUnique = async () => ({ ...EVENT, status: 'CANCELLED' });
    expect(
      (await new ConductService(db, SETTINGS).applySummary('e-1', body, RL, 'MEMBER')).repeated,
    ).toBe(true);
    await expect(
      new ConductService(db, SETTINGS).applySummary(
        'e-1',
        { ...body, requestId: '00000000-0000-4000-8000-000000000003' },
        RL,
        'MEMBER',
      ),
    ).rejects.toThrow(ConflictException);
    db.event.findUnique = async () => ({ ...EVENT, scope: 'PACK', packId: 'other' });
    await expect(
      new ConductService(db, SETTINGS).applySummary(
        'e-1',
        { ...body, requestId: '00000000-0000-4000-8000-000000000002' },
        RL,
        'MEMBER',
      ),
    ).rejects.toThrow('Участник не входит');
  });
});
