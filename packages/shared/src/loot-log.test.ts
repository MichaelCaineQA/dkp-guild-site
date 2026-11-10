import { describe, expect, it } from 'vitest';
import { lootLogQuerySchema, PROFILE_LOOT_LIMIT } from './loot-log';

/** Схема фильтров лут-лога (issue #99): каждый фильтр необязателен. */
describe('lootLogQuerySchema', () => {
  it('без параметров — дефолты пагинации', () => {
    expect(lootLogQuerySchema.parse({})).toEqual({
      memberId: undefined,
      eventId: undefined,
      itemId: undefined,
      limit: 50,
      offset: 0,
    });
  });

  it('каждый фильтр отдельно и в сочетании', () => {
    expect(lootLogQuerySchema.parse({ memberId: 'm1' }).memberId).toBe('m1');
    expect(lootLogQuerySchema.parse({ eventId: 'e1' }).eventId).toBe('e1');
    expect(lootLogQuerySchema.parse({ itemId: 'i1' }).itemId).toBe('i1');
    expect(
      lootLogQuerySchema.parse({ memberId: 'm1', eventId: 'e1', itemId: 'i1' }),
    ).toMatchObject({ memberId: 'm1', eventId: 'e1', itemId: 'i1' });
  });

  it('пагинация приводится из строк запроса', () => {
    expect(lootLogQuerySchema.parse({ limit: '10', offset: '20' })).toMatchObject({
      limit: 10,
      offset: 20,
    });
  });

  it('отрицательный offset и предел свыше 200 отклоняются', () => {
    expect(lootLogQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
    expect(lootLogQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
    expect(lootLogQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('пустая строка не проходит min(1) — «нет фильтра» это отсутствие ключа', () => {
    expect(lootLogQuerySchema.safeParse({ memberId: '' }).success).toBe(false);
  });

  it('лимит профиля положителен и ограничен сверху лимитом лут-лога', () => {
    expect(PROFILE_LOOT_LIMIT).toBeGreaterThan(0);
    expect(PROFILE_LOOT_LIMIT).toBeLessThanOrEqual(200);
  });
});
