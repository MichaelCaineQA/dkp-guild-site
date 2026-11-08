import { serializable } from '../prisma/serializable';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  absenceCoversEvent,
  absenceSeenActorKey,
  absenceDeadlineError,
  canCancelAbsence,
  can,
  createAbsenceSchema,
  parseSettingValue,
  type CreateAbsenceInput,
} from '@dkp/shared';
import type { AuditWriter } from '../members/members.service';

/** Строка заявки для списков. */
export interface AbsenceRow {
  id: string;
  eventId?: string | null;
  eventName?: string | null;
  memberId: string;
  memberName: string;
  dateFrom: Date;
  dateTo: Date;
  allDay: boolean;
  reason: string;
  status: string;
  seenBy: string[];
}

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface AbsencesDb {
  setting?: {
    findUnique(args: {
      where: { key: string };
      select: { value: true };
    }): Promise<{ value: unknown } | null>;
  };
  $transaction<T>(
    work: (tx: Omit<AbsencesDb, '$transaction'>) => Promise<T>,
    options: { isolationLevel: 'Serializable' },
  ): Promise<T>;
  absence: {
    findMany(args: {
      where?: { memberId?: string; status?: string };
      orderBy: { dateFrom: 'desc' };
      include: {
        member: { select: { nickname: true; pack?: { select: { leaderId: true } } } };
        seenBy: { select: { actorKey: true } };
        event?: { select: { startsAt: true; endsAt: true; name: true } };
      };
    }): Promise<
      Array<{
        id: string;
        eventId?: string | null;
        event?: { startsAt: Date; endsAt: Date; name: string } | null;
        memberId: string;
        dateFrom: Date;
        dateTo: Date;
        eligibleFrom?: Date | null;
        allDay?: boolean;
        reason: string;
        status: string;
        member: { nickname: string; pack?: { leaderId: string | null } | null };
        seenBy: Array<{ actorKey: string }>;
      }>
    >;
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      eventId?: string | null;
      memberId: string;
      dateFrom: Date;
      dateTo: Date;
      eligibleFrom?: Date | null;
      status: string;
    } | null>;
    create(args: {
      data: {
        memberId: string;
        dateFrom: Date;
        dateTo: Date;
        reason: string;
        eligibleFrom: Date;
        allDay: boolean;
      };
    }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: { status: string } }): Promise<unknown>;
  };
  absenceSeen: {
    createMany(args: {
      data: { absenceId: string; seenById: string | null; actorKey: string }[];
      skipDuplicates: true;
    }): Promise<{ count: number }>;
  };
  event: {
    findUnique(args: {
      where: { id: string };
      select: { startsAt: true; endsAt: true };
    }): Promise<{ startsAt: Date; endsAt: Date } | null>;
    findMany(args: {
      where: {
        id?: string;
        startsAt?: { gte: Date; lte: Date };
        endsAt?: { gt: Date };
        status: string | { notIn: string[] };
      };
      select: { startsAt: true; endsAt?: true };
    }): Promise<Array<{ startsAt: Date; endsAt?: Date }>>;
  };
  attendance: {
    findUnique(args: {
      where: { eventId_memberId: { eventId: string; memberId: string } };
    }): Promise<{ status: string | null } | null>;
    create(args: { data: { eventId: string; memberId: string; status: string } }): Promise<unknown>;
  };
  auditLog: AuditWriter;
}

/** Действующий пользователь сессии. */
export interface AbsencesActor {
  memberId: string | null;
  isAdmin: boolean;
  rank: string | null;
}

/** Дедлайн отсутствий (из Setting, дефолт 180 сек). */
export interface AbsencesSettings {
  deadlineBeforeStartSec: number;
}

/** Часы — инъектируются для тестов. */
export type Clock = () => Date;

/**
 * Отсутствия (issue #11, план 2.3): заявка без апрува, дедлайн за 3 мин
 * до старта ивента, отмена только до начала; «Увидел» — фиксация, на
 * статус не влияет, один на человека.
 */
@Injectable()
export class AbsencesService {
  constructor(
    private readonly db: AbsencesDb,
    private readonly settings: AbsencesSettings,
    private readonly clock: Clock = () => new Date(),
  ) {}

  /** Свои заявки (или все — для списка Главы/Админа). */
  async list(memberId?: string): Promise<AbsenceRow[]> {
    const rows = await this.db.absence.findMany({
      where: memberId ? { memberId, status: 'ACTIVE' } : { status: 'ACTIVE' },
      orderBy: { dateFrom: 'desc' },
      include: {
        member: { select: { nickname: true } },
        seenBy: { select: { actorKey: true } },
        event: { select: { startsAt: true, endsAt: true, name: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId ?? null,
      eventName: row.event?.name ?? null,
      memberId: row.memberId,
      memberName: row.member.nickname,
      dateFrom: row.event?.startsAt ?? row.dateFrom,
      dateTo: row.event?.endsAt ?? row.dateTo,
      allDay: row.allDay ?? false,
      reason: row.reason,
      status: row.status,
      seenBy: row.seenBy.map((s) => s.actorKey),
    }));
  }

  /**
   * Подать заявку: без апрува (решение №6). Проверки: не задним числом,
   * не ближе N сек до старта пересекающих ивентов.
   */
  async create(memberId: string, body: unknown, actor: AbsencesActor): Promise<{ id: string }> {
    const input: CreateAbsenceInput = createAbsenceSchema.parse(body);

    // Ивенты, попадающие в период заявки, включая уже начавшиеся:
    // идущий (RUNNING) ивент тем более «меньше 3 минут до старта» —
    // план 2.3 запрещает заявку и на него. Завершённые (FINISHED/
    // CANCELLED) не блокируют: их период уже прошёл.
    const now = this.clock();
    const configured = await this.db.setting?.findUnique({
      where: { key: 'absence.deadlineBeforeStartSec' },
      select: { value: true },
    });
    const deadlineBeforeStartSec = configured
      ? parseSettingValue('absence.deadlineBeforeStartSec', configured.value)
      : this.settings.deadlineBeforeStartSec;
    const error = absenceDeadlineError(input, [], this.settings, now);
    if (error) {
      throw new ConflictException(error);
    }

    const created = await this.db.absence.create({
      data: {
        memberId,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        reason: input.reason,
        allDay: input.allDay,
        eligibleFrom: new Date(now.getTime() + deadlineBeforeStartSec * 1000),
      },
    });
    await this.audit(actor, 'ABSENCE_CREATE', created.id, 'Подана заявка на отсутствие');
    return created;
  }

  /** Отменить свою заявку: только до начала пересекающих ивентов. */
  async cancel(id: string, actor: AbsencesActor): Promise<{ ok: true }> {
    const absence = await this.mustExist(id);
    if (absence.memberId !== actor.memberId && !actor.isAdmin) {
      throw new ForbiddenException('Отменить можно только свою заявку');
    }

    const events = await this.db.event.findMany({
      where: {
        ...(absence.eventId
          ? { id: absence.eventId }
          : {
              startsAt: { gte: new Date(0), lte: absence.dateTo },
              endsAt: { gt: absence.dateFrom },
            }),
        status: { notIn: ['CANCELLED'] },
      },
      select: { startsAt: true, endsAt: true },
    });
    const period =
      absence.eventId && events[0]
        ? { dateFrom: events[0].startsAt, dateTo: events[0].startsAt }
        : absence;
    if (!canCancelAbsence(period, events, this.clock())) {
      throw new ConflictException('Ивент уже начался — заявку отменить нельзя');
    }

    await this.db.absence.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit(actor, 'ABSENCE_CANCEL', id, 'Заявка на отсутствие отменена');
    return { ok: true };
  }

  /**
   * «Увидел» (план 2.3): Глава/Админ; фиксация принятия к сведению,
   * на статус не влияет; один раз на человека (unique absenceId+actorKey).
   */
  async markSeen(id: string, actor: AbsencesActor): Promise<{ ok: true }> {
    const actorKey = absenceSeenActorKey(actor);
    if (!actorKey || !can({ ...actor, rank: actor.rank as never }, 'absence.see'))
      throw new ForbiddenException('Отметка «Увидел» — Главе и Админу');
    return serializable(this.db, async (tx) => {
      const absence = await tx.absence.findUnique({ where: { id } });
      if (!absence) throw new NotFoundException('Заявка не найдена');
      const result = await tx.absenceSeen.createMany({
        data: [{ absenceId: id, seenById: actor.memberId, actorKey }],
        skipDuplicates: true,
      });
      if (result.count > 0)
        await tx.auditLog.create({
          data: {
            actorMemberId: actor.memberId,
            actorIsAdmin: actor.isAdmin,
            action: 'ABSENCE_SEEN',
            entityType: 'Absence',
            entityId: id,
            comment: 'Информация об отсутствии принята к сведению',
          },
        });
      return { ok: true as const };
    });
  }

  /**
   * Отсутствующие по ивенту: активные заявки, период которых покрывает
   * старт ивента — для карточки ивента и чек-листа РЛ (план 2.3).
   */
  async forEvent(
    eventStartsAt: Date,
    eventId?: string,
    actor?: AbsencesActor,
    eventEndsAt?: Date,
  ): Promise<
    Array<{
      id: string;
      memberId: string;
      memberName: string;
      reason: string | null;
      seenBy: string[];
    }>
  > {
    // Ищем заявки, пересекающие дату ивента: dateFrom <= старт <= dateTo.
    // Prisma не умеет «поле <= значение <= поле» одним where — берём
    // заявки с dateFrom <= старт и фильтруем по dateTo в памяти.
    const candidates = await this.db.absence.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { dateFrom: 'desc' },
      include: {
        member: { select: { nickname: true, pack: { select: { leaderId: true } } } },
        seenBy: { select: { actorKey: true } },
      },
    });
    return candidates
      .filter((absence) =>
        absence.eventId
          ? absence.eventId === eventId
          : absenceCoversEvent(absence, eventStartsAt, eventEndsAt),
      )
      .map((absence) => ({
        id: absence.id,
        memberId: absence.memberId,
        memberName: absence.member.nickname,
        reason:
          actor &&
          (actor.isAdmin ||
            actor.rank === 'ADMIN' ||
            actor.rank === 'GUILD_LEADER' ||
            actor.rank === 'OFFICER' ||
            actor.memberId === absence.memberId ||
            (!!actor.memberId && actor.memberId === absence.member.pack?.leaderId))
            ? absence.reason
            : null,
        seenBy: absence.seenBy.map((s) => s.actorKey),
      }));
  }

  async forEventId(eventId: string, actor: AbsencesActor) {
    const event = await this.db.event.findUnique({
      where: { id: eventId },
      select: { startsAt: true, endsAt: true },
    });
    if (!event) throw new NotFoundException('Ивент не найден');
    return this.forEvent(event.startsAt, eventId, actor, event.endsAt);
  }

  /**
   * Авто-отметка при закрытии ивента (план 2.3): отсутствующим по
   * уважительной ставится EXCUSED_ABSENCE — очков нет, «неявкой» не
   * считается. Вызывается из events при переходе в FINISHED.
   *
   * Не трогаем существующие отметки: игрок мог передумать, прийти и
   * отметиться кодом (PASSED) или получить ручную отметку РЛ — отсутствие
   * на дату не должно их затирать. Ставим только тем, кого ещё не отмечали.
   */
  async markExcusedForFinishedEvent(
    eventId: string,
    eventStartsAt: Date,
    eventEndsAt?: Date,
  ): Promise<number> {
    const absent = await this.forEvent(eventStartsAt, eventId, undefined, eventEndsAt);
    let marked = 0;
    for (const row of absent) {
      const existing = await this.db.attendance.findUnique({
        where: { eventId_memberId: { eventId, memberId: row.memberId } },
      });
      if (existing) {
        continue; // уже отмечен (чек-ин/руками) — не перезаписываем
      }
      await this.db.attendance.create({
        data: { eventId, memberId: row.memberId, status: 'EXCUSED_ABSENCE' },
      });
      marked++;
    }
    return marked;
  }

  private async mustExist(id: string) {
    const absence = await this.db.absence.findUnique({ where: { id } });
    if (!absence) {
      throw new NotFoundException('Заявка не найдена');
    }
    return absence;
  }

  private async audit(actor: AbsencesActor, action: string, entityId: string, comment: string) {
    await this.db.auditLog.create({
      data: {
        actorMemberId: actor.memberId,
        actorIsAdmin: actor.isAdmin,
        action,
        entityType: 'Absence',
        entityId,
        comment,
      },
    });
  }
}
