import { serializable } from '../prisma/serializable';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  activeCheckInPhase,
  can,
  checkInPhaseView,
  checkInShareAmount,
  isEventInvitee,
  submitCheckInSchema,
  type CheckInPhase,
  type CheckInWindowBounds,
  type CheckInWindowState,
  type EventScopeInput,
  type SubmitCheckInInput,
} from '@dkp/shared';
import { buildCodeChoices, decryptCheckInCode, isCodeCorrect } from './crypto';
import type { EventsActor } from '../events/events.service';
import { awardRaidLeadBonus, type RaidLeadBonusLedger } from '../dkp/raid-lead-bonus';

/** Доли платы за фазы (дефолты совпадают с SETTING_DEFAULTS). */
export interface CheckInSettings {
  startSharePct: number;
  endSharePct: number;
}

/** Сохранённый код ивент-фазы: хэш, соль, шифротекст и границы окна. */
interface StoredCode extends CheckInWindowBounds {
  codeHash: string;
  salt: string;
  /** Код, зашифрованный CHECKIN_ENC_KEY (открытым текстом не хранится). */
  codeEnc: string;
}

/** Что видит игрок: статус окна + 4 варианта (без указания верного). */
export interface PlayerCheckInView {
  phase: CheckInPhase;
  windowState: CheckInWindowState;
  /** Варианты кодов, перемешаны; присутствуют только в ACTIVE-окне, стабильны в его пределах. */
  choices: string[];
  status: string;
}

/** Что видит управляющий: сам код (только ему) и границы окна. */
export interface RaidLeadCheckInView {
  phase: CheckInPhase;
  windowState: CheckInWindowState;
  code: string;
  /** null — код этой фазы ещё не запускали. */
  windowOpensAt: Date | null;
  windowClosesAt: Date | null;
}

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface CheckInDb {
  member: {
    findUnique(args: { where: { id: string }; include: { pack: true } }): Promise<{
      id: string;
      packId: string | null;
      directKpId?: string | null;
      blockedAt: Date | null;
      pack: { kpId: string } | null;
    } | null>;
  };
  $transaction<T>(
    work: (tx: Omit<CheckInDb, '$transaction'>) => Promise<T>,
    options: { isolationLevel: 'Serializable' },
  ): Promise<T>;
  event: {
    findUnique(args: { where: { id: string } }): Promise<
      | (EventScopeInput & {
          id: string;
          status: string;
          dkpReward: number;
          raidLeadId: string;
          raidLeadBonusEnabled?: boolean;
          creatorId?: string | null;
        })
      | null
    >;
  };
  checkInCode: {
    findUnique(args: {
      where: { eventId_phase: { eventId: string; phase: string } };
    }): Promise<StoredCode | null>;
  };
  attendance: {
    findUnique(args: {
      where: { eventId_memberId: { eventId: string; memberId: string } };
    }): Promise<{ checkinStart: string; checkinEnd: string } | null>;
    upsert(args: {
      where: { eventId_memberId: { eventId: string; memberId: string } };
      create: { eventId: string; memberId: string; checkinStart?: string; checkinEnd?: string };
      update: { checkinStart?: string; checkinEnd?: string };
    }): Promise<unknown>;
  };
  dkpEntry: Pick<RaidLeadBonusLedger, 'findMany'> & {
    create(args: {
      data: {
        memberId: string;
        type: string;
        amount: number;
        eventId: string;
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

/** Часы — инъектируются, чтобы тесты замораживали время. */
export type Clock = () => Date;

/**
 * Чек-ин кодами (issue #9, план 2.2): окно кода открывает управляющий кнопкой
 * «Начать ивент» / «Завершить ивент» (launch.ts, решение №23) — расписание
 * ивента на окна не влияет. Здесь чтение и сверка попыток: в БД хэш с солью
 * для проверки и шифротекст для повторного показа управляющему, одна
 * попытка, 50/50 платы в журнал ДКП.
 */
@Injectable()
export class CheckInService {
  constructor(
    private readonly db: CheckInDb,
    private readonly settings: CheckInSettings,
    private readonly clock: Clock = () => new Date(),
    /** hex-ключ AES-256 для зашифрованного показа кода управляющему (env CHECKIN_ENC_KEY). */
    private readonly encKeyHex: string = '',
  ) {}

  async playerView(eventId: string, memberId: string): Promise<PlayerCheckInView> {
    return this.transact((service) => service.playerViewInTransaction(eventId, memberId));
  }
  async raidLeadView(
    eventId: string,
    actor: EventsActor,
    actorRank: string | null,
  ): Promise<RaidLeadCheckInView> {
    return this.transact((service) => service.raidLeadViewInTransaction(eventId, actor, actorRank));
  }
  async submit(
    eventId: string,
    memberId: string,
    body: unknown,
  ): Promise<{ result: 'PASSED' | 'FAILED' }> {
    return this.transact((service) => service.submitInTransaction(eventId, memberId, body));
  }
  private transact<T>(work: (service: CheckInService) => Promise<T>): Promise<T> {
    return serializable(
      this.db,
      (tx) =>
        work(
          new CheckInService(
            { ...tx, $transaction: this.db.$transaction.bind(this.db) },
            this.settings,
            this.clock,
            this.encKeyHex,
          ),
        ),
      true,
    );
  }

  /**
   * Вид игрока: статус окна текущей фазы + перемешанные 4 варианта
   * (верный + 3 обманки). Варианты отдаются только в активном окне
   * и стабильны в его пределах (детерминированы солью кода) — повторные
   * запросы не выдают верный код сменой обманок.
   *
   * Завершённый ивент чек-ин не закрывает: финальное окно открывает та же
   * кнопка, что завершает ивент, и действует ещё windowSec.
   */
  private async playerViewInTransaction(
    eventId: string,
    memberId: string,
  ): Promise<PlayerCheckInView> {
    if (!memberId) throw new ForbiddenException('Для отметки нужен профиль игрока');
    const event = await this.mustGetEvent(eventId);
    await this.assertInvited(event, memberId);
    if (event.status === 'CANCELLED') throw new ConflictException('Чек-ин недоступен');
    const codes = await this.codesOf(event.id);
    const view = checkInPhaseView(this.clock(), event.status, codes);

    const existing = await this.db.attendance.findUnique({
      where: { eventId_memberId: { eventId, memberId } },
    });
    const status = existing
      ? view.phase === 'START'
        ? existing.checkinStart
        : existing.checkinEnd
      : 'PENDING';

    const stored = view.windowState === 'ACTIVE' ? codes[view.phase] : undefined;
    return {
      phase: view.phase,
      windowState: view.windowState,
      choices: stored ? this.choicesOf(stored) : [],
      status,
    };
  }

  /**
   * Вид управляющего: сам код (только управляющим ивента — план 2.6) и
   * границы окна. Код показывается из шифротекста; до запуска фазы границ
   * ещё нет — окно откроет кнопка «Начать ивент» / «Завершить ивент».
   */
  private async raidLeadViewInTransaction(
    eventId: string,
    actor: EventsActor,
    actorRank: string | null,
  ): Promise<RaidLeadCheckInView> {
    const event = await this.mustGetEvent(eventId);
    if (event.status === 'CANCELLED') {
      throw new ConflictException('Ивент отменён — чек-ин недоступен');
    }
    const allowed = can(
      { rank: actorRank as never, isAdmin: actor.isAdmin, memberId: actor.memberId },
      'events.conduct',
      event,
    );
    if (!allowed) {
      throw new ForbiddenException('Код видят только управляющие ивента');
    }

    const codes = await this.codesOf(event.id);
    const view = checkInPhaseView(this.clock(), event.status, codes);
    const stored = codes[view.phase];
    if (!stored) {
      return {
        phase: view.phase,
        windowState: view.windowState,
        code: '',
        windowOpensAt: null,
        windowClosesAt: null,
      };
    }
    const code = this.reveal(stored);
    if (code === null) {
      throw new ConflictException('Код недоступен');
    }

    return {
      phase: view.phase,
      windowState: view.windowState,
      code,
      windowOpensAt: stored.windowOpensAt,
      windowClosesAt: stored.windowClosesAt,
    };
  }

  /**
   * Попытка игрока: окно активно, попытка первая. Верный код → PASSED +
   * DkpEntry CHECKIN_EARN на долю фазы (50/50, решение №7). Неверный →
   * FAILED, повтор блокируется (дальше только ручная отметка управляющим).
   */
  private async submitInTransaction(
    eventId: string,
    memberId: string,
    body: unknown,
  ): Promise<{ result: 'PASSED' | 'FAILED' }> {
    if (!memberId) throw new ForbiddenException('Для отметки нужен профиль игрока');
    const parsed = submitCheckInSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Некорректный код');
    const input: SubmitCheckInInput = parsed.data;
    const event = await this.mustGetEvent(eventId);
    await this.assertInvited(event, memberId);
    if (event.status === 'CANCELLED') {
      throw new ConflictException('Ивент отменён — чек-ин недоступен');
    }
    const codes = await this.codesOf(event.id);
    const phase = activeCheckInPhase(this.clock(), codes);
    if (!phase) {
      throw new ConflictException('Чек-ин недоступен: окно не активно');
    }
    const stored = codes[phase]!;

    const existing = await this.db.attendance.findUnique({
      where: { eventId_memberId: { eventId, memberId } },
    });
    const priorStatus = existing
      ? phase === 'START'
        ? existing.checkinStart
        : existing.checkinEnd
      : 'PENDING';
    if (priorStatus !== 'PENDING' && priorStatus !== 'ACTIVE') {
      throw new ConflictException('Попытка уже использована');
    }

    const correct = isCodeCorrect(input.code, stored.salt, stored.codeHash);
    const status = correct ? 'PASSED' : 'FAILED';

    await this.db.attendance.upsert({
      where: { eventId_memberId: { eventId, memberId } },
      create: {
        eventId,
        memberId,
        ...(phase === 'START' ? { checkinStart: status } : { checkinEnd: status }),
      },
      update: phase === 'START' ? { checkinStart: status } : { checkinEnd: status },
    });

    if (correct) {
      const amount = checkInShareAmount(event.dkpReward, phase, this.settings);
      // Нулевая доля (напр. плата 1 при 50/50) — отметка засчитывается,
      // но запись журнала на 0 не создаём (аудит F01).
      if (amount > 0) {
        await this.db.dkpEntry.create({
          data: {
            memberId,
            type: 'CHECKIN_EARN',
            amount,
            eventId,
            comment: `Чек-ин ${phase === 'START' ? 'старт' : 'финал'}: код верный`,
          },
        });
        if (event.raidLeadBonusEnabled && event.raidLeadId === memberId) {
          await awardRaidLeadBonus(this.db.dkpEntry, eventId, memberId);
        }
      }
    }

    await this.db.auditLog.create({
      data: {
        actorMemberId: memberId,
        action: 'CHECKIN_SUBMIT',
        entityType: 'Event',
        entityId: eventId,
        comment: `Отметка ${phase === 'START' ? 'старта' : 'финала'}: ${correct ? 'код верный' : 'код неверный'}`,
      },
    });
    return { result: status };
  }

  /** Коды ивента по фазам — только сохранённые; фазы без кода нет среди ключей. */
  private async codesOf(eventId: string): Promise<Partial<Record<CheckInPhase, StoredCode>>> {
    const read = (phase: CheckInPhase) =>
      this.db.checkInCode.findUnique({ where: { eventId_phase: { eventId, phase } } });
    const [start, end] = await Promise.all([read('START'), read('END')]);
    return { ...(start ? { START: start } : {}), ...(end ? { END: end } : {}) };
  }

  /** Варианты для игрока: верный код и 3 обманки; без читаемого кода вариантов нет. */
  private choicesOf(stored: StoredCode): string[] {
    const code = this.reveal(stored);
    return code === null ? [] : buildCodeChoices(code, stored.salt);
  }

  /** Расшифровка кода для показа управляющему; пусто/битое — null. */
  private reveal(stored: StoredCode): string | null {
    if (!stored.codeEnc) {
      return null;
    }
    return decryptCheckInCode(stored.codeEnc, this.encKeyHex);
  }

  private async assertInvited(event: EventScopeInput, memberId: string) {
    const member = await this.db.member.findUnique({
      where: { id: memberId },
      include: { pack: true },
    });
    if (
      !member ||
      member.blockedAt ||
      !isEventInvitee(event, { ...member, kpId: member.pack?.kpId ?? member.directKpId ?? null })
    )
      throw new ForbiddenException('Вы не приглашены на этот ивент');
  }

  private async mustGetEvent(eventId: string) {
    const event = await this.db.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException('Ивент не найден');
    }
    return event;
  }
}
