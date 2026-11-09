import { describe, expect, it } from 'vitest';
import {
  AUCTION_SETTINGS,
  CHECKIN_SETTINGS,
  SETTINGS_REGISTRY,
  SETTING_DEFAULTS,
  gameTimeSettingsSchema,
  parseSettingValue,
  updateSettingsSchema,
} from './settings';

describe('SETTINGS_REGISTRY', () => {
  it('все настройки из плана 2.2/2.3/6 присутствуют (15 ключей)', () => {
    expect(Object.keys(SETTINGS_REGISTRY).sort()).toEqual(
      [
        'checkin.generateBeforeStartSec',
        'checkin.windowSec',
        'checkin.attempts',
        'checkin.startSharePct',
        'checkin.endSharePct',
        'absence.deadlineBeforeStartSec',
        'auction.step',
        'auction.liveDurationSec',
        'auction.longDurationDays',
        'auction.antiSnipeLiveSec',
        'auction.antiSnipeExtendLiveSec',
        'auction.antiSnipeLongSec',
        'auction.antiSnipeExtendLongSec',
        'auction.foreignClassMarkupPct',
        'auction.noBidTimeoutSec',
      ].sort(),
    );
  });

  it('у каждой настройки есть схема, подпись и ссылка на план', () => {
    for (const [key, meta] of Object.entries(SETTINGS_REGISTRY)) {
      expect(meta.schema, key).toBeDefined();
      expect(meta.label.length, key).toBeGreaterThan(3);
      expect(meta.plan.length, key).toBeGreaterThan(0);
    }
  });

  it('дефолты проходят собственные схемы', () => {
    for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
      expect(() => parseSettingValue(key, value), key).not.toThrow();
    }
  });

  it('дефолты соответствуют плану (окна 3 мин, 50/50, шаг 1, наценка 50%)', () => {
    expect(SETTING_DEFAULTS['checkin.generateBeforeStartSec']).toBe(180);
    expect(SETTING_DEFAULTS['checkin.windowSec']).toBe(180);
    expect(SETTING_DEFAULTS['checkin.attempts']).toBe(1);
    expect(SETTING_DEFAULTS['checkin.startSharePct']).toBe(50);
    expect(SETTING_DEFAULTS['checkin.endSharePct']).toBe(50);
    expect(SETTING_DEFAULTS['absence.deadlineBeforeStartSec']).toBe(180);
    expect(SETTING_DEFAULTS['auction.step']).toBe(1);
    expect(SETTING_DEFAULTS['auction.liveDurationSec']).toBe(60);
    expect(SETTING_DEFAULTS['auction.longDurationDays']).toBe(2);
    expect(SETTING_DEFAULTS['auction.antiSnipeLiveSec']).toBe(30);
    expect(SETTING_DEFAULTS['auction.antiSnipeExtendLiveSec']).toBe(30);
    expect(SETTING_DEFAULTS['auction.antiSnipeLongSec']).toBe(600);
    expect(SETTING_DEFAULTS['auction.antiSnipeExtendLongSec']).toBe(600);
    expect(SETTING_DEFAULTS['auction.foreignClassMarkupPct']).toBe(50);
    expect(SETTING_DEFAULTS['auction.noBidTimeoutSec']).toBe(120);
  });
});

describe('parseSettingValue', () => {
  it('принимает валидное значение и отвергает вне диапазона', () => {
    expect(parseSettingValue('auction.step', 5)).toBe(5);
    expect(() => parseSettingValue('auction.step', 0)).toThrow();
    expect(() => parseSettingValue('auction.step', 1.5)).toThrow();
    expect(() => parseSettingValue('checkin.startSharePct', 101)).toThrow();
  });

  it('неизвестный ключ — ошибка', () => {
    expect(() => parseSettingValue('unknown.key', 1)).toThrow('Неизвестная настройка');
  });

  it('попыток ввода кода строго одна (защита от перебора, план 2.2)', () => {
    expect(parseSettingValue('checkin.attempts', 1)).toBe(1);
    expect(() => parseSettingValue('checkin.attempts', 2)).toThrow();
  });
});

describe('updateSettingsSchema', () => {
  it('валидирует набор ключ→значение', () => {
    const parsed = updateSettingsSchema.parse({ 'auction.step': 2 });
    expect(parsed).toEqual({ 'auction.step': 2 });
  });

  it('неизвестный ключ в наборе — ошибка', () => {
    expect(() => updateSettingsSchema.parse({ 'hacked.key': 1 })).toThrow();
  });
});

describe('gameTimeSettingsSchema', () => {
  it('валидирует якорь и длительности фаз', () => {
    const parsed = gameTimeSettingsSchema.parse({
      gameTimeAnchor: '2026-01-01T00:00:00Z',
      gameTimeDayMinutes: 90,
      gameTimeNightMinutes: 30,
    });
    expect(parsed.gameTimeAnchor).toBeInstanceOf(Date);
    expect(parsed.gameTimeDayMinutes).toBe(90);
  });

  it('отвергает нереалистичные длительности', () => {
    expect(() =>
      gameTimeSettingsSchema.parse({
        gameTimeAnchor: '2026-01-01T00:00:00Z',
        gameTimeDayMinutes: 0,
        gameTimeNightMinutes: 30,
      }),
    ).toThrow();
  });
});

describe('группы настроек не пересекаются', () => {
  it('checkin и auction не делят ключи', () => {
    const checkinKeys = Object.keys(CHECKIN_SETTINGS);
    const auctionKeys = Object.keys(AUCTION_SETTINGS);
    expect(checkinKeys.filter((k) => auctionKeys.includes(k))).toEqual([]);
  });
});
