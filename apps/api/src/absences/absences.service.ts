import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  absenceCoversEvent,
  absenceDeadlineError,
  canCancelAbsence,
  can,
  createAbsenceSchema,
  type CreateAbsenceInput,
} from '@dkp/shared';
import type { AuditWriter } from '../members/members.service';

/** Строка заявки для списков. */
export interface AbsenceRow {
  id: string;
  memberId: string;
  memberName: string;
  dateFrom: Date;
  dateTo: Date;
  reason: string;
  status: string;
  seenBy: string[];
}

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface AbsencesDb {
  absence: {
    findMany(args: {
      where?: { memberId?: string; status?: string };
      orderBy: { dateFrom: 'desc' };
      include: { member: { select: { nickname: true } }; seenBy: { select: { seenById: true } } };
    }): Promise<
      Array<{
        id: string;
        memberId: string;
        dateFrom: Date;
        dateTo: Date;
        reason: string;
        status: string;
        member: { nickname: string };
        seenBy: Array<{ seenById: string }>;
      }>
    >;
    findUnique(args: {
      where: { id: string };
    }): Promise<{ id: string; memberId: string; dateFrom: Date; dateTo: Date; status: string } | null>;
    create(args: {
      data: { memberId: string; dateFrom: Date; dateTo: Date; reason: string };
    }): Promise<{ id: string }>;
    update(args: {
      where: { id: string };
      data: { status: string };
    }): Promise<unknown>;
  };
  absenceSeen: {
    findUnique(args: {
      where: { absenceId_seenById: { absenceId: string; seenById: string } };
    }): Promise<{ id: string } | null>;
    create(args: {
      data: { absenceId: string; seenById: string };
    }): Promise<unknown>;
  };
  event: {
    findMany(args: {
      where: { startsAt: { gte: Date; lte: Date }; status: string };
      select: { startsAt: true };
    }): Promise<Array<{ startsAt: Date }>>;
  };
  attendance: {
    upsert(args: {
      where: { eventId_memberId: { eventId: string; memberId: string } };
      create: { eventId: string; memberId: string; status: string };
      update: { status: string };
    }): Promise<unknown>;
  };
  auditLog: AuditWriter;
}

/** Действующий пользователь сессии. */
export interface AbsencesActor {
  memberId: string;
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

  /** Свои заявки (или все — для офицерского списка). */
  async list(memberId?: string): Promise<AbsenceRow[]> {
    const rows = await this.db.absence.findMany({
      where: memberId ? { memberId, status: 'ACTIVE' } : { status: 'ACTIVE' },
      orderBy: { dateFrom: 'desc' },
      include: {
        member: { select: { nickname: true } },
        seenBy: { select: { seenById: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      memberId: row.memberId,
      memberName: row.member.nickname,
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
      reason: row.reason,
      status: row.status,
      seenBy: row.seenBy.map((s) => s.seenById),
    }));
  }

  /**
   * Подать заявку: без апрува (решение №6). Проверки: не задним числом,
   * не ближе N сек до старта пересекающих ивентов.
   */
  async create(memberId: string, body: unknown, actor: AbsencesActor): Promise<{ id: string }> {
    const input: CreateAbsenceInput = createAbsenceSchema.parse(body);

    // Ивенты будущего периода заявки: от now до dateTo
    const now = this.clock();
    const events = await this.db.event.findMany({
      where: {
        startsAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000), lte: input.dateTo },
        status: 'PLANNED',
      },
      select: { startsAt: true },
    });

    const error = absenceDeadlineError(input, events, this.settings, now);
    if (error) {
      throw new ConflictException(error);
    }

    const created = await this.db.absence.create({
      data: { memberId, dateFrom: input.dateFrom, dateTo: input.dateTo, reason: input.reason },
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
        startsAt: { gte: absence.dateFrom, lte: absence.dateTo },
        status: 'PLANNED',
      },
      select: { startsAt: true },
    });
    if (!canCancelAbsence(absence, events, this.clock())) {
      throw new ConflictException('Ивент уже начался — заявку отменить нельзя');
    }

    await this.db.absence.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit(actor, 'ABSENCE_CANCEL', id, 'Заявка на отсутствие отменена');
    return { ok: true };
  }

  /**
   * «Увидел» (план 2.3): РЛ/офицер+; фиксация принятия к сведению,
   * на статус не влияет; один раз на человека (unique absenceId+seenById).
   */
  async markSeen(id: string, actor: AbsencesActor): Promise<{ ok: true }> {
    const allowed =
      actor.isAdmin ||
      can({ rank: actor.rank as never, isAdmin: actor.isAdmin, memberId: actor.memberId }, 'absence.see');
    if (!allowed) {
      throw new ForbiddenException('Отметка «Увидел» — офицерам и выше');
    }

    await this.mustExist(id);
    const existing = await this.db.absenceSeen.findUnique({
      where: { absenceId_seenById: { absenceId: id, seenById: actor.memberId } },
    });
    if (existing) {
      return { ok: true }; // идемпотентно: повторный клик не ошибка
    }
    await this.db.absenceSeen.create({ data: { absenceId: id, seenById: actor.memberId } });
    return { ok: true };
  }

  /**
   * Отсутствующие по ивенту: активные заявки, период которых покрывает
   * старт ивента — для карточки ивента и чек-листа РЛ (план 2.3).
   */
  async forEvent(eventStartsAt: Date): Promise<
    Array<{ id: string; memberId: string; memberName: string; reason: string }>
  > {
    // Ищем заявки, пересекающие дату ивента: dateFrom <= старт <= dateTo.
    // Prisma не умеет «поле <= значение <= поле» одним where — берём
    // заявки с dateFrom <= старт и фильтруем по dateTo в памяти.
    const candidates = await this.db.absence.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { dateFrom: 'desc' },
      include: { member: { select: { nickname: true } }, seenBy: { select: { seenById: true } } },
    });
    return candidates
      .filter((absence) => absenceCoversEvent(absence, eventStartsAt))
      .map((absence) => ({
        id: absence.id,
        memberId: absence.memberId,
        memberName: absence.member.nickname,
        reason: absence.reason,
      }));
  }

  /**
   * Авто-отметка при закрытии ивента (план 2.3): отсутствующим по
   * уважительной ставится EXCUSED_ABSENCE — очков нет, «неявкой» не
   * считается. Вызывается из events при переходе в FINISHED.
   */
  async markExcusedForFinishedEvent(
    eventId: string,
    eventStartsAt: Date,
  ): Promise<number> {
    const absent = await this.forEvent(eventStartsAt);
    for (const row of absent) {
      await this.db.attendance.upsert({
        where: { eventId_memberId: { eventId, memberId: row.memberId } },
        create: { eventId, memberId: row.memberId, status: 'EXCUSED_ABSENCE' },
        update: { status: 'EXCUSED_ABSENCE' },
      });
    }
    return absent.length;
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
        action,
        entityType: 'Absence',
        entityId,
        comment,
      },
    });
  }
}
