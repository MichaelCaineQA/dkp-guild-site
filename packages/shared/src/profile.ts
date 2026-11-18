import { z } from 'zod';
import { COMBAT_ROLES, type CombatRole, type Rank } from './domain';
import { weaponPairSchema, type Weapon } from './weapons';
import type { ProfileLootRow } from './loot-log';
import { primeTimeSlotSchema, timeZoneSchema, type PrimeTimeSlot } from './prime-time';
import { createLinkRequestSchema } from './auth';

export const addGearScoreSchema = createLinkRequestSchema
  .pick({ gearScore: true, screenshotIds: true })
  .extend({ comment: z.string().trim().min(3).max(500) })
  .strict();

/** Свежесть последней записи, подтверждённой скриншотом. */
export function isGearScoreStale(
  records: ReadonlyArray<{ createdAt: Date; screenshotIds: readonly string[] }>,
  thresholdDays: number,
  now: Date,
): boolean {
  const latest = records
    .filter((record) => record.screenshotIds.length > 0)
    .reduce<Date | null>(
      (date, record) => (!date || record.createdAt > date ? record.createdAt : date),
      null,
    );
  return latest !== null && now.getTime() - latest.getTime() > thresholdDays * 86_400_000;
}
export const AVATARS = [
  'AURORA',
  'EMBER',
  'FOREST',
  'OCEAN',
  'VIOLET',
  'GOLD',
  'IRON',
  'ROSE',
  'FOX',
  'WOLF',
  'DRAGON',
  'OWL',
  'RAVEN',
  'TIGER',
  'LION',
  'PANDA',
  'FROG',
  'BUTTERFLY',
  'PHOENIX',
  'UNICORN',
  'MOON',
  'COMET',
  'CRYSTAL',
  'POTION',
  'BOOK',
  'BOW',
  'SWORD',
  'CROWN',
  'MUSHROOM',
  'LOTUS',
  'SHELL',
  'LIGHTNING',
] as const;
export type Avatar = (typeof AVATARS)[number];
export const AVATAR_COLORS = [
  'ORANGE',
  'RED',
  'PINK',
  'PURPLE',
  'INDIGO',
  'BLUE',
  'CYAN',
  'TEAL',
  'GREEN',
  'LIME',
  'GOLD',
  'SLATE',
] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

/**
 * Самостоятельно меняются ник, роль и оружия; ранг здесь запрещён (для него
 * отдельная ручка Главы/Админа). Ник — 2–40 символов, уникален (аудит F03:
 * админский обход PATCH /members/:id удалён, ник меняет владелец сам).
 * Предпочитаемый предмет (план 2.4, решение 18) — один из справочника
 * аукциона, nullable (снятие выбора); смена роли и предмета ограничена
 * кулдауном (план 2.5). Желаемое архибосс-оружие (issue #208) — второй
 * предмет, только из отмеченных «Архибосс»; кулдаун у каждого поля свой.
 */
export const updateOwnProfileSchema = z
  .object({
    nickname: z.string().min(2).max(40).optional(),
    combatRole: z.enum(COMBAT_ROLES).optional(),
    weapons: weaponPairSchema.optional(),
    avatar: z.enum(AVATARS).nullable().optional(),
    avatarColor: z.enum(AVATAR_COLORS).nullable().optional(),
    preferredItemId: z.string().min(1, 'Выберите предмет').nullable().optional(),
    preferredArchbossItemId: z.string().min(1, 'Выберите предмет').nullable().optional(),
    timeZone: timeZoneSchema.optional(),
    primeTime: z.array(primeTimeSlotSchema).max(100).optional(),
    comment: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .refine((data) => (data.combatRole === undefined) === (data.weapons === undefined), {
    message: 'Укажите роль и два оружия вместе',
  });

export function canViewProfileGearScore(
  actor: import('./permissions').PermissionActor,
  memberId: string,
): boolean {
  return (
    !!actor.isAdmin ||
    actor.rank === 'GUILD_LEADER' ||
    actor.rank === 'ADMIN' ||
    (!!actor.rank && !!actor.memberId && actor.memberId === memberId)
  );
}
export interface PlayerProfile {
  timeZone: string;
  primeTime: PrimeTimeSlot[];
  avatar?: Avatar | null;
  avatarColor?: AvatarColor | null;
  gearScore?: { value: number; screenshotIds: string[]; createdAt: string; stale: boolean } | null;
  id: string;
  nickname: string;
  discord: string | null;
  rank: Rank;
  combatRole: CombatRole | null;
  weapons: Weapon[];
  /** Предпочитаемый предмет (план 2.4): null — не выбран. */
  preferredItem: { id: string; name: string } | null;
  /** Последняя смена предпочитаемого предмета — для кулдауна (план 2.5). */
  preferredItemChangedAt: string | null;
  /** Желаемое архибосс-оружие (issue #208): null — не выбран. */
  preferredArchbossItem: { id: string; name: string } | null;
  /** Последняя смена архибосс-оружия — для кулдауна (план 2.5, свой отсчёт). */
  preferredArchbossItemChangedAt: string | null;
  /** Последняя смена боевой роли — для кулдауна (план 2.5). */
  combatRoleChangedAt: string | null;
  balance: number;
  recentEntries: Array<{
    id: string;
    type: string;
    amount: number;
    comment: string | null;
    eventId: string | null;
    createdAt: string;
  }>;
  /** Полученный лут (план 2.5): свежие PROFILE_LOOT_LIMIT выдач сверху. */
  loot: ProfileLootRow[];
  lootTotal: number;
}

/** GS в общем составе/карточке/виджете команды — только Главе/Админу. */
export function canViewGuildGearScore(actor: import('./permissions').PermissionActor): boolean {
  return !!actor.isAdmin || actor.rank === 'GUILD_LEADER' || actor.rank === 'ADMIN';
}
