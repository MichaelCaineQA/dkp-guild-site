import { describe, expect, it } from 'vitest';
import { canEditOwnProfile } from './permissions';
import { updateOwnProfileSchema } from './profile';

describe('самостоятельное редактирование профиля', () => {
  it('разрешено только владельцу: ранг и права админа не дают чужой профиль', () => {
    for (const rank of ['MEMBER', 'OFFICER', 'GUILD_LEADER', 'ADMIN'] as const) {
      expect(canEditOwnProfile({ rank, memberId: 'own' }, 'own')).toBe(true);
      expect(canEditOwnProfile({ rank, memberId: 'own' }, 'other')).toBe(false);
    }
    expect(canEditOwnProfile({ rank: null, memberId: null, isAdmin: true }, 'other')).toBe(false);
    expect(canEditOwnProfile({ rank: null, memberId: 'own' }, 'own')).toBe(false);
  });

  it('запрещает чужие поля, пустую роль и комментарий из пробелов', () => {
    const valid = {
      weapons: ['STAFF', 'WAND'],
      combatRole: 'HEALER',
      comment: 'Меняю специализацию',
    };
    expect(updateOwnProfileSchema.safeParse(valid).success).toBe(true);
    for (const body of [
      { ...valid, rank: 'ADMIN' },
      { ...valid, nickname: 'Другой' },
      { ...valid, combatRole: null },
      { ...valid, comment: '   ' },
    ]) {
      expect(updateOwnProfileSchema.safeParse(body).success).toBe(false);
    }
  });
});
