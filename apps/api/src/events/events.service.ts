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
  eventScopeSchema,
  type EventScopeInput,
  type ChangeEventStatusInput,
  type CreateEventApiInput,
  type CreateEventSeriesInput,
  type EventsQuery,
  type UpdateEventInput,
} from '@dkp/shared';
import type { AuditWriter } from '../members/members.service';
import { serializable } from '../prisma/serializable';
import type { Prisma } from '@prisma/client';
import type { CheckInLaunchDb } from '../checkin/launch';
import { enqueueEventAnnouncement } from '../discord-notifications/event-announcements';
import { awardRaidLeadBonus, type RaidLeadBonusLedger } from '../dkp/raid-lead-bonus';

/** Строка списка/календаря. */
export interface EventRow extends EventScopeInput {
  scopeName: string;
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

/** История чек-ина по одному ивенту либо по всем ивентам серии. */
type EventHistoryWhere = { eventId?: string; event?: { seriesId: string } };

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface EventsDb {
  kP: { findUnique(args: { where: { id: string } }): Promise<{ id: string; name: string } | null> };
  pack: {
    findUnique(args: {
      where: { id: string };
    }): Promise<{ id: string; name: string; kpId: string } | null>;
  };
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
        scope: EventScopeInput['scope'];
        kpId: string | null;
        packId: string | null;
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
        id?: string;
        scope: EventScopeInput['scope'];
        kpId: string | null;
        packId: string | null;
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
  /** Дропы ивентов (issue #109): без лотов — каскад при удалении, с лотом — блокировка. */
  lootDrop: {
    findFirst(args: {
      where: {
        eventId?: string;
        event?: { seriesId: string };
        NOT?: { auction: null };
      };
    }): Promise<{ id: string; eventId: string } | null>;
    deleteMany(args: {
      where: { eventId?: string; event?: { seriesId: string } };
    }): Promise<{ count: number }>;
  };
  /** История чек-ина (issue #302): ивент с ней не удаляется — отмена вместо удаления. */
  checkInCode: { findFirst(args: { where: EventHistoryWhere }): Promise<{ id: string } | null> };
  attendance: { findFirst(args: { where: EventHistoryWhere }): Promise<{ id: string } | null> };
  dkpEntry: RaidLeadBonusLedger & {
    findFirst(args: { where: EventHistoryWhere }): Promise<{ id: string } | null>;
  };
  auditLog: AuditWriter;
  $transaction<T>(work: (tx: EventsDbTx) => Promise<T>): Promise<T>;
  $transaction<T>(
    work: (tx: EventsDbTx) => Promise<T>,
    options: { isolationLevel: 'Serializable'; timeout?: number },
  ): Promise<T>;
}

type EventsDbTx = Pick<
  EventsDb,
  'event' | 'lootDrop' | 'auditLog' | 'kP' | 'pack' | 'checkInCode' | 'attendance' | 'dkpEntry'
>;

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
  constructor(
    private readonly db: EventsDb,
    /** Часы — момент нажатия «Начать ивент» / «Завершить ивент», открывающий окно кода. */
    private readonly clock: () => Date = () => new Date(),
  ) {}

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
    return Promise.all(events.map((event) => this.toRow(event)));
  }

  async getOne(id: string): Promise<EventDetail> {
    const event = await this.mustExist(id);
    return { ...(await this.toRow(event)), seriesId: event.seriesId };
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

    return serializable(this.db, async (tx) => {
      const scope = await this.validateScope(input, tx);
      const created = await tx.event.create({
        data: {
          ...scope,
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
      if (created.startsAt > new Date()) {
        await enqueueEventAnnouncement(
          tx as unknown as Prisma.TransactionClient,
          `event:${created.id}`,
          [created.id],
        );
      }
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
    return serializable(this.db, async (tx) => {
      const scope = await this.validateScope(input, tx);
      const rows = slots.map((slot) => ({
        id: randomUUID(),
        ...scope,
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
      }));
      const result = await tx.event.createMany({ data: rows });
      await this.audit(
        actor,
        'EVENT_SERIES_CREATE',
        seriesId,
        `Создана серия из ${result.count} ивентов до ${input.until.toISOString()}`,
        tx.auditLog,
        'EventSeries',
      );
      await enqueueEventAnnouncement(
        tx as unknown as Prisma.TransactionClient,
        `series:${seriesId}`,
        rows.filter((row) => row.startsAt > new Date()).map((row) => row.id),
      );
      return { seriesId, created: result.count };
    });
  }

  /**
   * Удаление серии целиком — только пока все ивенты PLANNED (issue #8).
   * Лоты аукциона живут независимо от ивента (план 2.4) и не удаляются —
   * серия с лотом отклоняется 409; дропы без лотов уходят каскадом (#109).
   * Серия с кодами чек-ина, отметками посещения или записями журнала ДКП
   * тоже не удаляется (#302) — её отменяют.
   *
   * Право и статусы перечитываются в транзакции (issue #312): после
   * предварительной проверки ивент могли начать или передать другому РЛ.
   * Серия не удаляется частично — не-PLANNED ивент даёт 409 до первого DELETE.
   */
  async deleteSeries(seriesId: string, actor: EventsActor): Promise<{ deleted: number }> {
    const manager = can({ ...actor, rank: actor.rank ?? null }, 'events.manage');
    if (!manager) this.assertOwnSeries(await this.seriesEvents(this.db, seriesId), actor);
    const active = await this.db.event.count({
      where: { seriesId, status: { not: 'PLANNED' } },
    });
    if (active > 0) {
      throw new ConflictException('В серии есть незапланированные ивенты — удалить нельзя');
    }
    const result = await serializable(this.db, async (tx) => {
      const current = await this.seriesEvents(tx, seriesId);
      if (!manager) this.assertOwnSeries(current, actor);
      if (current.some((event) => event.status !== 'PLANNED')) {
        throw new ConflictException('В серии есть незапланированные ивенты — удалить нельзя');
      }
      const withLot = await tx.lootDrop.findFirst({
        where: { event: { seriesId }, NOT: { auction: null } },
      });
      if (withLot) {
        throw new ConflictException(
          'В серии есть ивенты с лотами аукциона — удалить нельзя: лоты живут независимо от ивента (раздел 2.4)',
        );
      }
      const history = await this.historyBlocker(tx, { event: { seriesId } }, 'ивенты серии');
      if (history) throw new ConflictException(history);
      const drops = await tx.lootDrop.deleteMany({ where: { event: { seriesId } } });
      const events = await tx.event.deleteMany({ where: { seriesId, status: 'PLANNED' } });
      await this.audit(
        actor,
        'EVENT_SERIES_DELETE',
        seriesId,
        `Удалена серия целиком (${events.count} ивентов` +
          (drops.count > 0 ? `, каскадом удалено дропов: ${drops.count}` : '') +
          ')',
        tx.auditLog,
      );
      return events;
    });
    return { deleted: result.count };
  }

  /**
   * Удаление одиночного ивента — только PLANNED (CRUD-полнота, план 2.1).
   * Лоты аукциона живут независимо от ивента (план 2.4) и не удаляются —
   * ивент с лотом отклоняется 409; дропы без лотов финансовых данных не
   * несут и удаляются каскадом вместе с ивентом (issue #109).
   * Ивент с кодами чек-ина, отметками посещения или записями журнала ДКП
   * не удаляется (#302) — его отменяют.
   *
   * Статус и право перечитываются в транзакции (issue #312): ивент могли
   * начать (или передать другому РЛ) уже после предварительной проверки.
   * Удаление идущего ивента ломает его окно чек-ина, поэтому проверка —
   * до первого DELETE.
   */
  async deleteOne(id: string, actor: EventsActor): Promise<{ ok: true }> {
    const event = await this.mustExist(id);
    if (!canManageEvent({ ...actor, rank: actor.rank ?? null }, event)) {
      throw new ForbiddenException('Нет права на удаление ивента');
    }
    if (event.status !== 'PLANNED') {
      throw new ConflictException('Удалить можно только запланированный ивент');
    }
    await serializable(this.db, async (tx) => {
      const current = await tx.event.findUnique({
        where: { id },
        include: {
          eventType: { select: { name: true } },
          raidLead: { select: { nickname: true } },
        },
      });
      if (!current) throw new NotFoundException('Ивент не найден');
      if (!canManageEvent({ ...actor, rank: actor.rank ?? null }, current))
        throw new ForbiddenException('Нет права на удаление ивента');
      if (current.status !== 'PLANNED') {
        throw new ConflictException('Удалить можно только запланированный ивент');
      }
      // перечитываем дропы в транзакции: лот могли создать после проверки статуса
      const withLot = await tx.lootDrop.findFirst({
        where: { eventId: id, NOT: { auction: null } },
      });
      if (withLot) {
        throw new ConflictException(
          'Нельзя удалить ивент с лотами аукциона: лоты живут независимо от ивента (раздел 2.4)',
        );
      }
      const history = await this.historyBlocker(tx, { eventId: id }, 'ивент');
      if (history) throw new ConflictException(history);
      const drops = await tx.lootDrop.deleteMany({ where: { eventId: id } });
      await tx.event.delete({ where: { id } });
      await this.audit(
        actor,
        'EVENT_DELETE',
        id,
        `Удалён ивент ${current.startsAt.toISOString()}` +
          (drops.count > 0 ? `, каскадом удалено дропов: ${drops.count}` : ''),
        tx.auditLog,
      );
    });
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

    await serializable(this.db, async (tx) => {
      const current = await tx.event.findUnique({
        where: { id },
        include: {
          eventType: { select: { name: true } },
          raidLead: { select: { nickname: true } },
        },
      });
      if (!current) throw new NotFoundException('Ивент не найден');
      if (!canManageEvent({ ...actor, rank: actorRank }, current))
        throw new ForbiddenException('Нет права на редактирование');
      if (!isEventEditable(current.status))
        throw new ConflictException('Ивент доступен только для просмотра');
      const changingRaidLead =
        input.raidLeadId !== undefined && input.raidLeadId !== current.raidLeadId;
      if (changingRaidLead && !can({ ...actor, rank: actorRank }, 'events.manage'))
        throw new ForbiddenException('Назначать РЛ могут только Глава, Админ и Офицер');
      const changingScope =
        input.scope !== undefined || input.kpId !== undefined || input.packId !== undefined;
      if (changingScope && current.status !== 'PLANNED')
        throw new ConflictException('Состав можно менять только до начала ивента');
      const scope = changingScope ? await this.validateScope({ ...current, ...input }, tx) : {};
      await tx.event.update({
        where: { id },
        data: {
          ...input,
          ...scope,
          place: input.place ?? undefined,
          notes: input.notes ?? undefined,
        },
      });
      await this.audit(
        actor,
        'EVENT_UPDATE',
        id,
        `Изменён ивент ${event.startsAt.toISOString()}` +
          (changingScope ? `, состав ${JSON.stringify(scope)}` : '') +
          (changingRaidLead ? `, РЛ ${current.raidLeadId} → ${input.raidLeadId}` : ''),
        tx.auditLog,
      );
    });
    return { id };
  }

  /**
   * Смена статуса: planned → running → finished / cancelled (план 2.1).
   * «Начать ивент» и «Завершить ивент» (решение №23) той же транзакцией
   * открывают окно кода — статус и окно не расходятся. Статус перечитывается
   * внутри транзакции: при одновременных нажатиях двух управляющих второй
   * получает конфликт сериализации, повторяет и видит 409 — код один.
   */
  async changeStatus(
    id: string,
    body: unknown,
    actor: EventsActor,
  ): Promise<{ id: string; status: string }> {
    const input: ChangeEventStatusInput = changeEventStatusSchema.parse(body);
    const event = await this.mustExist(id);

    await serializable(this.db, async (tx) => {
      const current = await tx.event.findUnique({
        where: { id },
        include: {
          eventType: { select: { name: true } },
          raidLead: { select: { nickname: true } },
        },
      });
      if (!current) throw new NotFoundException('Ивент не найден');
      this.assertStatusChange(current, input.status, actor);
      const finishing = input.status === 'FINISHED';
      await tx.event.update({
        where: { id },
        data: { status: input.status, ...(finishing ? { raidLeadBonusEnabled: true } : {}) },
      });
      if (finishing) await awardRaidLeadBonus(tx.dkpEntry, id, current.raidLeadId);
      await this.audit(
        actor,
        'EVENT_STATUS_CHANGE',
        id,
        `Статус ${current.status} → ${input.status}`,
        tx.auditLog,
      );
      const phase =
        input.status === 'RUNNING' ? 'START' : input.status === 'FINISHED' ? 'END' : null;
      if (phase && this.onEventCodeLaunch) {
        await this.onEventCodeLaunch(
          tx as unknown as CheckInLaunchDb,
          id,
          phase,
          actor,
          this.clock(),
        );
      }
    });

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

  /** Право и допустимость перехода — по статусу, перечитанному в транзакции. */
  private assertStatusChange(
    event: EventDetail,
    status: ChangeEventStatusInput['status'],
    actor: EventsActor,
  ): void {
    const permitted =
      status === 'CANCELLED'
        ? canManageEvent({ ...actor, rank: actor.rank ?? null }, event)
        : can({ ...actor, rank: actor.rank ?? null }, 'events.conduct', event);
    if (!permitted) throw new ForbiddenException('Нет права на изменение статуса ивента');

    const allowed = EVENT_TRANSITIONS[event.status] ?? [];
    if (!allowed.includes(status)) {
      throw new ConflictException(`Переход ${event.status} → ${status} невозможен`);
    }
  }

  /** Хук завершения ивента — ставится модулем отсутствий (issue #11). */
  onEventFinished?: (eventId: string, startsAt: Date, endsAt: Date) => Promise<number>;

  /**
   * Хук запуска кода — ставит модуль чек-ина (решение №23): «Начать ивент»
   * открывает окно стартового кода, «Завершить ивент» — финального. Работает
   * в транзакции смены статуса: без окна и статус не меняется.
   */
  onEventCodeLaunch?: (
    tx: CheckInLaunchDb,
    eventId: string,
    phase: 'START' | 'END',
    actor: EventsActor,
    now: Date,
  ) => Promise<void>;

  private async toRow(
    event: EventScopeInput & {
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
    },
  ): Promise<EventRow> {
    const scopeName =
      event.scope === 'PACK'
        ? ((await this.db.pack.findUnique({ where: { id: event.packId! } }))?.name ?? 'Пак')
        : event.scope === 'KP'
          ? ((await this.db.kP.findUnique({ where: { id: event.kpId! } }))?.name ?? 'КП')
          : 'Вся гильдия';
    return {
      scope: event.scope,
      kpId: event.kpId,
      packId: event.packId,
      scopeName,
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

  /** Ивенты серии одной выборкой — для проверки права и статуса до и внутри транзакции. */
  private seriesEvents(db: Pick<EventsDbTx, 'event'>, seriesId: string) {
    return db.event.findMany({
      where: { seriesId },
      orderBy: { startsAt: 'asc' },
      include: {
        eventType: { select: { name: true } },
        raidLead: { select: { nickname: true } },
      },
    });
  }

  /** Серия, где нет ни одного ивента или есть чужой, — не «своя» (механизм РЛ, 2.6). */
  private assertOwnSeries(
    events: Awaited<ReturnType<EventsDb['event']['findMany']>>,
    actor: EventsActor,
  ): void {
    if (
      !events.length ||
      !events.every((event) => canManageEvent({ ...actor, rank: actor.rank ?? null }, event))
    ) {
      throw new ForbiddenException('Удалять можно только свою серию ивентов');
    }
  }

  private async validateScope(value: EventScopeInput, tx: EventsDbTx): Promise<EventScopeInput> {
    const input = eventScopeSchema.parse(value);
    if (input.scope === 'GUILD') {
      if (input.kpId || input.packId)
        throw new BadRequestException('Для гильдии группы не задаются');
    } else {
      if (!input.kpId || !(await tx.kP.findUnique({ where: { id: input.kpId } })))
        throw new BadRequestException('Выберите существующую КП');
      if (input.scope === 'PACK') {
        const pack = input.packId
          ? await tx.pack.findUnique({ where: { id: input.packId } })
          : null;
        if (!pack || pack.kpId !== input.kpId)
          throw new BadRequestException('Пак не принадлежит выбранной КП');
      } else if (input.packId) throw new BadRequestException('Для состава КП пак не задаётся');
    }
    return input;
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

  /**
   * Причина, по которой ивент (или серию) нельзя удалить из-за истории
   * чек-ина (issue #302). Коды и отметки посещения ссылаются на ивент без
   * каскада, а удаление обнулило бы ссылку журнала ДКП на событие (план 2.2:
   * запись журнала раскрывается до ивента). Вместо удаления ивент отменяют.
   *
   * Вызывается только внутри serializable-транзакции: код или отметку могут
   * записать уже после снимка попытки — тогда DELETE завершится сбоем
   * сериализации, а повтор увидит новую запись и вернёт тот же 409.
   * `target` — что отменить вместо удаления («ивент» / «ивенты серии»).
   */
  private async historyBlocker(
    tx: EventsDbTx,
    where: EventHistoryWhere,
    target: string,
  ): Promise<string | null> {
    if (await tx.checkInCode.findFirst({ where }))
      return `Чек-ин уже начался — отмените ${target} вместо удаления`;
    if (await tx.attendance.findFirst({ where }))
      return `Есть отметки посещения — отмените ${target} вместо удаления`;
    if (await tx.dkpEntry.findFirst({ where }))
      return `Есть записи журнала ДКП — отмените ${target} вместо удаления`;
    return null;
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
