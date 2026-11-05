import { z } from 'zod';

/**
 * Чек-ин кодами (issue #9, план 2.2, решение гильдии №7): отметка
 * посещения трёхзначным кодом, окно выбора, одна попытка, 50/50 платы.
 *
 * Схема хранения (план 2.2 «хранится только хэш»): в БД — хэш-подпись
 * для сверки попыток (salt+sha256) и код, зашифрованный AES-256-GCM
 * (ключ env CHECKIN_ENC_KEY) для повторного показа РЛ. Криптография
 * (node:crypto) живёт в apps/api/src/checkin/crypto.ts — shared
 * остаётся без node-зависимостей; здесь правила и чистая логика окон.
 */

/** Трёхзначный код: 100–999, без ведущих нулей (план 2.2). */
export const CHECKIN_CODE_PATTERN = /^\d{3}$/;

/** Фазы чек-ина: старт и финал (план 2.2). */
export const CHECKIN_PHASES = ['START', 'END'] as const;
export type CheckInPhase = (typeof CHECKIN_PHASES)[number];

/** Состояние отметки игрока в фазе (перечисление CheckInStatus в Prisma). */
export const CHECKIN_STATUSES = [
  'PENDING',
  'ACTIVE',
  'PASSED',
  'FAILED',
  'EXPIRED',
  'MANUAL',
] as const;
export type CheckInStatus = (typeof CHECKIN_STATUSES)[number];

/** Настройки окна чек-ина (из Setting, дефолты — план 2.2 / решение №7). */
export interface CheckInWindowConfig {
  /** За сколько до начала генерируется стартовый код, сек. */
  generateBeforeStartSec: number;
  /** Длительность окна выбора, сек. */
  windowSec: number;
}

/**
 * Статус окна фазы для игрока/РЛ: ещё не открылось / открыто / закрыто.
 * Чистая функция от текущего момента.
 */
export type CheckInWindowState = 'NOT_OPEN_YET' | 'ACTIVE' | 'CLOSED';

export function checkInWindowState(
  now: Date,
  windowOpensAt: Date,
  windowClosesAt: Date,
): CheckInWindowState {
  const t = now.getTime();
  if (t < windowOpensAt.getTime()) {
    return 'NOT_OPEN_YET';
  }
  return t <= windowClosesAt.getTime() ? 'ACTIVE' : 'CLOSED';
}

/**
 * Доля платы за фазу (решение №7: 50/50). Использует настройки
 * checkin.startSharePct / endSharePct, но сумма долей обязана быть 100%.
 */
export function checkInShareAmount(
  dkpReward: number,
  phase: CheckInPhase,
  shares: { startSharePct: number; endSharePct: number },
): number {
  const pct = phase === 'START' ? shares.startSharePct : shares.endSharePct;
  const amount = Math.round((dkpReward * pct) / 100);
  if (amount <= 0) {
    throw new Error('Доля платы должна быть положительной');
  }
  return amount;
}

/** Заявка игрока: выбранный из 4 код (строка 100–999). */
export const submitCheckInSchema = z.object({
  code: z.string().regex(CHECKIN_CODE_PATTERN, 'Код — трёхзначное число'),
});
export type SubmitCheckInInput = z.infer<typeof submitCheckInSchema>;

/** Окно из БД → когда открывается/закрывается для фазы. */
export interface CheckInWindowBounds {
  windowOpensAt: Date;
  windowClosesAt: Date;
}

/**
 * Границы окна по расписанию ивента (план 2.2):
 * стартовый код — за N сек до начала ивента, окно N сек;
 * финальный — в момент планового окончания, окно N сек.
 */
export function phaseWindowBounds(
  phase: CheckInPhase,
  event: { startsAt: Date; endsAt: Date },
  config: CheckInWindowConfig,
): CheckInWindowBounds {
  if (phase === 'START') {
    const opens = new Date(event.startsAt.getTime() - config.generateBeforeStartSec * 1000);
    return {
      windowOpensAt: opens,
      windowClosesAt: new Date(opens.getTime() + config.windowSec * 1000),
    };
  }
  return {
    windowOpensAt: event.endsAt,
    windowClosesAt: new Date(event.endsAt.getTime() + config.windowSec * 1000),
  };
}
