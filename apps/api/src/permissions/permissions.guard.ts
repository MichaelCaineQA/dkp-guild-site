import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type Permission } from '@dkp/shared';
import type { AuthedRequest } from '../auth/auth.guard';
import type { SessionUser } from '../auth/session.types';

export const PERMISSION_KEY = 'permissions:required';

/** Какое право нужно эндпоинту (список см. PERMISSIONS в @dkp/shared). */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

/**
 * Проверка права по матрице 2.6 поверх входа (AuthGuard): ForbiddenException
 * для вошедшего без права — чтобы клиент отличал «войдите» от «нельзя».
 *
 * Для действий «РЛ ивента» target с raidLeadId резолвится в самом сервисе
 * через can() — guard проверяет только ранговую часть.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      AuthedRequest & { session?: { user?: SessionUser } }
    >();
    const user = request.session?.user;
    if (!user) {
      throw new UnauthorizedException('Требуется вход');
    }

    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (permission === undefined) {
      return true;
    }

    // Непривязанный Discord-аккаунт не является членом гильдии: состава не видит.
    if (!can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, permission)) {
      throw new ForbiddenException('Недостаточно прав');
    }
    return true;
  }
}
