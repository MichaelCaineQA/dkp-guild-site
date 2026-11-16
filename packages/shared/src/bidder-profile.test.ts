import { describe, it, expect } from 'vitest';
import { bidderProfileAtCreation } from './bidder-profile';
describe('Снимок профиля на лоте', () => {
  it('возвращает исходную роль и предпочтение независимо от дальнейшего профиля', () => {
    expect(
      bidderProfileAtCreation(
        { player: { combatRole: 'DPS', preferredItemId: 'deleted-item' } },
        'player',
      ),
    ).toEqual({ combatRole: 'DPS', preferredItemId: 'deleted-item' });
  });
  it('не подставляет унаследованные свойства вместо снимка', () => {
    expect(bidderProfileAtCreation({}, 'constructor')).toBe(null);
  });
});
