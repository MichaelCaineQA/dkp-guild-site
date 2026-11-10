import { z } from 'zod';
import { COMBAT_ROLES, type CombatRole, type Rank } from './domain';
import { weaponPairSchema, type Weapon } from './weapons';
import type { ProfileLootRow } from './loot-log';
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

/** Самостоятельно меняются роль и оружия; ник и ранг здесь запрещены. */
export const updateOwnProfileSchema = z
  .object({
    combatRole: z.enum(COMBAT_ROLES).optional(),
    weapons: weaponPairSchema.optional(),
    avatar: z.enum(AVATARS).nullable().optional(),
    avatarColor: z.enum(AVATAR_COLORS).nullable().optional(),
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
  avatar?: Avatar | null;
  avatarColor?: AvatarColor | null;
  gearScore?: { value: number; screenshotIds: string[]; createdAt: string } | null;
  id: string;
  nickname: string;
  discord: string | null;
  rank: Rank;
  combatRole: CombatRole | null;
  weapons: Weapon[];
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
