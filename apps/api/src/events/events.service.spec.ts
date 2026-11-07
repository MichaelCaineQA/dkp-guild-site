import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EventsDb, EventsActor } from './events.service';
import { EventsService } from './events.service';

interface EventRecord {
  id: string;
  name: string;
  eventTypeId: string;
  mode: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  dkpReward: number;
  raidLeadId: string;
  place: string | null;
  notes: string | null;
  seriesId: string | null;
}

function makeDb(seed: Array<Partial<EventRecord> & { id: string }> = []) {
  const events: EventRecord[] = seed.map((e) => ({
    name: 'Сбор гильдии',
    eventTypeId: 'et-1',
    mode: 'PVE',
    status: 'PLANNED',
    startsAt: new Date('2026-03-03T17:00:00Z'),
    endsAt: new Date('2026-03-03T19:00:00Z'),
    dkpReward: 10,
    raidLeadId: 'm-rl',
    place: null,
    notes: null,
    seriesId: null,
    ...e,
  }));
  const audit: Array<Record<string, string | null>> = [];
  const db: EventsDb = {
    eventType: {
      findUnique: async ({ where }) =>
        where.id === 'et-1' ? { id: 'et-1', name: 'Гильдбосс' } : null,
    },
    member: {
      findUnique: async ({ where }) =>
        where.id === 'm-rl' ? { id: 'm-rl', nickname: 'РЛ' } : null,
    },
    event: {
      findMany: async ({ where, orderBy }) => {
        expect(orderBy).toEqual({ startsAt: 'asc' });
        return events
          .filter((e) => (where.startsAt?.gte ? e.startsAt >= where.startsAt.gte : true))
          .filter((e) => (where.startsAt?.lte ? e.startsAt <= where.startsAt.lte : true))
          .filter((e) => (where.eventTypeId ? e.eventTypeId === where.eventTypeId : true))
          .filter((e) => (where.mode ? e.mode === where.mode : true))
          .filter((e) => (where.seriesId ? e.seriesId === where.seriesId : true))
          .map((e) => ({ ...e, eventType: { name: 'Гильдбосс' }, raidLead: { nickname: 'РЛ' } }));
      },
      findUnique: async ({ where }) => {
        const found = events.find((e) => e.id === where.id);
        return found
          ? {
              ...found,
              eventTypeName: 'Гильдбосс',
              raidLeadName: 'РЛ',
              eventType: { name: 'Гильдбосс' },
              raidLead: { nickname: 'РЛ' },
            }
          : null;
      },
      create: async ({ data }) => {
        const created: EventRecord = {
          id: `e-${events.length + 1}`,
          name: data.name,
          eventTypeId: data.eventTypeId,
          mode: data.mode,
          status: 'PLANNED',
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          dkpReward: data.dkpReward,
          raidLeadId: data.raidLeadId,
          place: data.place ?? null,
          notes: data.notes ?? null,
          seriesId: data.seriesId ?? null,
        };
        events.push(created);
        return created;
      },
      update: async ({ where, data }) => {
        const event = events.find((e) => e.id === where.id)!;
        Object.assign(event, data);
        return event;
      },
      deleteMany: async ({ where }) => {
        const doomed = events.filter(
          (e) => e.seriesId === where.seriesId && e.status === where.status,
        );
        for (const d of doomed) {
          events.splice(events.indexOf(d), 1);
        }
        return { count: doomed.length };
      },
      delete: async ({ where }) => {
        const index = events.findIndex((e) => e.id === where.id);
        if (index >= 0) {
          events.splice(index, 1);
        }
        return {};
      },
      count: async ({ where }) =>
        events.filter((e) => e.seriesId === where.seriesId && e.status !== 'PLANNED').length,
    },
    auditLog: {
      create: async ({ data }) => {
        audit.push(data);
      },
    },
  };
  return { db, events, audit };
}

const ACTOR: EventsActor = { memberId: 'm-leader', isAdmin: false, rank: 'GUILD_LEADER' };

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Сбор гильдии',
    eventTypeId: 'et-1',
    mode: 'PVE',
    startsAt: '2026-03-03T17:00:00Z',
    endsAt: '2026-03-03T19:00:00Z',
    dkpReward: 10,
    raidLeadId: 'm-rl',
    ...overrides,
  };
}

describe('EventsService.create', () => {
  it('создаёт ивент и пишет аудит с платой и режимом', async () => {
    const { db, audit } = makeDb();
    const service = new EventsService(db);

    const result = await service.create(createBody(), ACTOR);
    expect(result.id).toBeDefined();
    expect(audit[0]).toMatchObject({ action: 'EVENT_CREATE', entityType: 'Event' });
    expect(audit[0]!.comment).toContain('плата 10 ДКП');
  });

  it('название сохраняется независимо от типа и читается в списке/карточке', async () => {
    const { db, events } = makeDb();
    const service = new EventsService(db);
    const { id } = await service.create(createBody({ name: 'Вечерний поход' }), ACTOR);
    expect(events[0].name).toBe('Вечерний поход');
    expect((await service.getOne(id)).name).toBe('Вечерний поход');
    await service.update(id, { name: 'Новый поход' }, ACTOR, 'GUILD_LEADER');
    expect((await service.getOne(id)).name).toBe('Новый поход');
  });

  it('неизвестный тип ивента — 404', async () => {
    const { db } = makeDb();
    const service = new EventsService(db);

    await expect(service.create(createBody({ eventTypeId: 'et-x' }), ACTOR)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('неизвестный РЛ — 404', async () => {
    const { db } = makeDb();
    const service = new EventsService(db);

    await expect(service.create(createBody({ raidLeadId: 'm-x' }), ACTOR)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('конец раньше начала — 409', async () => {
    const { db } = makeDb();
    const service = new EventsService(db);

    await expect(
      service.create(createBody({ endsAt: '2026-03-03T16:00:00Z' }), ACTOR),
    ).rejects.toThrow(ConflictException);
  });
});

describe('EventsService.createSeries / deleteSeries', () => {
  it('«вт/чт × 4 недели» — 8 ивентов с общим seriesId, аудит серии', async () => {
    const { db, events, audit } = makeDb();
    const service = new EventsService(db);

    const result = await service.createSeries(
      { ...createBody(), weekdays: [2, 4], weeks: 4 },
      ACTOR,
    );
    expect(result.created).toBe(8);
    const series = events.filter((e) => e.seriesId === result.seriesId);
    expect(series).toHaveLength(8);
    expect(audit[0]).toMatchObject({ action: 'EVENT_SERIES_CREATE', entityId: result.seriesId });
  });

  it('серия удаляется целиком, пока все PLANNED', async () => {
    const { db, events } = makeDb();
    const service = new EventsService(db);

    const { seriesId } = await service.createSeries(
      { ...createBody(), weekdays: [2], weeks: 2 },
      ACTOR,
    );
    const result = await service.deleteSeries(seriesId, ACTOR);
    expect(result.deleted).toBe(2);
    expect(events.filter((e) => e.seriesId === seriesId)).toHaveLength(0);
  });

  it('если хоть один ивент серии не PLANNED — удаление запрещено (409)', async () => {
    const { db, events } = makeDb();
    const service = new EventsService(db);

    const { seriesId } = await service.createSeries(
      { ...createBody(), weekdays: [2], weeks: 2 },
      ACTOR,
    );
    events.find((e) => e.seriesId === seriesId)!.status = 'RUNNING';

    await expect(service.deleteSeries(seriesId, ACTOR)).rejects.toThrow(ConflictException);
  });
});

describe('EventsService.update', () => {
  it('офицер меняет время, плата ДКП не входит в схему (отбрасывается)', async () => {
    const { db } = makeDb([{ id: 'e-1' }]);
    const service = new EventsService(db);

    await service.update('e-1', { startsAt: '2026-03-03T18:00:00Z' }, ACTOR, 'OFFICER');
    // Попытка передать плату игнорируется схемой — в data её нет
    await expect(
      service.update('e-1', { dkpReward: 999 } as never, ACTOR, 'OFFICER'),
    ).resolves.toEqual({ id: 'e-1' });
    const after = await service.getOne('e-1');
    expect(after.dkpReward).toBe(10);
  });

  it('РЛ ивента (рядовой) может редактировать своё, чужой рядовой — 403', async () => {
    const { db } = makeDb([{ id: 'e-1', raidLeadId: 'm-rl' }]);
    const service = new EventsService(db);

    await expect(
      service.update(
        'e-1',
        { place: 'Место сбора' },
        { memberId: 'm-rl', isAdmin: false },
        'MEMBER',
      ),
    ).resolves.toEqual({ id: 'e-1' });

    await expect(
      service.update('e-1', { place: 'X' }, { memberId: 'm-other', isAdmin: false }, 'MEMBER'),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('EventsService.changeStatus', () => {
  it('planned → running → finished по цепочке, с аудитом', async () => {
    const { db, audit } = makeDb([{ id: 'e-1' }]);
    const service = new EventsService(db);

    await service.changeStatus('e-1', { status: 'RUNNING' }, ACTOR);
    await service.changeStatus('e-1', { status: 'FINISHED' }, ACTOR);
    expect(audit).toHaveLength(2);
    expect(audit[1]!.comment).toContain('RUNNING → FINISHED');
  });

  it('недопустимый переход — 409', async () => {
    const { db } = makeDb([{ id: 'e-1', status: 'FINISHED' }]);
    const service = new EventsService(db);

    await expect(service.changeStatus('e-1', { status: 'RUNNING' }, ACTOR)).rejects.toThrow(
      ConflictException,
    );
  });

  it('planned → cancelled можно, cancelled → planned нельзя', async () => {
    const { db } = makeDb([{ id: 'e-1' }]);
    const service = new EventsService(db);

    await service.changeStatus('e-1', { status: 'CANCELLED' }, ACTOR);
    await expect(service.changeStatus('e-1', { status: 'PLANNED' }, ACTOR)).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('EventsService.list', () => {
  it('фильтрует по периоду, типу и режиму; сортировка по началу', async () => {
    const { db } = makeDb([
      { id: 'e-1', startsAt: new Date('2026-03-05T17:00:00Z'), mode: 'PVP' },
      { id: 'e-2', startsAt: new Date('2026-03-10T17:00:00Z') },
      { id: 'e-3', startsAt: new Date('2026-04-01T17:00:00Z') },
    ]);
    const service = new EventsService(db);

    const march = await service.list({ from: '2026-03-01', to: '2026-03-31' });
    expect(march.map((e) => e.id)).toEqual(['e-1', 'e-2']);

    const pvp = await service.list({ mode: 'PVP' });
    expect(pvp.map((e) => e.id)).toEqual(['e-1']);
  });
});

describe('EventsService.deleteOne', () => {
  it('удаляет PLANNED-ивент с аудитом', async () => {
    const { db, events, audit } = makeDb([{ id: 'e-1' }]);
    const service = new EventsService(db);

    await service.deleteOne('e-1', ACTOR);
    expect(events).toHaveLength(0);
    expect(audit[0]).toMatchObject({ action: 'EVENT_DELETE', entityId: 'e-1' });
  });

  it('не-PLANNED удалить нельзя — 409', async () => {
    const { db } = makeDb([{ id: 'e-1', status: 'RUNNING' }]);
    const service = new EventsService(db);

    await expect(service.deleteOne('e-1', ACTOR)).rejects.toThrow(ConflictException);
  });
});

describe('назначенный РЛ и финальные состояния', () => {
  const rl: EventsActor = { memberId: 'm-rl', rank: 'MEMBER', isAdmin: false };
  it('право РЛ редактировать свой ивент не позволяет переназначить РЛ', async () => {
    const { db, events, audit } = makeDb([{ id: 'e1' }]);
    await expect(
      new EventsService(db).update('e1', { raidLeadId: 'other' }, rl, 'MEMBER'),
    ).rejects.toThrow(ForbiddenException);
    expect(events[0].raidLeadId).toBe('m-rl');
    expect(audit).toHaveLength(0);
  });
  it('РЛ удаляет свой запланированный ивент, чужой остаётся без изменений', async () => {
    const { db, events, audit } = makeDb([{ id: 'own' }, { id: 'other', raidLeadId: 'other' }]);
    const service = new EventsService(db);
    await expect(service.deleteOne('other', rl)).rejects.toThrow(ForbiddenException);
    expect(events).toHaveLength(2);
    expect(audit).toHaveLength(0);
    await service.deleteOne('own', rl);
    expect(events.map((e) => e.id)).toEqual(['other']);
    expect(audit).toHaveLength(1);
  });
  it('РЛ не удаляет серию, в которой есть чужой ивент', async () => {
    const { db, events, audit } = makeDb([
      { id: 'own', seriesId: 's' },
      { id: 'other', seriesId: 's', raidLeadId: 'other' },
    ]);
    await expect(new EventsService(db).deleteSeries('s', rl)).rejects.toThrow(ForbiddenException);
    expect(events).toHaveLength(2);
    expect(audit).toHaveLength(0);
  });
  it('РЛ удаляет только полностью свою запланированную серию', async () => {
    const { db, events, audit } = makeDb([
      { id: 'own', seriesId: 's' },
      { id: 'other-series', seriesId: 'other', raidLeadId: 'other' },
    ]);
    expect(await new EventsService(db).deleteSeries('s', rl)).toEqual({ deleted: 1 });
    expect(events.map((e) => e.id)).toEqual(['other-series']);
    expect(audit).toHaveLength(1);
  });
  it.each(['FINISHED', 'CANCELLED'])('параметры %s не меняются даже Главой', async (status) => {
    const { db, events, audit } = makeDb([{ id: 'e1', status }]);
    await expect(
      new EventsService(db).update('e1', { place: 'Новое место' }, ACTOR, 'GUILD_LEADER'),
    ).rejects.toThrow(ConflictException);
    expect(events[0].place).toBeNull();
    expect(audit).toHaveLength(0);
  });
});
