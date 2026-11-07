import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY, PermissionsGuard } from './permissions.guard';
import type { SessionUser } from '../auth/session.types';

function makeGuard(permission?: string): PermissionsGuard {
  const reflector = {
    getAllAndOverride: (key: string) => (key === PERMISSION_KEY ? permission : undefined),
  } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

function makeContext(user: SessionUser | undefined): ExecutionContext {
  const request = { session: user ? { user } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function session(partial: Partial<SessionUser>): SessionUser {
  return {
    userId: 'u1',
    username: 'u',
    memberId: 'm1',
    rank: 'MEMBER',
    isAdmin: false,
    ...partial,
  };
}

describe('PermissionsGuard', () => {
  it('без сессии — 401', () => {
    expect(() =>
      makeGuard('members.manage').canActivate(makeContext(undefined)),
    ).toThrow(UnauthorizedException);
  });

  it('рядовой на members.manage — 403 (вошёл, но нельзя)', () => {
    expect(() =>
      makeGuard('members.manage').canActivate(makeContext(session({}))),
    ).toThrow(ForbiddenException);
  });

  it('офицер на members.manage получает 403', () => {
    expect(() =>
      makeGuard('members.manage').canActivate(makeContext(session({ rank: 'OFFICER' }))),
    ).toThrow(ForbiddenException);
  });

  it('рядовой на members.view_roster проходит', () => {
    expect(makeGuard('members.view_roster').canActivate(makeContext(session({})))).toBe(true);
  });

  it('непривязанный аккаунт даже на view_roster — 403', () => {
    expect(() =>
      makeGuard('members.view_roster').canActivate(
        makeContext(session({ rank: null, memberId: null })),
      ),
    ).toThrow(ForbiddenException);
  });

  it('резервный админ проходит любое право', () => {
    expect(
      makeGuard('members.change_rank').canActivate(
        makeContext(session({ rank: null, memberId: null, isAdmin: true })),
      ),
    ).toBe(true);
  });

  it('эндпоинт без права — только вход', () => {
    expect(makeGuard(undefined).canActivate(makeContext(session({})))).toBe(true);
  });
});
