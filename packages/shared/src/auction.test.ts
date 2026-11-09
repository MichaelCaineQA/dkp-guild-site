import { describe, expect, it } from 'vitest';
import {
  assignWinnerSchema,
  bidFullCost,
  cancelLotSchema,
  checkBidAllowed,
  checkLotExtendAllowed,
  createDropSchema,
  createLotSchema,
  endsAtAfterBid,
  extendLotSchema,
  extendedEndsAt,
  hasAvailableBalance,
  isForeignBidder,
  lotDurationSec,
  lotExpired,
  minBidAmount,
  placeBidSchema,
  suggestLotDefaults,
  winningBid,
  type AuctionSettingValues,
  type BidLotParams,
} from './auction';

const SETTINGS: AuctionSettingValues = {
  step: 1,
  liveDurationSec: 60,
  longDurationDays: 2,
  antiSnipeLiveSec: 30,
  antiSnipeLongSec: 600,
  noBidTimeoutSec: 120,
  foreignClassMarkupPct: 50,
};

const LIVE_LOT = {
  startPrice: 100,
  step: 5,
  timerKind: 'FIRST_BID',
  durationValue: 1.5,
  durationUnit: 'MINUTES',
  antiSnipeSec: 30,
  noBidTimeoutSec: 120,
} as const;

describe('createLotSchema (issue #93)', () => {
  it('принимает живую раздачу с дробными минутами (90 сек)', () => {
    const parsed = createLotSchema.parse(LIVE_LOT);
    expect(lotDurationSec(parsed.durationValue, parsed.durationUnit)).toBe(90);
  });

  it('принимает длинный лот в днях без тайм-аута без ставок', () => {
    const parsed = createLotSchema.parse({
      ...LIVE_LOT,
      timerKind: 'OPENING',
      durationValue: 2,
      durationUnit: 'DAYS',
      antiSnipeSec: 600,
      noBidTimeoutSec: undefined,
    });
    expect(lotDurationSec(parsed.durationValue, parsed.durationUnit)).toBe(2 * 86_400);
  });

  it('живая раздача требует тайм-аут без ставок', () => {
    const result = createLotSchema.safeParse({ ...LIVE_LOT, noBidTimeoutSec: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('noBidTimeoutSec'))).toBe(true);
    }
  });

  it('живая раздача длиннее 600 сек отклоняется', () => {
    const result = createLotSchema.safeParse({ ...LIVE_LOT, durationValue: 11 });
    expect(result.success).toBe(false);
  });

  it('живая раздача короче 30 сек отклоняется', () => {
    const result = createLotSchema.safeParse({ ...LIVE_LOT, durationValue: 0.4 });
    expect(result.success).toBe(false);
  });

  it('длинный лот допускает минуты («лоты любой длительности»)', () => {
    const result = createLotSchema.safeParse({
      ...LIVE_LOT,
      timerKind: 'OPENING',
      durationValue: 90,
      durationUnit: 'MINUTES',
    });
    expect(result.success).toBe(true);
  });

  it('длинный лот длиннее 14 дней отклоняется', () => {
    const result = createLotSchema.safeParse({
      ...LIVE_LOT,
      timerKind: 'OPENING',
      durationValue: 15,
      durationUnit: 'DAYS',
    });
    expect(result.success).toBe(false);
  });

  it('некорректные значения: отрицательная цена, дробный шаг, нулевой шаг', () => {
    expect(createLotSchema.safeParse({ ...LIVE_LOT, startPrice: -1 }).success).toBe(false);
    expect(createLotSchema.safeParse({ ...LIVE_LOT, step: 0 }).success).toBe(false);
    expect(createLotSchema.safeParse({ ...LIVE_LOT, step: 2.5 }).success).toBe(false);
    expect(createLotSchema.safeParse({ ...LIVE_LOT, antiSnipeSec: 7201 }).success).toBe(false);
  });
});

describe('lotDurationSec', () => {
  it('переводит минуты и дни в секунды', () => {
    expect(lotDurationSec(1, 'MINUTES')).toBe(60);
    expect(lotDurationSec(1.5, 'MINUTES')).toBe(90);
    expect(lotDurationSec(2, 'DAYS')).toBe(172_800);
  });
});

describe('suggestLotDefaults (план 6, п. 1)', () => {
  it('стартовая цена — рекомендованная цена предмета', () => {
    const defaults = suggestLotDefaults({ defaultStartPrice: 120 }, SETTINGS);
    expect(defaults).toMatchObject({
      startPrice: 120,
      step: 1,
      markupPct: 50,
      live: { durationValue: 1, durationUnit: 'MINUTES', antiSnipeSec: 30, noBidTimeoutSec: 120 },
      long: { durationValue: 2, durationUnit: 'DAYS', antiSnipeSec: 600 },
    });
  });

  it('без рекомендованной цены стартует с 0', () => {
    expect(suggestLotDefaults({ defaultStartPrice: null }, SETTINGS).startPrice).toBe(0);
  });

  it('90 секунд живой раздачи показываются как 1,5 минуты', () => {
    const defaults = suggestLotDefaults(
      { defaultStartPrice: null },
      { ...SETTINGS, liveDurationSec: 90 },
    );
    expect(defaults.live.durationValue).toBe(1.5);
  });
});

describe('createDropSchema', () => {
  it('требует предмет', () => {
    expect(createDropSchema.safeParse({}).success).toBe(false);
    expect(createDropSchema.safeParse({ itemId: 'i-1' }).success).toBe(true);
  });
});

/* ---------------- Ставки, баланс и анти-снайп (issue #94) ---------------- */

const baseLot: BidLotParams = {
  status: 'OPEN',
  startPrice: 100,
  step: 5,
  timerKind: 'OPENING',
  durationSec: 90,
  antiSnipeSec: 30,
  antiSnipeExtendSec: 600,
  targetRoles: ['DPS'],
  markupPct: 50,
  firstBidAt: null,
  endsAt: null,
};

describe('minBidAmount', () => {
  it('первая ставка — не ниже стартовой цены', () => {
    expect(minBidAmount(baseLot, null)).toBe(100);
  });
  it('следующая — не ниже текущей плюс шаг', () => {
    expect(minBidAmount(baseLot, 100)).toBe(105);
  });
});

describe('placeBidSchema', () => {
  it('принимает целую неотрицательную ставку', () => {
    expect(placeBidSchema.parse({ amount: 0 }).amount).toBe(0);
  });
  it('отклоняет дробную, отрицательную и нечисловую', () => {
    expect(placeBidSchema.safeParse({ amount: 1.5 }).success).toBe(false);
    expect(placeBidSchema.safeParse({ amount: -1 }).success).toBe(false);
    expect(placeBidSchema.safeParse({ amount: 'x' }).success).toBe(false);
  });
});

describe('isForeignBidder', () => {
  it('«Все» — без наценки никому', () => {
    expect(isForeignBidder(['ALL'], 'TANK')).toBe(false);
    expect(isForeignBidder(['ALL'], null)).toBe(false);
  });
  it('«чужая» роль и отсутствие роли — наценка', () => {
    expect(isForeignBidder(['DPS'], 'TANK')).toBe(true);
    expect(isForeignBidder(['DPS'], null)).toBe(true);
    expect(isForeignBidder(['DPS'], 'DPS')).toBe(false);
    expect(isForeignBidder(['DPS', 'TANK'], 'TANK')).toBe(false);
  });
});

describe('bidFullCost', () => {
  it('«родной» класс платит ставку без наценки', () => {
    expect(bidFullCost(100, 50, false)).toBe(100);
  });
  it('наценка округляется до целого вверх', () => {
    expect(bidFullCost(101, 50, true)).toBe(152); // 151,5 → 152
    expect(bidFullCost(100, 50, true)).toBe(150);
    expect(bidFullCost(7, 0, true)).toBe(7);
  });
});

describe('hasAvailableBalance', () => {
  it('полная стоимость и заморозка по другим лотам не выше баланса', () => {
    expect(hasAvailableBalance(200, 50, 150)).toBe(true); // ровно граница
    expect(hasAvailableBalance(200, 50, 151)).toBe(false);
    expect(hasAvailableBalance(100, 0, 100)).toBe(true);
    expect(hasAvailableBalance(-10, 0, 1)).toBe(false);
  });
});

describe('checkBidAllowed', () => {
  const now = new Date('2026-11-09T20:00:00Z');
  it('отклоняет ставки на закрытый и отменённый лот', () => {
    expect(checkBidAllowed({ ...baseLot, status: 'CLOSED' }, null, 100, now)).toBe('LOT_NOT_OPEN');
    expect(checkBidAllowed({ ...baseLot, status: 'CANCELLED' }, null, 100, now)).toBe(
      'LOT_NOT_OPEN',
    );
  });
  it('ставка ровно в момент окончания уже не принимается', () => {
    const endsAt = new Date('2026-11-09T20:00:00Z');
    expect(checkBidAllowed({ ...baseLot, endsAt }, null, 100, now)).toBe('LOT_ENDED');
    expect(
      checkBidAllowed({ ...baseLot, endsAt: new Date(now.getTime() + 1) }, null, 100, now),
    ).toBeNull();
  });
  it('живая раздача до первой ставки принимает ставку без торгового таймера', () => {
    const live: BidLotParams = { ...baseLot, timerKind: 'FIRST_BID', endsAt: null };
    expect(checkBidAllowed(live, null, 100, now)).toBeNull();
  });
  it('ставка ниже минимальной отклоняется', () => {
    expect(checkBidAllowed(baseLot, null, 99, now)).toBe('BID_TOO_LOW');
    expect(checkBidAllowed(baseLot, 100, 104, now)).toBe('BID_TOO_LOW');
    expect(checkBidAllowed(baseLot, 100, 105, now)).toBeNull();
  });
});

describe('endsAtAfterBid', () => {
  const now = new Date('2026-11-09T20:00:00Z');
  it('первая ставка живой раздачи запускает таймер длительностью лота', () => {
    const live: BidLotParams = { ...baseLot, timerKind: 'FIRST_BID', endsAt: null };
    expect(endsAtAfterBid(live, now)?.getTime()).toBe(now.getTime() + 90_000);
  });
  it('последующие ставки живой раздачи не сдвигают окончание вне окна анти-снайпа', () => {
    const endsAt = new Date(now.getTime() + 60_000);
    const live: BidLotParams = {
      ...baseLot,
      timerKind: 'FIRST_BID',
      firstBidAt: now,
      endsAt,
    };
    expect(endsAtAfterBid(live, now)).toBe(endsAt);
  });
  it('ставка в окне анти-снайпа прибавляет продление к текущему окончанию', () => {
    // Пример из плана 6, п. 4: за 2 мин до конца при продлении 10 мин
    // окончание переносится на 12 мин от ставки.
    const endsAt = new Date(now.getTime() + 120_000);
    const lot: BidLotParams = {
      ...baseLot,
      antiSnipeSec: 600,
      antiSnipeExtendSec: 600,
      endsAt,
    };
    expect(endsAtAfterBid(lot, now)?.getTime()).toBe(now.getTime() + 720_000);
  });
  it('точная граница окна продлевает, за её пределами — нет', () => {
    const endsAt = new Date(now.getTime() + 30_000); // ровно окно 30 сек
    expect(endsAtAfterBid({ ...baseLot, endsAt }, now)?.getTime()).toBe(endsAt.getTime() + 600_000);
    const outside = new Date(now.getTime() + 30_001);
    expect(endsAtAfterBid({ ...baseLot, endsAt: outside }, now)).toBe(outside);
  });
  it('окно 0 отключает продление', () => {
    const endsAt = new Date(now.getTime() + 5_000);
    expect(endsAtAfterBid({ ...baseLot, antiSnipeSec: 0, endsAt }, now)).toBe(endsAt);
  });
});

describe('lotExpired и winningBid (issue #95)', () => {
  const createdAt = new Date('2026-11-09T20:00:00Z');

  it('длинный лот истекает ровно в endsAt', () => {
    const endsAt = new Date(createdAt.getTime() + 86_400_000);
    const lot = {
      timerKind: 'OPENING' as const,
      endsAt,
      firstBidAt: null,
      noBidTimeoutSec: null,
      createdAt,
    };
    expect(lotExpired(lot, new Date(endsAt.getTime() - 1))).toBe(false);
    expect(lotExpired(lot, endsAt)).toBe(true);
  });

  it('живая раздача без ставок истекает по тайм-ауту от создания', () => {
    const lot = {
      timerKind: 'FIRST_BID' as const,
      endsAt: null,
      firstBidAt: null,
      noBidTimeoutSec: 120,
      createdAt,
    };
    expect(lotExpired(lot, new Date(createdAt.getTime() + 119_999))).toBe(false);
    expect(lotExpired(lot, new Date(createdAt.getTime() + 120_000))).toBe(true);
  });

  it('живая раздача после первой ставки истекает по endsAt, а не по тайм-ауту', () => {
    const endsAt = new Date(createdAt.getTime() + 90_000);
    const lot = {
      timerKind: 'FIRST_BID' as const,
      endsAt,
      firstBidAt: createdAt,
      noBidTimeoutSec: 120,
      createdAt,
    };
    expect(lotExpired(lot, new Date(createdAt.getTime() + 89_999))).toBe(false);
    expect(lotExpired(lot, endsAt)).toBe(true);
  });

  it('длинный лот без endsAt не считается истёкшим', () => {
    const lot = {
      timerKind: 'OPENING' as const,
      endsAt: null,
      firstBidAt: null,
      noBidTimeoutSec: null,
      createdAt,
    };
    expect(lotExpired(lot, new Date(createdAt.getTime() + 999_999_999))).toBe(false);
  });

  it('победитель — автор максимальной ставки; пустой лот без победителя', () => {
    expect(winningBid([])).toBeNull();
    const bids = [
      { memberId: 'a', amount: 100 },
      { memberId: 'b', amount: 150 },
      { memberId: 'c', amount: 120 },
    ];
    expect(winningBid(bids)).toMatchObject({ memberId: 'b', amount: 150 });
  });
});

describe('Ручное управление лотом (issue #96, план 6, п. 8)', () => {
  const now = new Date('2027-03-03T18:00:00Z');
  const endsAt = new Date('2027-03-03T18:01:00Z');

  it('продлить можно только действующий лот с идущим таймером', () => {
    expect(checkLotExtendAllowed({ status: 'OPEN', endsAt }, now)).toBeNull();
    expect(checkLotExtendAllowed({ status: 'CLOSED', endsAt }, now)).toBe('LOT_NOT_OPEN');
    expect(checkLotExtendAllowed({ status: 'CANCELLED', endsAt }, now)).toBe('LOT_NOT_OPEN');
    // живая раздача до первой ставки — торгового таймера нет
    expect(checkLotExtendAllowed({ status: 'OPEN', endsAt: null }, now)).toBe('TIMER_NOT_STARTED');
    // истёкший лот закрывает обработчик — продлевать поздно
    expect(checkLotExtendAllowed({ status: 'OPEN', endsAt }, endsAt)).toBe('LOT_ENDING');
    expect(checkLotExtendAllowed({ status: 'OPEN', endsAt }, new Date(endsAt.getTime() + 1))).toBe(
      'LOT_ENDING',
    );
  });

  it('продление прибавляется к текущему окончанию', () => {
    expect(extendedEndsAt(endsAt, 60).getTime()).toBe(endsAt.getTime() + 60_000);
  });

  it('схема продления требует длительность и непустую причину', () => {
    expect(
      extendLotSchema.safeParse({ extendSec: 60, comment: '  нужна пара минут  ' }).success,
    ).toBe(true);
    expect(extendLotSchema.safeParse({ extendSec: 60, comment: '  ' }).success).toBe(false);
    expect(extendLotSchema.safeParse({ extendSec: 0, comment: 'причина' }).success).toBe(false);
    expect(extendLotSchema.safeParse({ extendSec: 60 }).success).toBe(false);
  });

  it('отмена и досрочное завершение требуют причину', () => {
    expect(cancelLotSchema.safeParse({ comment: 'предмет ошибочный' }).success).toBe(true);
    expect(cancelLotSchema.safeParse({ comment: '' }).success).toBe(false);
    expect(cancelLotSchema.safeParse({}).success).toBe(false);
  });

  it('ручной победитель: requestId, получатель, цена от 0 и причина', () => {
    const ok = {
      requestId: '00000000-0000-4000-8000-000000000000',
      winnerId: 'member-1',
      price: 0,
      comment: 'отдаём бесплатно',
    };
    expect(assignWinnerSchema.safeParse(ok).success).toBe(true);
    expect(assignWinnerSchema.safeParse({ ...ok, price: -1 }).success).toBe(false);
    expect(assignWinnerSchema.safeParse({ ...ok, winnerId: '' }).success).toBe(false);
    expect(assignWinnerSchema.safeParse({ ...ok, requestId: 'не-uuid' }).success).toBe(false);
    expect(assignWinnerSchema.safeParse({ ...ok, comment: '  ' }).success).toBe(false);
  });
});
