import type { IncomingMessage } from 'node:http';
import type { SessionData } from 'express-session';
import { sign } from 'cookie-signature';
import { createSessionMiddleware, getSessionStore, readSessionUser } from './session';
import type { SessionUser } from '@dkp/shared';

/**
 * readSessionUser (issue #97, приёмка #100): handshake Socket.IO читает
 * тот же store, что REST-middleware. Регрессия: ключом store служит
 * неподписанный id — lookup по подписанному значению `s:<id>.<sig>`
 * всегда промахивался и realtime-аутентификация падала.
 */

const USER: SessionUser = {
  userId: 'u-1',
  username: 'test-member',
  memberId: 'm-1',
  rank: 'MEMBER',
  isAdmin: false,
};

function reqWithCookie(cookie: string): IncomingMessage {
  return { headers: { cookie } } as IncomingMessage;
}

/** Минимальная SessionData с пользователем (как кладёт middleware после входа). */
function sessionData(): SessionData {
  return { cookie: { originalMaxAge: 0 }, user: USER } as unknown as SessionData;
}

function putSession(sid: string): Promise<void> {
  return new Promise((resolve) => getSessionStore().set(sid, sessionData(), () => resolve()));
}

/** Кука в формате express-session: `s:` + sign(sid, secret). */
function sessionCookie(sid: string, secret: string): string {
  return `dkp.sid=${encodeURIComponent('s:' + sign(sid, secret))}`;
}

describe('readSessionUser (приёмка #100)', () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = 'test-secret';
    createSessionMiddleware(); // store один на процесс, как в приложении
  });

  it('подписанная кука находит сессию по неподписанному ключу store', async () => {
    await putSession('sid-1');

    await expect(readSessionUser(reqWithCookie(sessionCookie('sid-1', 'test-secret')))).resolves.toEqual(
      USER,
    );
  });

  it('чужая подпись не открывает сессию', async () => {
    await putSession('sid-2');

    await expect(readSessionUser(reqWithCookie(sessionCookie('sid-2', 'wrong-secret')))).resolves.toBeNull();
  });

  it('без куки и без сессии в store — null', async () => {
    await expect(readSessionUser(reqWithCookie(''))).resolves.toBeNull();
    await expect(readSessionUser(reqWithCookie(sessionCookie('nope', 'test-secret')))).resolves.toBeNull();
  });
});
