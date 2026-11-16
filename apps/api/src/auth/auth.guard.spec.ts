import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PrismaService } from '../prisma/prisma.service';
import { ALLOW_BLOCKED_KEY, AuthGuard, MIN_RANK_KEY } from './auth.guard';
import type { SessionUser } from './session.types';

function makeGuard(minRank?: string, allowBlocked = false): AuthGuard {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === MIN_RANK_KEY ? minRank : key === ALLOW_BLOCKED_KEY ? allowBlocked : undefined,
  } as unknown as Reflector;
  return new AuthGuard(reflector);
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
    blocked: false,
    ...partial,
  };
}

describe('AuthGuard', () => {
  it('без сессии — 401', () => {
    expect(() => makeGuard().canActivate(makeContext(undefined))).toThrow(UnauthorizedException);
  });

  it('рядовой проходит эндпоинт без требования ранга', () => {
    expect(makeGuard().canActivate(makeContext(session({})))).toBe(true);
  });

  it('рядовой не проходит @MinRank(OFFICER)', () => {
    expect(() => makeGuard('OFFICER').canActivate(makeContext(session({})))).toThrow(
      UnauthorizedException,
    );
  });

  it('офицер проходит @MinRank(OFFICER), но не @MinRank(GUILD_LEADER)', () => {
    const officerCtx = makeContext(session({ rank: 'OFFICER' }));
    expect(makeGuard('OFFICER').canActivate(officerCtx)).toBe(true);

    expect(() => makeGuard('GUILD_LEADER').canActivate(officerCtx)).toThrow(UnauthorizedException);
  });

  it('глава проходит @MinRank(GUILD_LEADER)', () => {
    expect(
      makeGuard('GUILD_LEADER').canActivate(makeContext(session({ rank: 'GUILD_LEADER' }))),
    ).toBe(true);
  });

  it('резервный админ (без Member) проходит любой ранг', () => {
    const adminCtx = makeContext(session({ rank: null, isAdmin: true }));
    expect(makeGuard('GUILD_LEADER').canActivate(adminCtx)).toBe(true);
  });
  it('перечитывает ранг из БД и отменяет прежние права сессии', async () => {
    const user = session({ rank: 'OFFICER' });
    const reflector = {
      getAllAndOverride: (key: string) => (key === MIN_RANK_KEY ? 'OFFICER' : undefined),
    } as unknown as Reflector;
    const prisma = {
      member: { findUnique: async () => ({ id: 'm1', rank: 'MEMBER' }) },
    } as unknown as PrismaService;
    const guard = new AuthGuard(reflector, prisma);
    await expect(guard.canActivate(makeContext(user))).rejects.toThrow(UnauthorizedException);
    expect(user.rank).toBe('MEMBER');
  });

  it('заблокированный получает 403 на любом эндпоинте (issue #149)', () => {
    const blockedCtx = makeContext(session({ blocked: true }));
    expect(() => makeGuard().canActivate(blockedCtx)).toThrow(ForbiddenException);
    // Требование ранга не важно: врата закрыты раньше проверки прав
    expect(() => makeGuard('GUILD_LEADER').canActivate(blockedCtx)).toThrow(ForbiddenException);
  });

  it('заблокированный проходит только эндпоинт с @AllowBlocked() (/auth/me)', () => {
    expect(makeGuard(undefined, true).canActivate(makeContext(session({ blocked: true })))).toBe(
      true,
    );
  });

  it('админ не бывает заблокирован', () => {
    const adminCtx = makeContext(session({ rank: null, isAdmin: true, blocked: true }));
    expect(makeGuard('GUILD_LEADER').canActivate(adminCtx)).toBe(true);
  });

  it('перечитывает блокировку из БД: сессия ещё не знает о ней', async () => {
    const user = session({});
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === MIN_RANK_KEY ? undefined : key === ALLOW_BLOCKED_KEY ? false : undefined,
    } as unknown as Reflector;
    const prisma = {
      member: {
        findUnique: async () => ({ id: 'm1', rank: 'MEMBER', blockedAt: new Date() }),
      },
    } as unknown as PrismaService;
    const guard = new AuthGuard(reflector, prisma);
    await expect(guard.canActivate(makeContext(user))).rejects.toThrow(ForbiddenException);
    expect(user.blocked).toBe(true);
  });
});
