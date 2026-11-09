import { z } from 'zod';

/**
 * Справочник предметов (docs/PLAN.md, разделы 2.4 и 6, issue #92):
 * название, редкость, слот, рекомендованная стартовая цена и мультивыбор
 * «кому нужна» (ДД / Хил / Танк / Все). Ведут Офицер/Глава/Админ
 * (право items.manage), читают все члены гильдии.
 *
 * Один предмет справочника выставляется многократно отдельными лотами
 * (LootDrop → Auction), поэтому предмет нельзя удалить, пока на него
 * ссылаются лоты, — история лотов сохраняется.
 */

/** «Кому нужна» — целевые боевые роли предмета. ALL = без классовой наценки. */
export const ITEM_TARGET_ROLES = ['ALL', 'DPS', 'HEALER', 'TANK'] as const;
export type ItemTargetRole = (typeof ITEM_TARGET_ROLES)[number];

export const ITEM_TARGET_ROLE_LABELS: Record<ItemTargetRole, string> = {
  ALL: 'Все',
  DPS: 'ДД',
  HEALER: 'Хил',
  TANK: 'Танк',
};

/** Редкости предмета — подсказки для формы; в БД хранится строка. */
export const ITEM_RARITIES = [
  'Обычный',
  'Необычный',
  'Редкий',
  'Героический',
  'Эпический',
  'Легендарный',
] as const;

/** Слоты предмета — подсказки для формы; в БД хранится строка. */
export const ITEM_SLOTS = [
  'Оружие',
  'Голова',
  'Нагрудник',
  'Плечи',
  'Пояс',
  'Перчатки',
  'Сапоги',
  'Ожерелье',
  'Кольцо',
  'Браслет',
] as const;

const optionalLabel = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Не длиннее ${max} символов`)
    .optional()
    .transform((value) => (value ? value : null));

/** Ввод предмета справочника (создание и редактирование). */
export const itemInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Название обязательно')
    .max(80, 'Название: до 80 символов'),
  rarity: optionalLabel(40),
  slot: optionalLabel(40),
  targetRoles: z
    .array(z.enum(ITEM_TARGET_ROLES))
    .min(1, 'Выберите, кому нужен предмет')
    .transform((roles) => normalizeTargetRoles(roles)),
  defaultStartPrice: z
    .number()
    .int('Цена — целое число')
    .min(0, 'Цена не ниже 0')
    .max(1_000_000, 'Цена не выше 1 000 000')
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? null : value)),
});
export type ItemInput = z.infer<typeof itemInputSchema>;

/**
 * Нормализация мультивыбора «кому нужна»: «Все» несовместимо с конкретными
 * ролями — если выбрано «Все», остаётся только оно. Порядок фиксирован.
 */
export function normalizeTargetRoles(roles: readonly ItemTargetRole[]): ItemTargetRole[] {
  if (roles.includes('ALL')) return ['ALL'];
  return ITEM_TARGET_ROLES.filter((role) => role !== 'ALL' && roles.includes(role));
}

/** Подпись целевых ролей для списков и карточек. */
export function formatTargetRoles(roles: readonly ItemTargetRole[]): string {
  return normalizeTargetRoles(roles)
    .map((role) => ITEM_TARGET_ROLE_LABELS[role])
    .join(', ');
}

/**
 * Стартовая цена лота по предмету (план 6): рекомендованная цена из
 * справочника, если задана, иначе 0.
 */
export function itemStartPrice(item: { defaultStartPrice: number | null }): number {
  return item.defaultStartPrice ?? 0;
}

/** Строка справочника в API и UI. */
export interface ItemRow {
  id: string;
  name: string;
  rarity: string | null;
  slot: string | null;
  targetRoles: ItemTargetRole[];
  /** Рекомендованная стартовая цена; null — не задана (лот стартует с 0). */
  defaultStartPrice: number | null;
  /** Сколько раз предмет выставлялся лотами; занятый предмет не удаляется. */
  lotsCount: number;
}
