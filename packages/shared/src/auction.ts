import { z } from 'zod';

/**
 * Открытый аукцион: дроп и создание лота (docs/PLAN.md, разделы 2.4 и 6,
 * issue #93). Управляющий ивента фиксирует выпавший предмет (LootDrop)
 * и создаёт из справочника открытый лот (Auction). Начальные значения лота —
 * из настроек аукциона и рекомендованной цены предмета, управляющий может
 * изменить их под конкретный лот.
 *
 * Два типа запуска таймера (план 6, п. 3):
 *  - «живая раздача» — таймер торгов от первой ставки, а без ставок лот
 *    закрывается по отдельному тайм-ауту;
 *  - «длинный лот» — отсчёт от открытия лота.
 */

/** Тип запуска таймера лота. */
export const LOT_TIMER_KINDS = ['FIRST_BID', 'OPENING'] as const;
export type LotTimerKind = (typeof LOT_TIMER_KINDS)[number];

export const LOT_TIMER_KIND_LABELS: Record<LotTimerKind, string> = {
  FIRST_BID: 'Живая раздача — таймер от первой ставки',
  OPENING: 'Длинный лот — таймер от открытия',
};

/** Единицы длительности лота в форме (приёмка #93: минуты и дни). */
export const LOT_DURATION_UNITS = ['MINUTES', 'DAYS'] as const;
export type LotDurationUnit = (typeof LOT_DURATION_UNITS)[number];

export const LOT_DURATION_UNIT_LABELS: Record<LotDurationUnit, string> = {
  MINUTES: 'мин',
  DAYS: 'дн',
};

/**
 * Границы полей лота. По длительности — как у связанных настроек реестра:
 * живая раздача 30–600 сек (auction.liveDurationSec), длинный лот до 14 дней
 * (auction.longDurationDays); «лоты любой длительности» (план 2.4) — длинный
 * лот можно задать и в минутах.
 */
export const LOT_LIMITS = {
  startPrice: { min: 0, max: 1_000_000 },
  step: { min: 1, max: 1_000 },
  liveDurationSec: { min: 30, max: 600 },
  longDurationSec: { min: 30, max: 14 * 86_400 },
  antiSnipeSec: { min: 0, max: 7_200 },
  antiSnipeExtendSec: { min: 0, max: 7_200 },
  noBidTimeoutSec: { min: 30, max: 3_600 },
} as const;

/** Длительность лота в секундах из пары «значение + единица». */
export function lotDurationSec(value: number, unit: LotDurationUnit): number {
  return Math.round(value * (unit === 'DAYS' ? 86_400 : 60));
}

const intField = (bounds: { min: number; max: number }, label: string) =>
  z
    .number({ invalid_type_error: `${label} — число` })
    .int(`${label} — целое число`)
    .min(bounds.min, `${label}: не меньше ${bounds.min}`)
    .max(bounds.max, `${label}: не больше ${bounds.max}`);

/**
 * Параметры нового лота (приёмка #93): предмет задаётся дропом, дальше —
 * стартовая цена, шаг, тип запуска таймера, длительность и анти-снайп.
 */
export const createLotSchema = z
  .object({
    startPrice: intField(LOT_LIMITS.startPrice, 'Стартовая цена'),
    step: intField(LOT_LIMITS.step, 'Шаг ставки'),
    timerKind: z.enum(LOT_TIMER_KINDS),
    durationValue: z
      .number({ invalid_type_error: 'Длительность — число' })
      .positive('Длительность больше нуля'),
    durationUnit: z.enum(LOT_DURATION_UNITS),
    antiSnipeSec: intField(LOT_LIMITS.antiSnipeSec, 'Анти-снайп (окно)'),
    /** Продление окончания при снайп-ставке; по умолчанию — из настроек. */
    antiSnipeExtendSec: intField(LOT_LIMITS.antiSnipeExtendSec, 'Анти-снайп (продление)')
      .nullish(),
    noBidTimeoutSec: intField(LOT_LIMITS.noBidTimeoutSec, 'Тайм-аут без ставок')
      .nullish(),
  })
  .superRefine((input, ctx) => {
    const sec = lotDurationSec(input.durationValue, input.durationUnit);
    const bounds =
      input.timerKind === 'FIRST_BID' ? LOT_LIMITS.liveDurationSec : LOT_LIMITS.longDurationSec;
    if (sec < bounds.min || sec > bounds.max) {
      const label = input.timerKind === 'FIRST_BID' ? 'живой раздачи' : 'длинного лота';
      ctx.addIssue({
        code: 'custom',
        path: ['durationValue'],
        message: `Длительность ${label}: от ${bounds.min} до ${bounds.max} сек`,
      });
    }
    if (input.timerKind === 'FIRST_BID' && input.noBidTimeoutSec == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['noBidTimeoutSec'],
        message: 'Для живой раздачи укажите тайм-аут без ставок',
      });
    }
  });
export type CreateLotInput = z.infer<typeof createLotSchema>;

/** Фиксация дропа: предмет из справочника. */
export const createDropSchema = z.object({
  itemId: z.string().min(1, 'Выберите предмет'),
});
export type CreateDropInput = z.infer<typeof createDropSchema>;

/** Настройки аукциона, влияющие на дефолты нового лота (реестр settings.ts). */
export interface AuctionSettingValues {
  step: number;
  liveDurationSec: number;
  longDurationDays: number;
  antiSnipeLiveSec: number;
  antiSnipeExtendLiveSec: number;
  antiSnipeLongSec: number;
  antiSnipeExtendLongSec: number;
  noBidTimeoutSec: number;
  foreignClassMarkupPct: number;
}

/** Начальные значения формы лота для обоих типов таймера (план 6, п. 1). */
export interface LotDefaults {
  startPrice: number;
  step: number;
  markupPct: number;
  live: {
    durationValue: number;
    durationUnit: 'MINUTES';
    antiSnipeSec: number;
    antiSnipeExtendSec: number;
    noBidTimeoutSec: number;
  };
  long: {
    durationValue: number;
    durationUnit: 'DAYS';
    antiSnipeSec: number;
    antiSnipeExtendSec: number;
  };
}

/**
 * Дефолты лота из настроек и предмета: стартовая цена — рекомендованная цена
 * справочника (иначе 0), остальное — из настроек аукциона. Длительность живой
 * раздачи отдаётся в минутах (60 сек → 1 мин, 90 сек → 1,5 мин).
 */
export function suggestLotDefaults(
  item: { defaultStartPrice: number | null },
  settings: AuctionSettingValues,
): LotDefaults {
  return {
    startPrice: item.defaultStartPrice ?? 0,
    step: settings.step,
    markupPct: settings.foreignClassMarkupPct,
    live: {
      durationValue: settings.liveDurationSec / 60,
      durationUnit: 'MINUTES',
      antiSnipeSec: settings.antiSnipeLiveSec,
      antiSnipeExtendSec: settings.antiSnipeExtendLiveSec,
      noBidTimeoutSec: settings.noBidTimeoutSec,
    },
    long: {
      durationValue: settings.longDurationDays,
      durationUnit: 'DAYS',
      antiSnipeSec: settings.antiSnipeLongSec,
      antiSnipeExtendSec: settings.antiSnipeExtendLongSec,
    },
  };
}

/** Статус лота (план 6, жизненный цикл). */
export type LotStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';

export const LOT_STATUS_LABELS: Record<LotStatus, string> = {
  OPEN: 'Открыт',
  CLOSED: 'Завершён',
  CANCELLED: 'Отменён',
};

/** Лот в строке дропа страницы проведения. */
export interface AuctionLotRow {
  id: string;
  status: LotStatus;
  startPrice: number;
  step: number;
  timerKind: LotTimerKind;
  durationSec: number;
  antiSnipeSec: number;
  /** Продление окончания при снайп-ставке (план 6, п. 4). */
  antiSnipeExtendSec: number;
  /** Тайм-аут закрытия без ставок — только у живой раздачи. */
  noBidTimeoutSec: number | null;
  /** Наценка «чужому» классу, зафиксированная при создании лота (план 6, п. 6). */
  markupPct: number;
  firstBidAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

/** Дроп ивента с лотом (если создан). */
export interface LootDropRow {
  id: string;
  eventId: string;
  itemId: string;
  itemName: string;
  rarity: string | null;
  slot: string | null;
  targetRoles: import('./items').ItemTargetRole[];
  createdAt: string;
  lot: AuctionLotRow | null;
}

/* ------------------------------------------------------------------ */
/* Ставки: открытый аукцион, баланс и анти-снайп (issue #94, план 6). */
/* ------------------------------------------------------------------ */

/** Параметры лота, от которых зависит приём ставок. */
export interface BidLotParams {
  status: LotStatus;
  startPrice: number;
  step: number;
  timerKind: LotTimerKind;
  durationSec: number;
  antiSnipeSec: number;
  /** Продление окончания при ставке в окне анти-снайпа (план 6, п. 4). */
  antiSnipeExtendSec: number;
  /** Замороженная разметка «кому нужна» (план 6, п. 6). */
  targetRoles: readonly import('./items').ItemTargetRole[];
  /** Замороженный процент наценки «чужому» классу (план 6, п. 6). */
  markupPct: number;
  firstBidAt: Date | null;
  endsAt: Date | null;
}

/** Новая ставка. */
export const placeBidSchema = z.object({
  amount: z
    .number({ invalid_type_error: 'Ставка — число' })
    .int('Ставка — целое число')
    .min(0, 'Ставка неотрицательная')
    .max(1_000_000, 'Ставка: не больше 1 000 000'),
});
export type PlaceBidInput = z.infer<typeof placeBidSchema>;

/**
 * Минимальная допустимая ставка (план 6, п. 2): первая — не ниже стартовой
 * цены, каждая следующая — не ниже текущей плюс шаг. currentMax — максимум
 * принятых ставок, null если ставок ещё не было.
 */
export function minBidAmount(lot: Pick<BidLotParams, 'startPrice' | 'step'>, currentMax: number | null): number {
  return currentMax === null ? lot.startPrice : currentMax + lot.step;
}

/**
 * «Чужой» класс для классовой наценки (план 6, п. 6): предмет без «Все»,
 * боевая роль игрока не входит в разметку лота. Игрок без роли в профиле
 * платит наценку — иначе наценку обходили бы снятием роли.
 * (Открытый вопрос #91 о вступивших после создания лота это не закрывает.)
 */
export function isForeignBidder(
  targetRoles: readonly import('./items').ItemTargetRole[],
  combatRole: 'DPS' | 'HEALER' | 'TANK' | null,
): boolean {
  if (targetRoles.includes('ALL')) return false;
  return combatRole === null || !targetRoles.includes(combatRole);
}

/**
 * Полная стоимость ставки с наценкой, округлённая до целого вверх
 * (план 6, п. 5 и 7). Именно она проверяется по балансу, замораживается
 * у лидера и списывается при победе.
 */
export function bidFullCost(amount: number, markupPct: number, foreign: boolean): number {
  return foreign ? Math.ceil((amount * (100 + markupPct)) / 100) : amount;
}

/**
 * Доступный баланс для новой ставки (план 6, п. 5): баланс минус замороженные
 * полные стоимости лидирующих ставок игрока на других открытых лотах.
 * Ставка принимается, если её полная стоимость не превышает доступный баланс.
 */
export function hasAvailableBalance(balance: number, frozen: number, fullCost: number): boolean {
  return balance - frozen >= fullCost;
}

/** Причина отказа ставки — для сообщений API и тестов. */
export type BidRejection =
  | 'LOT_NOT_OPEN' // лот закрыт или отменён
  | 'LOT_ENDED' // таймер торгов истёк (по серверному времени)
  | 'BID_TOO_LOW'; // ниже минимальной допустимой

/**
 * Проверка ставки по состоянию лота и времени сервера (план 6, п. 2–4):
 * принимаются только ставки на действующий лот в пределах серверного времени.
 * Живая раздача до первой ставки не ограничена торговым таймером (её закрывает
 * отдельный тайм-аут без ставок, обработчик — #95).
 */
export function checkBidAllowed(
  lot: BidLotParams,
  currentMax: number | null,
  amount: number,
  now: Date,
): BidRejection | null {
  if (lot.status !== 'OPEN') return 'LOT_NOT_OPEN';
  if (lot.endsAt !== null && now.getTime() >= lot.endsAt.getTime()) return 'LOT_ENDED';
  if (amount < minBidAmount(lot, currentMax)) return 'BID_TOO_LOW';
  return null;
}

/**
 * Новое окончание лота после принятой ставки (план 6, п. 3–4).
 * Живая раздача: первая ставка запускает торговый таймер длительностью
 * durationSec. Анти-снайп: ставка в пределах окна до конца лота, включая
 * точную границу, прибавляет продление к текущему окончанию. Ставка ровно
 * на границе окна (endsAt − now == окно) тоже продлевает.
 */
export function endsAtAfterBid(lot: BidLotParams, now: Date): Date | null {
  if (lot.timerKind === 'FIRST_BID' && lot.firstBidAt === null) {
    return new Date(now.getTime() + lot.durationSec * 1000);
  }
  if (lot.endsAt === null) return null;
  const remainingMs = lot.endsAt.getTime() - now.getTime();
  if (remainingMs <= lot.antiSnipeSec * 1000) {
    return new Date(lot.endsAt.getTime() + lot.antiSnipeExtendSec * 1000);
  }
  return lot.endsAt;
}

/** Ставка в открытой истории лота (план 6: ставки видны всем). */
export interface BidRow {
  id: string;
  auctionId: string;
  memberId: string;
  memberName: string;
  amount: number;
  /** Полная стоимость с наценкой на момент ставки (заморожена у лидера). */
  fullCost: number;
  /** Применённая наценка «чужому» классу, % (0 — «родной» класс). */
  markupPct: number;
  createdAt: string;
}

/** Результат принятой ставки: запись и новое окончание лота. */
export interface PlaceBidResult {
  bid: BidRow;
  endsAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Закрытие лота и автосписание (issue #95, план 6, п. 3, 7 и 9).      */
/* ------------------------------------------------------------------ */

/**
 * Истёк ли таймер лота по серверному времени (план 6, п. 3 и 7).
 * Длинный лот и живая раздача после первой ставки — по endsAt; живая раздача
 * без единой ставки — по отдельному тайм-ауту noBidTimeoutSec от создания.
 * Обработчик закрытия полагается на серверное время: после перезапуска
 * просроченные лоты закрываются при первом проходе.
 */
export function lotExpired(
  lot: Pick<BidLotParams, 'timerKind' | 'endsAt' | 'firstBidAt'> & {
    noBidTimeoutSec: number | null;
    createdAt: Date;
  },
  now: Date,
): boolean {
  if (lot.endsAt !== null) return now.getTime() >= lot.endsAt.getTime();
  if (
    lot.timerKind === 'FIRST_BID' &&
    lot.firstBidAt === null &&
    lot.noBidTimeoutSec !== null
  ) {
    return now.getTime() >= lot.createdAt.getTime() + lot.noBidTimeoutSec * 1000;
  }
  return false;
}

/**
 * Победитель лота — автор последней валидной ставки, т.е. максимальной
 * (план 6, п. 7). Суммы принятых ставок строго возрастают (каждая следующая —
 * не ниже текущей плюс шаг), поэтому максимум единственный; на равенство
 * остаётся более ранняя ставка. Пустой список — лот без ставок: победителя
 * и расхода нет (план 6, п. 9).
 */
export function winningBid<T extends { amount: number }>(bids: readonly T[]): T | null {
  return bids.reduce<T | null>(
    (best, bid) => (best === null || bid.amount > best.amount ? bid : best),
    null,
  );
}

/** Итог закрытия лота: кто получил предмет и сколько списано с него. */
export interface LotCloseResult {
  closed: boolean;
  /** Лот уже был закрыт/отменён или таймер ещё не истёк. */
  skipped: boolean;
  winner: { memberId: string; memberName: string; finalPrice: number; markupPct: number } | null;
}
