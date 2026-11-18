import { describe, it, expect } from 'vitest';
import { bidderProfileAtCreation, snapshotPrefersItem } from './bidder-profile';
describe('Снимок профиля на лоте', () => {
  it('возвращает исходную роль и предпочтение независимо от дальнейшего профиля', () => {
    expect(
      bidderProfileAtCreation(
        { player: { combatRole: 'DPS', preferredItemId: 'deleted-item' } },
        'player',
      ),
    ).toEqual({
      combatRole: 'DPS',
      preferredItemId: 'deleted-item',
      preferredArchbossItemId: null,
    });
  });
  it('не подставляет унаследованные свойства вместо снимка', () => {
    expect(bidderProfileAtCreation({}, 'constructor')).toBe(null);
  });
  it('нормализует архибосс-поле старых снимков (до #208) в null', () => {
    expect(
      bidderProfileAtCreation({ player: { combatRole: 'TANK', preferredItemId: null } }, 'player'),
    ).toEqual({ combatRole: 'TANK', preferredItemId: null, preferredArchbossItemId: null });
  });
  it('snapshotPrefersItem: скидка — на обычное или архибосс-желание (#208)', () => {
    const snapshot = { preferredItemId: 'item-1', preferredArchbossItemId: 'arch-1' };
    expect(snapshotPrefersItem(snapshot, 'item-1')).toBe(true);
    expect(snapshotPrefersItem(snapshot, 'arch-1')).toBe(true);
    expect(snapshotPrefersItem(snapshot, 'item-2')).toBe(false);
    expect(snapshotPrefersItem({ preferredItemId: null, preferredArchbossItemId: null }, 'x')).toBe(
      false,
    );
  });
});
