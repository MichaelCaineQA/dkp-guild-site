import { z } from 'zod';
import { COMBAT_ROLES, type CombatRole, type Rank } from './domain';
import { weaponPairSchema, type Weapon } from './weapons';

/** Самостоятельно меняются роль и оружия; ник и ранг здесь запрещены. */
export const updateOwnProfileSchema = z
  .object({
    combatRole: z.enum(COMBAT_ROLES),
    weapons: weaponPairSchema,
    comment: z.string().trim().min(3).max(500),
  })
  .strict();

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
}

/** GS в общем составе/карточке/виджете команды — только Главе/Админу. */
export function canViewGuildGearScore(actor: import('./permissions').PermissionActor): boolean {
  return !!actor.isAdmin || actor.rank === 'GUILD_LEADER' || actor.rank === 'ADMIN';
}
