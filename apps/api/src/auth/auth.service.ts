import { Injectable, Logger } from '@nestjs/common';
import type { SessionUser } from './session.types';

/** Минимальный интерфейс БД для AuthService — для юнит-тестов без Prisma. */
export interface AuthDb {
  user: {
    count(): Promise<number>;
    findFirst(args: {
      where: { username: string };
      include: { member: { select: { id: true; rank: true } } };
    }): Promise<UserRow | null>;
    findUnique(args: {
      where: { id: string };
      include: { member: { select: { id: true; rank: true } } };
    }): Promise<UserRow | null>;
    upsert(args: {
      where: { discordId: string };
      create: { discordId: string; username: string };
      update: { username: string };
      include: { member: { select: { id: true; rank: true } } };
    }): Promise<UserRow>;
  };
  member: {
    create(args: {
      data: { userId: string; nickname: string; rank: string };
    }): Promise<{ id: string; rank: string }>;
  };
}

export interface UserRow {
  id: string;
  username: string;
  discordId: string | null;
  member: { id: string; rank: string } | null;
}

export interface DiscordProfile {
  discordId: string;
  username: string;
}

/**
 * Вход через Discord (план 2.9):
 *  - первый вошедший пользователь получает Member с рангом GUILD_LEADER
 *    (bootstrap гильдии);
 *  - последующие — просто аккаунты без Member, до подтверждения привязки
 *    офицером (заявки — LinkRequestService);
 *  - привязанным актуальный ранг приезжает из БД при каждом входе.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly db: AuthDb) {}

  /**
   * Discord-вход: upsert пользователя. Главой первый вошедший больше
   * не становится (решение владельца): единственный Глава — тестовый
   * пользователь из db:seed:test (на проде назначается при инициализации);
   * новые Discord-аккаунты ждут одобрения заявки главой/админом.
   */
  async loginWithDiscord(profile: DiscordProfile): Promise<SessionUser> {
    const user = await this.db.user.upsert({
      where: { discordId: profile.discordId },
      create: { discordId: profile.discordId, username: profile.username },
      update: { username: profile.username },
      include: { member: { select: { id: true, rank: true } } },
    });

    return this.toSessionUser(user);
  }

  /** Свежие данные пользователя по id (перечитать ранг/привязку из БД). */
  async getSessionUser(userId: string): Promise<SessionUser | null> {
    // Резервный админ — синтетическая сессия, в БД его нет.
    if (userId.startsWith('admin:')) {
      return {
        userId,
        username: userId.slice('admin:'.length),
        memberId: null,
        rank: null,
        isAdmin: true,
      };
    }
    // Тестовые пользователи e2e (issue #20): User в БД создаёт db:seed:test,
    // ранг и Member перечитываются из него. isAdmin всегда false — он
    // зарезервирован за резервным админом (admin:).
    if (userId.startsWith('test:')) {
      const username = userId.slice('test:'.length);
      const user = await this.db.user.findFirst({
        where: { username },
        include: { member: { select: { id: true, rank: true } } },
      });
      if (!user) {
        return { userId, username, memberId: null, rank: null, isAdmin: false };
      }
      return {
        userId: user.id,
        username: user.username,
        memberId: user.member?.id ?? null,
        rank: (user.member?.rank as SessionUser['rank']) ?? null,
        isAdmin: false,
      };
    }
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { member: { select: { id: true, rank: true } } },
    });
    return user ? this.toSessionUser(user) : null;
  }

  /** Резервный вход администратора: сравнение с env-значениями (timing-safe). */
  isAdminCredentials(
    login: string,
    password: string,
    env: { login?: string; password?: string },
  ): boolean {
    if (!env.login || !env.password) {
      return false; // резервный вход не настроен
    }
    return safeEqual(login, env.login) && safeEqual(password, env.password);
  }

  private toSessionUser(user: UserRow): SessionUser {
    return {
      userId: user.id,
      username: user.username,
      memberId: user.member?.id ?? null,
      rank: (user.member?.rank as SessionUser['rank']) ?? null,
      isAdmin: user.discordId === null,
    };
  }
}

/** Сравнение строк без утечки времени (длины различаются — сразу false). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
