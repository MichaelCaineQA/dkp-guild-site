'use client';

import { useEffect, useState } from 'react';
import { OnboardingScreen } from './onboarding';
import { DashboardScreen } from './dashboard';
import { useSession } from './session-context';
import { api, API_URL_VALUE } from '../lib/api';
import { Page, Modal } from './ui';

/**
 * Главная (ревью владельца, п.1): гостям — welcome-экран со входом
 * через Discord и входом администратора по логину-паролю; вошедшим —
 * анкета и ожидание — до приёма; дашборд — одобренным игрокам.
 */
export default function HomePage() {
  const { user, loading } = useSession();

  if (loading) {
    return <Page>Загрузка…</Page>;
  }

  if (!user) {
    return <WelcomeScreen />;
  }

  if (!user.memberId && !user.isAdmin) return <OnboardingScreen />;

  return <DashboardScreen />;
}

/** Гостевой экран: приветствие + вход через Discord + вход для админа. */
function WelcomeScreen() {
  const [showAdmin, setShowAdmin] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discord, setDiscord] = useState<boolean | null>(null);
  const [providersError, setProvidersError] = useState(false);

  useEffect(() => {
    let active = true;
    void api<{ discord: boolean }>('/auth/providers')
      .then((providers) => {
        if (active) setDiscord(providers.discord);
      })
      .catch(() => {
        if (active) setProvidersError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const adminLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ ok: boolean }>('/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({ login, password }),
      });
      if (result.ok) {
        window.location.reload();
      } else {
        setError('Неверный логин или пароль');
      }
    } catch (err) {
      setError(
        (err as { status?: number }).status === 429
          ? 'Слишком много попыток. Повторите вход через 15 минут.'
          : 'Не удалось войти',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
        <h1 className="text-4xl font-bold">Добро пожаловать в ДКП-систему гильдии</h1>
        <p className="max-w-lg text-secondary">
          Расписание ивентов, посещение чек-ин кодами, журнал ДКП и статистика. Чтобы продолжить,
          привяжите свою учётную запись Discord.
        </p>
        <div className="flex flex-col items-center gap-3">
          {discord === true && (
            <a
              href={`${API_URL_VALUE}/auth/discord`}
              className="rounded-lg bg-accent px-6 py-3 text-base font-semibold text-accent-contrast hover:bg-accent-hover"
            >
              Связать с Discord
            </a>
          )}
          {discord === false && (
            <p className="text-sm text-secondary">Вход через Discord пока не настроен.</p>
          )}
          {discord === null && !providersError && (
            <p className="text-sm text-secondary">Проверка способов входа…</p>
          )}
          {providersError && (
            <p role="alert" className="text-sm text-danger">
              Не удалось проверить доступность Discord. Обновите страницу.
            </p>
          )}
          <button
            type="button"
            className="text-sm text-secondary underline hover:text-primary"
            onClick={() => setShowAdmin((v) => !v)}
          >
            Вход для администратора
          </button>
        </div>

        {showAdmin && (
          <Modal title="Вход для Админа" onClose={() => setShowAdmin(false)}>
            <form onSubmit={adminLogin} className="flex flex-col gap-3 text-left">
              <input
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-primary placeholder:text-disabled focus:border-accent focus:outline-none"
                aria-label="Логин администратора"
                placeholder="Логин администратора"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
              />
              <input
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-primary placeholder:text-disabled focus:border-accent focus:outline-none"
                aria-label="Пароль"
                placeholder="Пароль"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="submit"
                disabled={busy || !login || !password}
                className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-muted disabled:opacity-50"
              >
                Войти как администратор
              </button>
              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
              <button type="button" disabled={busy} onClick={() => setShowAdmin(false)}>
                Закрыть
              </button>
            </form>
          </Modal>
        )}
      </div>
    </Page>
  );
}
