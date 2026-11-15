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
      { ...valid, gearScore: 5000 },
      { ...valid, combatRole: null },
      { ...valid, comment: '   ' },
    ]) {
      expect(updateOwnProfileSchema.safeParse(body).success).toBe(false);
    }
  });

  it('ник — своё поле (аудит F03): 2–40 символов, самостоятельная смена', () => {
    expect(
      updateOwnProfileSchema.safeParse({ nickname: 'Новенький', comment: 'Сменил ник' }).success,
    ).toBe(true);
    expect(
      updateOwnProfileSchema.safeParse({ nickname: 'Я', comment: 'Слишком короткий' }).success,
    ).toBe(false);
    expect(
      updateOwnProfileSchema.safeParse({
        nickname: 'а'.repeat(41),
        comment: 'Слишком длинный',
      }).success,
    ).toBe(false);
  });
});
