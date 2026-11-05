import type { SessionUser } from '@dkp/shared';

/**
 * Расширение сессии express-session типом нашего пользователя.
 * Поле заполняется при входе и обнуляется при logout.
 */
declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
  }
}

export type { SessionUser };
