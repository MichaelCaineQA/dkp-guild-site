import { z } from 'zod';

/** Оружие RU-сервера: сфера и перчатки пока не доступны. */
export const WEAPONS = [
  'SWORD_SHIELD',
  'GREATSWORD',
  'DAGGERS',
  'CROSSBOW',
  'LONGBOW',
  'STAFF',
  'WAND',
  'SPEAR',
] as const;
export type Weapon = (typeof WEAPONS)[number];
export const WEAPON_LABELS: Record<Weapon, string> = {
  SWORD_SHIELD: 'Меч и щит',
  GREATSWORD: 'Двуручный меч',
  DAGGERS: 'Кинжалы',
  CROSSBOW: 'Арбалет',
  LONGBOW: 'Длинный лук',
  STAFF: 'Посох',
  WAND: 'Жезл и книга',
  SPEAR: 'Копьё',
};
export const weaponPairSchema = z
  .array(z.enum(WEAPONS))
  .length(2)
  .refine((pair) => pair[0] !== pair[1], 'Выберите два разных оружия');
export function formatWeapons(weapons: readonly Weapon[]): string {
  return weapons.length ? weapons.map((weapon) => WEAPON_LABELS[weapon]).join(' / ') : 'Не указано';
}
