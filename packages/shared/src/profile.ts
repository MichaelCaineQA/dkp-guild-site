import { z } from 'zod';
import { COMBAT_ROLES, type CombatRole, type Rank } from './domain';

/** Самостоятельно меняется только боевая роль; ник и ранг здесь запрещены. */
export const updateOwnProfileSchema = z
  .object({
    combatRole: z.enum(COMBAT_ROLES),
    comment: z.string().trim().min(3).max(500),
  })
  .strict();

export interface PlayerProfile {
  id: string;
  nickname: string;
  discord: string | null;
  rank: Rank;
  combatRole: CombatRole | null;
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
