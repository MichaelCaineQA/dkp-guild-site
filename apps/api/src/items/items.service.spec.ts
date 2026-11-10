import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ItemInput } from '@dkp/shared';
import { ItemsService, type ItemsActor, type ItemsDb } from './items.service';

const ACTOR: ItemsActor = { memberId: 'm-officer', isAdmin: false };

interface Stored {
  id: string;
  name: string;
  rarity: string | null;
  slot: string | null;
  targetRoles: Array<'ALL' | 'DPS' | 'HEALER' | 'TANK'>;
  defaultStartPrice: number | null;
  _count?: { lootDrops: number };
}

function makeDb(seed: Stored[] = [], lotsByItem: Record<string, number> = {}) {
  const items = seed.map((item) => ({ ...item }));
  const audit: Array<Record<string, string | null>> = [];
  const db: ItemsDb = {
    member: {
      count: async () => 0,
    },
    item: {
      findMany: async () =>
        [...items]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((item) => ({ ...item, _count: { lootDrops: lotsByItem[item.id] ?? 0 } })),
      findUnique: async ({ where }) => {
        const found = items.find((item) => item.id === where.id);
        return found ? { ...found } : null;
      },
      findFirst: async ({ where }) => items.find((item) => item.name === where.name) ?? null,
      create: async ({ data }) => {
        const created = { id: `i-${items.length + 1}`, ...(data as ItemInput) } as Stored;
        items.push(created);
        return { ...created };
      },
      update: async ({ where, data }) => {
        const found = items.find((item) => item.id === where.id)!;
        Object.assign(found, data);
        return { ...found };
      },
      delete: async ({ where }) => {
        const index = items.findIndex((item) => item.id === where.id);
        items.splice(index, 1);
        return {};
      },
    },
    lootDrop: {
      count: async ({ where }) => lotsByItem[where.itemId] ?? 0,
    },
    auditLog: {
      create: async ({ data }) => {
        audit.push({
          actorMemberId: data.actorMemberId,
          action: data.action,
          entityType: data.entityType,
          entityId: data.entityId,
          comment: data.comment ?? null,
        });
      },
    },
  };
  return { db, items, audit };
}

const INPUT = {
  name: 'Клинок рассвета',
  rarity: 'Эпический',
  slot: 'Оружие',
  targetRoles: ['DPS', 'TANK'],
  defaultStartPrice: 120,
};

describe('ItemsService (issue #92)', () => {
  it('list возвращает предметы по алфавиту с числом лотов', async () => {
    const { db } = makeDb(
      [
        { id: 'i-1', name: 'Щит', rarity: null, slot: null, targetRoles: ['ALL'], defaultStartPrice: null },
        { id: 'i-2', name: 'Меч', rarity: null, slot: null, targetRoles: ['DPS'], defaultStartPrice: 50 },
      ],
      { 'i-2': 3 },
    );
    const service = new ItemsService(db);

    const list = await service.list();
    expect(list.map((item) => item.name)).toEqual(['Меч', 'Щит']);
    expect(list[0]).toMatchObject({ lotsCount: 3, defaultStartPrice: 50 });
  });

  it('создаёт предмет и пишет аудит', async () => {
    const { db, audit } = makeDb();
    const service = new ItemsService(db);

    const created = await service.create(INPUT, ACTOR);
    expect(created).toMatchObject({ name: 'Клинок рассвета', targetRoles: ['DPS', 'TANK'] });
    expect(audit[0]).toMatchObject({
      action: 'ITEM_CREATE',
      entityType: 'Item',
      entityId: created.id,
      actorMemberId: 'm-officer',
    });
  });

  it('дубликат названия — 409', async () => {
    const { db } = makeDb([
      { id: 'i-1', name: 'Меч', rarity: null, slot: null, targetRoles: ['ALL'], defaultStartPrice: null },
    ]);
    const service = new ItemsService(db);

    await expect(service.create({ ...INPUT, name: 'Меч' }, ACTOR)).rejects.toThrow(
      ConflictException,
    );
  });

  it('невалидный ввод — 400, аудита нет', async () => {
    const { db, audit } = makeDb();
    const service = new ItemsService(db);

    await expect(service.create({ name: '', targetRoles: ['ALL'] }, ACTOR)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.create({ name: 'Меч', targetRoles: [] }, ACTOR)).rejects.toThrow(
      BadRequestException,
    );
    expect(audit).toHaveLength(0);
  });

  it('обновляет предмет и пишет аудит с переходом названия', async () => {
    const { db, audit } = makeDb([
      { id: 'i-1', name: 'Меч', rarity: null, slot: null, targetRoles: ['ALL'], defaultStartPrice: null },
    ]);
    const service = new ItemsService(db);

    const updated = await service.update('i-1', { ...INPUT, name: 'Меч героя' }, ACTOR);
    expect(updated.name).toBe('Меч героя');
    expect(audit[0]).toMatchObject({ action: 'ITEM_UPDATE' });
    expect(audit[0]!.comment).toContain('«Меч» → «Меч героя»');
  });

  it('переименование в занятое название — 409', async () => {
    const { db } = makeDb([
      { id: 'i-1', name: 'Меч', rarity: null, slot: null, targetRoles: ['ALL'], defaultStartPrice: null },
      { id: 'i-2', name: 'Щит', rarity: null, slot: null, targetRoles: ['ALL'], defaultStartPrice: null },
    ]);
    const service = new ItemsService(db);

    await expect(service.update('i-1', { ...INPUT, name: 'Щит' }, ACTOR)).rejects.toThrow(
      ConflictException,
    );
  });

  it('неизвестный предмет — 404', async () => {
    const { db } = makeDb();
    const service = new ItemsService(db);

    await expect(service.update('i-x', INPUT, ACTOR)).rejects.toThrow(NotFoundException);
    await expect(service.remove('i-x', ACTOR)).rejects.toThrow(NotFoundException);
  });

  it('удаляет свободный предмет с аудитом', async () => {
    const { db, items, audit } = makeDb([
      { id: 'i-1', name: 'Меч', rarity: null, slot: null, targetRoles: ['ALL'], defaultStartPrice: null },
    ]);
    const service = new ItemsService(db);

    await expect(service.remove('i-1', ACTOR)).resolves.toEqual({ ok: true });
    expect(items).toHaveLength(0);
    expect(audit[0]).toMatchObject({ action: 'ITEM_DELETE', entityType: 'Item' });
  });

  it('занятый лотами предмет не удаляется — история лотов сохраняется', async () => {
    const { db, items } = makeDb(
      [
        { id: 'i-1', name: 'Меч', rarity: null, slot: null, targetRoles: ['ALL'], defaultStartPrice: null },
      ],
      { 'i-1': 2 },
    );
    const service = new ItemsService(db);

    await expect(service.remove('i-1', ACTOR)).rejects.toThrow(ConflictException);
    expect(items).toHaveLength(1);
  });
});
