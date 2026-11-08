import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuditWriter } from '../members/members.service';

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface EventTypesDb {
  eventType: {
    findMany(args: {
      orderBy: { name: 'asc' };
    }): Promise<Array<{ id: string; name: string; _count?: { events: number } }>>;
    findUnique(args: { where: { id: string } }): Promise<{ id: string; name: string } | null>;
    findFirst(args: { where: { name: string } }): Promise<{ id: string } | null>;
    create(args: { data: { name: string } }): Promise<{ id: string; name: string }>;
    update(args: {
      where: { id: string };
      data: { name: string };
    }): Promise<{ id: string; name: string }>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  auditLog: AuditWriter;
}

export interface EventTypesActor {
  memberId: string | null;
  isAdmin: boolean;
}

/**
 * Справочник типов ивентов (issue #7, план 2.1): гильдбосс, осада, контракты…
 * CRUD — офицерам и выше (items.manage через контроллер... нет — свой доступ:
 * справочники ведут офицеры+, каждое изменение — в AuditLog.
 */
@Injectable()
export class EventTypesService {
  constructor(private readonly db: EventTypesDb) {}

  async list() {
    return this.db.eventType.findMany({ orderBy: { name: 'asc' } });
  }

  async create(name: string, actor: EventTypesActor) {
    const clean = validateName(name);
    const clash = await this.db.eventType.findFirst({ where: { name: clean } });
    if (clash) {
      throw new ConflictException('Такой тип ивента уже есть');
    }
    const created = await this.db.eventType.create({ data: { name: clean } });
    await this.audit(actor, 'EVENT_TYPE_CREATE', created.id, `Создан тип ивента «${clean}»`);
    return created;
  }

  async rename(id: string, name: string, actor: EventTypesActor) {
    const clean = validateName(name);
    const existing = await this.mustExist(id);
    const clash = await this.db.eventType.findFirst({ where: { name: clean } });
    if (clash && clash.id !== id) {
      throw new ConflictException('Такой тип ивента уже есть');
    }
    const updated = await this.db.eventType.update({ where: { id }, data: { name: clean } });
    await this.audit(actor, 'EVENT_TYPE_UPDATE', id, `Тип ивента «${existing.name}» → «${clean}»`);
    return updated;
  }

  /**
   * Удаление: только если тип не используется ивентами. На занятый тип — 409
   * с подсказкой переименовать (история ивентов не должна терять смысл).
   */
  async remove(id: string, actor: EventTypesActor) {
    const existing = await this.mustExist(id);
    await this.db.eventType.delete({ where: { id } });
    await this.audit(actor, 'EVENT_TYPE_DELETE', id, `Удалён тип ивента «${existing.name}»`);
    return { ok: true };
  }

  private async mustExist(id: string) {
    const found = await this.db.eventType.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundException('Тип ивента не найден');
    }
    return found;
  }

  private async audit(actor: EventTypesActor, action: string, entityId: string, comment: string) {
    await this.db.auditLog.create({
      data: {
        actorMemberId: actor.memberId,
        actorIsAdmin: actor.isAdmin,
        action,
        entityType: 'EventType',
        entityId,
        comment,
      },
    });
  }
}

function validateName(name: string): string {
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 40) {
    throw new ConflictException('Название типа: 2–40 символов');
  }
  return clean;
}
