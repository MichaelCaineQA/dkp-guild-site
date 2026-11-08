import {
  Injectable,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { mergeMap } from 'rxjs';
import type { AuthedRequest } from '../auth/auth.guard';
import { AuditService } from './audit.service';

const AUDIT_KEY = 'audit:action';
interface AuditMetadata {
  action: string;
  entityType: string;
  comment: string;
}
/** Применяется только к действиям, которые ещё не пишут аудит в сервисе. */
export const AuditAction = (metadata: AuditMetadata) => SetMetadata(AUDIT_KEY, metadata);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const metadata = this.reflector.get<AuditMetadata | undefined>(AUDIT_KEY, context.getHandler());
    if (!metadata) return next.handle();
    return next.handle().pipe(
      mergeMap(async (result: unknown) => {
        if (result && typeof result === 'object' && 'ok' in result && result.ok === false)
          return result;
        const request = context.switchToHttp().getRequest<AuthedRequest>();
        const actor = request.session?.user;
        await this.audit.record({
          actorMemberId: actor?.memberId ?? null,
          actorIsAdmin: actor?.isAdmin ?? false,
          action: metadata.action,
          entityType: metadata.entityType,
          entityId: String(request.params.id ?? actor?.userId ?? 'unknown'),
          comment: `${metadata.comment}; аккаунт: ${actor?.userId ?? 'неизвестен'}`,
        });
        return result;
      }),
    );
  }
}
