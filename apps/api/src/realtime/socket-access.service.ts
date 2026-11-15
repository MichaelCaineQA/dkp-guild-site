import { Injectable } from '@nestjs/common';
import type { SessionUser } from '@dkp/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Актуальное членство для Socket.IO (аудит F02, issue #164).
 *
 * Cookie-сессия хранит снимок пользователя на момент входа: блокировка
 * (issue #149) или исчезновение Member в нём не отражаются. REST
 * перечитывает допуск в AuthGuard на каждом запросе — WS обязан делать
 * то же самое при handshake и подписке на лот, иначе уже открытое
 * соединение переживает блокировку и продолжает получать данные.
 */
@Injectable()
export class SocketAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Свежий пользователь по сессии. null — членства больше нет (доступ
   * закрыть); blocked=true — учётка заблокирована.
   */
  async refreshUser(user: SessionUser): Promise<SessionUser | null> {
    if (user.isAdmin) return { ...user, blocked: false };
    const member = await this.prisma.member.findUnique({
      where: { userId: user.userId },
      select: { id: true, rank: true, blockedAt: true },
    });
    if (!member) return null;
    return {
      ...user,
      memberId: member.id,
      rank: member.rank,
      blocked: member.blockedAt != null,
    };
  }
}
