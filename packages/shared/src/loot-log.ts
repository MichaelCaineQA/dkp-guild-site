import { z } from 'zod';

/**
 * Лут-лог (issue #99, план 2.4/2.9/6): публичная история полученного лута —
 * кто что взял и за сколько. Источник строк — только фактические выдачи
 * (LootAward): отменённые лоты и лоты без выдачи в лут-логе не представлены.
 * Стоимость строки — фактическое списание из append-only журнала ДКП;
 * исправление (смена победителя) не переписывает журнал — возврат и новое
 * списание добавляются новыми записями.
 */

/** Фильтры лут-лога: игрок / событие / предмет + пагинация (план 2.4). */
export const lootLogQuerySchema = z.object({
  memberId: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  itemId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type LootLogQuery = z.infer<typeof lootLogQuerySchema>;

/** Страница лут-лога с общим числом выдач под фильтром. */
export interface LootLogPage {
  entries: LootLogRow[];
  total: number;
}

/** Строка лут-лога: предмет, получатель, событие, фактическая стоимость. */
export interface LootLogRow {
  awardId: string;
  lotId: string;
  itemName: string;
  rarity: string | null;
  winnerId: string;
  winnerName: string;
  /** Фактическое списание из журнала ДКП (0 — ручная выдача без списания). */
  finalPrice: number;
  /** Применённая наценка «чужому» классу, % (0 — «родной» или вручную). */
  markupPct: number;
  /** Применённая скидка за предпочитаемый предмет, % (0 — не предпочитался). */
  discountPct: number;
  eventId: string;
  eventName: string;
  eventStartsAt: string;
  createdAt: string;
}

/** Полученный лут в профиле игрока (план 2.5): без получателя — он владелец. */
export interface ProfileLootRow {
  awardId: string;
  lotId: string;
  itemName: string;
  rarity: string | null;
  finalPrice: number;
  markupPct: number;
  /** Применённая скидка за предпочитаемый предмет, % (0 — не предпочитался). */
  discountPct: number;
  eventId: string;
  eventName: string;
  eventStartsAt: string;
  createdAt: string;
}

/** Сколько записей полученного лута отдаёт профиль (свежие сверху). */
export const PROFILE_LOOT_LIMIT = 50;
