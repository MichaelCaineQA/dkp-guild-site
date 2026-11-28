import { z } from 'zod';

// A change is effective at changedAt. Records must include both sides so
// dates before the first recorded transfer can be resolved without a backfill.
export const memberPackHistorySchema = z.object({
  memberId: z.string().min(1),
  previousPackId: z.string().min(1).nullable(),
  packId: z.string().min(1).nullable(),
  previousDirectKpId: z.string().min(1).nullable().optional(),
  directKpId: z.string().min(1).nullable().optional(),
  changedAt: z.date(),
});
export const packMembershipHistorySchema = z.object({
  packId: z.string().min(1),
  previousKpId: z.string().min(1),
  kpId: z.string().min(1),
  changedAt: z.date(),
});
export type MemberPackHistory = z.infer<typeof memberPackHistorySchema>;
export type PackMembershipHistory = z.infer<typeof packMembershipHistorySchema>;

function valueAt<T>(
  current: T,
  changes: readonly { previous: T; next: T; changedAt: Date }[],
  at: Date,
): T {
  const sorted = [...changes].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  let value = sorted.length ? sorted[0].previous : current;
  for (const change of sorted) {
    if (change.changedAt.getTime() > at.getTime()) break;
    value = change.next;
  }
  return value;
}

/** Pass only records for the member being resolved. */
export function memberPackAt(
  currentPackId: string | null,
  history: readonly MemberPackHistory[],
  at: Date,
): string | null {
  return valueAt(
    currentPackId,
    history.map((h) => ({ previous: h.previousPackId, next: h.packId, changedAt: h.changedAt })),
    at,
  );
}

export function memberDirectKpAt(
  currentKpId: string | null,
  history: readonly MemberPackHistory[],
  at: Date,
): string | null {
  return valueAt(
    currentKpId,
    history.map((h) => ({
      previous: h.previousDirectKpId ?? null,
      next: h.directKpId ?? null,
      changedAt: h.changedAt,
    })),
    at,
  );
}

/** Pass only records for the pack being resolved. */
export function packKpAt(
  currentKpId: string,
  history: readonly PackMembershipHistory[],
  at: Date,
): string {
  return valueAt(
    currentKpId,
    history.map((h) => ({ previous: h.previousKpId, next: h.kpId, changedAt: h.changedAt })),
    at,
  );
}
