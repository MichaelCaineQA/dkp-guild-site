import { describe, expect, it } from 'vitest';
import { raidLeadBonusAmount } from './raid-lead-bonus';

describe('Бонус рейд-лидера', () => {
  it.each([
    [0, 0],
    [1, 1],
    [25, 3],
    [50, 5],
  ])('за %i ДКП посещения начисляет %i ДКП бонуса', (checkInDkp, bonus) => {
    expect(raidLeadBonusAmount(checkInDkp)).toBe(bonus);
  });
});
