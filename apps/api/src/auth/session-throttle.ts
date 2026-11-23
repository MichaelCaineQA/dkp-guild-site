import { normalizeIp, Throttle } from '@nestjs/throttler';
import type { AuthedRequest } from './auth.guard';

/** Независимое окно на действие и аккаунт; без сессии действует лимит по IP. */
export function SessionThrottle(limit: number) {
  return Throttle({
    default: {
      limit,
      ttl: 60_000,
      blockDuration: 0,
      getTracker: (_request, context) => {
        const req = context.switchToHttp().getRequest<AuthedRequest>();
        return req.session?.user
          ? `user:${req.session.user.userId}`
          : `ip:${normalizeIp(req.ip ?? req.socket.remoteAddress ?? '')}`;
      },
    },
  });
}
