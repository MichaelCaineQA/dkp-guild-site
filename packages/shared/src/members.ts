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
 * Редактирование чужих личных полей (ник/роль/оружия) удалено (аудит F03,
 * план 2.5/12.11): их меняет сам игрок через PATCH /profiles/:id
 * (updateOwnProfileSchema); администрации остаётся смена ранга отдельной
 * ручкой members.change_rank.
 */

/** Смена ранга: обязательный комментарий — он уходит в AuditLog (правило 4). */
export const changeRankSchema = z.object({
  rank: z.enum(RANKS),
  comment: z.string().trim().min(3).max(500),
});
export type ChangeRankInput = z.infer<typeof changeRankSchema>;

/**
 * Блокировка/разблокировка учётки (issue #149): комментарий обязателен —
 * действие ручное и уходит в AuditLog.
 */
export const blockMemberSchema = z.object({
  comment: z.string().trim().min(3).max(500),
});
export type BlockMemberInput = z.infer<typeof blockMemberSchema>;

/**
 * Ранги, которые можно заблокировать (issue #149): Главу и админа блокировать
 * нельзя — передача главы идёт отдельным механизмом (12.12), админ — не член
 * гильдии. Данные заблокированного (ДКП, класс, лут) сохраняются.
 */
export const BLOCKABLE_RANKS: ReadonlySet<string> = new Set(['OFFICER', 'MEMBER']);

/** Фильтры списка состава: ранг и роль в бою (issue #6). */
export const rosterQuerySchema = z.object({
  weapon: z.enum(WEAPONS).optional(),
  rank: z.enum(RANKS).optional(),
  combatRole: z.enum(COMBAT_ROLES).optional(),
  availableNow: z.enum(['true']).optional(),
});
export type RosterQuery = z.infer<typeof rosterQuerySchema>;
