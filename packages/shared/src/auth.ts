import { z } from 'zod';
import { COMBAT_ROLES } from './domain';
import { weaponPairSchema } from './weapons';

/** Данные сессии пользователя API (httpOnly-cookie). */
export const sessionUserSchema = z.object({
  userId: z.string(),
  username: z.string(),
  /** id Member, если аккаунт привязан к члену гильдии. */
  memberId: z.string().nullable(),
  rank: z.enum(['GUILD_LEADER', 'ADMIN', 'OFFICER', 'MEMBER']).nullable(),
  /** true — резервный вход администратора (не Discord). */
  isAdmin: z.boolean().default(false),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

/** Заявка на привязку Discord ↔ член гильдии (план 2.9). */
export const createLinkRequestSchema = z.object({
  nickname: z.string().trim().min(2).max(40),
  combatRole: z.enum(COMBAT_ROLES),
  weapons: weaponPairSchema,
  gearScore: z.number().int().positive().safe(),
  screenshotIds: z
    .array(z.string().uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type CreateLinkRequestInput = z.infer<typeof createLinkRequestSchema>;

export const SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024;
export const SCREENSHOT_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export interface OnboardingRequest {
  id: string;
  nickname: string;
  combatRole: import('./domain').CombatRole | null;
  weapons: import('./weapons').Weapon[];
  gearScore: number | null;
  screenshotIds: string[];
  createdAt: string;
  user?: { username: string };
}
