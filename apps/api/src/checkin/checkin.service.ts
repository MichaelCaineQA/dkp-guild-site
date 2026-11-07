import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  can,
  checkInShareAmount,
  checkInWindowState,
  phaseWindowBounds,
  submitCheckInSchema,
  type CheckInPhase,
  type CheckInWindowState,
  type SubmitCheckInInput,
} from '@dkp/shared';
import {
  buildCodeChoices,
  decryptCheckInCode,
  encryptCheckInCode,
  isCodeCorrect,
  newCodeWithHash,
} from './crypto';
import type { EventsActor } from '../events/events.service';

/** Настройки окна чек-ина (дефолты совпадают с SETTING_DEFAULTS). */
export interface CheckInSettings {
  generateBeforeStartSec: number;
  windowSec: number;
  attempts: number;
  startSharePct: number;
  endSharePct: number;
}

/** Сохранённый код ивент-фазы: хэш, соль, шифротекст, границы окна. */
interface StoredCode {
  codeHash: string;
  salt: string;
  /** Код, зашифрованный CHECKIN_ENC_KEY (открытым текстом не хранится). */
  codeEnc: string;
  windowOpensAt: Date;
  windowClosesAt: Date;
}

/** Что видит игрок: статус окна + 4 варианта (без указания верного). */
export interface PlayerCheckInView {
  phase: CheckInPhase;
  windowState: CheckInWindowState;
  /** Варианты кодов, перемешаны; присутствуют только в ACTIVE-окне. */
  choices: string[];
  status: string;
}

/** Что видит РЛ: сам код (только ему) и границы окна. */
export interface RaidLeadCheckInView {
  phase: CheckInPhase;
  windowState: CheckInWindowState;
  code: string;
  windowOpensAt: Date;
  windowClosesAt: Date;
}

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface CheckInDb {
  event: {
    findUnique(args: {
      where: { id: string };
    }): Promise<{
      id: string;
      status: string;
      startsAt: Date;
      endsAt: Date;
      dkpReward: number;
      raidLeadId: string;
    } | null>;
  };
  checkInCode: {
    findUnique(args: {
      where: { eventId_phase: { eventId: string; phase: string } };
    }): Promise<StoredCode | null>;
    create(args: {
      data: {
        eventId: string;
        phase: string;
        codeHash: string;
        salt: string;
        codeEnc: string;
        windowOpensAt: Date;
        windowClosesAt: Date;
      };
    }): Promise<unknown>;
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
  dkpEntry: {
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
 * Чек-ин кодами (issue #9, план 2.2): ленивая генерация кода при запросе,
 * хранение только хэша для сверки + шифротекста для повторного показа РЛ,
 * одна попытка, 50/50 платы в журнал ДКП.
 */
@Injectable()
export class CheckInService {
  constructor(
    private readonly db: CheckInDb,
    private readonly settings: CheckInSettings,
    private readonly clock: Clock = () => new Date(),
    /** hex-ключ AES-256 для зашифрованного показа кода РЛ (env CHECKIN_ENC_KEY). */
    private readonly encKeyHex: string = '',
  ) {}

  /**
   * Вид игрока: статус окна текущей фазы + перемешанные 4 варианта
   * (верный + 3 обманки). Варианты отдаются только в активном окне.
   */
  async playerView(eventId: string, memberId: string): Promise<PlayerCheckInView> {
    const event = await this.mustGetEvent(eventId);
    const now = this.clock();
    const phase = (await this.currentPhase(event, now)) ?? 'START';

    const existing = await this.db.attendance.findUnique({
      where: { eventId_memberId: { eventId, memberId } },
    });
    const status = existing
      ? phase === 'START'
        ? existing.checkinStart
        : existing.checkinEnd
      : 'PENDING';

    const stored = await this.ensureCode(event, phase);
    const windowState = checkInWindowState(now, stored.windowOpensAt, stored.windowClosesAt);
    const correctCode = this.reveal(stored);

    return {
      phase,
      windowState,
      choices:
        windowState === 'ACTIVE' && correctCode !== null ? buildCodeChoices(correctCode) : [],
      status,
    };
  }

  /**
   * Вид РЛ: сам код (только РЛ ивента, Глава или Админ+ — план 2.2).
   * Ленивая генерация: код создаётся при первом запросе в окне;
   * повторный показ — расшифровкой codeEnc.
   */
  async raidLeadView(
    eventId: string,
    actor: EventsActor,
    actorRank: string | null,
  ): Promise<RaidLeadCheckInView> {
    const event = await this.mustGetEvent(eventId);
    if (event.status === 'CANCELLED' || event.status === 'FINISHED') {
      throw new ConflictException('Ивент отменён или завершён — чек-ин недоступен');
    }
    const allowed =
      can(
        { rank: actorRank as never, isAdmin: actor.isAdmin, memberId: actor.memberId },
        'events.conduct',
        event,
      );
    if (!allowed) {
      throw new ForbiddenException('Код видит только РЛ ивента, Глава или Админ');
    }

    const now = this.clock();
    const phase = (await this.currentPhase(event, now)) ?? 'START';
    const stored = await this.ensureCode(event, phase);
    const windowState = checkInWindowState(now, stored.windowOpensAt, stored.windowClosesAt);
    const code = this.reveal(stored);
    if (code === null) {
      if (windowState === 'NOT_OPEN_YET') {
        // До окна: показываем статус, код появится при генерации в окне.
        return {
          phase,
          windowState,
          code: '',
          windowOpensAt: stored.windowOpensAt,
          windowClosesAt: stored.windowClosesAt,
        };
      }
      throw new ConflictException('Код недоступен: окно прошло без генерации');
    }

    return {
      phase,
      windowState,
      code,
      windowOpensAt: stored.windowOpensAt,
      windowClosesAt: stored.windowClosesAt,
    };
  }

  /**
   * Попытка игрока: окно активно, попытка первая. Верный код → PASSED +
   * DkpEntry CHECKIN_EARN на долю фазы (50/50, решение №7). Неверный →
   * FAILED, повтор блокируется (дальше только ручная отметка РЛ).
   */
  async submit(
    eventId: string,
    memberId: string,
    body: unknown,
  ): Promise<{ result: 'PASSED' | 'FAILED' }> {
    const input: SubmitCheckInInput = submitCheckInSchema.parse(body);
    const event = await this.mustGetEvent(eventId);
    if (event.status === 'CANCELLED' || event.status === 'FINISHED') {
      throw new ConflictException('Ивент отменён или завершён — чек-ин недоступен');
    }
    const now = this.clock();
    const phase = await this.currentPhase(event, now);
    if (phase === null) {
      throw new ConflictException('Чек-ин недоступен: окно не активно');
    }

    const stored = await this.ensureCode(event, phase);
    const windowState = checkInWindowState(now, stored.windowOpensAt, stored.windowClosesAt);
    if (windowState !== 'ACTIVE' || stored.codeHash === '') {
      throw new ConflictException('Окно чек-ина не активно');
    }

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
      const amount = checkInShareAmount(event.dkpReward, phase, {
        startSharePct: this.settings.startSharePct,
        endSharePct: this.settings.endSharePct,
      });
      await this.db.dkpEntry.create({
        data: {
          memberId,
          type: 'CHECKIN_EARN',
          amount,
          eventId,
          comment: `Чек-ин ${phase === 'START' ? 'старт' : 'финал'}: код верный`,
        },
      });
    }

    return { result: status };
  }

  /** Расшифровка кода для показа РЛ; пусто/битое — null. */
  private reveal(stored: StoredCode): string | null {
    if (!stored.codeEnc) {
      return null;
    }
    return decryptCheckInCode(stored.codeEnc, this.encKeyHex);
  }

  /**
   * Текущая фаза по времени: START в [начало−N, конец), END в [конец, конец+N].
   * Досрочно запущенный END-код (план 2.2 п.5) перекрывает всё, включая
   * ещё не открывшееся стартовое окно: РЛ закончил раньше плана.
   */
  private async currentPhase(
    event: { id: string; startsAt: Date; endsAt: Date },
    now: Date,
  ): Promise<CheckInPhase | null> {
    const startBounds = phaseWindowBounds('START', event, this.settings);
    const endBounds = phaseWindowBounds('END', event, this.settings);
    if (now >= endBounds.windowOpensAt && now <= endBounds.windowClosesAt) {
      return 'END';
    }
    const earlyEnd = await this.db.checkInCode.findUnique({
      where: { eventId_phase: { eventId: event.id, phase: 'END' } },
    });
    if (
      earlyEnd &&
      earlyEnd.codeEnc !== '' &&
      now >= earlyEnd.windowOpensAt &&
      now <= earlyEnd.windowClosesAt
    ) {
      return 'END';
    }
    if (now >= startBounds.windowOpensAt && now < event.endsAt) {
      return 'START';
    }
    return null;
  }

  /**
   * Досрочный финальный код (план 2.2 п.5): РЛ закончил раньше плана —
   * кнопка запускает END-окно от текущего момента. Если плановое окно
   * уже открыто/прошло или код уже сгенерирован — 409 (нет смысла).
   * Возвращает код один раз — РЛ видит его на странице проведения.
   */
  async startEndCodeEarly(
    eventId: string,
    actor: EventsActor,
    actorRank: string | null,
  ): Promise<RaidLeadCheckInView> {
    const event = await this.mustGetEvent(eventId);
    const allowed =
      can(
        { rank: actorRank as never, isAdmin: actor.isAdmin, memberId: actor.memberId },
        'events.conduct',
        event,
      );
    if (!allowed) {
      throw new ForbiddenException('Досрочный код — РЛ ивента, Главе или Админу');
    }
    if (event.status === 'CANCELLED' || event.status === 'FINISHED') {
      throw new ConflictException('Ивент отменён или завершён');
    }

    const existing = await this.db.checkInCode.findUnique({
      where: { eventId_phase: { eventId: event.id, phase: 'END' } },
    });
    if (existing) {
      const windowState = checkInWindowState(this.clock(), existing.windowOpensAt, existing.windowClosesAt);
      if (windowState !== 'CLOSED') {
        throw new ConflictException('Финальный код уже сгенерирован');
      }
      // Прошедшее пустое окно можно пересоздать досрочным? Нет: плановое
      // окно уже было — «досрочным» его не сделать, это история.
      throw new ConflictException('Плановое финальное окно уже прошло');
    }

    const planned = phaseWindowBounds('END', event, this.settings);
    const now = this.clock();
    if (now >= planned.windowOpensAt) {
      throw new ConflictException('Плановое окно уже открылось — используйте обычный код');
    }

    // Досрочное окно: от сейчас, длительность — та же настройка
    const bounds = {
      windowOpensAt: new Date(now.getTime()),
      windowClosesAt: new Date(now.getTime() + this.settings.windowSec * 1000),
    };
    const { code, salt, codeHash } = newCodeWithHash();
    const stored: StoredCode = {
      codeHash,
      salt,
      codeEnc: encryptCheckInCode(code, this.encKeyHex),
      ...bounds,
    };
    await this.db.checkInCode.create({
      data: {
        eventId: event.id,
        phase: 'END',
        codeHash,
        salt,
        codeEnc: stored.codeEnc,
        windowOpensAt: bounds.windowOpensAt,
        windowClosesAt: bounds.windowClosesAt,
      },
    });
    return {
      phase: 'END',
      windowState: 'ACTIVE',
      code,
      windowOpensAt: bounds.windowOpensAt,
      windowClosesAt: bounds.windowClosesAt,
    };
  }

  /**
   * Ленивая генерация: код создаётся при первом обращении в его окне
   * (за N сек до начала / в момент планового окончания — план 2.2).
   * В БД: хэш с солью (сверка попыток) + AES-шифротекст (повторный
   * показ РЛ). Вне окна новый код не создаётся; без генерации — пустышка.
   */
  private async ensureCode(
    event: { id: string; startsAt: Date; endsAt: Date },
    phase: CheckInPhase,
  ): Promise<StoredCode> {
    const existing = await this.db.checkInCode.findUnique({
      where: { eventId_phase: { eventId: event.id, phase } },
    });
    if (existing) {
      return existing;
    }

    const bounds = phaseWindowBounds(phase, event, this.settings);
    const now = this.clock();
    if (now < bounds.windowOpensAt || now > bounds.windowClosesAt) {
      // Окно ещё не открылось или прошло без генерации — кода нет.
      return { codeHash: '', salt: '', codeEnc: '', ...bounds };
    }

    const { code, salt, codeHash } = newCodeWithHash();
    const stored: StoredCode = {
      codeHash,
      salt,
      codeEnc: encryptCheckInCode(code, this.encKeyHex),
      ...bounds,
    };
    await this.db.checkInCode.create({
      data: {
        eventId: event.id,
        phase,
        codeHash,
        salt,
        codeEnc: stored.codeEnc,
        windowOpensAt: bounds.windowOpensAt,
        windowClosesAt: bounds.windowClosesAt,
      },
    });
    return stored;
  }

  private async mustGetEvent(eventId: string) {
    const event = await this.db.event.findUnique({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException('Ивент не найден');
    }
    return event;
  }
}
