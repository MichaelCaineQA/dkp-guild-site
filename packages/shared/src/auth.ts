import { z } from 'zod';

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
  nickname: z.string().min(2).max(40),
});
export type CreateLinkRequestInput = z.infer<typeof createLinkRequestSchema>;
