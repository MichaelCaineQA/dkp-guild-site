/**
 * Чистая логика тестового входа (issue #20): валидация имени и сбор
 * синтетической сессии. Контроллер только кладёт результат в req.session.
 */

export interface TestLoginResult {
  ok: boolean
  error?: string
  user?: {
    userId: string
    username: string
    memberId: null
    rank: null
    isAdmin: boolean
  }
}

/** Разрешены только тестовые пользователи test-* — иначе можно войти за реального человека. */
export function performTestLogin(
  body: { username?: string },
  authTestMode: string | undefined,
): TestLoginResult {
  if (authTestMode !== 'true') {
    return { ok: false, error: 'NOT_FOUND' }
  }
  const username = body.username ?? ''
  if (!username.startsWith('test-')) {
    return { ok: false, error: 'Допустимы только тестовые пользователи (test-*)' }
  }
  return {
    ok: true,
    user: {
      userId: `test:${username}`,
      username,
      memberId: null,
      rank: null,
      isAdmin: false,
    },
  }
}
