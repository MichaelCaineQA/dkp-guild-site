import { describe, expect, it } from 'vitest';
import {
  canManageKp,
  canMoveOrgMember,
  orgCreateKpSchema,
  orgCreatePackSchema,
  orgMoveMemberSchema,
} from './org';

const kpLeader = { rank: 'MEMBER' as const, memberId: 'leader' };
const ownKp = { leaderId: 'leader' };

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

  it('отклоняет запрос с двумя целями перевода', () => {
    expect(orgMoveMemberSchema.safeParse({ kpId: 'kp', packId: 'pack' }).success).toBe(false);
  });
});

describe('Права по назначению лидера КП', () => {
  it.each(['org.edit_kp', 'org.create_pack'] as const)('разрешает %s в своей КП', (action) => {
    expect(canManageKp(kpLeader, action, ownKp)).toBe(true);
  });

  it('добавляет в свою КП участника без КП и пака', () => {
    expect(canMoveOrgMember(kpLeader, ownKp, { kpId: null, packId: null })).toBe(true);
  });

  it.each([
    { kpId: 'kp', packId: null },
    { kpId: null, packId: 'pack' },
  ])('отклоняет назначение, если игрок уже состоит в группе %o', (member) => {
    expect(canMoveOrgMember(kpLeader, ownKp, member)).toBe(false);
  });
});
