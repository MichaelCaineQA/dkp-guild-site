import { z } from 'zod';

export const adminDkpGrantSchema = z
  .object({
    requestId: z.string().uuid(),
    memberId: z.string().min(1),
    amount: z.number().int().positive().max(2147483647),
    comment: z.string().trim().min(3).max(500),
  })
  .strict();
import { DKP_ENTRY_TYPES } from './domain';

/**
 * Журнал ДКП (issue #12, план 2.2, решение №4): публичная прозрачность —
 * операции и балансы видны всем членам гильдии. Журнал append-only:
 * PUT/DELETE-путей нет и не будет — «исправление» это новая ADJUSTMENT.
 */

/** Фильтры списка операций: игрок / ивент / тип / период + пагинация. */
export const dkpQuerySchema = z.object({
  memberId: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  type: z.enum(DKP_ENTRY_TYPES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type DkpQuery = z.infer<typeof dkpQuerySchema>;

/** Строка журнала для UI: кто, тип, сумма, автор, комментарий, ивент. */
export interface DkpEntryRow {
  id: string;
  memberId: string;
  memberName: string;
  type: string;
  amount: number;
  comment: string | null;
  eventId: string | null;
  createdAt: string;
}

/** Баланс члена гильдии. */
export interface DkpBalanceRow {
  memberId: string;
  memberName: string;
  balance: number;
}
