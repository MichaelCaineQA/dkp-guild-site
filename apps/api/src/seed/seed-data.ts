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

/** Якорь игрового цикла: произвольная точка в прошлом, калибруется по игре (#7). */
export const SEED_GUILD: SeedGuild = {
  name: 'Гильдия',
  gameTimeAnchor: new Date('2026-01-01T00:00:00Z'),
  gameTimeDayMinutes: 90,
  gameTimeNightMinutes: 30,
};

/** Справочник типов ивентов — редактируется офицерами дальше сам. */
export const EVENT_TYPE_NAMES = ['Гильдбосс', 'Осада', 'Контракты', 'Спонтанный сбор'] as const;

/** Ключи настроек. Схемы валидации (zod) появятся в @dkp/shared в задаче #7. */
export const SEED_SETTINGS: SeedSetting[] = [
  // Чек-ин кодами (план 2.2, решение №7)
  { key: 'checkin.generateBeforeStartSec', value: 180 },
  { key: 'checkin.windowSec', value: 180 },
  { key: 'checkin.attempts', value: 1 },
  { key: 'checkin.startSharePct', value: 50 },
  { key: 'checkin.endSharePct', value: 50 },
  // Отсутствия (план 2.3, решение №6)
  { key: 'absence.deadlineBeforeStartSec', value: 180 },
  // Аукцион (план 6) — задел на этап 2
  { key: 'auction.step', value: 1 },
  { key: 'auction.liveDurationSec', value: 60 },
  { key: 'auction.longDurationDays', value: 2 },
  { key: 'auction.antiSnipeLiveSec', value: 30 },
  { key: 'auction.antiSnipeLongSec', value: 600 },
  { key: 'auction.foreignClassMarkupPct', value: 50 },
  { key: 'auction.noBidTimeoutSec', value: 120 },
];
