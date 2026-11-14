import { describe, expect, it } from 'vitest';
import { orgCreateKpSchema, orgCreatePackSchema } from './org';

describe('Данные оргструктуры', () => {
  it('допускает пустую КП с непустым названием', () => {
    expect(orgCreateKpSchema.parse({ name: '  Первая  ' })).toEqual({
      name: 'Первая',
      packIds: [],
    });
  });

  it('отклоняет пустое название пака', () => {
    expect(orgCreatePackSchema.safeParse({ name: '  ', kpId: 'kp' }).success).toBe(false);
  });

  it('отклоняет повтор одного участника при создании пака', () => {
    expect(
      orgCreatePackSchema.safeParse({ name: 'Пак', kpId: 'kp', memberIds: ['m', 'm'] }).success,
    ).toBe(false);
  });
});
