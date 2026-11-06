import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { AbsencesDb, AbsencesActor, Clock } from './absences.service';
import { AbsencesService } from './absences.service';

/** «Сейчас» — фиксированный момент для всех тестов дедлайнов. */
const NOW = new Date('2026-03-10T12:00:00Z');

interface AbsenceRecord {
  id: string;
  memberId: string;
  dateFrom: Date;
  dateTo: Date;
  reason: string;
  status: string;
}

function makeDb(seed: Array<Partial<AbsenceRecord> & { id: string }> = []) {
  const absences: AbsenceRecord[] = seed.map((a) => ({
    memberId: 'm-1',
    dateFrom: new Date('2026-03-20T00:00:00Z'),
    dateTo: new Date('2026-03-21T00:00:00Z'),
    reason: 'Отпуск',
    status: 'ACTIVE',
    ...a,
  }));
  const seen = new Set<string>();
  const attendance: Array<{ eventId: string; memberId: string; status: string }> = [];
  const audit: Array<Record<string, string | null>> = [];
  const events: Array<{ startsAt: Date; status: string }> = [
    { startsAt: new Date('2026-03-20T17:00:00Z'), status: 'PLANNED' }, // в периоде заявок
  ];
  const db: AbsencesDb = {
    absence: {
      findMany: async ({ where }) =>
        absences
          .filter((a) => (where?.memberId ? a.memberId === where.memberId : true))
          .filter((a) => (where?.status ? a.status === where.status : true))
          .sort((a, b) => b.dateFrom.getTime() - a.dateFrom.getTime())
          .map((a) => ({
            ...a,
            member: { nickname: 'Игрок' },
            seenBy: Array.from(seen)
              .filter((s) => s.startsWith(`${a.id}:`))
              .map((s) => ({ seenById: s.split(':')[1]! })),
          })),
      findUnique: async ({ where }) => {
        const found = absences.find((a) => a.id === where.id);
        return found ? { ...found } : null;
      },
      create: async ({ data }) => {
        const created: AbsenceRecord = { id: `a-${absences.length + 1}`, status: 'ACTIVE', ...data };
        absences.push(created);
        return created;
      },
      update: async ({ where, data }) => {
        const found = absences.find((a) => a.id === where.id)!;
        found.status = data.status;
        return found;
      },
    },
    absenceSeen: {
      findUnique: async ({ where }) =>
        seen.has(`${where.absenceId_seenById.absenceId}:${where.absenceId_seenById.seenById}`)
          ? { id: 'seen' }
          : null,
      create: async ({ data }) => {
        seen.add(`${data.absenceId}:${data.seenById}`);
      },
    },
    event: {
      findMany: async ({ where }) =>
        events.filter(
          (e) =>
            e.startsAt >= (where?.startsAt?.gte ?? new Date(0)) &&
            e.startsAt <= (where?.startsAt?.lte ?? new Date(8640000000000000)) &&
            (typeof where?.status === 'string'
              ? e.status === where.status
              : where?.status && 'notIn' in where.status
                ? !where.status.notIn.includes(e.status)
                : true),
        ),
    },
    attendance: {
      findUnique: async ({ where }) =>
        attendance.find(
          (a) =>
            a.eventId === where.eventId_memberId.eventId &&
            a.memberId === where.eventId_memberId.memberId,
        ) ?? null,
      create: async ({ data }) => {
        attendance.push({ ...data });
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audit.push(data);
      },
    },
  };
  return { db, absences, seen, attendance, audit, events };
}

const ACTOR: AbsencesActor = { memberId: 'm-1', isAdmin: false, rank: 'MEMBER' };

const LEADER: AbsencesActor = { memberId: 'm-lead', isAdmin: false, rank: 'GUILD_LEADER' };

const SETTINGS = { deadlineBeforeStartSec: 180 };
const clock: Clock = () => NOW;

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    dateFrom: '2026-03-20T00:00:00Z',
    dateTo: '2026-03-21T00:00:00Z',
    reason: 'Отпуск за городом',
    ...overrides,
  };
}

describe('AbsencesService.create', () => {
  it('создаёт заявку на будущий период, пишет аудит', async () => {
    const { db, audit } = makeDb();
    const service = new AbsencesService(db, SETTINGS, clock);

    const result = await service.create('m-1', createBody(), ACTOR);
    expect(result.id).toBeDefined();
    expect(audit[0]).toMatchObject({ action: 'ABSENCE_CREATE', entityType: 'Absence' });
  });

  it('задним числом — 409', async () => {
    const { db } = makeDb();
    const service = new AbsencesService(db, SETTINGS, clock);

    await expect(
      service.create(
        'm-1',
        createBody({ dateFrom: '2026-03-01T00:00:00Z', dateTo: '2026-03-02T00:00:00Z' }),
        ACTOR,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('меньше 3 минут до старта пересекающего ивента — 409', async () => {
    const { db, events } = makeDb();
    // Ивент через 2 минуты — в периоде заявки
    events.push({ startsAt: new Date('2026-03-10T12:02:00Z'), status: 'PLANNED' });
    const service = new AbsencesService(db, SETTINGS, clock);

    await expect(
      service.create(
        'm-1',
        createBody({ dateFrom: '2026-03-10T00:00:00Z', dateTo: '2026-03-11T00:00:00Z' }),
        ACTOR,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('ревизия: уже начавшийся (RUNNING) ивент в периоде — заявку подать нельзя', async () => {
    const { db, events } = makeDb();
    events.push({ startsAt: new Date('2026-03-10T11:00:00Z'), status: 'RUNNING' }); // начался час назад
    const service = new AbsencesService(db, SETTINGS, clock);

    await expect(
      service.create(
        'm-1',
        createBody({ dateFrom: '2026-03-10T00:00:00Z', dateTo: '2026-03-11T00:00:00Z' }),
        ACTOR,
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('AbsencesService.cancel', () => {
  it('свою заявку до начала ивента — можно, с аудитом', async () => {
    const { db, audit } = makeDb([{ id: 'a-1' }]);
    const service = new AbsencesService(db, SETTINGS, clock);

    const result = await service.cancel('a-1', ACTOR);
    expect(result).toEqual({ ok: true });
    expect(audit[0]).toMatchObject({ action: 'ABSENCE_CANCEL' });
  });

  it('чужую заявку — 403', async () => {
    const { db } = makeDb([{ id: 'a-1', memberId: 'm-2' }]);
    const service = new AbsencesService(db, SETTINGS, clock);

    await expect(service.cancel('a-1', ACTOR)).rejects.toThrow(ForbiddenException);
  });

  it('ивент уже начался — 409', async () => {
    const { db } = makeDb([
      { id: 'a-1', dateFrom: new Date('2026-03-10T00:00:00Z'), dateTo: new Date('2026-03-11T00:00:00Z') },
    ]);
    (db.event.findMany as unknown) = async () => [{ startsAt: new Date('2026-03-10T11:00:00Z') }];
    const service = new AbsencesService(db, SETTINGS, clock);
    await expect(service.cancel('a-1', ACTOR)).rejects.toThrow(ConflictException);
  });
});

describe('AbsencesService.markSeen', () => {
  it('глава ставит «Увидел» — идемпотентно, статус заявки не меняется (офицер больше не может — решение владельца)', async () => {
    const { db, seen, absences } = makeDb([{ id: 'a-1' }]);
    const service = new AbsencesService(db, SETTINGS, clock);

    await expect(service.markSeen('a-1', LEADER)).resolves.toEqual({ ok: true });
    await expect(service.markSeen('a-1', LEADER)).resolves.toEqual({ ok: true }); // повтор — не ошибка
    expect(seen.has('a-1:m-lead')).toBe(true);
    expect(absences[0]!.status).toBe('ACTIVE'); // «Увидел» на статус не влияет
  });

  it('рядовой не может ставить «Увидел» — 403', async () => {
    const { db } = makeDb([{ id: 'a-1' }]);
    const service = new AbsencesService(db, SETTINGS, clock);

    await expect(service.markSeen('a-1', ACTOR)).rejects.toThrow(ForbiddenException);
  });
});

describe('AbsencesService.forEvent / markExcusedForFinishedEvent', () => {
  it('находит заявки, покрывающие дату ивента', async () => {
    const { db } = makeDb([
      { id: 'a-1', memberId: 'm-1' }, // 20–21 марта — покрывает ивент 20-го
      { id: 'a-2', memberId: 'm-2', dateFrom: new Date('2026-03-25T00:00:00Z'), dateTo: new Date('2026-03-26T00:00:00Z') },
    ]);
    const service = new AbsencesService(db, SETTINGS, clock);

    const rows = await service.forEvent(new Date('2026-03-20T17:00:00Z'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'a-1', memberId: 'm-1' });
  });

  it('при завершении ивента отсутствующим ставится EXCUSED_ABSENCE', async () => {
    const { db, attendance } = makeDb([
      { id: 'a-1', memberId: 'm-1' },
      { id: 'a-2', memberId: 'm-2' },
    ]);
    const service = new AbsencesService(db, SETTINGS, clock);

    const marked = await service.markExcusedForFinishedEvent('e-1', new Date('2026-03-20T17:00:00Z'));
    expect(marked).toBe(2);
    expect(attendance).toEqual([
      { eventId: 'e-1', memberId: 'm-1', status: 'EXCUSED_ABSENCE' },
      { eventId: 'e-1', memberId: 'm-2', status: 'EXCUSED_ABSENCE' },
    ]);
  });

  it('ревизия: не перезаписывает существующие отметки (чек-ин PASSED остаётся)', async () => {
    const { db, attendance } = makeDb([{ id: 'a-1', memberId: 'm-1' }]);
    // m-1 пришёл и отметился кодом до закрытия ивента
    attendance.push({ eventId: 'e-1', memberId: 'm-1', status: 'PRESENT' });
    const service = new AbsencesService(db, SETTINGS, clock);

    const marked = await service.markExcusedForFinishedEvent('e-1', new Date('2026-03-20T17:00:00Z'));
    expect(marked).toBe(0); // никого нового не отметили
    expect(attendance).toEqual([{ eventId: 'e-1', memberId: 'm-1', status: 'PRESENT' }]);
  });
});

describe('AbsencesService.list', () => {
  it('свои заявки возвращает с отметками «Увидел»', async () => {
    const { db, seen } = makeDb([{ id: 'a-1', memberId: 'm-1' }, { id: 'a-2', memberId: 'm-2' }]);
    seen.add('a-1:m-off');
    const service = new AbsencesService(db, SETTINGS, clock);

    const mine = await service.list('m-1');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.seenBy).toEqual(['m-off']);

    const all = await service.list();
    expect(all).toHaveLength(2);
  });
});
