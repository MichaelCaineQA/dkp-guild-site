import { describe, expect, it } from 'vitest';
import { blockMemberSchema, BLOCKABLE_RANKS, sessionUserSchema } from './index';

describe('blockMemberSchema (issue #149)', () => {
  it('комментарий обязателен, 3–500 символов, обрезается по краям', () => {
    expect(blockMemberSchema.safeParse({ comment: ' Покинул гильдию ' }).success).toBe(true);
    expect(blockMemberSchema.safeParse({ comment: 'ок' }).success).toBe(false);
    expect(blockMemberSchema.safeParse({ comment: '' }).success).toBe(false);
    expect(blockMemberSchema.safeParse({}).success).toBe(false);
    expect(blockMemberSchema.safeParse({ comment: 'а'.repeat(501) }).success).toBe(false);
  });

  it('блокировать можно только Офицеров и Рядовых', () => {
    expect(BLOCKABLE_RANKS.has('MEMBER')).toBe(true);
    expect(BLOCKABLE_RANKS.has('OFFICER')).toBe(true);
    // Главу не блокируем — передача главы отдельным механизмом (12.12);
    // админ — не член гильдии
    expect(BLOCKABLE_RANKS.has('GUILD_LEADER')).toBe(false);
    expect(BLOCKABLE_RANKS.has('ADMIN')).toBe(false);
  });
});

describe('sessionUserSchema.blocked', () => {
  it('по умолчанию false — старые сессии без поля остаются валидными', () => {
    const parsed = sessionUserSchema.parse({
      userId: 'u1',
      username: 'u',
      memberId: null,
      rank: null,
      isAdmin: false,
    });
    expect(parsed.blocked).toBe(false);
  });

  it('заблокированный отмечается явно', () => {
    const parsed = sessionUserSchema.parse({
      userId: 'u1',
      username: 'u',
      memberId: 'm1',
      rank: 'MEMBER',
      isAdmin: false,
      blocked: true,
    });
    expect(parsed.blocked).toBe(true);
  });
});
