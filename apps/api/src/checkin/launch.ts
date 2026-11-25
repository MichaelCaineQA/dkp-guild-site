import {
  SETTING_DEFAULTS,
  activeCheckInPhase,
  manualWindowBounds,
  parseSettingValue,
  type CheckInPhase,
} from '@dkp/shared';
import type { EventsActor } from '../events/events.service';
import { encryptCheckInCode, newCodeWithHash } from './crypto';

/** Данные строки кода — одни и те же для создания и перезапуска закрытого окна. */
interface CheckInCodeData {
  codeHash: string;
  salt: string;
  /** Код, зашифрованный CHECKIN_ENC_KEY (открытым текстом не хранится). */
  codeEnc: string;
  windowOpensAt: Date;
  windowClosesAt: Date;
}

/**
 * Минимальный интерфейс транзакции, в которой открывается окно кода.
 * Это транзакция смены статуса ивента (events.service): окно открывается
 * вместе со статусом или не открывается вовсе.
 */
export interface CheckInLaunchDb {
  setting: {
    findUnique(args: {
      where: { key: string };
      select: { value: true };
    }): Promise<{ value: unknown } | null>;
  };
  checkInCode: {
    findUnique(args: {
      where: { eventId_phase: { eventId: string; phase: string } };
    }): Promise<{ windowOpensAt: Date; windowClosesAt: Date } | null>;
    upsert(args: {
      where: { eventId_phase: { eventId: string; phase: string } };
      create: CheckInCodeData & { eventId: string; phase: string };
      update: CheckInCodeData;
    }): Promise<unknown>;
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

/** Границы открытого окна — те же, что сохранены с кодом. */
export interface LaunchedCheckInCode {
  windowOpensAt: Date;
  windowClosesAt: Date;
}

/** Длительность окна из Setting; без строки — дефолт реестра. */
export async function readCheckInWindowSec(db: Pick<CheckInLaunchDb, 'setting'>): Promise<number> {
  const row = await db.setting.findUnique({
    where: { key: 'checkin.windowSec' },
    select: { value: true },
  });
  return row
    ? parseSettingValue('checkin.windowSec', row.value)
    : SETTING_DEFAULTS['checkin.windowSec'];
}

/**
 * Открыть окно кода фазы кнопкой «Начать ивент» / «Завершить ивент» (план 2.2,
 * решение №23): окно идёт от момента нажатия на `checkin.windowSec`, расписание
 * ивента на него не влияет. Сам код видит только запустивший — в БД остаются
 * хэш с солью для сверки попыток и шифротекст для повторного показа; в аудит
 * идёт факт запуска с автором, без кода.
 *
 * Уже открытое окно не трогаем: игроки вводят этот код прямо сейчас. Пройдшее
 * запускаем заново с новым кодом — так завершают ивенты, чей код остался от
 * автоматической генерации по расписанию.
 *
 * Вызывается только внутри транзакции смены статуса.
 */
export async function launchCheckInCode(
  tx: CheckInLaunchDb,
  eventId: string,
  phase: CheckInPhase,
  actor: EventsActor,
  now: Date,
  encKeyHex: string,
  windowSec: number,
): Promise<LaunchedCheckInCode> {
  const key = { eventId_phase: { eventId, phase } };
  const existing = await tx.checkInCode.findUnique({ where: key });
  if (existing && activeCheckInPhase(now, { [phase]: existing })) {
    return existing;
  }

  const bounds = manualWindowBounds(now, windowSec);
  const { code, salt, codeHash } = newCodeWithHash();
  const data: CheckInCodeData = {
    codeHash,
    salt,
    codeEnc: encryptCheckInCode(code, encKeyHex),
    ...bounds,
  };
  await tx.checkInCode.upsert({
    where: key,
    create: { eventId, phase, ...data },
    update: data,
  });
  await tx.auditLog.create({
    data: {
      actorMemberId: actor.memberId,
      actorIsAdmin: actor.isAdmin,
      action: 'CHECKIN_CODE_GENERATE',
      entityType: 'Event',
      entityId: eventId,
      comment: `Запущен ${phase === 'START' ? 'стартовый' : 'финальный'} код (окно до ${bounds.windowClosesAt.toISOString()})`,
    },
  });
  return bounds;
}
