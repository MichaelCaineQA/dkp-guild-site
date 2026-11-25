import { z } from 'zod';

/**
 * Чек-ин кодами (issue #9, план 2.2, решение гильдии №7): отметка
 * посещения трёхзначным кодом, окно выбора, одна попытка, 50/50 платы.
 * Окна кодов открывают управляющие кнопками «Начать ивент» и «Завершить
 * ивент» (решение №23): расписание ивента на них не влияет.
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
 *
 * Инвариант (аудит F01): сумма двух фаз всегда равна плате. Стартовая доля
 * округляется вниз, финальная — остаток: нечётная плата не завышает журнал,
 * а «ушёл раньше» никогда не получает больше половины (лишний балл —
 * досидевшим до финального кода). При малой плате стартовая доля может
 * быть нулевой — записи журнала на 0 не создаются.
 */
export function checkInShareAmount(
  dkpReward: number,
  phase: CheckInPhase,
  shares: { startSharePct: number; endSharePct: number },
): number {
  if (shares.startSharePct <= 0 || shares.endSharePct <= 0) {
    throw new Error('Доли платы должны быть положительными');
  }
  const startAmount = Math.floor((dkpReward * shares.startSharePct) / 100);
  return phase === 'START' ? startAmount : dkpReward - startAmount;
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
 * Окно, которое открывает управляющий кнопкой «Начать ивент» / «Завершить
 * ивент» (план 2.2, решение №23): от момента нажатия на windowSec.
 */
export function manualWindowBounds(now: Date, windowSec: number): CheckInWindowBounds {
  return {
    windowOpensAt: new Date(now.getTime()),
    windowClosesAt: new Date(now.getTime() + windowSec * 1000),
  };
}

/** Коды ивента по фазам; фазы без кода нет среди ключей. */
export type CheckInCodes = Partial<Record<CheckInPhase, CheckInWindowBounds>>;

/**
 * Фаза, окно которой открыто прямо сейчас; null — открытых окон нет.
 * Финал перекрывает старт: завершили раньше времени — игроки, не успевшие
 * в стартовое окно, отмечаются финальным кодом.
 */
export function activeCheckInPhase(now: Date, codes: CheckInCodes): CheckInPhase | null {
  const end = codes.END;
  if (end && checkInWindowState(now, end.windowOpensAt, end.windowClosesAt) === 'ACTIVE') {
    return 'END';
  }
  const start = codes.START;
  if (start && checkInWindowState(now, start.windowOpensAt, start.windowClosesAt) === 'ACTIVE') {
    return 'START';
  }
  return null;
}

/** Фаза и состояние окна для показа: игроку — что можно ввести, управляющему — какой код называть. */
export interface CheckInPhaseView {
  phase: CheckInPhase;
  windowState: CheckInWindowState;
  /** Границы сохранённого кода; null — код этой фазы ещё не запускали. */
  window: CheckInWindowBounds | null;
}

/**
 * Какую фазу показывать в текущий момент. Приоритет у финального кода —
 * он закрывает ивент. Кодов нет: у завершённого ивента окно финала закрыто,
 * у остальных стартовый код ещё не запускали («Начать ивент» откроет его).
 */
export function checkInPhaseView(now: Date, status: string, codes: CheckInCodes): CheckInPhaseView {
  const view = (phase: CheckInPhase, window: CheckInWindowBounds): CheckInPhaseView => ({
    phase,
    windowState: checkInWindowState(now, window.windowOpensAt, window.windowClosesAt),
    window,
  });
  if (codes.END) return view('END', codes.END);
  if (codes.START) return view('START', codes.START);
  return status === 'FINISHED'
    ? { phase: 'END', windowState: 'CLOSED', window: null }
    : { phase: 'START', windowState: 'NOT_OPEN_YET', window: null };
}
