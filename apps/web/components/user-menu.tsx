'use client';

import { useSession } from './session-context';

const RANK_LABELS: Record<string, string> = {
  GUILD_LEADER: 'Глава',
  ADMIN: 'Админ',
  OFFICER: 'Офицер',
  MEMBER: 'Рядовой',
};

/** Меню пользователя в шапке: вход через Discord / данные сессии / выход. */
export function UserMenu() {
  const { user, loading, reload } = useSession();

  if (loading) {
    return <span className="user-menu">…</span>;
  }

  if (!user) {
    return (
      <a
        className="user-menu login"
        href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/discord`}
      >
        Войти через Discord
      </a>
    );
  }

  return (
    <span className="user-menu">
      {user.username}
      {user.rank && <span className="role-badge">{RANK_LABELS[user.rank]}</span>}
      {user.isAdmin && <span className="role-badge">админ</span>}
      {!user.memberId && !user.isAdmin && (
        <a href="/link" style={{ marginLeft: 8 }}>
          привязать ник
        </a>
      )}
      <button
        type="button"
        style={{ marginLeft: 8 }}
        onClick={async () => {
          const { api } = await import('../lib/api');
          await api('/auth/logout', { method: 'POST' }).catch(() => {});
          await reload();
        }}
      >
        Выйти
      </button>
    </span>
  );
}
