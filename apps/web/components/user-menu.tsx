'use client';

import { useSession } from './session-context';
import { Badge, Button } from './ui';

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
    return <span className="text-sm text-secondary">…</span>;
  }

  if (!user) {
    return (
      <a
        className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-contrast hover:bg-accent-hover"
        href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/discord`}
      >
        Войти через Discord
      </a>
    );
  }

  return (
    <span className="flex items-center gap-2 text-sm text-primary">
      {user.username}
      {user.rank && <Badge tone="accent">{RANK_LABELS[user.rank]}</Badge>}
      {user.isAdmin && <Badge>админ</Badge>}
      {!user.memberId && !user.isAdmin && (
        <a className="text-accent hover:underline" href="/link">
          привязать ник
        </a>
      )}
      <Button
        variant="secondary"
        onClick={async () => {
          const { api } = await import('../lib/api');
          await api('/auth/logout', { method: 'POST' }).catch(() => {});
          await reload();
        }}
      >
        Выйти
      </Button>
    </span>
  );
}
