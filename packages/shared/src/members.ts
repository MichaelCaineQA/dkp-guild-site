import { z } from 'zod';
import { COMBAT_ROLES, RANKS } from './domain';
import { weaponPairSchema, WEAPONS } from './weapons';

/** Ник члена гильдии: игровой, 2–40 символов (как заявка на привязку). */
const nickname = z.string().min(2).max(40);

/** Создание члена: ник, обязательные роль и пара оружий; ранг опционален. */
export const createMemberSchema = z.object({
  nickname,
  combatRole: z.enum(COMBAT_ROLES),
  weapons: weaponPairSchema,
  rank: z.enum(RANKS).optional(),
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

/**
 * Редактирование члена (офицер+): ник, роль и пара оружий. Ранг — отдельной
 * ручкой members.change_rank (Глава/Админ + комментарий в аудит).
 */
export const updateMemberSchema = z.object({
  nickname,
  combatRole: z.enum(COMBAT_ROLES),
  weapons: weaponPairSchema,
});
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

/** Смена ранга: обязательный комментарий — он уходит в AuditLog (правило 4). */
export const changeRankSchema = z.object({
  rank: z.enum(RANKS),
  comment: z.string().trim().min(3).max(500),
});
export type ChangeRankInput = z.infer<typeof changeRankSchema>;

/** Фильтры списка состава: ранг и роль в бою (issue #6). */
export const rosterQuerySchema = z.object({
  weapon: z.enum(WEAPONS).optional(),
  rank: z.enum(RANKS).optional(),
  combatRole: z.enum(COMBAT_ROLES).optional(),
});
export type RosterQuery = z.infer<typeof rosterQuerySchema>;
