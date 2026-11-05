import { performTestLogin } from './test-login';

describe('performTestLogin (issue #20)', () => {
  it('без AUTH_TEST_MODE — NOT_FOUND (ручки будто нет)', () => {
    expect(performTestLogin({ username: 'test-leader' }, undefined)).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
  });

  it('с флагом возвращает синтетическую сессию test-пользователя', () => {
    const result = performTestLogin({ username: 'test-officer' }, 'true');

    expect(result.ok).toBe(true);
    expect(result.user).toMatchObject({
      userId: 'test:test-officer',
      username: 'test-officer',
      isAdmin: false,
    });
  });

  it('не-тестовое имя отклоняется (защита от входа за реальных людей)', () => {
    const result = performTestLogin({ username: 'pndlvr' }, 'true');

    expect(result.ok).toBe(false);
    expect(result.user).toBeUndefined();
  });

  it('пустое тело отклоняется', () => {
    expect(performTestLogin({}, 'true').ok).toBe(false);
  });
});
