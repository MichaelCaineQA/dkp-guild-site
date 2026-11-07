import { describe, it, expect } from 'vitest';
import { createLinkRequestSchema } from './auth';
import { canViewProfileGearScore } from './profile';
const input = {
  nickname: ' Игрок ',
  combatRole: 'DPS',
  weapons: ['STAFF', 'WAND'],
  gearScore: 1,
  screenshotIds: ['11111111-1111-4111-8111-111111111111'],
};
describe('Первая анкета', () => {
  it('принимает любой положительный безопасный целый GS без игрового порога', () => {
    for (const gearScore of [1, 500, 2147483648, Number.MAX_SAFE_INTEGER])
      expect(createLinkRequestSchema.safeParse({ ...input, gearScore }).success).toBe(true);
    expect(createLinkRequestSchema.parse(input).nickname).toBe('Игрок');
  });
  it.each([0, -1, 1.5, NaN, Infinity, '100', undefined])('отклоняет GS %s', (gearScore) =>
    expect(createLinkRequestSchema.safeParse({ ...input, gearScore }).success).toBe(false),
  );
  it('не принимает отсутствующие, произвольные или повторяющиеся id файлов', () => {
    for (const screenshotIds of [
      [],
      ['../../file'],
      [input.screenshotIds[0], input.screenshotIds[0]],
    ])
      expect(createLinkRequestSchema.safeParse({ ...input, screenshotIds }).success).toBe(false);
  });
});
describe('GS в профиле', () => {
  it('свой GS доступен члену, чужой — только Главе/Админу', () => {
    expect(canViewProfileGearScore({ rank: 'MEMBER', memberId: 'm' }, 'm')).toBe(true);
    for (const rank of ['MEMBER', 'OFFICER'] as const)
      expect(canViewProfileGearScore({ rank, memberId: 'other' }, 'm')).toBe(false);
    for (const rank of ['GUILD_LEADER', 'ADMIN'] as const)
      expect(canViewProfileGearScore({ rank }, 'm')).toBe(true);
    expect(canViewProfileGearScore({ rank: null, isAdmin: true }, 'm')).toBe(true);
    expect(canViewProfileGearScore({ rank: null }, 'm')).toBe(false);
  });
});
