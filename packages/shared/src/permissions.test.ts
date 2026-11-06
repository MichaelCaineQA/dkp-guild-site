import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  RAID_LEAD_ACTIONS,
  can,
  permissionsOf,
  rankAtLeast,
  type Permission,
  type PermissionActor,
} from './permissions';
import type { Rank } from './domain';

const actor = (partial: Partial<PermissionActor>): PermissionActor => ({
  rank: 'MEMBER',
  memberId: 'm-self',
  isAdmin: false,
  ...partial,
});

const ALL_RANKS: Rank[] = ['GUILD_LEADER', 'ADMIN', 'OFFICER', 'MEMBER'];

/** Ожидания матрицы 2.6: право → кто может (кроме РЛ ивента и админа). */
const EXPECTED: Partial<Record<Permission, Rank[]>> = {
  'members.manage': ['GUILD_LEADER', 'ADMIN', 'OFFICER'],
  'members.change_rank': ['GUILD_LEADER', 'ADMIN'],
  'members.view_roster': ALL_RANKS,
  'link_requests.review': ['GUILD_LEADER', 'ADMIN', 'OFFICER'],
  'settings.manage': ['GUILD_LEADER', 'ADMIN'],
  'rules.edit': ['GUILD_LEADER', 'ADMIN'],
  'events.manage': ['GUILD_LEADER', 'ADMIN', 'OFFICER'],
  'events.conduct': ['GUILD_LEADER', 'ADMIN', 'OFFICER'],
  'attendance.manual': ['GUILD_LEADER', 'ADMIN', 'OFFICER'],
  'absence.see': ['GUILD_LEADER', 'ADMIN'],
  'dkp.penalty': ['GUILD_LEADER', 'ADMIN', 'OFFICER'],
  'items.manage': ['GUILD_LEADER', 'ADMIN', 'OFFICER'],
  'auction.bid': ALL_RANKS,
  'profile.view': ALL_RANKS,
  'profile.edit_own': ALL_RANKS,
  'audit.view': ['GUILD_LEADER', 'ADMIN', 'OFFICER'],
};

describe('can: матрица прав 2.6', () => {
  // Проверяем каждое право на каждом ранге — полная таблица в тестах.
  for (const permission of PERMISSIONS) {
    const allowed = EXPECTED[permission];
    it(`${permission}: точно заявленным рангам`, () => {
      expect(allowed, `пропиши ожидание для ${permission}`).toBeDefined();
      for (const rank of ALL_RANKS) {
        const verdict = can(actor({ rank }), permission);
        expect(verdict, `${rank} × ${permission}`).toBe(allowed!.includes(rank));
      }
    });
  }

  it('непривязанный аккаунт (rank=null) не может ничего', () => {
    for (const permission of PERMISSIONS) {
      expect(can(actor({ rank: null, memberId: null }), permission)).toBe(false);
    }
  });

  it('резервный админ (isAdmin, без Member) может всё', () => {
    for (const permission of PERMISSIONS) {
      expect(can(actor({ rank: null, memberId: null, isAdmin: true }), permission)).toBe(true);
    }
  });
});

describe('can: права «РЛ ивента»', () => {
  // Актор-фикстура — memberId 'm-self', значит «свой» ивент — raidLeadId 'm-self'.
  const event = { raidLeadId: 'm-self' };

  it('рядовой-РЛ ведёт свой ивент (conduct/manual/see), но не создаёт ивенты', () => {
    const rl = actor({ rank: 'MEMBER' });
    expect(can(rl, 'events.conduct', event)).toBe(true);
    expect(can(rl, 'attendance.manual', event)).toBe(true);
    expect(can(rl, 'absence.see', event)).toBe(false); // «Увидел» — больше не право РЛ (решение владельца)
    expect(can(rl, 'events.manage', event)).toBe(false);
    expect(can(rl, 'members.manage', event)).toBe(false);
  });

  it('права РЛ не действуют на чужом ивенте и без target', () => {
    const rl = actor({ rank: 'MEMBER' });
    expect(can(rl, 'events.conduct', { raidLeadId: 'm-other' })).toBe(false);
    expect(can(rl, 'events.conduct')).toBe(false);
  });

  it('права РЛ не расширяются на действия вне множества РЛ', () => {
    for (const permission of PERMISSIONS) {
      const memberIsRl = can(actor({ rank: 'MEMBER' }), permission, event);
      if (!RAID_LEAD_ACTIONS.has(permission)) {
        expect(memberIsRl, `${permission} не должно быть правом РЛ`).toBe(
          can(actor({ rank: 'MEMBER' }), permission),
        );
      }
    }
  });
});

describe('rankAtLeast / permissionsOf', () => {
  it('глава и админ равны в иерархии, офицер выше рядового', () => {
    expect(rankAtLeast('GUILD_LEADER', 'ADMIN')).toBe(true);
    expect(rankAtLeast('ADMIN', 'GUILD_LEADER')).toBe(true);
    expect(rankAtLeast('OFFICER', 'MEMBER')).toBe(true);
    expect(rankAtLeast('MEMBER', 'OFFICER')).toBe(false);
  });

  it('permissionsOf: у рядового только права рядового', () => {
    const memberPerms = permissionsOf(actor({ rank: 'MEMBER' }));
    expect(memberPerms).toEqual(
      expect.arrayContaining(['members.view_roster', 'auction.bid', 'profile.edit_own']),
    );
    expect(memberPerms).not.toContain('members.manage');
    expect(memberPerms).not.toContain('members.change_rank');
  });

  it('permissionsOf: у главы всё', () => {
    expect(permissionsOf(actor({ rank: 'GUILD_LEADER' }))).toHaveLength(PERMISSIONS.length);
  });
});
