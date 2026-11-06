'use client';

import { useEffect, useState } from 'react';
import type { DkpBalanceRow } from '@dkp/shared';
import { useSession } from '../components/session-context';
import { api } from '../lib/api';
import { Badge, Card, Muted, Page, PageHeader, SectionTitle } from '../components/ui';

interface UpcomingEvent {
  id: string;
  eventTypeName: string;
  mode: string;
  startsAt: string;
  raidLeadName: string;
}

/**
 * Главная (ревью владельца, п.1): гостям — welcome-экран со входом
 * через Discord и входом администратора по логину-паролю; вошедшим —
 * дашборд со сводной информацией (полный список экранов принесёт
 * владелец; каркас: баланс, ближайшие ивенты, игровой цикл).
 */
export default function HomePage() {
  const { user, loading } = useSession();

  if (loading) {
    return <Page>Загрузка…</Page>;
  }

  if (!user) {
    return <WelcomeScreen />;
  }

  return <DashboardScreen memberId={user.memberId} />;
}

/** Гостевой экран: приветствие + вход через Discord + вход для админа. */
function WelcomeScreen() {
  const [showAdmin, setShowAdmin] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    } catch {
      setError('Не удалось войти');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
        <h1 className="text-4xl font-bold">Добро пожаловать в ДКП-систему гильдии</h1>
        <p className="max-w-lg text-secondary">
          Расписание ивентов, посещение чек-ин кодами, журнал ДКП и статистика.
          Чтобы продолжить, привяжите свою учётную запись Discord.
        </p>
        <div className="flex flex-col items-center gap-3">
          <a
            href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/discord`}
            className="rounded-lg bg-accent px-6 py-3 text-base font-semibold text-accent-contrast hover:bg-accent-hover"
          >
            Связать с Discord
          </a>
          <button
            type="button"
            className="text-sm text-secondary underline hover:text-primary"
            onClick={() => setShowAdmin((v) => !v)}
          >
            Вход для администратора
          </button>
        </div>

        {showAdmin && (
          <form onSubmit={adminLogin} className="flex w-full max-w-xs flex-col gap-2">
            <input
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-primary placeholder:text-disabled focus:border-accent focus:outline-none"
              placeholder="Логин администратора"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
            />
            <input
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-primary placeholder:text-disabled focus:border-accent focus:outline-none"
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
            {error && <p className="text-sm text-danger">{error}</p>}
          </form>
        )}
      </div>
    </Page>
  );
}

/** Дашборд вошедшего: баланс, ближайшие ивенты, игровой цикл (каркас). */
function DashboardScreen({ memberId }: { memberId: string | null }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingEvent[]>([]);

  useEffect(() => {
    // Непривязанный аккаунт (ждёт одобрения) — без запросов дашборда
    if (!memberId) {
      return;
    }
    api<DkpBalanceRow[]>(`/dkp/balances`)
      .then((rows) => setBalance(rows.find((r) => r.memberId === memberId)?.balance ?? 0))
      .catch(() => setBalance(null));
    const now = new Date().toISOString();
    api<UpcomingEvent[]>(`/events?from=${now}`)
      .then((events) => setUpcoming(events.slice(0, 5)))
      .catch(() => setUpcoming([]));
  }, [memberId]);

  return (
    <Page>
      <PageHeader title="Дашборд гильдии" subtitle="Сводка: баланс, ближайшие ивенты, игровое время." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <SectionTitle>Ваш баланс</SectionTitle>
          {memberId === null ? (
            <Muted>Аккаунт ждёт одобрения главой гильдии или админом</Muted>
          ) : balance === null ? (
            <Muted>Загрузка…</Muted>
          ) : (
            <p className="text-3xl font-bold tabular-nums">{balance} ДКП</p>
          )}
        </Card>
        <Card>
          <SectionTitle>Ближайшие ивенты</SectionTitle>
          {upcoming.length === 0 ? (
            <Muted>Запланированных ивентов нет</Muted>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {upcoming.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{event.eventTypeName}</Badge>
                  <Badge>{event.mode === 'PVE' ? 'PvE' : 'PvP'}</Badge>
                  <span className="font-medium">
                    {new Date(event.startsAt).toLocaleString('ru-RU', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <Muted>РЛ: {event.raidLeadName}</Muted>
                </li>
              ))}
            </ul>
          )}
          <a href="/schedule" className="mt-3 inline-block text-sm text-accent hover:underline">
            Всё расписание →
          </a>
        </Card>
      </div>
      <Card className="mt-4">
        <SectionTitle>Игровое время</SectionTitle>
        <p className="text-sm text-secondary">
          Текущая фаза и обратный отсчёт до смены день/ночь — в шапке сайта.
        </p>
      </Card>
    </Page>
  );
}
