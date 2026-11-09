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
    antiSnipeSec: intField(LOT_LIMITS.antiSnipeSec, 'Анти-снайп'),
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
  antiSnipeLongSec: number;
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
    noBidTimeoutSec: number;
  };
  long: {
    durationValue: number;
    durationUnit: 'DAYS';
    antiSnipeSec: number;
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
      noBidTimeoutSec: settings.noBidTimeoutSec,
    },
    long: {
      durationValue: settings.longDurationDays,
      durationUnit: 'DAYS',
      antiSnipeSec: settings.antiSnipeLongSec,
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
