import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  itemInputSchema,
  type ItemInput,
  type ItemRow,
  type ItemTargetRole,
} from '@dkp/shared';
import type { AuditWriter } from '../members/members.service';

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
interface StoredItem {
  id: string;
  name: string;
  rarity: string | null;
  slot: string | null;
  targetRoles: ItemTargetRole[];
  defaultStartPrice: number | null;
  _count?: { lootDrops: number };
}

export interface ItemsDb {
  item: {
    findMany(args: {
      orderBy: { name: 'asc' };
      include?: { _count: { select: { lootDrops: true } } };
    }): Promise<StoredItem[]>;
    findUnique(args: { where: { id: string } }): Promise<StoredItem | null>;
    findFirst(args: { where: { name: string } }): Promise<{ id: string } | null>;
    create(args: { data: Omit<ItemInput, 'lotsCount'> }): Promise<StoredItem>;
    update(args: { where: { id: string }; data: ItemInput }): Promise<StoredItem>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  lootDrop: {
    count(args: { where: { itemId: string } }): Promise<number>;
  };
  member: {
    count(args: { where: { preferredItemId: string } }): Promise<number>;
  };
  auditLog: AuditWriter;
}

export interface ItemsActor {
  memberId: string | null;
  isAdmin: boolean;
}

/**
 * Справочник предметов (issue #92, план 2.4): название, редкость, слот,
 * рекомендованная стартовая цена и «кому нужна» (мультивыбор). Один предмет
 * выставляется многократно отдельными лотами, поэтому удаление занятого
 * предмета запрещено — история лотов сохраняется.
 */
@Injectable()
export class ItemsService {
  constructor(private readonly db: ItemsDb) {}

  async list(): Promise<ItemRow[]> {
    const items = await this.db.item.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { lootDrops: true } } },
    });
    return items.map((item) => this.toRow(item));
  }

  async create(rawInput: unknown, actor: ItemsActor): Promise<ItemRow> {
    const input = this.parseInput(rawInput);
    await this.ensureNameFree(input.name, null);
    const created = await this.db.item.create({ data: input });
    await this.audit(actor, 'ITEM_CREATE', created.id, `Создан предмет «${input.name}»`);
    return this.toRow(created);
  }

  async update(id: string, rawInput: unknown, actor: ItemsActor): Promise<ItemRow> {
    const input = this.parseInput(rawInput);
    const existing = await this.mustExist(id);
    await this.ensureNameFree(input.name, id);
    const updated = await this.db.item.update({ where: { id }, data: input });
    await this.audit(
      actor,
      'ITEM_UPDATE',
      id,
      `Изменён предмет «${existing.name}» → «${input.name}»`,
    );
    return this.toRow(updated);
  }

  /**
   * Удаление: только если предмет ни разу не выставлялся лотом. Иначе 409 —
   * история лотов (приёмка issue #92) не должна терять ссылку на предмет.
   * Предпочитаемым поле становится пустым у всех выбравших (SetNull, решение 18).
   */
  async remove(id: string, actor: ItemsActor): Promise<{ ok: true }> {
    const existing = await this.mustExist(id);
    const lots = await this.db.lootDrop.count({ where: { itemId: id } });
    if (lots > 0) {
      throw new ConflictException(
        `Предмет «${existing.name}» используется в лотах (${lots}) — удаление запрещено`,
      );
    }
    const preferredBy = await this.db.member.count({ where: { preferredItemId: id } });
    await this.db.item.delete({ where: { id } });
    await this.audit(
      actor,
      'ITEM_DELETE',
      id,
      `Удалён предмет «${existing.name}»` +
        (preferredBy > 0
          ? `; предпочитаемый предмет очищен у ${preferredBy} игрок(ов)`
          : ''),
    );
    return { ok: true };
  }

  /** Валидация ввода: ошибки схемы — 400 с первым понятным сообщением. */
  private parseInput(rawInput: unknown): ItemInput {
    const parsed = itemInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Некорректные данные предмета',
      );
    }
    return parsed.data;
  }

  private async mustExist(id: string): Promise<StoredItem> {
    const found = await this.db.item.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundException('Предмет не найден');
    }
    return found;
  }

  private async ensureNameFree(name: string, exceptId: string | null): Promise<void> {
    const clash = await this.db.item.findFirst({ where: { name } });
    if (clash && clash.id !== exceptId) {
      throw new ConflictException('Предмет с таким названием уже есть');
    }
  }

  private toRow(item: StoredItem): ItemRow {
    return {
      id: item.id,
      name: item.name,
      rarity: item.rarity,
      slot: item.slot,
      targetRoles: item.targetRoles,
      defaultStartPrice: item.defaultStartPrice,
      lotsCount: item._count?.lootDrops ?? 0,
    };
  }

  private async audit(actor: ItemsActor, action: string, entityId: string, comment: string) {
    await this.db.auditLog.create({
      data: {
        actorMemberId: actor.memberId,
        actorIsAdmin: actor.isAdmin,
        action,
        entityType: 'Item',
        entityId,
        comment,
      },
    });
  }
}
