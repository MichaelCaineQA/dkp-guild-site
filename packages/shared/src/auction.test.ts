import { describe, expect, it } from 'vitest';
import {
  createDropSchema,
  createLotSchema,
  lotDurationSec,
  suggestLotDefaults,
  type AuctionSettingValues,
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
