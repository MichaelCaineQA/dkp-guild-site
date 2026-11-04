import { describe, expect, it } from 'vitest';
import { computeBalance } from './balance';

describe('computeBalance (журнал ДКП append-only)', () => {
  it('суммирует начисления и траты', () => {
    expect(computeBalance([{ amount: 10 }, { amount: -4 }, { amount: 10 }])).toBe(16);
  });

  it('пустой журнал даёт ноль', () => {
    expect(computeBalance([])).toBe(0);
  });

  it('баланс может уходить в минус только корректировкой', () => {
    expect(computeBalance([{ amount: -5 }])).toBe(-5);
  });
});
