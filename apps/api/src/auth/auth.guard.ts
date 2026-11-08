import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  ServiceUnavailableException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(
    private readonly reflector: Reflector,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthedRequest & { session: { user?: SessionUser } }>();
    const user = request.session?.user;
    if (!user) {
      throw new UnauthorizedException('Требуется вход');
    }

    if (!user.isAdmin && this.prisma?.member?.findUnique) {
      return this.prisma.member
        .findUnique({ where: { userId: user.userId }, select: { id: true, rank: true } })
        .then((member) => {
          user.memberId = member?.id ?? null;
          user.rank = member?.rank ?? null;
          return this.authorize(context, user);
        });
    }
    if (!user.isAdmin && !this.prisma?.member?.findUnique && process.env.NODE_ENV !== 'test')
      throw new ServiceUnavailableException('Не удалось проверить ранг');
    return this.authorize(context, user);
  }

  private authorize(context: ExecutionContext, user: SessionUser): boolean {
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
