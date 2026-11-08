import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EventTypesDb, EventTypesActor } from './event-types.service';
import { EventTypesService } from './event-types.service';

const ACTOR: EventTypesActor = { memberId: 'm-actor', isAdmin: false };

function makeDb(seed: Array<{ id: string; name: string }> = []) {
  const types = seed.map((t) => ({ ...t }));
  const audit: Array<Record<string, string | null>> = [];
  const db: EventTypesDb = {
    eventType: {
      findMany: async () => [...types].sort((a, b) => a.name.localeCompare(b.name)),
      // Как и Prisma, фейк возвращает копии — сервис сравнивает до/после.
      findUnique: async ({ where }) => {
        const found = types.find((t) => t.id === where.id);
        return found ? { ...found } : null;
      },
      findFirst: async ({ where }) => types.find((t) => t.name === where.name) ?? null,
      create: async ({ data }) => {
        const created = { id: `t-${types.length + 1}`, ...data };
        types.push(created);
        return created;
      },
      update: async ({ where, data }) => {
        const found = types.find((t) => t.id === where.id)!;
        found.name = data.name;
        return { ...found };
      },
      delete: async ({ where }) => {
        const index = types.findIndex((t) => t.id === where.id);
        types.splice(index, 1);
        return {};
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audit.push({ actorMemberId: data.actorMemberId, action: data.action, entityType: data.entityType, entityId: data.entityId, comment: data.comment ?? null });
      },
    },
  };
  return { db, types, audit };
}

describe('EventTypesService', () => {
  it('list возвращает справочник по алфавиту', async () => {
    const { db } = makeDb([
      { id: 't-1', name: 'Осада' },
      { id: 't-2', name: 'Гильдбосс' },
    ]);
    const service = new EventTypesService(db);

    const list = await service.list();
    expect(list.map((t) => t.name)).toEqual(['Гильдбосс', 'Осада']);
  });

  it('создаёт тип и пишет аудит', async () => {
    const { db, audit } = makeDb();
    const service = new EventTypesService(db);

    const created = await service.create('  Мировой босс  ', ACTOR);
    expect(created.name).toBe('Мировой босс'); // trim
    expect(audit[0]).toMatchObject({ action: 'EVENT_TYPE_CREATE', entityType: 'EventType' });
    expect(audit[0]!.comment).toContain('Мировой босс');
  });

  it('дубликат имени — 409', async () => {
    const { db } = makeDb([{ id: 't-1', name: 'Осада' }]);
    const service = new EventTypesService(db);

    await expect(service.create('Осада', ACTOR)).rejects.toThrow(ConflictException);
  });

  it('имя короче 2 символов — 409', async () => {
    const { db } = makeDb();
    const service = new EventTypesService(db);

    await expect(service.create('О', ACTOR)).rejects.toThrow(ConflictException);
  });

  it('переименовывает с аудитом старого и нового имени', async () => {
    const { db, audit } = makeDb([{ id: 't-1', name: 'Осада' }]);
    const service = new EventTypesService(db);

    const updated = await service.rename('t-1', 'Осада (PvP)', ACTOR);
    expect(updated.name).toBe('Осада (PvP)');
    expect(audit[0]!.comment).toContain('«Осада» → «Осада (PvP)»');
  });

  it('переименование в занятое имя — 409', async () => {
    const { db } = makeDb([
      { id: 't-1', name: 'Осада' },
      { id: 't-2', name: 'Гильдбосс' },
    ]);
    const service = new EventTypesService(db);

    await expect(service.rename('t-1', 'Гильдбосс', ACTOR)).rejects.toThrow(ConflictException);
  });

  it('удаляет неиспользуемый тип с аудитом', async () => {
    const { db, audit } = makeDb([{ id: 't-1', name: 'Осада' }]);
    const service = new EventTypesService(db);

    const result = await service.remove('t-1', ACTOR);
    expect(result).toEqual({ ok: true });
    expect(audit[0]).toMatchObject({ action: 'EVENT_TYPE_DELETE' });
  });

  it('несуществующий тип — 404', async () => {
    const { db } = makeDb();
    const service = new EventTypesService(db);

    await expect(service.remove('t-x', ACTOR)).rejects.toThrow(NotFoundException);
    await expect(service.rename('t-x', 'Новый', ACTOR)).rejects.toThrow(NotFoundException);
  });
});
