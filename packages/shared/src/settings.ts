import { z } from 'zod';

/**
 * Реестр настроек системы (issue #7): игровые правила живут в модели Setting,
 * не константами в коде (AGENTS.md, правило 3). Ключи совпадают с seed'ом;
 * zod-схема — единственный источник валидации и дефолтов.
 *
 * Группа настроек определяет право записи: справочные (checkin, absence,
 * auction, dkp) — settings.manage (Глава/Админ); игровой цикл хранится на
 * Guild и редактируется тем же правом.
 */

interface SettingMeta {
  /** Человекочитаемая подпись для UI. */
  label: string;
  /** Единица измерения для UI. */
  unit?: string;
  /** Какую часть плана закрывает настройка. */
  plan: string;
}

const intSetting = (min: number, max: number) => z.number().int().min(min).max(max);

export const CHECKIN_SETTINGS = {
  'checkin.generateBeforeStartSec': {
    schema: intSetting(0, 3600),
    label: 'Генерация стартового кода до начала ивента',
    unit: 'сек',
    plan: '2.2',
  },
  'checkin.windowSec': {
    schema: intSetting(30, 3600),
    label: 'Окно выбора кода',
    unit: 'сек',
    plan: '2.2',
  },
  'checkin.attempts': {
    schema: intSetting(1, 1),
    label: 'Попыток ввода кода',
    unit: 'шт',
    plan: '2.2 (защита от перебора)',
  },
  'checkin.startSharePct': {
    schema: intSetting(0, 100),
    label: 'Доля платы за стартовый код',
    unit: '%',
    plan: '12 (решение 1)',
  },
  'checkin.endSharePct': {
    schema: intSetting(0, 100),
    label: 'Доля платы за финальный код',
    unit: '%',
    plan: '12 (решение 1)',
  },
} satisfies Record<string, SettingMeta & { schema: z.ZodType<number> }>;

export const ABSENCE_SETTINGS = {
  'absence.deadlineBeforeStartSec': {
    schema: intSetting(0, 86400),
    label: 'Дедлайн заявки на отсутствие до старта ивента',
    unit: 'сек',
    plan: '2.3 (решение 6)',
  },
} satisfies Record<string, SettingMeta & { schema: z.ZodType<number> }>;

export const AUCTION_SETTINGS = {
  'auction.step': {
    schema: intSetting(1, 1000),
    label: 'Минимальный шаг ставки',
    unit: 'очк.',
    plan: '6',
  },
  'auction.liveDurationSec': {
    schema: intSetting(30, 600),
    label: 'Длительность живой раздачи',
    unit: 'сек',
    plan: '6',
  },
  'auction.longDurationDays': {
    schema: intSetting(1, 14),
    label: 'Длительность длинного лота',
    unit: 'дн',
    plan: '6',
  },
  'auction.antiSnipeLiveSec': {
    schema: intSetting(0, 300),
    label: 'Анти-снайп живой раздачи (окно/продление)',
    unit: 'сек',
    plan: '6',
  },
  'auction.antiSnipeLongSec': {
    schema: intSetting(0, 7200),
    label: 'Анти-снайп длинного лота (окно/продление)',
    unit: 'сек',
    plan: '6',
  },
  'auction.foreignClassMarkupPct': {
    schema: intSetting(0, 500),
    label: 'Наценка «чужому» классу',
    unit: '%',
    plan: '6',
  },
  'auction.noBidTimeoutSec': {
    schema: intSetting(30, 3600),
    label: 'Тайм-аут лота без ставок (живая раздача)',
    unit: 'сек',
    plan: '6',
  },
} satisfies Record<string, SettingMeta & { schema: z.ZodType<number> }>;

/** Все настройки системы: ключ → схема + подпись. */
export const SETTINGS_REGISTRY = {
  ...CHECKIN_SETTINGS,
  ...ABSENCE_SETTINGS,
  ...AUCTION_SETTINGS,
} as const;

export type SettingKey = keyof typeof SETTINGS_REGISTRY;

/** Дефолты реестра — источник для seed и для новых ключей. */
export const SETTING_DEFAULTS: Record<SettingKey, number> = Object.fromEntries(
  (Object.keys(SETTINGS_REGISTRY) as SettingKey[]).map((key) => [
    key,
    SETTINGS_REGISTRY[key].schema.parse(
      (
        {
          'checkin.generateBeforeStartSec': 180,
          'checkin.windowSec': 180,
          'checkin.attempts': 1,
          'checkin.startSharePct': 50,
          'checkin.endSharePct': 50,
          'absence.deadlineBeforeStartSec': 180,
          'auction.step': 1,
          'auction.liveDurationSec': 60,
          'auction.longDurationDays': 2,
          'auction.antiSnipeLiveSec': 30,
          'auction.antiSnipeLongSec': 600,
          'auction.foreignClassMarkupPct': 50,
          'auction.noBidTimeoutSec': 120,
        } as Record<SettingKey, number>
      )[key],
    ),
  ]),
) as Record<SettingKey, number>;

/** Валидация значения настройки по ключу (неизвестный ключ — ошибка). */
export function parseSettingValue(key: string, value: unknown): number {
  const meta = SETTINGS_REGISTRY[key as SettingKey];
  if (!meta) {
    throw new Error(`Неизвестная настройка: ${key}`);
  }
  return meta.schema.parse(value);
}

/** Игровой цикл (план 2.1): якорь + длительности, хранится на Guild. */
export const gameTimeSettingsSchema = z.object({
  gameTimeAnchor: z.coerce.date(),
  gameTimeDayMinutes: intSetting(10, 720),
  gameTimeNightMinutes: intSetting(5, 360),
});
export type GameTimeSettings = z.infer<typeof gameTimeSettingsSchema>;

/** Запись настроек: произвольный набор ключ→значение, все валидируются. */
export const updateSettingsSchema = z.record(
  z.string().refine((key): key is SettingKey => key in SETTINGS_REGISTRY, {
    message: 'Неизвестная настройка',
  }),
  z.number(),
);
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
