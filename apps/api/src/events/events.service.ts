import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EVENT_TRANSITIONS,
  can,
  canManageEvent,
  isEventEditable,
  type Rank,
  changeEventStatusSchema,
  createEventApiSchema,
  createEventSeriesSchema,
  eventsQuerySchema,
  generateSeriesEvents,
  updateEventSchema,
  type ChangeEventStatusInput,
  type CreateEventApiInput,
  type CreateEventSeriesInput,
  type EventsQuery,
  type UpdateEventInput,
} from '@dkp/shared';
import type { AuditWriter } from '../members/members.service';

/** Строка списка/календаря. */
export interface EventRow {
  name: string;
  id: string;
  eventTypeId: string;
  eventTypeName: string;
  mode: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  dkpReward: number;
  raidLeadId: string;
  creatorId?: string | null;
  raidLeadName: string;
  place: string | null;
  notes: string | null;
}

export interface EventDetail extends EventRow {
  seriesId: string | null;
}

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface EventsDb {
  eventType: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; name: string } | null>;
  };
  member: {
    findUnique(args: { where: { id: string } }): Promise<{ id: string; nickname: string } | null>;
  };
  event: {
    findMany(args: {
      where: {
        startsAt?: { gte?: Date; lte?: Date };
        eventTypeId?: string;
        mode?: string;
        status?: { not: string };
        seriesId?: string;
      };
      orderBy: { startsAt: 'asc' };
      include: { eventType: { select: { name: true } }; raidLead: { select: { nickname: true } } };
    }): Promise<
      Array<{
        id: string;
        name: string;
        eventTypeId: string;
        mode: string;
        status: string;
        startsAt: Date;
        endsAt: Date;
        dkpReward: number;
        raidLeadId: string;
        creatorId?: string | null;
        place: string | null;
        notes: string | null;
        seriesId: string | null;
        eventType: { name: string };
        raidLead: { nickname: string };
      }>
    >;
    findUnique(args: {
      where: { id: string };
      include: { eventType: { select: { name: true } }; raidLead: { select: { nickname: true } } };
    }): Promise<
      (EventDetail & { eventType: { name: string }; raidLead: { nickname: string } }) | null
    >;
    create(args: {
      data: {
        name: string;
        eventTypeId: string;
        mode: string;
        startsAt: Date;
        endsAt: Date;
        dkpReward: number;
        raidLeadId: string;
        creatorId?: string | null;
        place?: string | null;
        notes?: string | null;
        seriesId?: string;
      };
    }): Promise<{ id: string; startsAt: Date }>;
    createMany(args: {
      data: Array<Parameters<EventsDb['event']['create']>[0]['data']>;
    }): Promise<{ count: number }>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<{ id: string }>;
    deleteMany(args: { where: { seriesId: string; status: string } }): Promise<{ count: number }>;
    delete(args: { where: { id: string } }): Promise<unknown>;
    count(args: { where: { seriesId: string; status: { not: string } } }): Promise<number>;
  };
  auditLog: AuditWriter;
  $transaction<T>(work: (tx: Pick<EventsDb, 'event' | 'auditLog'>) => Promise<T>): Promise<T>;
}

/** Действующий пользователь сессии — для прав и аудита. */
export interface EventsActor {
  memberId: string | null;
  isAdmin: boolean;
  rank?: Rank | null;
}

/**
 * Расписание ивентов (issue #8, план 2.1). Плата ДКП фиксируется при
 * создании и дальше неизменяема (решение гильдии №1). Редактирование —
 * офицеры+ или РЛ этого ивента (механизм «РЛ ивента» из 2.6).
 */
@Injectable()
export class EventsService {
  constructor(private readonly db: EventsDb) {}

  /** Список за период с фильтрами — календарь и «ближайшие». */
  async list(query: unknown): Promise<EventRow[]> {
    const filters: EventsQuery = eventsQuerySchema.parse(query);
    const where: {
      startsAt?: { gte?: Date; lte?: Date };
      eventTypeId?: string;
      mode?: string;
    } = {};
    if (filters.from) {
      where.startsAt = { ...where.startsAt, gte: filters.from };
    }
    if (filters.to) {
      where.startsAt = { ...where.startsAt, lte: filters.to };
    }
    if (filters.eventTypeId) {
      where.eventTypeId = filters.eventTypeId;
    }
    if (filters.mode) {
      where.mode = filters.mode;
    }

    const events = await this.db.event.findMany({
      where,
      orderBy: { startsAt: 'asc' },
      include: {
        eventType: { select: { name: true } },
        raidLead: { select: { nickname: true } },
      },
    });
    return events.map((event) => this.toRow(event));
  }

  async getOne(id: string): Promise<EventDetail> {
    const event = await this.mustExist(id);
    return { ...this.toRow(event), seriesId: event.seriesId };
  }

  /** Создание ивента (events.manage — офицеры+). */
  async create(body: unknown, actor: EventsActor): Promise<{ id: string }> {
    const parsed = createEventApiSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        'Укажите название, тип, время, РЛ и положительную целую плату ДКП',
      );
    const input: CreateEventApiInput = parsed.data;
    await this.mustExistEventType(input.eventTypeId);
    await this.mustExistMember(input.raidLeadId);
    this.assertValidRange(input.startsAt, input.endsAt);

    return this.db.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          name: input.name,
          eventTypeId: input.eventTypeId,
          mode: input.mode,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          dkpReward: input.dkpReward,
          raidLeadId: input.raidLeadId,
          creatorId: actor.memberId,
          place: input.place ?? null,
          notes: input.notes ?? null,
        },
      });
      await this.audit(actor, 'EVENT_CREATE', created.id, this.describeCreated(input), tx.auditLog);
      return { id: created.id };
    });
  }

  /**
   * Серия по шаблону (issue #8): «вт/чт 20:00 × N недель» одним действием.
   * Все ивенты серии несут общий seriesId — удаляются тоже целиком.
   */
  async createSeries(
    body: unknown,
    actor: EventsActor,
  ): Promise<{ seriesId: string; created: number }> {
    const parsed = createEventSeriesSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Проверьте название и параметры серии');
    const input: CreateEventSeriesInput = parsed.data;
    await this.mustExistEventType(input.eventTypeId);
    await this.mustExistMember(input.raidLeadId);
    this.assertValidRange(input.startsAt, input.endsAt);

    let slots: ReturnType<typeof generateSeriesEvents>;
    try {
      slots = generateSeriesEvents(input);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Некорректная серия');
    }
    const seriesId = `series-${randomUUID()}`;
    return this.db.$transaction(async (tx) => {
      const result = await tx.event.createMany({
        data: slots.map((slot) => ({
          ...slot,
          seriesId,
          name: input.name,
          eventTypeId: input.eventTypeId,
          mode: input.mode,
          dkpReward: input.dkpReward,
          raidLeadId: input.raidLeadId,
          creatorId: actor.memberId,
          place: input.place ?? null,
          notes: input.notes ?? null,
        })),
      });
      await this.audit(
        actor,
        'EVENT_SERIES_CREATE',
        seriesId,
        `Создана серия из ${result.count} ивентов до ${input.until.toISOString()}`,
        tx.auditLog,
        'EventSeries',
      );
      return { seriesId, created: result.count };
    });
  }

  /** Удаление серии целиком — только пока все ивенты PLANNED (issue #8). */
  async deleteSeries(seriesId: string, actor: EventsActor): Promise<{ deleted: number }> {
    if (!can({ ...actor, rank: actor.rank ?? null }, 'events.manage')) {
      const events = await this.db.event.findMany({
        where: { seriesId },
        orderBy: { startsAt: 'asc' },
        include: {
          eventType: { select: { name: true } },
          raidLead: { select: { nickname: true } },
        },
      });
      if (
        !events.length ||
        !events.every((event) => canManageEvent({ ...actor, rank: actor.rank ?? null }, event))
      ) {
        throw new ForbiddenException('Удалять можно только свою серию ивентов');
      }
    }
    const active = await this.db.event.count({
      where: { seriesId, status: { not: 'PLANNED' } },
    });
    if (active > 0) {
      throw new ConflictException('В серии есть незапланированные ивенты — удалить нельзя');
    }
    const result = await this.db.event.deleteMany({ where: { seriesId, status: 'PLANNED' } });
    await this.audit(
      actor,
      'EVENT_SERIES_DELETE',
      seriesId,
      `Удалена серия целиком (${result.count} ивентов)`,
    );
    return { deleted: result.count };
  }

  /** Удаление одиночного ивента — только PLANNED (CRUD-полнота, план 2.1). */
  async deleteOne(id: string, actor: EventsActor): Promise<{ ok: true }> {
    const event = await this.mustExist(id);
    if (!canManageEvent({ ...actor, rank: actor.rank ?? null }, event)) {
      throw new ForbiddenException('Нет права на удаление ивента');
    }
    if (event.status !== 'PLANNED') {
      throw new ConflictException('Удалить можно только запланированный ивент');
    }
    await this.db.event.delete({ where: { id } });
    await this.audit(actor, 'EVENT_DELETE', id, `Удалён ивент ${event.startsAt.toISOString()}`);
    return { ok: true };
  }

  /**
   * Редактирование: офицеры+ (проверил guard по events.manage) или РЛ
   * этого ивента — точечная проверка can() с target.raidLeadId (2.6).
   * Плата ДКП в схеме отсутствует — попытка её передать отбрасывается zod'ом.
   */
  async update(
    id: string,
    body: unknown,
    actor: EventsActor,
    actorRank: Rank | null,
  ): Promise<{ id: string }> {
    const parsed = updateEventSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Некорректные поля ивента');
    const input: UpdateEventInput = parsed.data;
    const event = await this.mustExist(id);

    if (!canManageEvent({ ...actor, rank: actorRank }, event)) {
      throw new ForbiddenException('Редактировать может офицер или РЛ ивента');
    }
    if (!isEventEditable(event.status)) {
      throw new ConflictException('Завершённый или отменённый ивент доступен только для просмотра');
    }
    if (
      input.raidLeadId !== undefined &&
      input.raidLeadId !== event.raidLeadId &&
      !can({ ...actor, rank: actorRank }, 'events.manage')
    ) {
      throw new ForbiddenException('Назначать РЛ могут только Глава, Админ и Офицер');
    }

    if (input.eventTypeId) {
      await this.mustExistEventType(input.eventTypeId);
    }
    if (input.raidLeadId) {
      await this.mustExistMember(input.raidLeadId);
    }
    const startsAt = input.startsAt ?? event.startsAt;
    const endsAt = input.endsAt ?? event.endsAt;
    this.assertValidRange(startsAt, endsAt);

    await this.db.event.update({
      where: { id },
      data: { ...input, place: input.place ?? undefined, notes: input.notes ?? undefined },
    });
    await this.audit(actor, 'EVENT_UPDATE', id, `Изменён ивент ${event.startsAt.toISOString()}`);
    return { id };
  }

  /** Смена статуса: planned → running → finished / cancelled (план 2.1). */
  async changeStatus(
    id: string,
    body: unknown,
    actor: EventsActor,
  ): Promise<{ id: string; status: string }> {
    const input: ChangeEventStatusInput = changeEventStatusSchema.parse(body);
    const event = await this.mustExist(id);

    const permitted =
      input.status === 'CANCELLED'
        ? canManageEvent({ ...actor, rank: actor.rank ?? null }, event)
        : can({ ...actor, rank: actor.rank ?? null }, 'events.conduct', event);
    if (!permitted) throw new ForbiddenException('Нет права на изменение статуса ивента');

    const allowed = EVENT_TRANSITIONS[event.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new ConflictException(`Переход ${event.status} → ${input.status} невозможен`);
    }

    await this.db.event.update({ where: { id }, data: { status: input.status } });
    await this.audit(actor, 'EVENT_STATUS_CHANGE', id, `Статус ${event.status} → ${input.status}`);

    // Закрытие ивента: отсутствующим по уважительной — авто-отметка
    // EXCUSED_ABSENCE (план 2.3, issue #11). Хук опционален: без него
    // (старые вызовы/тесты) завершение работает как раньше.
    if (input.status === 'FINISHED' && this.onEventFinished) {
      const marked = await this.onEventFinished(id, event.startsAt, event.endsAt);
      if (marked > 0) {
        await this.audit(
          actor,
          'ABSENCE_AUTO_MARK',
          id,
          `Отсутствующим по уважительной проставлен EXCUSED_ABSENCE (${marked})`,
        );
      }
    }
    return { id, status: input.status };
  }

  /** Хук завершения ивента — ставится модулем отсутствий (issue #11). */
  onEventFinished?: (eventId: string, startsAt: Date, endsAt: Date) => Promise<number>;

  private toRow(event: {
    name: string;
    id: string;
    eventTypeId: string;
    mode: string;
    status: string;
    startsAt: Date;
    endsAt: Date;
    dkpReward: number;
    raidLeadId: string;
    creatorId?: string | null;
    place: string | null;
    notes: string | null;
    eventType: { name: string };
    raidLead: { nickname: string };
  }): EventRow {
    return {
      id: event.id,
      name: event.name,
      eventTypeId: event.eventTypeId,
      eventTypeName: event.eventType.name,
      mode: event.mode,
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      dkpReward: event.dkpReward,
      raidLeadId: event.raidLeadId,
      creatorId: event.creatorId ?? null,
      raidLeadName: event.raidLead.nickname,
      place: event.place,
      notes: event.notes,
    };
  }

  private async mustExist(id: string) {
    const event = await this.db.event.findUnique({
      where: { id },
      include: {
        eventType: { select: { name: true } },
        raidLead: { select: { nickname: true } },
      },
    });
    if (!event) {
      throw new NotFoundException('Ивент не найден');
    }
    return event;
  }

  private async mustExistEventType(id: string) {
    const type = await this.db.eventType.findUnique({ where: { id } });
    if (!type) {
      throw new NotFoundException('Тип ивента не найден');
    }
  }

  private async mustExistMember(id: string) {
    const member = await this.db.member.findUnique({ where: { id } });
    if (!member) {
      throw new NotFoundException('Рейд-лид не найден среди членов гильдии');
    }
  }

  private assertValidRange(startsAt: Date, endsAt: Date) {
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new ConflictException('Ивент должен заканчиваться позже начала');
    }
  }

  private describeCreated(input: CreateEventApiInput): string {
    return `Создан ивент ${input.startsAt.toISOString()}, плата ${input.dkpReward} ДКП, режим ${input.mode}`;
  }

  private async audit(
    actor: EventsActor,
    action: string,
    entityId: string,
    comment: string,
    writer: AuditWriter = this.db.auditLog,
    entityType = 'Event',
  ) {
    await writer.create({
      data: {
        actorMemberId: actor.memberId,
        actorIsAdmin: actor.isAdmin,
        action,
        entityType,
        entityId,
        comment,
      },
    });
  }
}
