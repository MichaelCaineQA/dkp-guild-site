import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Reflector } from '@nestjs/core';
import type { SessionUser } from './session.types';

export type RankName = 'GUILD_LEADER' | 'ADMIN' | 'OFFICER' | 'MEMBER';

/** Иерархия рангов: у кого больше — тот может больше (матрица 2.6). */
export const RANK_ORDER: Record<RankName, number> = {
  GUILD_LEADER: 3,
  ADMIN: 3,
  OFFICER: 2,
  MEMBER: 1,
};

export const MIN_RANK_KEY = 'auth:minRank';

/** Минимальный ранг для эндпоинта. Резервный админ проходит всегда. */
export const MinRank = (rank: RankName) => SetMetadata(MIN_RANK_KEY, rank);

/** Request с сессией (user — из SessionData) и профилем passport. */
export type AuthedRequest = Request & { user?: unknown };

/**
 * Пропускает только вошедших; при @MinRank проверяет ранг. Резервный админ
 * (isAdmin, без Member) приравнен к высшему рангу: технический доступ нужен
 * независимо от состава гильдии (план 2.6).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest & { session: { user?: SessionUser } }>();
    const user = request.session?.user;
    if (!user) {
      throw new UnauthorizedException('Требуется вход');
    }

    const minRank = this.reflector.getAllAndOverride<RankName | undefined>(MIN_RANK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (minRank === undefined || user.isAdmin) {
      return true;
    }
    if (user.rank === null || RANK_ORDER[user.rank] < RANK_ORDER[minRank]) {
      throw new UnauthorizedException('Недостаточно прав');
    }
    return true;
  }
}
