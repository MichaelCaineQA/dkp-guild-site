import type { DkpEntry } from './domain';

/**
 * Баланс игрока = сумма операций журнала ДКП (docs/PLAN.md, раздел 2.2).
 * Журнал append-only — «исправление» всегда новая операция, не правка старой.
 */
export function computeBalance(entries: ReadonlyArray<Pick<DkpEntry, 'amount'>>): number {
  return entries.reduce((sum, entry) => sum + entry.amount, 0);
}
