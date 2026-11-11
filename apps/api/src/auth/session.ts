import { Logger } from '@nestjs/common';
import type { RequestHandler } from 'express';
import type { IncomingMessage } from 'node:http';
import session from 'express-session';
import { unsign } from 'cookie-signature';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';
import type { SessionUser } from '@dkp/shared';

const COOKIE_NAME = 'dkp.sid';
const logger = new Logger('Session');

const sessionSecret = (): string => process.env.SESSION_SECRET ?? 'dev-secret';

let store: session.Store | null = null;

/**
 * Единая сессия httpOnly-cookie (план 2.9): одна и та же для REST и
 * Socket.IO (issue #97 — handshake читает тот же store по cookie).
 * При заданном REDIS_URL сессии живут в Redis (переживают рестарт API и
 * видны всем инстансам), иначе — встроенный MemoryStore (один инстанс,
 * тесты). Store создаётся один раз на процесс.
 */
export function createSessionMiddleware(): RequestHandler {
  if (store) throw new Error('Сессия уже инициализирована');
  const redisUrl = process.env.REDIS_URL;
  store = redisUrl ? createRedisStore(redisUrl) : new session.MemoryStore();
  return session({
    name: COOKIE_NAME,
    secret: sessionSecret(),
    resave: false,
    saveUninitialized: false,
    store,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Secure по умолчанию в проде; COOKIE_SECURE=false — для запуска
      // в контейнере по http://localhost (docker compose, см. docker-compose.yml)
      secure: process.env.COOKIE_SECURE
        ? process.env.COOKIE_SECURE === 'true'
        : process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
    },
  });
}

/** Store текущего процесса — для тестов (положить сессию напрямую). */
export function getSessionStore(): session.Store {
  if (!store) throw new Error('Сессия ещё не инициализирована');
  return store;
}

/**
 * Пользователь из cookie-сессии произвольного HTTP-запроса — в первую
 * очередь handshake Socket.IO, который идёт мимо middleware Express.
 * null — нет сессии или нет входа.
 *
 * Ключ store — неподписанный id. Как и express-session при чтении:
 * срезаем префикс `s:` и снимаем подпись unsign(secret) — lookup по
 * подписанному значению целиком всегда промахивается (#100).
 */
export async function readSessionUser(req: IncomingMessage): Promise<SessionUser | null> {
  const signed = sidFromCookieHeader(req.headers.cookie);
  const sid =
    signed?.startsWith('s:') === true ? unsign(signed.slice(2), sessionSecret()) : false;
  const current = store;
  if (!sid || !current) return null;
  return new Promise((resolve) => {
    current.get(sid, (error, sess) => {
      if (error || !sess?.user) {
        resolve(null);
        return;
      }
      resolve(sess.user);
    });
  });
}

function createRedisStore(redisUrl: string): session.Store {
  const client = createClient({ url: redisUrl });
  // Ошибки соединения не должны ронять процесс; логируем и даём клиенту
  // переподключиться (connect-само собой через retryStrategy).
  client.on('error', (error: Error) => logger.warn(`Redis сессий: ${error.message}`));
  void client.connect();
  return new RedisStore({ client });
}

function sidFromCookieHeader(header: string | string[] | undefined): string | null {
  if (!header || Array.isArray(header)) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== COOKIE_NAME) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}
