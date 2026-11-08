import { createHash } from 'node:crypto';
import { serializable } from '../prisma/serializable';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  buildEventSummary,
  applyEventSummarySchema,
  absenceCoversEvent,
  isEventInvitee,
  type ApplyEventSummaryResult,
  can,
  checkInShareAmount,
  manualCheckInSchema,
  manualDkpSchema,
  setAttendanceSchema,
  type EventSummaryRow,
  type ManualCheckInInput,
  type ManualDkpInput,
  type SetAttendanceInput,
} from '@dkp/shared';
import type { EventsActor } from '../events/events.service';

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface ConductDb {
  eventSummaryBatch: {
    findUnique(args: { where: { id: string } }): Promise<{
      eventId: string;
      actorKey: string;
      payloadHash: string;
      actionCount: number;
    } | null>;
    create(args: {
      data: {
        id: string;
        eventId: string;
        actorKey: string;
        payloadHash: string;
        actionCount: number;
      };
    }): Promise<unknown>;
  };
  absence: {
    findMany(args: {
      where: { status: 'ACTIVE' };
      select: { memberId: true; eventId: true; dateFrom: true; dateTo: true; eligibleFrom: true };
    }): Promise<
      {
        memberId: string;
        eventId: string | null;
        dateFrom: Date;
        dateTo: Date;
        eligibleFrom?: Date | null;
      }[]
    >;
    create(args: {
      data: { eventId: string; memberId: string; dateFrom: Date; dateTo: Date; reason: string };
    }): Promise<{ id: string }>;
  };

  setting: {
    findMany(args: {
      where: { key: { in: string[] } };
      select: { key: true; value: true };
    }): Promise<{ key: string; value: unknown }[]>;
  };
  $transaction<T>(
    work: (tx: Omit<ConductDb, '$transaction'>) => Promise<T>,
    options: { isolationLevel: 'Serializable'; timeout?: number },
  ): Promise<T>;
  event: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      status: string;
      startsAt: Date;
      endsAt: Date;
      dkpReward: number;
      raidLeadId: string;
      creatorId?: string | null;
      scope?: 'GUILD' | 'KP' | 'PACK';
      packId?: string | null;
      kpId?: string | null;
    } | null>;
  };
  member: {
    findMany(args?: unknown): Promise<
      Array<{
        id: string;
        nickname: string;
        packId?: string | null;
        pack?: { kpId: string } | null;
      }>
    >;
  };
  attendance: {
    findMany(args: {
      where: { eventId: string };
    }): Promise<
      Array<{ memberId: string; status: string | null; checkinStart: string; checkinEnd: string }>
    >;
    findUnique(args: {
      where: { eventId_memberId: { eventId: string; memberId: string } };
    }): Promise<{ status: string | null; checkinStart: string; checkinEnd: string } | null>;
    upsert(args: {
      where: { eventId_memberId: { eventId: string; memberId: string } };
      create: {
        eventId: string;
        memberId: string;
        status?: string | null;
        checkinStart?: string;
        checkinEnd?: string;
        manualById?: string | null;
        manualComment?: string | null;
      };
      update: Record<string, unknown>;
    }): Promise<unknown>;
  };
  dkpEntry: {
    findMany(args: {
      where: { eventId: string };
    }): Promise<Array<{ memberId: string; amount: number; type: string; eventId: string | null }>>;
    create(args: {
      data: {
        memberId: string;
        type: string;
        amount: number;
        eventId: string;
        createdById: string | null;
        comment: string;
      };
    }): Promise<{ id: string }>;
  };
  auditLog: {
    create(args: {
      data: {
        actorMemberId: string | null;
        actorIsAdmin?: boolean;
        action: string;
        entityType: string;
        entityId: string;
        comment: string;
      };
    }): Promise<unknown>;
  };
}

type ConductEvent = NonNullable<Awaited<ReturnType<ConductDb['event']['findUnique']>>>;

/** Настройки долей чек-ина (50/50). */
export interface ConductSettings {
  startSharePct: number;
  endSharePct: number;
}

/**
 * Проведение ивента (issue #10, план 2.2 п.6): ручные отметки РЛ,
 * ручная выдача чек-ин статуса, ручные ДКП, итоговая сводка.
 * Права: Глава/Админ или РЛ ивента (механизм «РЛ ивента», план 2.6).
 */
@Injectable()
export class ConductService {
  constructor(
    private readonly db: ConductDb,
    private readonly settings: ConductSettings | ((db: ConductDb) => Promise<ConductSettings>),
  ) {}

  async setAttendance(
    eventId: string,
    body: unknown,
    actor: EventsActor,
    actorRank: string | null,
  ): Promise<{ ok: true }> {
    return this.transact((service) =>
      service.setAttendanceInTransaction(eventId, body, actor, actorRank),
    );
  }
  async manualCheckIn(
    eventId: string,
    body: unknown,
    actor: EventsActor,
    actorRank: string | null,
  ): Promise<{ ok: true }> {
    return this.transact((service) =>
      service.manualCheckInInTransaction(eventId, body, actor, actorRank),
    );
  }
  async manualDkp(
    eventId: string,
    body: unknown,
    actor: EventsActor,
    actorRank: string | null,
  ): Promise<{ id: string }> {
    return this.transact((service) =>
      service.manualDkpInTransaction(eventId, body, actor, actorRank),
    );
  }
  async applySummary(
    eventId: string,
    body: unknown,
    actor: EventsActor,
    actorRank: string | null,
  ): Promise<ApplyEventSummaryResult> {
    const parsed = applyEventSummarySchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Проверьте корректировки и обязательные комментарии');
    const input = parsed.data;
    const payloadHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const actorKey = actor.memberId ?? 'system-admin';
    return this.transact(async (service) => {
      const event = await service.assertCanConduct(eventId, actor, actorRank, true);
      const existing = await service.db.eventSummaryBatch.findUnique({
        where: { id: input.requestId },
      });
      if (existing) {
        if (
          existing.eventId !== eventId ||
          existing.actorKey !== actorKey ||
          existing.payloadHash !== payloadHash
        )
          throw new ConflictException(
            'Идентификатор запроса уже использован для других корректировок',
          );
        return { ok: true, applied: existing.actionCount, repeated: true };
      }
      if (event.status === 'CANCELLED') throw new ConflictException('Ивент отменён');
      const roster = new Set((await service.checklist(eventId)).map((row) => row.memberId));
      if (input.actions.some((action) => !roster.has(action.memberId)))
        throw new BadRequestException('Участник не входит в приглашённый состав ивента');
      const worker = new ConductService(
        service.db,
        typeof service.settings === 'function'
          ? await service.settings(service.db)
          : service.settings,
      );
      for (const action of input.actions) {
        if (action.kind === 'CHECKIN')
          await worker.manualCheckInInTransaction(eventId, action, actor, actorRank, event);
        else if (action.kind === 'DKP')
          await worker.manualDkpInTransaction(
            eventId,
            { ...action, type: action.amount > 0 ? 'MANUAL_EARN' : 'ADJUSTMENT' },
            actor,
            actorRank,
            event,
          );
        else if (action.kind === 'ATTENDANCE')
          await worker.setAttendanceInTransaction(eventId, action, actor, actorRank, event);
        else {
          const absence = await service.db.absence.create({
            data: {
              eventId,
              memberId: action.memberId,
              dateFrom: event.startsAt,
              dateTo: event.endsAt,
              reason: action.reason,
            },
          });
          await service.db.auditLog.create({
            data: {
              actorMemberId: actor.memberId,
              actorIsAdmin: actor.isAdmin,
              action: 'ABSENCE_CREATE',
              entityType: 'Absence',
              entityId: absence.id,
              comment: `Уважительная причина по итогам ивента ${eventId}: ${action.reason}`,
            },
          });
        }
      }
      await service.db.eventSummaryBatch.create({
        data: {
          id: input.requestId,
          eventId,
          actorKey,
          payloadHash,
          actionCount: input.actions.length,
        },
      });
      await service.audit(
        actor,
        'EVENT_SUMMARY_APPLY',
        eventId,
        `Применён пакет итогов. Корректировок: ${input.actions.length}`,
      );
      return { ok: true, applied: input.actions.length, repeated: false };
    }, 30_000);
  }

  private transact<T>(
    work: (service: ConductService) => Promise<T>,
    timeoutMs?: number,
  ): Promise<T> {
    return serializable(
      this.db,
      (tx) =>
        work(
          new ConductService(
            { ...tx, $transaction: this.db.$transaction.bind(this.db) },
            this.settings,
          ),
        ),
      true,
      timeoutMs,
    );
  }

  /** Чек-лист ивента: все члены + их отметки + отсутствующие. */
  async checklistForActor(
    eventId: string,
    actor: EventsActor,
    actorRank: string | null,
  ): Promise<EventSummaryRow[]> {
    await this.assertCanConduct(eventId, actor, actorRank, true);
    return this.checklist(eventId);
  }

  async checklist(eventId: string): Promise<EventSummaryRow[]> {
    const event = await this.mustGetEvent(eventId);
    const [members, attendance, entries, absences] = await Promise.all([
      this.db.member.findMany({
        select: { id: true, nickname: true, packId: true, pack: { select: { kpId: true } } },
      }),
      this.db.attendance.findMany({ where: { eventId } }),
      this.db.dkpEntry.findMany({ where: { eventId } }),
      this.db.absence.findMany({
        where: { status: 'ACTIVE' },
        select: { memberId: true, eventId: true, dateFrom: true, dateTo: true, eligibleFrom: true },
      }),
    ]);
    const invited = members.filter((m) =>
      isEventInvitee(
        { scope: event.scope ?? 'GUILD', kpId: event.kpId ?? null, packId: event.packId ?? null },
        { id: m.id, packId: m.packId ?? null, kpId: m.pack?.kpId ?? null },
      ),
    );
    const excused = absences
      .filter((a) =>
        a.eventId ? a.eventId === eventId : absenceCoversEvent(a, event.startsAt, event.endsAt),
      )
      .map((a) => a.memberId);
    return buildEventSummary(invited, attendance, entries, event.id, excused);
  }

  /**
   * Ручная отметка посещения (план 2.2): был / опоздал / ушёл раньше /
   * неявка. Отсутствие по уважительной отдельно не ставится — только
   * автоматически при закрытии (issue #11).
   */
  private async setAttendanceInTransaction(
    eventId: string,
    body: unknown,
    actor: EventsActor,
    actorRank: string | null,
    verifiedEvent?: ConductEvent,
  ): Promise<{ ok: true }> {
    const parsed = setAttendanceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Проверьте поля и обязательный комментарий');
    const input: SetAttendanceInput = parsed.data;
    if (!verifiedEvent) await this.assertCanConduct(eventId, actor, actorRank);

    await this.db.attendance.upsert({
      where: { eventId_memberId: { eventId, memberId: input.memberId } },
      create: {
        eventId,
        memberId: input.memberId,
        status: input.status,
        manualById: actor.memberId,
        manualComment: input.comment,
      },
      update: {
        status: input.status,
        manualById: actor.memberId,
        manualComment: input.comment,
      },
    });
    await this.audit(
      actor,
      'MANUAL_ATTENDANCE',
      `${eventId}:${input.memberId}`,
      `Отметка «${input.status}». ${input.comment}`,
    );
    return { ok: true };
  }

  /**
   * Ручная выдача чек-ин статуса (MANUAL, план 2.2): тем, кто не отметился
   * сам. Начисляет ту же долю фазы (50/50), что и верный код, но без
   * перезаписи PASSED/FAILED и без повторного начисления.
   */
  private async manualCheckInInTransaction(
    eventId: string,
    body: unknown,
    actor: EventsActor,
    actorRank: string | null,
    verifiedEvent?: ConductEvent,
  ): Promise<{ ok: true }> {
    const parsed = manualCheckInSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Проверьте поля и обязательный комментарий');
    const input: ManualCheckInInput = parsed.data;
    const event = verifiedEvent ?? (await this.assertCanConduct(eventId, actor, actorRank));

    const existing = await this.db.attendance.findUnique({
      where: { eventId_memberId: { eventId, memberId: input.memberId } },
    });
    const priorStatus = existing
      ? input.phase === 'START'
        ? existing.checkinStart
        : existing.checkinEnd
      : 'PENDING';
    if (priorStatus === 'PASSED' || priorStatus === 'MANUAL') {
      throw new ConflictException('Участник уже отмечен по этой фазе');
    }

    await this.db.attendance.upsert({
      where: { eventId_memberId: { eventId, memberId: input.memberId } },
      create: {
        eventId,
        memberId: input.memberId,
        ...(input.phase === 'START' ? { checkinStart: 'MANUAL' } : { checkinEnd: 'MANUAL' }),
        manualById: actor.memberId,
        manualComment: input.comment,
      },
      update: {
        ...(input.phase === 'START' ? { checkinStart: 'MANUAL' } : { checkinEnd: 'MANUAL' }),
        manualById: actor.memberId,
        manualComment: input.comment,
      },
    });

    const amount = checkInShareAmount(
      event.dkpReward,
      input.phase,
      typeof this.settings === 'function' ? await this.settings(this.db) : this.settings,
    );
    await this.db.dkpEntry.create({
      data: {
        memberId: input.memberId,
        type: 'CHECKIN_EARN',
        amount,
        eventId,
        createdById: actor.memberId,
        comment: `Ручной чек-ин (${input.phase === 'START' ? 'старт' : 'финал'}). ${input.comment}`,
      },
    });
    await this.audit(
      actor,
      'MANUAL_CHECKIN',
      `${eventId}:${input.memberId}`,
      `Ручная отметка ${input.phase === 'START' ? 'старта' : 'финала'} (+${amount} ДКП). ${input.comment}`,
    );
    return { ok: true };
  }

  /** Ручное начисление/корректировка ДКП (журнал append-only). */
  private async manualDkpInTransaction(
    eventId: string,
    body: unknown,
    actor: EventsActor,
    actorRank: string | null,
    verifiedEvent?: ConductEvent,
  ): Promise<{ id: string }> {
    const parsed = manualDkpSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Проверьте поля и обязательный комментарий');
    const input: ManualDkpInput = parsed.data;
    if (!verifiedEvent) await this.assertCanConduct(eventId, actor, actorRank);

    const created = await this.db.dkpEntry.create({
      data: {
        memberId: input.memberId,
        type: input.type,
        amount: input.amount,
        eventId,
        createdById: actor.memberId,
        comment: input.comment,
      },
    });
    await this.audit(
      actor,
      'MANUAL_DKP',
      created.id,
      `${input.type} ${input.amount > 0 ? '+' : ''}${input.amount} ДКП. ${input.comment}`,
    );
    return created;
  }

  private async assertCanConduct(
    eventId: string,
    actor: EventsActor,
    actorRank: string | null,
    allowReceiptRead = false,
  ) {
    const event = await this.mustGetEvent(eventId);
    const allowed = can(
      { rank: actorRank as never, isAdmin: actor.isAdmin, memberId: actor.memberId },
      'events.conduct',
      event,
    );
    if (!allowed) {
      throw new ForbiddenException('Проведение — Главе, Админу и РЛ ивента');
    }
    if (event.status === 'CANCELLED' && !allowReceiptRead) {
      throw new ConflictException('Ивент отменён');
    }
    return event;
  }

  private async mustGetEvent(eventId: string) {
    const event = await this.db.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException('Ивент не найден');
    }
    return event;
  }

  private async audit(actor: EventsActor, action: string, entityId: string, comment: string) {
    await this.db.auditLog.create({
      data: {
        actorMemberId: actor.memberId,
        actorIsAdmin: actor.isAdmin,
        action,
        entityType: 'Event',
        entityId,
        comment,
      },
    });
  }
}
