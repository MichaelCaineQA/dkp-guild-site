import { describe, expect, it } from 'vitest';
import { weaponPairSchema, WEAPONS } from './weapons';
import { updateOwnProfileSchema } from './profile';
import { createLinkRequestSchema } from './auth';
import { createMemberSchema } from './members';

describe('оружия RU-сервера', () => {
  it('ровно восемь оружий; сферы и перчаток нет', () => {
    expect(WEAPONS).toHaveLength(8);
    expect(weaponPairSchema.safeParse(['STAFF', 'WAND']).success).toBe(true);
    for (const pair of [
      [],
      ['STAFF'],
      ['STAFF', 'STAFF'],
      ['STAFF', 'WAND', 'SPEAR'],
      ['ORB', 'STAFF'],
      ['GAUNTLETS', 'STAFF'],
    ]) {
      expect(weaponPairSchema.safeParse(pair).success).toBe(false);
    }
  });
  it('во всех формах нужны роль и пара оружий', () => {
    const input = {
      nickname: 'Игрок',
      combatRole: 'DPS',
      weapons: ['LONGBOW', 'DAGGERS'],
      comment: 'Меняю специализацию',
      gearScore: 1,
      screenshotIds: ['11111111-1111-4111-8111-111111111111'],
    };
    for (const schema of [createMemberSchema, createLinkRequestSchema]) {
      expect(schema.safeParse(input).success).toBe(true);
      expect(schema.safeParse({ ...input, combatRole: null }).success).toBe(false);
      expect(schema.safeParse({ ...input, weapons: [] }).success).toBe(false);
    }
    expect(
      updateOwnProfileSchema.safeParse({
        combatRole: input.combatRole,
        weapons: input.weapons,
        comment: input.comment,
      }).success,
    ).toBe(true);
  });
});
