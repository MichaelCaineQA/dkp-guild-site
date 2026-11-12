import { z } from 'zod';
import type { ItemTargetRole } from './items';

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
const lotParamsObject = z.object({
  startPrice: intField(LOT_LIMITS.startPrice, 'Стартовая цена'),
  step: intField(LOT_LIMITS.step, 'Шаг ставки'),
  timerKind: z.enum(LOT_TIMER_KINDS),
  durationValue: z
    .number({ invalid_type_error: 'Длительность — число' })
    .positive('Длительность больше нуля'),
  durationUnit: z.enum(LOT_DURATION_UNITS),
  antiSnipeSec: intField(LOT_LIMITS.antiSnipeSec, 'Анти-снайп (окно)'),
  /** Продление окончания при снайп-ставке; по умолчанию — из настроек. */
  antiSnipeExtendSec: intField(LOT_LIMITS.antiSnipeExtendSec, 'Анти-снайп (продление)').nullish(),
  noBidTimeoutSec: intField(LOT_LIMITS.noBidTimeoutSec, 'Тайм-аут без ставок').nullish(),
});

const refineLotParams = (
  input: z.infer<typeof lotParamsObject>,
  ctx: z.RefinementCtx,
): void => {
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
};

export const createLotSchema = lotParamsObject.superRefine(refineLotParams);
export type CreateLotInput = z.infer<typeof createLotSchema>;

/**
 * Лот вне ивента — «хранилище гильдии» (#137): предмет выбирается явно
 * в той же форме, параметры и границы — как у лота по дропу (план 2.4).
 */
export const createStandaloneLotSchema = lotParamsObject
  .extend({ itemId: z.string().min(1, 'Выберите предмет') })
  .superRefine(refineLotParams);
export type CreateStandaloneLotInput = z.infer<typeof createStandaloneLotSchema>;

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
  preferredItemDiscountPct: number;
}

/** Начальные значения формы лота для обоих типов таймера (план 6, п. 1). */
export interface LotDefaults {
  startPrice: number;
  step: number;
  markupPct: number;
  /** Скидка за предпочитаемый предмет — снимок настройки (решение 18). */
  discountPct: number;
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
    discountPct: settings.preferredItemDiscountPct,
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
  /** Скидка за предпочитаемый предмет, зафиксированная при создании лота (решение 18). */
  discountPct: number;
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
export function minBidAmount(
  lot: Pick<BidLotParams, 'startPrice' | 'step'>,
  currentMax: number | null,
): number {
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
 * Полная стоимость ставки с наценкой и скидкой за предпочитаемый предмет,
 * округлённая до целого вверх (план 6, п. 5 и 7; решение 18). Сначала
 * применяется наценка «чужому» классу, затем от наценной цены — скидка;
 * округление — одно, в конце. Именно эта сумма проверяется по балансу,
 * замораживается у лидера и списывается при победе.
 */
export function bidFullCost(
  amount: number,
  markupPct: number,
  foreign: boolean,
  discountPct = 0,
): number {
  const markedUp = foreign ? (amount * (100 + markupPct)) / 100 : amount;
  return discountPct > 0 ? Math.ceil((markedUp * (100 - discountPct)) / 100) : Math.ceil(markedUp);
}

/**
 * Роль и предпочитаемый предмет на момент создания лота (план 6, п. 6;
 * решение 18): смена класса или предпочтения после создания лота цену лота
 * не меняет. Member хранит текущее и предыдущее значение с датой смены;
 * кулдаун смены (auction.profileChangeCooldownDays, дефолт 14 дней) длиннее
 * максимального лота (14 дней), поэтому за жизнь лота поле меняется
 * не более одного раза и предыдущего значения достаточно.
 */
export interface BidderSnapshotFields {
  combatRole: 'DPS' | 'HEALER' | 'TANK' | null;
  prevCombatRole: 'DPS' | 'HEALER' | 'TANK' | null;
  combatRoleChangedAt: Date | null;
  preferredItemId: string | null;
  prevPreferredItemId: string | null;
  preferredItemChangedAt: Date | null;
}

/** Боевая роль игрока, действовавшая на момент создания лота. */
export function roleAtLotCreation(
  member: Pick<BidderSnapshotFields, 'combatRole' | 'prevCombatRole' | 'combatRoleChangedAt'>,
  lotCreatedAt: Date,
): 'DPS' | 'HEALER' | 'TANK' | null {
  const changedAfter =
    member.combatRoleChangedAt !== null &&
    member.combatRoleChangedAt.getTime() > lotCreatedAt.getTime();
  return changedAfter ? member.prevCombatRole : member.combatRole;
}

/** Предпочитался ли этот предмет игроком на момент создания лота. */
export function prefersItemAtLotCreation(
  member: Pick<
    BidderSnapshotFields,
    'preferredItemId' | 'prevPreferredItemId' | 'preferredItemChangedAt'
  >,
  lotCreatedAt: Date,
  itemId: string,
): boolean {
  const changedAfter =
    member.preferredItemChangedAt !== null &&
    member.preferredItemChangedAt.getTime() > lotCreatedAt.getTime();
  const preferredThen = changedAfter ? member.prevPreferredItemId : member.preferredItemId;
  return preferredThen === itemId;
}

/**
 * Разрешена ли смена боевой роли / предпочитаемого предмета сейчас
 * (план 2.5, решение 18): не чаще раза в cooldownDays, у каждого поля свой
 * отсчёт; первый выбор (поле никогда не менялось) — сразу.
 */
export function canChangeProfileField(
  changedAt: Date | null,
  cooldownDays: number,
  now: Date,
): boolean {
  if (changedAt === null) return true;
  return now.getTime() - changedAt.getTime() >= cooldownDays * 86_400_000;
}

/**
 * Доступный баланс для новой ставки (план 6, п. 5): баланс минус замороженные
 * полные стоимости лидирующих ставок игрока на других открытых лотах.
 * Ставка принимается, если её полная стоимость не превышает доступный баланс.
 */
export function hasAvailableBalance(balance: number, frozen: number, fullCost: number): boolean {
  return balance - frozen >= fullCost;
}

/**
 * Замороженные средства игрока (план 6, п. 5; issue #81): сумма полных
 * стоимостей его ЛИДИРУЮЩИХ ставок на открытых лотах. Для каждого лота
 * учитывается только актуальная ведущая ставка (максимум по amount), а не
 * вся история ставок: перебитая собственная ставка исключается
 * автоматически, повышение собственной заменяет старую сумму. fullCost уже
 * содержит применимые наценку и скидку (снимок на момент ставки);
 * отменённые и завершённые лоты в список открытых не попадают.
 */
export function frozenAmount(
  memberId: string,
  openLots: ReadonlyArray<{
    id: string;
    bids: ReadonlyArray<Pick<BidRow, 'memberId' | 'amount' | 'fullCost'>>;
  }>,
): number {
  let frozen = 0;
  for (const lot of openLots) {
    const top = winningBid(lot.bids);
    if (top && top.memberId === memberId) frozen += top.fullCost;
  }
  return frozen;
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
  /** Полная стоимость с наценкой и скидкой на момент ставки (заморожена у лидера). */
  fullCost: number;
  /** Применённая наценка «чужому» классу, % (0 — «родной» класс). */
  markupPct: number;
  /** Применённая скидка за предпочитаемый предмет, % (0 — не предпочитался). */
  discountPct: number;
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
  if (lot.timerKind === 'FIRST_BID' && lot.firstBidAt === null && lot.noBidTimeoutSec !== null) {
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
  winner: {
    memberId: string;
    memberName: string;
    finalPrice: number;
    markupPct: number;
    discountPct: number;
  } | null;
}

/* ------------------------------------------------------------------ */
/* Ручное управление лотом (issue #96, план 6, п. 8–10).               */
/* ------------------------------------------------------------------ */

/** Границы ручных действий с лотом. */
export const LOT_MANAGE_LIMITS = {
  extendSec: { min: 10, max: 14 * 86_400 },
  price: { min: 0, max: 1_000_000 },
  comment: { min: 3, max: 500 },
} as const;

/** Причина ручного действия — обязательна и попадает в аудит (план 6, п. 8). */
const reasonField = z
  .string({ invalid_type_error: 'Причина — текст' })
  .trim()
  .min(LOT_MANAGE_LIMITS.comment.min, 'Укажите причину действия')
  .max(LOT_MANAGE_LIMITS.comment.max, 'Причина: не длиннее 500 символов');

/** Продление действующего лота — управляющим ивента (план 6, п. 8). */
export const extendLotSchema = z.object({
  extendSec: intField(LOT_MANAGE_LIMITS.extendSec, 'Продление'),
  comment: reasonField,
});
export type ExtendLotInput = z.infer<typeof extendLotSchema>;

/** Отмена действующего лота — управляющим ивента (план 6, п. 8). */
export const cancelLotSchema = z.object({ comment: reasonField });
export type CancelLotInput = z.infer<typeof cancelLotSchema>;

/**
 * Досрочное завершение лота — Глава/Админ (план 6, п. 8): победителем
 * становится автор ведущей ставки, списание — как при обычном закрытии.
 */
export const closeLotEarlySchema = z.object({ comment: reasonField });
export type CloseLotEarlyInput = z.infer<typeof closeLotEarlySchema>;

/**
 * Ручной победитель — Глава/Админ (план 6, п. 8): получатель — любой игрок,
 * цена произвольная, включая 0, без наценки и без скидки за предпочитаемый
 * предмет; списание сразу и может увести баланс в минус. requestId фиксирует
 * повтор запроса: возврат прежнему победителю и списание с нового
 * не выполняются дважды.
 */
export const assignWinnerSchema = z.object({
  requestId: z.string().uuid('Повторите действие — некорректный идентификатор запроса'),
  winnerId: z.string().min(1, 'Выберите получателя'),
  price: intField(LOT_MANAGE_LIMITS.price, 'Цена'),
  comment: reasonField,
});
export type AssignWinnerInput = z.infer<typeof assignWinnerSchema>;

/** Причина отказа в продлении лота. */
export type LotExtendRejection =
  | 'LOT_NOT_OPEN' // лот закрыт или отменён
  | 'TIMER_NOT_STARTED' // живая раздача до первой ставки — торгового таймера нет
  | 'LOT_ENDING'; // таймер истёк — лот закрывается обработчиком

/**
 * Продлить можно только действующий лот с запущенным таймером (план 6, п. 8):
 * живая раздача до первой ставки таймером торгов не ограничена, а истёкший
 * лот закрывает обработчик #95 — продлевать его уже поздно.
 */
export function checkLotExtendAllowed(
  lot: Pick<BidLotParams, 'status' | 'endsAt'>,
  now: Date,
): LotExtendRejection | null {
  if (lot.status !== 'OPEN') return 'LOT_NOT_OPEN';
  if (lot.endsAt === null) return 'TIMER_NOT_STARTED';
  if (now.getTime() >= lot.endsAt.getTime()) return 'LOT_ENDING';
  return null;
}

/** Новое окончание после ручного продления: время прибавляется к текущему концу. */
export function extendedEndsAt(endsAt: Date, extendSec: number): Date {
  return new Date(endsAt.getTime() + extendSec * 1000);
}

/** Выдача лота в строках лута и аудита. */
export interface LotAwardRow {
  memberId: string;
  memberName: string;
  finalPrice: number;
  /** Наценка в цене выдачи: 0 — «родной» класс или ручное назначение. */
  markupPct: number;
  /** Скидка за предпочитаемый предмет в цене выдачи: 0 — не предпочитался. */
  discountPct: number;
}

/** Результат ручных действий с лотом для UI. */
export interface LotManageResult {
  lot: AuctionLotRow;
  /** Победитель после действия (null — лот закрыт без победителя или отменён). */
  winner: LotAwardRow | null;
  /** Возврат прежнему победителю при смене (план 6, п. 8). */
  refund: { memberId: string; memberName: string; amount: number } | null;
  /** Повтор уже выполненного запроса — данные не менялись. */
  repeated: boolean;
}

/* ------------------------------------------------------------------ */
/* Realtime аукциона (issue #97, план §7): Socket.IO + Redis adapter.  */
/* Источник истины — сервер; события несут серверное время для таймера. */
/* ------------------------------------------------------------------ */

/** Имена событий Socket.IO — единые для API и веб-клиента. */
export const AUCTION_SOCKET_EVENTS = {
  /** Клиент → сервер: подписка на лот (ответ — auction:state). */
  join: 'auction:join',
  /** Сервер → клиент: полный срез состояния лота (подписка/переподключение). */
  state: 'auction:state',
  /** Принятая ставка (включая новое окончание при анти-снайпе). */
  bid: 'auction:bid',
  /** Изменение лота без закрытия: продление, смена победителя вручную. */
  lot: 'auction:lot',
  /** Лот закрыт/отменён: подписчикам лота и общему каналу списка. */
  closed: 'auction:closed',
  /** Новый лот создан — общий канал списка лотов. */
  created: 'auction:created',
} as const;

/** Причина закрытия лота в событии auction:closed. */
export type AuctionCloseReason = 'EXPIRED' | 'CANCELLED' | 'EARLY' | 'ASSIGNED';

/** Событие принятой ставки: ставка и актуальное окончание лота. */
export interface AuctionBidEvent {
  auctionId: string;
  bid: BidRow;
  endsAt: string | null;
  serverTime: string;
}

/** Событие изменения лота: продление или ручное назначение победителя. */
export interface AuctionLotEvent {
  auctionId: string;
  lot: AuctionLotRow;
  /** Победитель после действия (null — не менялся/лот без выдачи). */
  winner: LotAwardRow | null;
  serverTime: string;
}

/** Событие закрытия лота (канал списка); комнате лота шлётся свежий срез. */
export interface AuctionClosedEvent {
  auctionId: string;
  winner: LotAwardRow | null;
  reason: AuctionCloseReason;
  serverTime: string;
}

/** Событие создания лота (канал списка). */
export interface AuctionCreatedEvent {
  lot: AuctionLotRow;
  serverTime: string;
}

/** Полный срез состояния лота — ответ на подписку и переподключение. */
export interface AuctionLiveState {
  lot: AuctionLotRow;
  bids: BidRow[];
  /** Выдача завершённого лота (null — открыт или без выдачи). */
  winner: LotAwardRow | null;
  serverTime: string;
}

/* ------------------------------------------------------------------ */
/* Список лотов экрана аукциона и виджет «Мой аукцион» (issue #98).    */
/* ------------------------------------------------------------------ */

/** Вкладка списка лотов (план 6, п. 10). */
export const AUCTION_LIST_STATUSES = ['OPEN', 'CLOSED', 'CANCELLED'] as const;
export type AuctionListStatus = (typeof AUCTION_LIST_STATUSES)[number];

/** Ведущая ставка лота для списка. */
export interface AuctionTopBid {
  memberId: string;
  memberName: string;
  amount: number;
  /** Полная стоимость ведущей ставки (с наценкой, если применимо). */
  fullCost: number;
}

/** Ставка просматривающего игрока на лоте. */
export interface AuctionMyBid {
  amount: number;
  /** true — ставка просматривающего сейчас ведущая. */
  leading: boolean;
}

/** Строка лота на вкладках аукциона (экран #98). */
export interface AuctionListRow {
  id: string;
  status: LotStatus;
  itemName: string;
  rarity: string | null;
  targetRoles: ItemTargetRole[];
  startPrice: number;
  step: number;
  markupPct: number;
  /** Скидка за предпочитаемый предмет, зафиксированная при создании лота. */
  discountPct: number;
  /** Предмет лота — предпочитаемый просматривающим на момент создания лота. */
  myPreferred: boolean;
  timerKind: LotTimerKind;
  antiSnipeSec: number;
  antiSnipeExtendSec: number;
  noBidTimeoutSec: number | null;
  firstBidAt: string | null;
  endsAt: string | null;
  createdAt: string;
  topBid: AuctionTopBid | null;
  myBid: AuctionMyBid | null;
  winner: LotAwardRow | null;
}

/** Строка запроса списка лотов (экран #98). */
export const auctionsQuerySchema = z.object({
  status: z.enum(AUCTION_LIST_STATUSES).default('OPEN'),
});
export type AuctionsQuery = z.infer<typeof auctionsQuerySchema>;

/* ------------------------------------------------------------------ */
/* Кошелёк дашборда: баланс и замороженные очки (issue #81, план 2.8   */
/* и 6 п. 5).                                                          */
/* ------------------------------------------------------------------ */

/** Лот, составляющий заморозку кошелька: ожидаемое списание при победе. */
export interface WalletLotRow {
  lotId: string;
  itemName: string;
  /** Полная стоимость ведущей ставки игрока (наценка и скидка уже внутри). */
  fullCost: number;
  endsAt: string | null;
}

/**
 * «Мой кошелёк» (план 2.8, 6 п. 5): фактический баланс append-only журнала
 * и ожидаемые списания по открытым лотам, где игрок ведёт. Ставки ничего
 * не списывают заранее — журнал меняется только при фактическом завершении
 * лота, поэтому ожидание победы расходной записи не создаёт.
 */
export interface MemberWallet {
  /** Фактическая сумма журнала ДКП (computeBalance), без списания ставок. */
  balance: number;
  /** Ожидаемые списания: сумма полных стоимостей ведущих ставок (frozenAmount). */
  frozen: number;
  /** Баланс минус заморожено — предел полной стоимости новой ставки. */
  available: number;
  /** Открытые лоты, где игрок ведёт, — по ближайшему окончанию. */
  lots: WalletLotRow[];
}
