'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { can, type Permission } from '@dkp/shared';
import { useSession } from './session-context';

/** Пункт навигации: показывается всем либо требует права (матрица 2.6). */
const NAV_ITEMS: Array<{ href: string; label: string; permission?: Permission }> = [
  { href: '/', label: 'Главная' },
  { href: '/roster', label: 'Состав', permission: 'members.view_roster' },
  { href: '/link-requests', label: 'Заявки', permission: 'link_requests.review' },
  { href: '/settings', label: 'Настройки', permission: 'items.manage' },
  { href: '/design', label: 'Дизайн', permission: 'members.view_roster' },
];

/** Навигация по сайту: ссылки видимы по правам сессии. */
export function NavMenu() {
  const { user, loading } = useSession();
  const pathname = usePathname();

  if (loading || !user) {
    return <span className="text-sm font-semibold text-primary">ДКП-система гильдии</span>;
  }

  const items = NAV_ITEMS.filter(
    (item) =>
      !item.permission ||
      can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, item.permission),
  );

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              active
                ? 'bg-accent-soft font-semibold text-accent'
                : 'text-secondary hover:bg-surface-muted hover:text-primary'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
