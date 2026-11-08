import { GAME_TIME_DEFAULTS, SETTING_DEFAULTS } from '@dkp/shared';

/**
 * Стартовые данные (docs/PLAN.md: 2.1 типы ивентов, 2.2 окна чек-ина,
 * 2.3 дедлайн отсутствий, 6 параметры аукциона, 2.1 игровой цикл).
 *
 * Значения — дефолты из плана; после запуска меняются через настройки (#7)
 * без правки кода. Seed создаёт только отсутствующие настройки —
 * ручные значения не перетирает.
 */

export interface SeedGuild {
  name: string;
  gameTimeAnchor: Date;
  gameTimeDayMinutes: number;
  gameTimeNightMinutes: number;
}

export interface SeedSetting {
  key: string;
  value: number;
}

/**
 * Якорь игрового цикла по умолчанию: 01.01.2026 02:30:00 по Москве (UTC+3),
 * т.е. 2025-12-31T23:30:00Z — момент начала известной дневной фазы.
 */
export const SEED_GUILD: SeedGuild = {
  name: 'Гильдия',
  gameTimeAnchor: new Date('2025-12-31T23:30:00Z'),
  ...GAME_TIME_DEFAULTS,
};

/** Справочник типов ивентов — редактируется офицерами дальше сам. */
export const EVENT_TYPE_NAMES = ['Гильдбосс', 'Осада', 'Контракты', 'Спонтанный сбор'] as const;

/**
 * Ключи настроек с дефолтами из реестра @dkp/shared (задача #7):
 * единственный источник дефолтов — SETTINGS_REGISTRY/SETTING_DEFAULTS.
 */
export const SEED_SETTINGS: SeedSetting[] = (
  Object.keys(SETTING_DEFAULTS) as Array<keyof typeof SETTING_DEFAULTS>
).map((key) => ({
  key,
  value: SETTING_DEFAULTS[key],
}));
